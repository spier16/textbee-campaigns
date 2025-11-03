import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  Campaign,
  CampaignDocument,
  CampaignStatus,
} from '../schemas/campaign.schema'
import {
  CampaignMessage,
  CampaignMessageDocument,
  MessageStatus,
} from '../schemas/campaign-message.schema'

@Injectable()
export class CampaignQueueService {
  private readonly logger = new Logger(CampaignQueueService.name)

  constructor(
    @InjectQueue('campaign-queue') private readonly campaignQueue: Queue,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignMessage.name)
    private campaignMessageModel: Model<CampaignMessageDocument>,
  ) {}

  /**
   * Add a campaign to the processing queue
   */
  async addCampaignToQueue(campaignId: string, userId: string, delay?: number) {
    this.logger.debug(`Adding campaign ${campaignId} to queue`)

    const jobOptions = {
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 5000,
      },
      removeOnComplete: 10,
      removeOnFail: 50,
      ...(delay && { delay }),
    }

    await this.campaignQueue.add(
      'process-campaign',
      {
        campaignId,
        userId,
      },
      jobOptions,
    )
  }

  /**
   * Schedule message processing for a campaign
   */
  async scheduleMessageProcessing(campaignId: string, delay: number = 0) {
    this.logger.debug(
      `Scheduling message processing for campaign ${campaignId}`,
    )

    await this.campaignQueue.add(
      'schedule-messages',
      {
        campaignId,
      },
      {
        delay,
        attempts: 2,
        removeOnComplete: 5,
        removeOnFail: 10,
      },
    )
  }

  /**
   * Pause a campaign's processing
   * Propagates PAUSED status to all campaign messages for efficient worker filtering
   * Workers will automatically skip these messages via denormalized campaignStatus field
   */
  async pauseCampaign(campaignId: string) {
    // Update campaign status
    await this.campaignModel.findByIdAndUpdate(campaignId, {
      status: CampaignStatus.PAUSED,
    })

    // Propagate status to all messages for efficient worker filtering
    // Workers will automatically stop claiming these messages
    const result = await this.campaignMessageModel.updateMany(
      { campaign: new Types.ObjectId(campaignId) },
      { $set: { campaignStatus: CampaignStatus.PAUSED } },
    )

    this.logger.log(
      `Campaign ${campaignId} paused and ${result.modifiedCount} messages updated with PAUSED status`,
    )

    // Remove any legacy queue jobs (for backwards compatibility)
    const jobs = await this.campaignQueue.getJobs(['waiting', 'delayed'])
    for (const job of jobs) {
      if (job.data.campaignId === campaignId) {
        await job.remove()
        this.logger.debug(
          `Removed legacy job ${job.id} for paused campaign ${campaignId}`,
        )
      }
    }
  }

  /**
   * Resume a paused campaign
   * Propagates RUNNING status to all campaign messages
   * Workers will automatically start claiming these messages
   */
  async resumeCampaign(campaignId: string, userId: string) {
    this.logger.debug(`Resuming campaign ${campaignId}`)

    // Update campaign status
    await this.campaignModel.findByIdAndUpdate(campaignId, {
      status: CampaignStatus.RUNNING,
      $unset: { completedAt: '' },
    })

    // Propagate status to all messages
    // Workers will automatically start claiming these messages
    const result = await this.campaignMessageModel.updateMany(
      { campaign: new Types.ObjectId(campaignId) },
      { $set: { campaignStatus: CampaignStatus.RUNNING } },
    )

    this.logger.log(
      `Campaign ${campaignId} resumed and ${result.modifiedCount} messages updated with RUNNING status`,
    )

    // No need to add to queue - device workers continuously monitor the unified queue
  }

  /**
   * Cancel a campaign and remove all its jobs
   */
  async cancelCampaign(campaignId: string) {
    const jobs = await this.campaignQueue.getJobs([
      'waiting',
      'delayed',
      'active',
    ])

    for (const job of jobs) {
      if (job.data.campaignId === campaignId) {
        await job.remove()
        this.logger.debug(
          `Removed job ${job.id} for cancelled campaign ${campaignId}`,
        )
      }
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.campaignQueue.getWaiting(),
      this.campaignQueue.getActive(),
      this.campaignQueue.getCompleted(),
      this.campaignQueue.getFailed(),
      this.campaignQueue.getDelayed(),
    ])

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    }
  }

  /**
   * Schedule a campaign to start at a specific time
   * Replaces cron-based campaign start checking
   */
  async scheduleCampaignStart(
    campaignId: string,
    userId: string,
    startTime: Date,
  ) {
    const delay = Math.max(0, startTime.getTime() - Date.now())

    this.logger.debug(
      `Scheduling campaign ${campaignId} to start at ${startTime} (delay: ${delay}ms)`,
    )

    await this.campaignQueue.add(
      'start-campaign',
      {
        campaignId,
        userId,
      },
      {
        delay,
        attempts: 3,
        backoff: {
          type: 'exponential' as const,
          delay: 5000,
        },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    )
  }

  /**
   * Schedule a batch dispatch of campaign messages
   * This is useful for processing large campaigns in smaller batches
   */
  async scheduleMessageDispatch(campaignId: string, delay: number = 0) {
    this.logger.debug(
      `Scheduling message dispatch for campaign ${campaignId} with delay ${delay}ms`,
    )

    await this.campaignQueue.add(
      'dispatch-campaign-messages',
      {
        campaignId,
      },
      {
        delay,
        attempts: 2,
        removeOnComplete: 5,
        removeOnFail: 10,
      },
    )
  }

  /**
   * Check if a campaign should start now based on its schedule
   */
  private shouldCampaignStartNow(
    campaign: CampaignDocument,
    now: Date,
  ): boolean {
    // Use sendingWindows for all schedule types
    if (campaign.sendingWindows && campaign.sendingWindows.length > 0) {
      const firstWindow = campaign.sendingWindows[0]
      const windowStart = new Date(
        `${firstWindow.startDate}T${firstWindow.startTime}:00Z`,
      )
      return now >= windowStart
    }

    // Fallback for campaigns without sendingWindows (shouldn't happen after migration)
    // For campaigns set to start "now", they should start immediately
    if (campaign.scheduleType === 'now') {
      return true
    }

    // For "later" without sendingWindows, start at beginning of start date
    if (campaign.scheduleType === 'later') {
      const startOfDay = new Date(campaign.campaignStartDate + 'T00:00:00')
      return now >= startOfDay
    }

    // Default: start immediately
    return true
  }

  /**
   * Check if current time is within valid sending windows
   */
  private isInValidSendingWindow(
    campaign: CampaignDocument,
    now: Date,
  ): boolean {
    // Use unified sendingWindows array for all schedule types
    if (campaign.sendingWindows && campaign.sendingWindows.length > 0) {
      return campaign.sendingWindows.some((window) => {
        const windowStart = new Date(
          `${window.startDate}T${window.startTime}:00Z`,
        )
        const windowEnd = new Date(`${window.endDate}T${window.endTime}:59Z`)
        return now >= windowStart && now <= windowEnd
      })
    }

    // Fallback: allow sending during campaign date range (for unmigrated campaigns)
    const campaignDate = now.toISOString().split('T')[0]
    return (
      campaignDate >= campaign.campaignStartDate &&
      campaignDate <= campaign.campaignEndDate
    )
  }
}
