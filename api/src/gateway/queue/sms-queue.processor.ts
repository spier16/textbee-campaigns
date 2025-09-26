import { Process, Processor } from '@nestjs/bull'
import { InjectModel } from '@nestjs/mongoose'
import { Job } from 'bull'
import { Model } from 'mongoose'
import * as firebaseAdmin from 'firebase-admin'
import { Device } from '../schemas/device.schema'
import { SMS } from '../schemas/sms.schema'
import { SMSBatch } from '../schemas/sms-batch.schema'
import { WebhookService } from 'src/webhook/webhook.service'
import { Logger } from '@nestjs/common'
import { CampaignMessage, CampaignMessageDocument, MessageStatus } from '../../campaigns/schemas/campaign-message.schema'
import { UsagePlanService } from '../usage-plan.service'
import { GatewayService } from '../gateway.service'

@Processor('sms')
export class SmsQueueProcessor {
  private readonly logger = new Logger(SmsQueueProcessor.name)

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<Device>,
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    @InjectModel(SMSBatch.name) private smsBatchModel: Model<SMSBatch>,
    @InjectModel(CampaignMessage.name) private campaignMessageModel: Model<CampaignMessageDocument>,
    private webhookService: WebhookService,
    private usagePlanService: UsagePlanService,
    private gatewayService: GatewayService,
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

      // Update device SMS count and daily usage counters with proper reset logic
      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const currentHour = now.getHours()

      // Get current device state to check reset needs
      const currentDevice = await this.deviceModel.findById(deviceId)
      let updateData: any = {
        $inc: {
          sentSMSCount: response.successCount,
        },
        $set: {}
      }

      // Handle daily counter reset
      const lastDailyReset = currentDevice.daily_counter_reset
      const needsDailyReset = !lastDailyReset || lastDailyReset.toISOString().split('T')[0] !== today

      if (needsDailyReset) {
        updateData.$set.messages_sent_today = response.successCount
        updateData.$set.daily_counter_reset = now
      } else {
        updateData.$inc.messages_sent_today = response.successCount
      }

      // Handle hourly counter reset
      const lastHourlyReset = currentDevice.hourly_counter_reset
      const needsHourlyReset = !lastHourlyReset ||
        lastHourlyReset.toISOString().split('T')[0] !== today ||
        lastHourlyReset.getHours() !== currentHour

      if (needsHourlyReset) {
        updateData.$set.messages_sent_this_hour = response.successCount
        updateData.$set.hourly_counter_reset = now
      } else {
        updateData.$inc.messages_sent_this_hour = response.successCount
      }

      await this.deviceModel
        .findByIdAndUpdate(deviceId, updateData)
        .exec()

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

      // Use the same GatewayService method that manual messaging uses
      const smsData = {
        message: campaignMessage.content,
        recipients: [campaignMessage.recipient],
        smsBody: campaignMessage.content,
        receivers: [campaignMessage.recipient]
      }

      this.logger.debug(`Sending campaign message via GatewayService: ${campaignMessage.content} to ${campaignMessage.recipient}`)

      // Send using the exact same service method as manual messaging
      const response = await this.gatewayService.sendSMS(deviceId, smsData)

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
   * Check if device can send message now (re-validates device availability)
   */
  private async canDeviceSendNow(device: any): Promise<boolean> {
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

      // Refresh device data to get latest counters
      const freshDevice = await this.deviceModel.findById(device._id)
      if (!freshDevice) {
        return false
      }

      // Check if daily limit exceeded
      if (freshDevice.messages_sent_today >= currentTier.dailyLimit) {
        this.logger.debug(`Device ${device._id} has reached daily limit: ${freshDevice.messages_sent_today}/${currentTier.dailyLimit}`)
        return false
      }

      // Check hourly rate limit
      const maxHourlyMessages = Math.ceil(3600 / currentTier.timeDelayBetweenMessages)
      if (freshDevice.messages_sent_this_hour >= maxHourlyMessages) {
        this.logger.debug(`Device ${device._id} has reached hourly limit: ${freshDevice.messages_sent_this_hour}/${maxHourlyMessages}`)
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

    // Calculate next available slot based on device delay
    const delayMs = currentTier.timeDelayBetweenMessages * 1000
    const nextAvailableTime = new Date(Date.now() + delayMs)

    // Update campaign message
    campaignMessage.status = MessageStatus.SCHEDULED
    campaignMessage.scheduledTime = nextAvailableTime
    campaignMessage.lastError = 'Device not available, rescheduled'
    await campaignMessage.save()

    this.logger.debug(`Rescheduled campaign message ${campaignMessage._id} to ${nextAvailableTime}`)
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
}
