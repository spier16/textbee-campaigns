import { Process, Processor } from '@nestjs/bull'
import { InjectModel } from '@nestjs/mongoose'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { Model, Types } from 'mongoose'
import { Campaign, CampaignDocument, CampaignStatus, ScheduleType } from '../schemas/campaign.schema'
import { CampaignMessage, CampaignMessageDocument, MessageStatus } from '../schemas/campaign-message.schema'
import { Device, DeviceDocument } from '../../gateway/schemas/device.schema'
import { SmsQueueService } from '../../gateway/queue/sms-queue.service'
import { UsagePlanService } from '../../gateway/usage-plan.service'
import { DeviceUsageCalculatorService } from '../../gateway/services/device-usage-calculator.service'
import { RandomizedDelayService } from '../../gateway/services/randomized-delay.service'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'

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
    private usageCalculator: DeviceUsageCalculatorService,
    private randomizedDelayService: RandomizedDelayService,
    @InjectQueue('campaign-queue') private campaignQueue: Queue,
  ) {}

  @Process({
    name: 'start-campaign',
    concurrency: 3,
  })
  async startCampaign(job: Job<CampaignProcessJob>) {
    const { campaignId, userId } = job.data
    this.logger.debug(`Starting campaign ${campaignId} for user ${userId}`)

    try {
      const campaign = await this.campaignModel.findById(campaignId)
      if (!campaign) {
        this.logger.error(`Campaign ${campaignId} not found`)
        return
      }

      if (campaign.status !== CampaignStatus.SCHEDULED) {
        this.logger.debug(`Campaign ${campaignId} is not scheduled (status: ${campaign.status}), skipping`)
        return
      }

      // Update status to running
      await this.campaignModel.findByIdAndUpdate(campaignId, {
        status: CampaignStatus.RUNNING,
        startedAt: new Date(),
      })

      this.logger.log(`Campaign ${campaignId} started, transitioning to process-campaign`)

      // Immediately trigger campaign processing
      await this.campaignQueue.add(
        'process-campaign',
        { campaignId, userId },
        {
          attempts: 3,
          backoff: {
            type: 'exponential' as const,
            delay: 5000,
          },
          removeOnComplete: 10,
          removeOnFail: 50,
        }
      )
    } catch (error) {
      this.logger.error(`Error starting campaign ${campaignId}:`, error)
      throw error
    }
  }

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
          _id: { $in: campaign.sendDevices.map(id => new Types.ObjectId(id)) },
          user: new Types.ObjectId(userId),
          enabled: true,
        })
        .exec()

      if (devices.length === 0) {
        this.logger.error(`No available devices for campaign ${campaignId}`)
        await this.markCampaignAsFailed(campaign, 'No available devices')
        return
      }

      // Queue all messages with initial not_before calculation
      this.logger.debug(`Found ${devices.length} devices for campaign ${campaignId}, calling queueAllMessages`)
      await this.queueAllMessages(campaign)

    } catch (error) {
      this.logger.error(`Error processing campaign ${campaignId}:`, error)
      const campaign = await this.campaignModel.findById(campaignId)
      if (campaign) {
        await this.markCampaignAsFailed(campaign, error.message)
      }
    }
  }

  // DEPRECATED - These job handlers are no longer used with the new queue architecture
  // Device workers now continuously pull from the unified message queue
  // Keeping these for backwards compatibility during migration
  @Process({
    name: 'dispatch-campaign-messages',
    concurrency: 5,
  })
  async dispatchCampaignMessages(job: Job<{ campaignId: string }>) {
    this.logger.warn(`dispatch-campaign-messages job is deprecated with new queue architecture`)
    // No-op - device workers handle message dispatch now
  }

  @Process({
    name: 'schedule-messages',
    concurrency: 10,
  })
  async scheduleMessagesJob(job: Job<{ campaignId: string }>) {
    this.logger.warn(`schedule-messages job is deprecated with new queue architecture`)
    // No-op - device workers handle message dispatch now
  }

  /**
   * Queue all pending messages for a campaign with calculated not_before timestamps
   * This replaces the complex batch scheduling logic with a simple upfront queueing approach
   */
  private async queueAllMessages(campaign: CampaignDocument) {
    const now = new Date()
    this.logger.debug(`queueAllMessages called for campaign ${campaign._id}`)

    // Calculate initial not_before based on campaign's sending windows
    const notBefore = this.calculateInitialNotBefore(campaign, now)
    this.logger.debug(`Calculated not_before: ${notBefore.toISOString()} for campaign ${campaign._id}`)

    // Bulk update all PENDING messages to QUEUED with not_before and queuedAt
    const result = await this.campaignMessageModel.updateMany(
      {
        campaign: campaign._id,
        status: MessageStatus.PENDING
      },
      {
        $set: {
          status: MessageStatus.QUEUED,
          campaignStatus: campaign.status, // Denormalize for efficient worker filtering
          not_before: notBefore,
          queuedAt: now
        }
      }
    )

    this.logger.log(`Queued ${result.modifiedCount} messages for campaign ${campaign._id} with not_before: ${notBefore.toISOString()}`)

    // Update campaign stats
    await this.updateCampaignStats(campaign)
  }

  /**
   * Calculate the initial not_before timestamp based on campaign's sending windows
   * Returns the earliest valid time messages can be sent
   */
  private calculateInitialNotBefore(campaign: CampaignDocument, now: Date): Date {
    if (!campaign.sendingWindows?.length) {
      this.logger.warn(`Campaign ${campaign._id} has no sending windows, using now`)
      return now
    }

    // Check if now is within any window
    for (const window of campaign.sendingWindows) {
      const start = new Date(`${window.startDate}T${window.startTime}:00Z`)
      const end = new Date(`${window.endDate}T${window.endTime}:59Z`)
      if (now >= start && now <= end) {
        this.logger.debug(`Current time is within window ${window.startDate} ${window.startTime} - ${window.endDate} ${window.endTime}`)
        return now
      }
    }

    // Find next window start
    const futureWindows = campaign.sendingWindows
      .map(w => ({
        start: new Date(`${w.startDate}T${w.startTime}:00Z`),
        window: w
      }))
      .filter(({ start }) => start > now)
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    if (futureWindows.length > 0) {
      const nextWindow = futureWindows[0]
      this.logger.debug(`Next window starts at ${nextWindow.start.toISOString()}`)
      return nextWindow.start
    }

    // No future windows available
    this.logger.warn(`No future sending windows found for campaign ${campaign._id}, using now`)
    return now
  }

  // OLD METHOD - TO BE REMOVED
  private async scheduleMessages_OLD(campaign: CampaignDocument, devices: DeviceDocument[]) {
    const now = new Date()
    this.logger.debug(`scheduleMessages called for campaign ${campaign._id}`)

    // Check if we're in a valid sending window
    if (!this.isInSendingWindow(campaign, now)) {
      this.logger.debug(`Campaign ${campaign._id} not in sending window, rescheduling`)
      // Reschedule for next available window
      await this.rescheduleForNextWindow(campaign)
      return
    }

    this.logger.debug(`Campaign ${campaign._id} is in sending window`)

    // Get pending messages that need to be scheduled
    const pendingMessages = await this.campaignMessageModel
      .find({
        campaign: campaign._id,
        status: MessageStatus.PENDING,
      })
      .limit(100) // Process in batches
      .sort({ priority: -1, createdAt: 1 })
      .exec()

    this.logger.debug(`Found ${pendingMessages.length} pending messages for campaign ${campaign._id}`)

    if (pendingMessages.length === 0) {
      // Campaign is complete
      this.logger.debug(`No pending messages found for campaign ${campaign._id}, checking completion`)
      await this.checkCampaignCompletion(campaign)
      return
    }

    // Assign messages to devices and schedule them
    let deviceIndex = 0
    const messagesToSchedule = []
    let devicesChecked = 0
    let allDevicesUnavailable = true

    // Track the next available time for each device to ensure proper spacing
    const deviceNextAvailableTime = new Map<string, Date>()

    this.logger.debug(`Attempting to schedule ${pendingMessages.length} messages across ${devices.length} devices`)

    for (const message of pendingMessages) {
      const device = devices[deviceIndex % devices.length]
      const deviceId = device._id.toString()
      devicesChecked++

      this.logger.debug(`Checking device ${device._id} (${device.brand} ${device.model}) for message ${message._id}`)

      // Check device availability and rate limits
      const canSend = await this.canDeviceSendNow(device)
      if (!canSend) {
        this.logger.debug(`Device ${device._id} cannot send now - checking next device`)
        deviceIndex++

        // If we've checked all devices and none can send, break to avoid infinite loop
        if (devicesChecked >= devices.length * pendingMessages.length) {
          this.logger.warn(`All devices unavailable after checking ${devicesChecked} combinations`)
          break
        }
        continue
      }

      allDevicesUnavailable = false

      // Calculate next available slot with randomization, considering previous messages scheduled for this device
      let scheduledTime: Date
      if (deviceNextAvailableTime.has(deviceId)) {
        // Device already has messages scheduled, add randomized tier delay to the last scheduled time
        const currentTier = await this.usagePlanService.getCurrentTierForDevice(device)
        const minWaitSeconds = currentTier ? currentTier.min_wait_seconds : 300 // Default 5 min
        const randomizedWaitSeconds = this.randomizedDelayService.calculateRandomizedWait(minWaitSeconds)
        const delayMs = randomizedWaitSeconds * 1000
        scheduledTime = new Date(deviceNextAvailableTime.get(deviceId).getTime() + delayMs)
        this.logger.debug(`Scheduling next message for device ${device._id} with randomized delay: ${randomizedWaitSeconds}s (min: ${minWaitSeconds}s)`)
      } else {
        // First message for this device - check if it's the very first message of the campaign
        const isFirstMessageOfCampaign = await this.isFirstMessageOfCampaign(campaign, device)
        if (isFirstMessageOfCampaign) {
          // Send immediately for the first message of the campaign
          scheduledTime = new Date()
          this.logger.debug(`First message of campaign - scheduling immediately for device ${device._id}`)
        } else {
          // Not the first message globally, use normal calculation with randomization
          scheduledTime = await this.calculateNextAvailableSlot(device)
        }
      }

      // Update the device's next available time
      deviceNextAvailableTime.set(deviceId, scheduledTime)

      this.logger.debug(`Scheduling message ${message._id} on device ${device._id} for ${scheduledTime}`)

      message.status = MessageStatus.SCHEDULED
      message.assignedDevice = device._id.toString()
      message.scheduledTime = scheduledTime

      messagesToSchedule.push(message)
      deviceIndex++
    }

    this.logger.debug(`Successfully scheduled ${messagesToSchedule.length} out of ${pendingMessages.length} pending messages`)

    // Save scheduled messages
    if (messagesToSchedule.length > 0) {
      await Promise.all(messagesToSchedule.map(msg => msg.save()))

      // Queue messages for sending
      await this.queueScheduledMessages(messagesToSchedule)

      this.logger.debug(`Queued ${messagesToSchedule.length} messages for campaign ${campaign._id}`)
    } else if (allDevicesUnavailable) {
      // All devices are unavailable - schedule retry with longer delay
      this.logger.warn(`No devices available for campaign ${campaign._id}, scheduling retry in 5 minutes`)
      await this.scheduleNextBatch(campaign, 5 * 60 * 1000) // 5 minute delay
      return
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
    // Check if campaign has any sending windows defined
    if (!campaign.sendingWindows || campaign.sendingWindows.length === 0) {
      this.logger.warn(`Campaign ${campaign._id} has no sending windows defined`)
      return false
    }

    // Check if current time falls within any of the defined windows
    // All times in sendingWindows are stored in UTC for consistency
    return campaign.sendingWindows.some(window => {
      const windowStart = new Date(`${window.startDate}T${window.startTime}:00Z`)
      const windowEnd = new Date(`${window.endDate}T${window.endTime}:59Z`)
      return now >= windowStart && now <= windowEnd
    })
  }

  private async canDeviceSendNow(device: DeviceDocument): Promise<boolean> {
    try {
      // Check if device is enabled
      if (!device.enabled) {
        this.logger.debug(`Device ${device._id} is disabled`)
        return false
      }

      // Check if device is on cooldown (rolling window based)
      if (device.is_on_cooldown) {
        this.logger.debug(`Device ${device._id} is on cooldown`)
        return false
      }

      // Get current usage stats (rolling window)
      const stats = await this.usageCalculator.getDeviceUsageStats(device)

      this.logger.debug(`Checking device ${device._id} availability:`)
      this.logger.debug(`- Enabled: ${device.enabled}`)
      this.logger.debug(`- On cooldown: ${device.is_on_cooldown}`)
      this.logger.debug(`- Messages in window: ${stats.messagesSentInWindow}/${stats.currentTierLimit}`)
      this.logger.debug(`- Usage percentage: ${stats.usagePercentage.toFixed(1)}%`)

      // Check if limit exceeded in rolling window
      if (stats.isOverLimit) {
        this.logger.debug(`Device ${device._id} has exceeded limit in rolling window: ${stats.messagesSentInWindow}/${stats.currentTierLimit}`)
        return false
      }

      this.logger.debug(`Device ${device._id} is available for sending`)
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

    // Add randomized delay based on tier settings
    const randomizedWaitSeconds = this.randomizedDelayService.calculateRandomizedWait(currentTier.min_wait_seconds)
    const delayMs = randomizedWaitSeconds * 1000
    return new Date(now.getTime() + delayMs)
  }

  /**
   * Check if this is the very first message being scheduled for the campaign
   */
  private async isFirstMessageOfCampaign(campaign: CampaignDocument, device: DeviceDocument): Promise<boolean> {
    // Check if any messages have already been scheduled or sent for this campaign
    const processedMessagesCount = await this.campaignMessageModel.countDocuments({
      campaign: campaign._id,
      status: { $in: [MessageStatus.SCHEDULED, MessageStatus.QUEUED, MessageStatus.SENDING, MessageStatus.SENT] }
    })

    return processedMessagesCount === 0
  }

  private async queueScheduledMessages(messages: CampaignMessageDocument[]) {
    // Prepare messages for SMS queue
    const queueJobs = []

    for (const message of messages) {
      if (!message.assignedDevice || !message.scheduledTime) {
        this.logger.warn(`Message ${message._id} missing device or scheduled time, skipping`)
        continue
      }

      // Verify device exists
      const device = await this.deviceModel.findById(message.assignedDevice)
      if (!device) {
        this.logger.warn(`Message ${message._id} device ${message.assignedDevice} not found, skipping`)
        continue
      }

      this.logger.debug(`Device ${device._id} found for message ${message._id}`)

      // Simplified queue job - just pass device and message IDs
      queueJobs.push({
        deviceId: message.assignedDevice,
        campaignMessageId: message._id.toString(),
        scheduledTime: message.scheduledTime,
        priority: message.priority || 1,
      })
    }

    // Add jobs to SMS queue with proper delays
    if (queueJobs.length > 0) {
      this.logger.debug(`Preparing to queue ${queueJobs.length} campaign messages via GatewayService`)

      // Mark messages as queued BEFORE adding to queue to prevent race condition
      await this.campaignMessageModel.updateMany(
        { _id: { $in: messages.map(m => m._id) } },
        { status: MessageStatus.QUEUED }
      )

      await this.smsQueueService.addCampaignMessagesJobs(queueJobs)

      this.logger.debug(`Successfully queued ${queueJobs.length} campaign messages for GatewayService delivery`)
    }
  }

  private async rescheduleForNextWindow(campaign: CampaignDocument) {
    // Schedule the next processing job for the next available window
    const nextWindow = this.getNextSendingWindow(campaign)
    if (nextWindow) {
      const delay = Math.max(0, nextWindow.getTime() - Date.now())

      this.logger.debug(`Rescheduling campaign ${campaign._id} for ${nextWindow} (delay: ${delay}ms)`)

      // Schedule the campaign to be processed at the next window
      await this.campaignQueue.add(
        'schedule-messages',
        { campaignId: campaign._id.toString() },
        {
          delay,
          attempts: 2,
          removeOnComplete: 5,
          removeOnFail: 10,
        }
      )
    }
  }

  private getNextSendingWindow(campaign: CampaignDocument): Date | null {
    const now = new Date()

    if (!campaign.sendingWindows || campaign.sendingWindows.length === 0) {
      this.logger.warn(`Campaign ${campaign._id} has no sending windows defined`)
      return null
    }

    // Parse all windows and convert to Date objects
    // All times in sendingWindows are stored in UTC
    const futureWindows = campaign.sendingWindows
      .map(window => ({
        start: new Date(`${window.startDate}T${window.startTime}:00Z`),
        end: new Date(`${window.endDate}T${window.endTime}:59Z`)
      }))
      .filter(window => window.start > now) // Only future windows
      .sort((a, b) => a.start.getTime() - b.start.getTime()) // Sort chronologically

    // Return the start time of the next window, or null if no future windows exist
    return futureWindows.length > 0 ? futureWindows[0].start : null
  }

  private async scheduleNextBatch(campaign: CampaignDocument, customDelay?: number) {
    // Schedule next batch processing in 1 minute (or custom delay)
    const delay = customDelay || 60 * 1000 // Default 1 minute

    this.logger.debug(`Scheduling next batch for campaign ${campaign._id} in ${delay}ms`)

    // Schedule the next batch processing
    await this.campaignQueue.add(
      'schedule-messages',
      { campaignId: campaign._id.toString() },
      {
        delay,
        attempts: 2,
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    )
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