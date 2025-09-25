import { Process, Processor } from '@nestjs/bull'
import { InjectModel } from '@nestjs/mongoose'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { Model } from 'mongoose'
import { Campaign, CampaignDocument, CampaignStatus, ScheduleType } from '../schemas/campaign.schema'
import { CampaignMessage, CampaignMessageDocument, MessageStatus } from '../schemas/campaign-message.schema'
import { Device, DeviceDocument } from '../../gateway/schemas/device.schema'
import { SmsQueueService } from '../../gateway/queue/sms-queue.service'
import { UsagePlanService } from '../../gateway/usage-plan.service'

interface CampaignProcessJob {
  campaignId: string
  userId: string
}

@Processor('campaign-queue')
export class CampaignQueueProcessor {
  private readonly logger = new Logger(CampaignQueueProcessor.name)

  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignMessage.name) private campaignMessageModel: Model<CampaignMessageDocument>,
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    private smsQueueService: SmsQueueService,
    private usagePlanService: UsagePlanService,
  ) {}

  @Process({
    name: 'process-campaign',
    concurrency: 5,
  })
  async processCampaign(job: Job<CampaignProcessJob>) {
    const { campaignId, userId } = job.data
    this.logger.debug(`Processing campaign ${campaignId} for user ${userId}`)

    try {
      const campaign = await this.campaignModel.findById(campaignId)
      if (!campaign) {
        this.logger.error(`Campaign ${campaignId} not found`)
        return
      }

      if (campaign.status !== CampaignStatus.RUNNING) {
        this.logger.debug(`Campaign ${campaignId} is not running, skipping`)
        return
      }

      // Get available devices for this campaign
      const devices = await this.deviceModel
        .find({
          _id: { $in: campaign.sendDevices },
          user: userId,
          enabled: true,
        })
        .exec()

      if (devices.length === 0) {
        this.logger.error(`No available devices for campaign ${campaignId}`)
        await this.markCampaignAsFailed(campaign, 'No available devices')
        return
      }

      // Schedule messages based on campaign type and current time
      await this.scheduleMessages(campaign, devices)

    } catch (error) {
      this.logger.error(`Error processing campaign ${campaignId}:`, error)
      const campaign = await this.campaignModel.findById(campaignId)
      if (campaign) {
        await this.markCampaignAsFailed(campaign, error.message)
      }
    }
  }

  @Process({
    name: 'schedule-messages',
    concurrency: 10,
  })
  async scheduleMessagesJob(job: Job<{ campaignId: string }>) {
    const { campaignId } = job.data

    const campaign = await this.campaignModel.findById(campaignId)
    if (!campaign || campaign.status !== CampaignStatus.RUNNING) {
      return
    }

    const devices = await this.deviceModel
      .find({
        _id: { $in: campaign.sendDevices },
        enabled: true,
      })
      .exec()

    await this.scheduleMessages(campaign, devices)
  }

  private async scheduleMessages(campaign: CampaignDocument, devices: DeviceDocument[]) {
    const now = new Date()

    // Check if we're in a valid sending window
    if (!this.isInSendingWindow(campaign, now)) {
      this.logger.debug(`Campaign ${campaign._id} not in sending window, rescheduling`)
      // Reschedule for next available window
      await this.rescheduleForNextWindow(campaign)
      return
    }

    // Get pending messages that need to be scheduled
    const pendingMessages = await this.campaignMessageModel
      .find({
        campaign: campaign._id,
        status: MessageStatus.PENDING,
      })
      .limit(100) // Process in batches
      .sort({ priority: -1, createdAt: 1 })
      .exec()

    if (pendingMessages.length === 0) {
      // Campaign is complete
      await this.checkCampaignCompletion(campaign)
      return
    }

    // Assign messages to devices and schedule them
    let deviceIndex = 0
    const messagesToSchedule = []

    for (const message of pendingMessages) {
      const device = devices[deviceIndex % devices.length]

      // Check device availability and rate limits
      const canSend = await this.canDeviceSendNow(device)
      if (!canSend) {
        deviceIndex++
        continue
      }

      // Schedule message for immediate sending or delayed based on device rate limits
      const scheduledTime = await this.calculateNextAvailableSlot(device)

      message.status = MessageStatus.SCHEDULED
      message.assignedDevice = device._id.toString()
      message.scheduledTime = scheduledTime

      messagesToSchedule.push(message)
      deviceIndex++
    }

    // Save scheduled messages
    if (messagesToSchedule.length > 0) {
      await Promise.all(messagesToSchedule.map(msg => msg.save()))

      // Queue messages for sending
      await this.queueScheduledMessages(messagesToSchedule)
    }

    // Update campaign stats
    await this.updateCampaignStats(campaign)

    // Schedule next batch if there are more pending messages
    const remainingPending = await this.campaignMessageModel.countDocuments({
      campaign: campaign._id,
      status: MessageStatus.PENDING,
    })

    if (remainingPending > 0) {
      // Schedule next batch processing
      await this.scheduleNextBatch(campaign)
    }
  }

  private isInSendingWindow(campaign: CampaignDocument, now: Date): boolean {
    const campaignDate = now.toISOString().split('T')[0]

    // Check if we're within campaign date range
    if (campaignDate < campaign.campaignStartDate || campaignDate > campaign.campaignEndDate) {
      return false
    }

    // For 'now' and 'later' schedule types, we can send anytime within date range
    if (campaign.scheduleType === ScheduleType.NOW || campaign.scheduleType === ScheduleType.LATER) {
      return true
    }

    // For 'windows' schedule type
    if (campaign.scheduleType === ScheduleType.WINDOWS && campaign.sendingWindows) {
      return campaign.sendingWindows.some(window => {
        const windowStart = new Date(`${window.startDate}T${window.startTime}`)
        const windowEnd = new Date(`${window.endDate}T${window.endTime}`)
        return now >= windowStart && now <= windowEnd
      })
    }

    // For 'weekday' schedule type
    if (campaign.scheduleType === ScheduleType.WEEKDAY && campaign.weekdayWindows && campaign.weekdayEnabled) {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      const currentDay = dayNames[now.getDay()]

      if (!campaign.weekdayEnabled[currentDay]) {
        return false
      }

      const todayWindows = campaign.weekdayWindows[currentDay]
      if (!todayWindows || todayWindows.length === 0) {
        return false
      }

      const currentTime = now.getHours() * 60 + now.getMinutes()

      return todayWindows.some(window => {
        const [startHour, startMin] = window.startTime.split(':').map(Number)
        const [endHour, endMin] = window.endTime.split(':').map(Number)
        const startTime = startHour * 60 + startMin
        const endTime = endHour * 60 + endMin

        return currentTime >= startTime && currentTime <= endTime
      })
    }

    return false
  }

  private async canDeviceSendNow(device: DeviceDocument): Promise<boolean> {
    try {
      // Check if device is on cooldown
      if (device.is_on_cooldown && device.cooldown_until) {
        if (new Date() < device.cooldown_until) {
          return false
        }
      }

      // Check current tier limits
      const currentTier = await this.usagePlanService.getCurrentTierForDevice(device)
      if (!currentTier) {
        return false
      }

      // Check if daily limit exceeded
      if (device.messages_sent_today >= currentTier.dailyLimit) {
        return false
      }

      // Check hourly rate limit (simplified)
      if (device.messages_sent_this_hour >= currentTier.timeDelayBetweenMessages / 60) {
        return false
      }

      return true
    } catch (error) {
      this.logger.error(`Error checking device availability:`, error)
      return false
    }
  }

  private async calculateNextAvailableSlot(device: DeviceDocument): Promise<Date> {
    const now = new Date()

    // Get current tier to determine delay
    const currentTier = await this.usagePlanService.getCurrentTierForDevice(device)
    if (!currentTier) {
      return now
    }

    // Add delay based on tier settings
    const delayMs = currentTier.timeDelayBetweenMessages * 1000
    return new Date(now.getTime() + delayMs)
  }

  private async queueScheduledMessages(messages: CampaignMessageDocument[]) {
    // Group messages by device and scheduled time
    const messageGroups = new Map<string, CampaignMessageDocument[]>()

    for (const message of messages) {
      const key = `${message.assignedDevice}-${message.scheduledTime?.getTime()}`
      if (!messageGroups.has(key)) {
        messageGroups.set(key, [])
      }
      messageGroups.get(key)!.push(message)
    }

    // Queue each group
    for (const [key, groupMessages] of messageGroups) {
      const device = groupMessages[0].assignedDevice
      const scheduledTime = groupMessages[0].scheduledTime

      if (scheduledTime && device) {
        // TODO: Queue messages for sending through SMS queue
        // This would integrate with the existing SMS queue system
        this.logger.debug(`Queued ${groupMessages.length} messages for device ${device} at ${scheduledTime}`)

        // For now, mark as queued
        await this.campaignMessageModel.updateMany(
          { _id: { $in: groupMessages.map(m => m._id) } },
          { status: MessageStatus.QUEUED }
        )
      }
    }
  }

  private async rescheduleForNextWindow(campaign: CampaignDocument) {
    // Schedule the next processing job for the next available window
    const nextWindow = this.getNextSendingWindow(campaign)
    if (nextWindow) {
      // Schedule job for next window
      this.logger.debug(`Rescheduling campaign ${campaign._id} for ${nextWindow}`)
      // TODO: Schedule job with delay
    }
  }

  private getNextSendingWindow(campaign: CampaignDocument): Date | null {
    const now = new Date()

    // Implementation depends on schedule type
    // This would calculate the next available sending window
    // For now, return 1 hour from now as a simple fallback
    return new Date(now.getTime() + 60 * 60 * 1000)
  }

  private async scheduleNextBatch(campaign: CampaignDocument) {
    // Schedule next batch processing in 1 minute
    const delay = 60 * 1000 // 1 minute

    // TODO: Add job to queue with delay
    this.logger.debug(`Scheduling next batch for campaign ${campaign._id} in ${delay}ms`)
  }

  private async updateCampaignStats(campaign: CampaignDocument) {
    const stats = await this.campaignMessageModel.aggregate([
      { $match: { campaign: campaign._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ])

    let sentMessages = 0
    let failedMessages = 0
    let pendingMessages = 0

    for (const stat of stats) {
      switch (stat._id) {
        case MessageStatus.SENT:
          sentMessages = stat.count
          break
        case MessageStatus.FAILED:
          failedMessages = stat.count
          break
        case MessageStatus.PENDING:
        case MessageStatus.SCHEDULED:
        case MessageStatus.QUEUED:
          pendingMessages += stat.count
          break
      }
    }

    await this.campaignModel.findByIdAndUpdate(campaign._id, {
      sentMessages,
      failedMessages,
      pendingMessages,
      lastMessageSentAt: new Date(),
    })
  }

  private async checkCampaignCompletion(campaign: CampaignDocument) {
    const pendingCount = await this.campaignMessageModel.countDocuments({
      campaign: campaign._id,
      status: { $in: [MessageStatus.PENDING, MessageStatus.SCHEDULED, MessageStatus.QUEUED] }
    })

    if (pendingCount === 0) {
      await this.campaignModel.findByIdAndUpdate(campaign._id, {
        status: CampaignStatus.COMPLETED,
        completedAt: new Date(),
      })
      this.logger.log(`Campaign ${campaign._id} completed`)
    }
  }

  private async markCampaignAsFailed(campaign: CampaignDocument, error: string) {
    await this.campaignModel.findByIdAndUpdate(campaign._id, {
      status: CampaignStatus.FAILED,
      lastError: error,
      completedAt: new Date(),
    })
    this.logger.error(`Campaign ${campaign._id} failed: ${error}`)
  }
}