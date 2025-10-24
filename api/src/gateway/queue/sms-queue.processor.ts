import { Process, Processor, InjectQueue } from '@nestjs/bull'
import { InjectModel } from '@nestjs/mongoose'
import { Job, Queue } from 'bull'
import { Model } from 'mongoose'
import * as firebaseAdmin from 'firebase-admin'
import { Device } from '../schemas/device.schema'
import { SMS } from '../schemas/sms.schema'
import { SMSBatch } from '../schemas/sms-batch.schema'
import { WebhookService } from 'src/webhook/webhook.service'
import { Logger } from '@nestjs/common'
import { CampaignMessage, CampaignMessageDocument, MessageStatus } from '../../campaigns/schemas/campaign-message.schema'
import { ScheduleType } from '../../campaigns/schemas/campaign.schema'
import { UsagePlanService } from '../usage-plan.service'
import { GatewayService } from '../gateway.service'
import { DeviceUsageCalculatorService } from '../services/device-usage-calculator.service'
import { RandomizedDelayService } from '../services/randomized-delay.service'

@Processor('sms')
export class SmsQueueProcessor {
  private readonly logger = new Logger(SmsQueueProcessor.name)

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<Device>,
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    @InjectModel(SMSBatch.name) private smsBatchModel: Model<SMSBatch>,
    @InjectModel(CampaignMessage.name) private campaignMessageModel: Model<CampaignMessageDocument>,
    @InjectQueue('sms') private smsQueue: Queue,
    private webhookService: WebhookService,
    private usagePlanService: UsagePlanService,
    private gatewayService: GatewayService,
    private usageCalculator: DeviceUsageCalculatorService,
    private randomizedDelayService: RandomizedDelayService,
  ) {}

  @Process({
    name: 'send-sms',
    concurrency: 10,
  })
  async handleSendSms(job: Job<any>) {
    this.logger.debug(`Processing send-sms job ${job.id}`)
    const { deviceId, fcmMessages, smsBatchId } = job.data

    try {
      this.smsBatchModel
        .findByIdAndUpdate(smsBatchId, {
          $set: { status: 'processing' },
        })
        .exec()
        .catch((error) => {
          this.logger.error(
            `Failed to update sms batch status to processing ${smsBatchId}`,
            error,
          )
          throw error
        })

      const response = await firebaseAdmin.messaging().sendEach(fcmMessages)

      this.logger.debug(
        `SMS Job ${job.id} completed, success: ${response.successCount}, failures: ${response.failureCount}`,
      )

      // Update device: increment total count and set last message timestamp
      await this.deviceModel
        .findByIdAndUpdate(deviceId, {
          $inc: {
            sentSMSCount: response.successCount,
          },
          $set: {
            lastMessageSentAt: new Date(),
          },
        })
        .exec()

      // Check tier progression after batch completes
      await this.gatewayService.checkTierProgression(deviceId)

      // Update batch status
      const smsBatch = await this.smsBatchModel.findByIdAndUpdate(
        smsBatchId,
        {
          $inc: {
            successCount: response.successCount,
            failureCount: response.failureCount,
          },
        },
        { returnDocument: 'after' },
      )

      if (smsBatch.successCount === smsBatch.recipientCount) {
        await this.smsBatchModel.findByIdAndUpdate(smsBatchId, {
          $set: { status: 'completed' },
        })
      }

      return response
    } catch (error) {
      this.logger.error(`Failed to process SMS job ${job.id}`, error)

      const smsBatch = await this.smsBatchModel.findByIdAndUpdate(
        smsBatchId,
        {
          $inc: {
            failureCount: fcmMessages.length,
          },
        },
        { returnDocument: 'after' },
      )

      const newStatus =
        smsBatch.failureCount === smsBatch.recipientCount
          ? 'failed'
          : 'partial_success'

      await this.smsBatchModel.findByIdAndUpdate(smsBatchId, {
        $set: { status: newStatus },
      })

      throw error
    }
  }

  @Process({
    name: 'wake-device',
    concurrency: 5,
  })
  async handleWakeDevice(job: Job<{ deviceId: string }>) {
    const { deviceId } = job.data
    this.logger.debug(`Processing wake-device job for device ${deviceId}`)

    try {
      const device = await this.deviceModel.findById(deviceId)
      if (!device) {
        this.logger.error(`Device ${deviceId} not found`)
        return
      }

      // Check if device is still on cooldown
      const stats = await this.usageCalculator.getDeviceUsageStats(device)
      if (stats.isOverLimit) {
        this.logger.debug(`Device ${deviceId} still on cooldown, will be woken again later`)
        return
      }

      this.logger.log(`Device ${deviceId} is now available - looking for pending campaign messages`)

      // Find pending/scheduled campaign messages assigned to this device
      const pendingMessages = await this.campaignMessageModel
        .find({
          assignedDevice: deviceId,
          status: { $in: [MessageStatus.SCHEDULED, MessageStatus.PENDING] },
        })
        .sort({ scheduledTime: 1, priority: -1 })
        .limit(10) // Process up to 10 messages at a time
        .exec()

      if (pendingMessages.length === 0) {
        this.logger.debug(`No pending messages for device ${deviceId}`)
        return
      }

      this.logger.log(`Found ${pendingMessages.length} pending messages for device ${deviceId}`)

      // Re-queue the messages for immediate processing
      for (const message of pendingMessages) {
        await this.smsQueue.add(
          'send-campaign-message',
          {
            deviceId: deviceId,
            campaignMessageId: message._id.toString(),
          },
          {
            priority: message.priority || 1,
            attempts: 3,
            delay: 0, // Send immediately
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            removeOnComplete: 50,
            removeOnFail: 100,
          },
        )
      }

      this.logger.log(`Re-queued ${pendingMessages.length} messages for device ${deviceId}`)
    } catch (error) {
      this.logger.error(`Error processing wake-device job for ${deviceId}:`, error)
      throw error
    }
  }

  @Process({
    name: 'send-campaign-message',
    concurrency: 10,
  })
  async handleSendCampaignMessage(job: Job<any>) {
    this.logger.debug(`Processing send-campaign-message job ${job.id} for device ${job.data.deviceId} and message ${job.data.campaignMessageId}`)
    const { deviceId, campaignMessageId } = job.data

    try {
      // Get campaign message
      const campaignMessage = await this.campaignMessageModel.findById(campaignMessageId)
      if (!campaignMessage) {
        this.logger.error(`Campaign message ${campaignMessageId} not found`)
        return
      }

      // Check if message is still scheduled to be sent
      if (campaignMessage.status !== MessageStatus.QUEUED) {
        this.logger.debug(`Campaign message ${campaignMessageId} status is ${campaignMessage.status}, skipping`)
        return
      }

      // Update status to sending
      campaignMessage.status = MessageStatus.SENDING
      await campaignMessage.save()

      // Re-check device availability before sending (limit might have been exceeded since scheduling)
      const device = await this.deviceModel.findById(deviceId)
      if (!device) {
        campaignMessage.status = MessageStatus.FAILED
        campaignMessage.lastError = 'Device not found'
        await campaignMessage.save()
        return
      }

      const canSend = await this.canDeviceSendNow(device)
      if (!canSend) {
        this.logger.debug(`Device ${deviceId} cannot send message ${campaignMessageId} now - rescheduling`)
        await this.rescheduleCampaignMessage(campaignMessage, device)
        return
      }

      // Use the same GatewayService method that manual messaging uses
      const smsData = {
        message: campaignMessage.content,
        recipients: [campaignMessage.recipient],
        smsBody: campaignMessage.content,
        receivers: [campaignMessage.recipient]
      }

      this.logger.debug(`Sending campaign message via GatewayService: ${campaignMessage.content} to ${campaignMessage.recipient}`)

      // Send using the exact same service method as manual messaging, but pass campaign ID
      const campaignId = campaignMessage.campaign.toString() // Convert ObjectId to string
      const response = await this.gatewayService.sendSMS(deviceId, smsData, campaignId)

      // Update campaign message status
      campaignMessage.status = MessageStatus.SENT
      campaignMessage.sentAt = new Date()
      campaignMessage.smsId = response?.data?.smsBatchId || 'unknown' // Use SMS batch ID from response
      await campaignMessage.save()

      this.logger.debug(`Campaign message ${campaignMessageId} status updated to SENT in database`)

      // Update campaign stats after message is sent
      await this.updateCampaignStatsAfterSend(campaignMessage)

      this.logger.debug(`Campaign message ${campaignMessageId} sent successfully via GatewayService`)
      return response

    } catch (error) {
      this.logger.error(`Failed to process campaign message job ${job.id}`, error)

      // Update campaign message status
      const campaignMessage = await this.campaignMessageModel.findById(campaignMessageId)
      if (campaignMessage) {
        campaignMessage.status = MessageStatus.FAILED
        campaignMessage.lastError = error.message
        campaignMessage.retryCount++

        // Schedule retry if within retry limit
        if (campaignMessage.retryCount < campaignMessage.maxRetries) {
          const retryDelay = Math.min(300000, Math.pow(2, campaignMessage.retryCount) * 60000) // Exponential backoff, max 5 minutes
          campaignMessage.nextRetryAt = new Date(Date.now() + retryDelay)
          campaignMessage.status = MessageStatus.SCHEDULED
        }

        await campaignMessage.save()
      }

      throw error
    }
  }

  /**
   * Check if device can send message now (re-validates device availability using rolling window)
   */
  private async canDeviceSendNow(device: any): Promise<boolean> {
    try {
      // Check if device is on cooldown (rolling window based)
      if (device.is_on_cooldown) {
        this.logger.debug(`Device ${device._id} is on cooldown`)
        return false
      }

      // Get fresh device data
      const freshDevice = await this.deviceModel.findById(device._id)
      if (!freshDevice) {
        return false
      }

      // Get current usage stats (rolling window)
      const stats = await this.usageCalculator.getDeviceUsageStats(freshDevice)

      // Check if limit exceeded in rolling window
      if (stats.isOverLimit) {
        this.logger.debug(`Device ${device._id} has exceeded limit in rolling window: ${stats.messagesSentInWindow}/${stats.currentTierLimit}`)
        return false
      }

      return true
    } catch (error) {
      this.logger.error(`Error checking device availability:`, error)
      return false
    }
  }

  /**
   * Update device message counters
   */
  private async updateDeviceCounters(device: any) {
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const currentHour = now.getHours()

    // Reset daily counter if it's a new day
    if (device.messages_sent_today_date !== today) {
      device.messages_sent_today = 0
      device.messages_sent_today_date = today
    }

    // Reset hourly counter if it's a new hour
    if (device.messages_sent_this_hour_timestamp !== currentHour) {
      device.messages_sent_this_hour = 0
      device.messages_sent_this_hour_timestamp = currentHour
    }

    // Increment counters
    await this.deviceModel.findByIdAndUpdate(device._id, {
      $inc: {
        sentSMSCount: 1,
        messages_sent_today: 1,
        messages_sent_this_hour: 1,
      },
      $set: {
        messages_sent_today_date: today,
        messages_sent_this_hour_timestamp: currentHour,
        lastMessageSentAt: now,
      }
    })
  }

  /**
   * Reschedule a campaign message when device is not available
   */
  private async rescheduleCampaignMessage(campaignMessage: CampaignMessageDocument, device: any) {
    const currentTier = await this.usagePlanService.getCurrentTierForDevice(device)
    if (!currentTier) {
      campaignMessage.status = MessageStatus.FAILED
      campaignMessage.lastError = 'Device tier not found'
      await campaignMessage.save()
      return
    }

    // Load campaign to check sending windows
    const Campaign = this.campaignMessageModel.db.model('Campaign')
    const campaign = await Campaign.findById(campaignMessage.campaign)
    if (!campaign) {
      campaignMessage.status = MessageStatus.FAILED
      campaignMessage.lastError = 'Campaign not found'
      await campaignMessage.save()
      return
    }

    // Get device usage stats to determine appropriate delay
    const stats = await this.usageCalculator.getDeviceUsageStats(device)

    let delayMs: number
    if (stats.estimatedCooldownEndTime) {
      // Device is at limit - wait until oldest message ages out of the rolling window
      delayMs = Math.max(0, stats.estimatedCooldownEndTime.getTime() - Date.now())
      this.logger.debug(`Device ${device._id} at limit. Rescheduling after cooldown ends: ${stats.estimatedCooldownEndTime}`)
    } else {
      // Device not at limit - use randomized tier delay
      const randomizedWaitSeconds = this.randomizedDelayService.calculateRandomizedWait(currentTier.avg_wait_seconds)
      delayMs = randomizedWaitSeconds * 1000
      this.logger.debug(`Device ${device._id} using randomized delay: ${randomizedWaitSeconds}s (avg: ${currentTier.avg_wait_seconds}s)`)
    }

    // Calculate next device-available time
    let nextAvailableTime = new Date(Date.now() + delayMs)

    // Check if that time is within campaign sending windows
    if (!this.isInSendingWindow(campaign, nextAvailableTime)) {
      this.logger.debug(`Calculated time ${nextAvailableTime} is outside campaign sending window, finding next valid window`)

      // Find next valid sending window
      const nextValidWindow = this.getNextSendingWindow(campaign, nextAvailableTime)

      if (!nextValidWindow) {
        // No more valid windows - campaign might be ended or no more windows available
        campaignMessage.status = MessageStatus.FAILED
        campaignMessage.lastError = 'No valid sending windows available'
        await campaignMessage.save()
        this.logger.warn(`No valid sending windows found for campaign message ${campaignMessage._id}`)
        return
      }

      nextAvailableTime = nextValidWindow
      delayMs = Math.max(0, nextAvailableTime.getTime() - Date.now())
      this.logger.debug(`Adjusted reschedule time to next valid window: ${nextAvailableTime}`)
    }

    // Update campaign message status and time
    campaignMessage.status = MessageStatus.SCHEDULED
    campaignMessage.scheduledTime = nextAvailableTime
    campaignMessage.lastError = 'Device not available, rescheduled'
    await campaignMessage.save()

    this.logger.debug(`Rescheduled campaign message ${campaignMessage._id} to ${nextAvailableTime} (delay: ${delayMs}ms)`)

    // Re-queue the message with the calculated delay
    await this.smsQueue.add(
      'send-campaign-message',
      {
        deviceId: device._id.toString(),
        campaignMessageId: campaignMessage._id.toString(),
      },
      {
        priority: campaignMessage.priority || 1,
        attempts: 3,
        delay: delayMs,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    )

    this.logger.debug(`Re-queued campaign message ${campaignMessage._id} with delay ${delayMs}ms`)
  }

  /**
   * Update campaign statistics after a message is sent
   */
  private async updateCampaignStatsAfterSend(campaignMessage: CampaignMessageDocument) {
    try {
      const Campaign = this.campaignMessageModel.db.model('Campaign')

      // Increment sent count and decrement pending count
      await Campaign.findByIdAndUpdate(campaignMessage.campaign, {
        $inc: {
          sentMessages: 1,
          pendingMessages: -1
        },
        $set: {
          lastMessageSentAt: new Date()
        }
      })

      this.logger.debug(`Updated campaign ${campaignMessage.campaign} stats: incremented sentMessages`)
    } catch (error) {
      this.logger.error('Error updating campaign stats after send:', error)
    }
  }

  /**
   * Check if a given time is within campaign's valid sending windows
   */
  private isInSendingWindow(campaign: any, now: Date): boolean {
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

  /**
   * Find the next valid sending window for a campaign after a given time
   */
  private getNextSendingWindow(campaign: any, afterTime: Date): Date | null {
    // Check if campaign has ended
    const afterDate = afterTime.toISOString().split('T')[0]
    if (afterDate > campaign.campaignEndDate) {
      return null
    }

    // For 'now' and 'later' schedule types, next valid time is immediately (if within date range)
    if (campaign.scheduleType === ScheduleType.NOW || campaign.scheduleType === ScheduleType.LATER) {
      if (afterDate <= campaign.campaignEndDate) {
        return afterTime
      }
      return null
    }

    // For 'windows' schedule type
    if (campaign.scheduleType === ScheduleType.WINDOWS && campaign.sendingWindows) {
      // Find next window that starts after afterTime
      let nextWindow: Date | null = null

      for (const window of campaign.sendingWindows) {
        const windowStart = new Date(`${window.startDate}T${window.startTime}`)
        const windowEnd = new Date(`${window.endDate}T${window.endTime}`)

        // If we're before this window starts, this could be our next window
        if (afterTime < windowStart && (!nextWindow || windowStart < nextWindow)) {
          nextWindow = windowStart
        }
        // If we're currently in this window, return current time
        else if (afterTime >= windowStart && afterTime <= windowEnd) {
          return afterTime
        }
      }

      return nextWindow
    }

    // For 'weekday' schedule type
    if (campaign.scheduleType === ScheduleType.WEEKDAY && campaign.weekdayWindows && campaign.weekdayEnabled) {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

      // Try to find a valid window in the next 14 days
      for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
        const checkDate = new Date(afterTime)
        checkDate.setDate(checkDate.getDate() + daysAhead)

        const checkDateStr = checkDate.toISOString().split('T')[0]

        // Check if this date is within campaign range
        if (checkDateStr < campaign.campaignStartDate || checkDateStr > campaign.campaignEndDate) {
          continue
        }

        const dayName = dayNames[checkDate.getDay()]

        if (!campaign.weekdayEnabled[dayName]) {
          continue
        }

        const dayWindows = campaign.weekdayWindows[dayName]
        if (!dayWindows || dayWindows.length === 0) {
          continue
        }

        // Sort windows by start time
        const sortedWindows = [...dayWindows].sort((a, b) => {
          const aTime = parseInt(a.startTime.replace(':', ''))
          const bTime = parseInt(b.startTime.replace(':', ''))
          return aTime - bTime
        })

        for (const window of sortedWindows) {
          const [startHour, startMin] = window.startTime.split(':').map(Number)
          const [endHour, endMin] = window.endTime.split(':').map(Number)

          const windowStart = new Date(checkDate)
          windowStart.setHours(startHour, startMin, 0, 0)

          const windowEnd = new Date(checkDate)
          windowEnd.setHours(endHour, endMin, 59, 999)

          // If checking today, make sure we haven't passed this window yet
          if (daysAhead === 0 && afterTime > windowEnd) {
            continue
          }

          // If we're before this window, return its start time
          if (afterTime < windowStart) {
            return windowStart
          }

          // If we're currently in this window, return current time
          if (afterTime >= windowStart && afterTime <= windowEnd) {
            return afterTime
          }
        }
      }
    }

    return null
  }
}
