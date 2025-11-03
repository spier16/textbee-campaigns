import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  CampaignMessage,
  CampaignMessageDocument,
  MessageStatus,
} from '../../campaigns/schemas/campaign-message.schema'

/**
 * MessageSweeperService
 *
 * Housekeeping service that runs periodically to recover stuck messages
 * from the queue. This prevents messages from being lost if a device worker
 * crashes or fails to process a claimed message within the visibility timeout.
 *
 * Runs every 15 seconds to check for expired claims and return them to the queue.
 */
@Injectable()
export class MessageSweeperService {
  private readonly logger = new Logger(MessageSweeperService.name)

  constructor(
    @InjectModel(CampaignMessage.name)
    private campaignMessageModel: Model<CampaignMessageDocument>,
  ) {}

  /**
   * Sweep expired message claims and return them to the queue
   * Runs every 15 seconds
   */
  @Cron('*/15 * * * * *')
  async sweepExpiredClaims() {
    const now = new Date()

    try {
      // Return expired claims back to QUEUED
      // Messages are considered expired if:
      // 1. Status is CLAIMED
      // 2. claimUntil timestamp has passed
      const result = await this.campaignMessageModel.updateMany(
        {
          status: MessageStatus.CLAIMED,
          claimUntil: { $lte: now },
        },
        {
          $set: { status: MessageStatus.QUEUED },
          $unset: { claimedBy: '', claimUntil: '' },
        },
      )

      if (result.modifiedCount > 0) {
        this.logger.warn(
          `Recovered ${result.modifiedCount} expired message claims - ` +
            `these messages exceeded their 90-second visibility timeout`,
        )
      }
    } catch (error) {
      this.logger.error(
        'Error sweeping expired message claims:',
        error.stack || error,
      )
    }
  }

  /**
   * Clean up old completed and failed messages
   * Runs daily at 3 AM
   * Optional: Keeps last 30 days of completed/failed messages for audit trail
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldMessages() {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    try {
      const result = await this.campaignMessageModel.deleteMany({
        status: {
          $in: [
            MessageStatus.SENT,
            MessageStatus.FAILED,
            MessageStatus.CANCELLED,
          ],
        },
        updatedAt: { $lt: thirtyDaysAgo },
      })

      if (result.deletedCount > 0) {
        this.logger.log(
          `Cleaned up ${result.deletedCount} old messages (>30 days)`,
        )
      }
    } catch (error) {
      this.logger.error('Error cleaning up old messages:', error.stack || error)
    }
  }

  /**
   * Check for stuck SENDING messages
   * Runs every minute
   * Messages stuck in SENDING for >5 minutes are suspicious and should be investigated
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkStuckSendingMessages() {
    const fiveMinutesAgo = new Date()
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5)

    try {
      const stuckMessages = await this.campaignMessageModel.countDocuments({
        status: MessageStatus.SENDING,
        updatedAt: { $lt: fiveMinutesAgo },
      })

      if (stuckMessages > 0) {
        this.logger.warn(
          `Found ${stuckMessages} messages stuck in SENDING status for >5 minutes - ` +
            `these may indicate worker crashes or network issues`,
        )

        // Optionally reset them to QUEUED for retry
        // Uncomment if you want automatic recovery of stuck SENDING messages
        /*
        await this.campaignMessageModel.updateMany(
          {
            status: MessageStatus.SENDING,
            updatedAt: { $lt: fiveMinutesAgo }
          },
          {
            $set: { status: MessageStatus.QUEUED },
            $unset: { claimedBy: '', claimUntil: '' },
            $inc: { attempts: 1 }
          }
        )
        */
      }
    } catch (error) {
      this.logger.error(
        'Error checking stuck SENDING messages:',
        error.stack || error,
      )
    }
  }

  /**
   * Report queue health metrics
   * Runs every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reportQueueMetrics() {
    try {
      const [queued, claimed, sending, sent, failed] = await Promise.all([
        this.campaignMessageModel.countDocuments({
          status: MessageStatus.QUEUED,
        }),
        this.campaignMessageModel.countDocuments({
          status: MessageStatus.CLAIMED,
        }),
        this.campaignMessageModel.countDocuments({
          status: MessageStatus.SENDING,
        }),
        this.campaignMessageModel.countDocuments({
          status: MessageStatus.SENT,
        }),
        this.campaignMessageModel.countDocuments({
          status: MessageStatus.FAILED,
        }),
      ])

      this.logger.log(
        `Queue metrics - ` +
          `QUEUED: ${queued}, ` +
          `CLAIMED: ${claimed}, ` +
          `SENDING: ${sending}, ` +
          `SENT: ${sent}, ` +
          `FAILED: ${failed}`,
      )

      // Alert if queue is backing up
      if (queued > 10000) {
        this.logger.warn(`Queue backlog is high: ${queued} messages waiting`)
      }

      // Alert if too many claimed messages (possible worker issues)
      if (claimed > 100) {
        this.logger.warn(
          `High number of claimed messages: ${claimed} (possible worker bottleneck)`,
        )
      }
    } catch (error) {
      this.logger.error('Error reporting queue metrics:', error.stack || error)
    }
  }
}
