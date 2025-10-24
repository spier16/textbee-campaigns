import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Campaign, CampaignDocument, CampaignStatus } from '../schemas/campaign.schema'

@Injectable()
export class CampaignQueueService {
  private readonly logger = new Logger(CampaignQueueService.name)

  constructor(
    @InjectQueue('campaign-queue') private readonly campaignQueue: Queue,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
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
      jobOptions
    )
  }

  /**
   * Schedule message processing for a campaign
   */
  async scheduleMessageProcessing(campaignId: string, delay: number = 0) {
    this.logger.debug(`Scheduling message processing for campaign ${campaignId}`)

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
      }
    )
  }

  /**
   * Pause a campaign's processing
   */
  async pauseCampaign(campaignId: string) {
    const jobs = await this.campaignQueue.getJobs(['waiting', 'delayed'])

    for (const job of jobs) {
      if (job.data.campaignId === campaignId) {
        await job.remove()
        this.logger.debug(`Removed job ${job.id} for paused campaign ${campaignId}`)
      }
    }
  }

  /**
   * Resume a paused campaign
   */
  async resumeCampaign(campaignId: string, userId: string) {
    this.logger.debug(`Resuming campaign ${campaignId}`)
    await this.addCampaignToQueue(campaignId, userId)
  }

  /**
   * Cancel a campaign and remove all its jobs
   */
  async cancelCampaign(campaignId: string) {
    const jobs = await this.campaignQueue.getJobs(['waiting', 'delayed', 'active'])

    for (const job of jobs) {
      if (job.data.campaignId === campaignId) {
        await job.remove()
        this.logger.debug(`Removed job ${job.id} for cancelled campaign ${campaignId}`)
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
  async scheduleCampaignStart(campaignId: string, userId: string, startTime: Date) {
    const delay = Math.max(0, startTime.getTime() - Date.now())

    this.logger.debug(`Scheduling campaign ${campaignId} to start at ${startTime} (delay: ${delay}ms)`)

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
      }
    )
  }

  /**
   * Schedule a batch dispatch of campaign messages
   * This is useful for processing large campaigns in smaller batches
   */
  async scheduleMessageDispatch(campaignId: string, delay: number = 0) {
    this.logger.debug(`Scheduling message dispatch for campaign ${campaignId} with delay ${delay}ms`)

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
      }
    )
  }

  /**
   * Check if a campaign should start now based on its schedule
   */
  private shouldCampaignStartNow(campaign: CampaignDocument, now: Date): boolean {
    // If it has a specific scheduled time, check that
    if (campaign.scheduledDate && campaign.scheduledTime) {
      const scheduledDateTime = new Date(`${campaign.scheduledDate}T${campaign.scheduledTime}`)
      return now >= scheduledDateTime
    }

    // For campaigns set to start "now", they should start immediately
    if (campaign.scheduleType === 'now') {
      return true
    }

    // For "later" without specific time, start at beginning of start date
    if (campaign.scheduleType === 'later') {
      const startOfDay = new Date(campaign.campaignStartDate + 'T00:00:00')
      return now >= startOfDay
    }

    // For window-based campaigns, check if we're in a valid window
    return this.isInValidSendingWindow(campaign, now)
  }

  /**
   * Check if current time is within valid sending windows
   */
  private isInValidSendingWindow(campaign: CampaignDocument, now: Date): boolean {
    if (campaign.scheduleType === 'windows' && campaign.sendingWindows) {
      return campaign.sendingWindows.some(window => {
        const windowStart = new Date(`${window.startDate}T${window.startTime}`)
        const windowEnd = new Date(`${window.endDate}T${window.endTime}`)
        return now >= windowStart && now <= windowEnd
      })
    }

    if (campaign.scheduleType === 'weekday' && campaign.weekdayWindows && campaign.weekdayEnabled) {
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
}