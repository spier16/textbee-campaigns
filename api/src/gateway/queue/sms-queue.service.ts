import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { ConfigService } from '@nestjs/config'
import { Message } from 'firebase-admin/messaging'
import { Types } from 'mongoose'

@Injectable()
export class SmsQueueService {
  private readonly logger = new Logger(SmsQueueService.name)
  private readonly useSmsQueue: boolean
  private readonly maxSmsBatchSize: number

  constructor(
    @InjectQueue('sms') private readonly smsQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.useSmsQueue = this.configService.get<boolean>('USE_SMS_QUEUE', false)
    this.maxSmsBatchSize = this.configService.get<number>(
      'MAX_SMS_BATCH_SIZE',
      5,
    )
  }

  /**
   * Check if queue is enabled based on environment variable
   */
  isQueueEnabled(): boolean {
    return this.useSmsQueue
  }

  async addSendSmsJob(
    deviceId: string,
    fcmMessages: Message[],
    smsBatchId: string,
  ) {
    this.logger.debug(`Adding send-sms job for batch ${smsBatchId}`)

    // Split messages into batches of max smsBatchSize messages
    const batches = []
    for (let i = 0; i < fcmMessages.length; i += this.maxSmsBatchSize) {
      batches.push(fcmMessages.slice(i, i + this.maxSmsBatchSize))
    }

    let delayMultiplier = 1;
    for (const batch of batches) {
      await this.smsQueue.add(
        'send-sms',
        {
          deviceId,
          fcmMessages: batch,
          smsBatchId,
        },
        {
          priority: 1, // TODO: Make this dynamic based on users subscription plan
          attempts: 1,
          delay: 1000 * delayMultiplier++,
          backoff: {
            type: 'exponential',
            delay: 5000, // 5 seconds
          },
          removeOnComplete: false,
          removeOnFail: false,
        },
      )
    }
  }

  /**
   * Add campaign message to SMS queue with device-specific delays
   */
  async addCampaignMessageJob(
    deviceId: string,
    campaignMessageId: string,
    fcmMessage: Message,
    smsBatchId: string,
    priority: number = 1,
    delay: number = 0,
  ) {
    this.logger.debug(`Adding campaign message job for message ${campaignMessageId}`)

    await this.smsQueue.add(
      'send-campaign-message',
      {
        deviceId,
        campaignMessageId,
        fcmMessage,
        smsBatchId,
      },
      {
        priority,
        attempts: 3, // More retries for campaign messages
        delay,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    )
  }

  /**
   * Add multiple campaign messages as separate jobs with calculated delays
   */
  async addCampaignMessagesJobs(
    messages: Array<{
      deviceId: string
      campaignMessageId: string
      scheduledTime: Date
      priority: number
    }>
  ) {
    const now = new Date()

    for (const message of messages) {
      const delay = Math.max(0, message.scheduledTime.getTime() - now.getTime())

      await this.smsQueue.add(
        'send-campaign-message',
        {
          deviceId: message.deviceId,
          campaignMessageId: message.campaignMessageId,
        },
        {
          priority: message.priority,
          attempts: 3, // More retries for campaign messages
          delay,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      )
    }
  }
}
