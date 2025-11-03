import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import Redis from 'ioredis'
import { Device, DeviceDocument } from '../schemas/device.schema'
import {
  Campaign,
  CampaignDocument,
  CampaignStatus,
} from '../../campaigns/schemas/campaign.schema'
import {
  CampaignMessage,
  CampaignMessageDocument,
  MessageStatus,
} from '../../campaigns/schemas/campaign-message.schema'
import { SMS, SMSDocument } from '../schemas/sms.schema'
import { SMSType } from '../sms-type.enum'
import { GatewayService } from '../gateway.service'
import { UsagePlanService } from '../usage-plan.service'
import { DeviceUsageCalculatorService } from '../services/device-usage-calculator.service'
import { RandomizedDelayService } from '../services/randomized-delay.service'

/**
 * DeviceWorkerService
 *
 * Manages long-lived worker loops (one per device) that continuously pull messages
 * from the unified campaign message queue and send them when devices are available.
 *
 * Key features:
 * - Atomic message claiming with visibility timeout
 * - Redis-based device leasing for multi-instance deployment
 * - Dynamic delay calculation based on current tier
 * - Sending window validation at claim time
 * - No pre-scheduling or batching needed
 */
@Injectable()
export class DeviceWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceWorkerService.name)
  private activeLoops = new Map<string, boolean>()
  private loopPromises = new Map<string, Promise<void>>()

  private redis: Redis

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignMessage.name)
    private campaignMessageModel: Model<CampaignMessageDocument>,
    @InjectModel(SMS.name) private smsModel: Model<SMSDocument>,
    @InjectQueue('sms') private smsQueue: Queue,
    private gatewayService: GatewayService,
    private usagePlanService: UsagePlanService,
    private usageCalculator: DeviceUsageCalculatorService,
    private randomizedDelayService: RandomizedDelayService,
  ) {
    // Get Redis client from Bull queue (reuse existing Redis connection)
    this.redis = (this.smsQueue as any).client as Redis
  }

  async onModuleInit() {
    this.logger.log(
      'DeviceWorkerService initializing - starting device worker loops',
    )
    await this.startAllDeviceWorkers()
  }

  async onModuleDestroy() {
    this.logger.log(
      'DeviceWorkerService shutting down - stopping all device worker loops',
    )
    await this.stopAllDeviceWorkers()
  }

  /**
   * Start worker loops for all enabled devices
   */
  async startAllDeviceWorkers() {
    const devices = await this.deviceModel.find({ enabled: true }).exec()
    this.logger.log(
      `Starting worker loops for ${devices.length} enabled devices`,
    )

    for (const device of devices) {
      await this.startDeviceWorker(device)
    }
  }

  /**
   * Stop all active worker loops
   */
  async stopAllDeviceWorkers() {
    // Signal all loops to stop
    for (const [deviceId] of this.activeLoops) {
      this.activeLoops.set(deviceId, false)
    }

    // Wait for all loops to finish
    const promises = Array.from(this.loopPromises.values())
    await Promise.allSettled(promises)

    this.logger.log('All device worker loops stopped')
  }

  /**
   * Start a worker loop for a specific device
   */
  async startDeviceWorker(device: DeviceDocument) {
    const deviceId = device._id.toString()

    // Don't start if already running
    if (this.activeLoops.get(deviceId)) {
      this.logger.debug(`Worker loop already active for device ${deviceId}`)
      return
    }

    // Start the loop
    this.activeLoops.set(deviceId, true)
    const loopPromise = this.runDeviceLoop(device)
    this.loopPromises.set(deviceId, loopPromise)

    this.logger.log(
      `Started worker loop for device ${deviceId} (${device.brand} ${device.model})`,
    )
  }

  /**
   * Stop a worker loop for a specific device
   */
  async stopDeviceWorker(deviceId: string) {
    this.activeLoops.set(deviceId, false)
    await this.loopPromises.get(deviceId)
    this.loopPromises.delete(deviceId)
    this.logger.log(`Stopped worker loop for device ${deviceId}`)
  }

  /**
   * Main device worker loop
   * Runs continuously while device is enabled
   */
  private async runDeviceLoop(device: DeviceDocument) {
    const deviceId = device._id.toString()
    const leaseKey = `device:${deviceId}:worker`

    try {
      // Acquire Redis lease with retry logic (prevents multiple pods from running same device loop)
      // Retry up to 3 times with exponential backoff to handle stale leases
      const maxRetries = 3
      let acquired = false

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        acquired = await this.acquireDeviceLease(leaseKey)

        if (acquired) {
          break
        }

        if (attempt < maxRetries - 1) {
          const backoffMs = [3000, 5000, 5000][attempt] // 3s, 5s, 5s = 13s total (exceeds 10s lease TTL)
          this.logger.debug(
            `Could not acquire lease for device ${deviceId} (attempt ${attempt + 1}/${maxRetries}) - ` +
              `retrying in ${backoffMs}ms...`,
          )
          await this.sleep(backoffMs)
        }
      }

      if (!acquired) {
        this.logger.warn(
          `Failed to acquire lease for device ${deviceId} after ${maxRetries} attempts - ` +
            `another pod owns this device or there may be a stale lease`,
        )
        return
      }

      this.logger.log(`Acquired worker lease for device ${deviceId}`)

      // Main loop
      while (this.activeLoops.get(deviceId)) {
        try {
          // Refresh device data periodically
          const freshDevice = await this.deviceModel.findById(deviceId).exec()
          if (!freshDevice || !freshDevice.enabled) {
            this.logger.log(
              `Device ${deviceId} no longer enabled, stopping worker loop`,
            )
            break
          }

          // 1. Check device gates BEFORE claiming
          if (!(await this.canDeviceSendNow(freshDevice))) {
            await this.sleep(500 + Math.random() * 500) // 500-1000ms jitter
            await this.renewLease(leaseKey)
            continue
          }

          // 2. Atomic claim with sort
          const message = await this.claimNextMessage(freshDevice)
          if (!message) {
            // No messages available
            await this.sleep(250 + Math.random() * 250) // 250-500ms jitter
            await this.renewLease(leaseKey)
            continue
          }

          this.logger.debug(`Device ${deviceId} claimed message ${message._id}`)

          // 3. Validate sending window (load campaign only when we have a message)
          const campaign = await this.campaignModel
            .findById(message.campaign)
            .exec()
          if (!campaign) {
            this.logger.error(
              `Campaign ${message.campaign} not found for message ${message._id}`,
            )
            await this.markMessageFailed(message, 'Campaign not found')
            continue
          }

          if (!this.isInSendingWindow(campaign, new Date())) {
            // Update not_before to next window
            this.logger.debug(
              `Message ${message._id} outside sending window, updating not_before`,
            )
            await this.pushToNextWindow(message, campaign)
            continue
          }

          // 4. Send message (CLAIMED → SENDING → SENT)
          const sendStatus = await this.sendMessage(
            freshDevice,
            message,
            campaign,
          )

          // 5. Calculate delay and wait (skip cooldown if message was skipped)
          if (sendStatus === 'skipped') {
            // Message was skipped - immediately try next message without cooldown
            this.logger.debug(
              `Message skipped, device ${deviceId} will immediately claim next message`,
            )
          } else {
            // Message was sent or failed - apply normal cooldown
            const delay = await this.calculateNextDelay(freshDevice)
            this.logger.debug(
              `Device ${deviceId} waiting ${delay}ms before next claim`,
            )
            await this.sleep(delay)
          }

          await this.renewLease(leaseKey)
        } catch (error) {
          this.logger.error(
            `Device worker error for ${deviceId}:`,
            error.stack || error,
          )
          await this.sleep(5000) // Back off on error
        }
      }
    } finally {
      // Release lease on exit
      await this.releaseLease(leaseKey)
      this.activeLoops.delete(deviceId)
      this.logger.log(`Device worker loop exited for ${deviceId}`)
    }
  }

  /**
   * Atomically claim the next eligible message from the queue
   * Uses denormalized campaignStatus for efficient filtering without campaign join
   */
  private async claimNextMessage(
    device: DeviceDocument,
  ): Promise<CampaignMessageDocument | null> {
    const now = new Date()
    const deviceId = device._id.toString()

    // Atomic claim with sort - NO campaign query needed!
    // Uses denormalized campaignStatus for efficient filtering
    const message = await this.campaignMessageModel
      .findOneAndUpdate(
        {
          status: MessageStatus.QUEUED,
          campaignStatus: CampaignStatus.RUNNING, // Efficient filter via denormalized field
          not_before: { $lte: now },
        },
        {
          $set: {
            status: MessageStatus.CLAIMED,
            claimedBy: deviceId,
            claimUntil: new Date(now.getTime() + 90 * 1000), // 90 sec visibility timeout
          },
        },
        {
          sort: { not_before: 1, queuedAt: 1 }, // FIFO tie-break
          returnDocument: 'after',
          new: true,
        },
      )
      .exec()

    return message
  }

  /**
   * Send a claimed message
   * Returns status: 'sent' | 'skipped' | 'failed'
   */
  private async sendMessage(
    device: DeviceDocument,
    message: CampaignMessageDocument,
    campaign: CampaignDocument,
  ): Promise<'sent' | 'skipped' | 'failed'> {
    try {
      // Redundancy check: Validate contact hasn't been messaged if campaign excludes previously messaged
      if (!campaign.includePreviouslyMessaged) {
        const hasBeenMessaged = await this.checkIfContactMessaged(
          campaign.user.toString(),
          message.recipient,
          campaign._id.toString(),
        )

        if (hasBeenMessaged) {
          // Contact was messaged since this message was queued - skip sending
          message.status = MessageStatus.CANCELLED
          message.lastError = 'Contact was previously messaged'
          await message.save()

          this.logger.warn(
            `Skipping message ${message._id} to ${message.recipient} - already messaged (campaign: ${campaign._id})`,
          )

          // Update campaign stats for skipped message
          await this.updateCampaignStatsAfterSkip(campaign._id)

          return 'skipped' // Don't send
        }
      }

      // Update to SENDING
      message.status = MessageStatus.SENDING
      await message.save()

      this.logger.log(
        `Sending message ${message._id} via device ${device._id} to ${message.recipient}`,
      )

      // Send via gateway
      const smsData = {
        message: message.content,
        recipients: [message.recipient],
        smsBody: message.content,
        receivers: [message.recipient],
      }

      await this.gatewayService.sendSMS(
        device._id.toString(),
        smsData,
        campaign._id.toString(),
      )

      // Update to SENT
      message.status = MessageStatus.SENT
      message.sentAt = new Date()
      await message.save()

      // Update device timestamp
      device.lastMessageSentAt = new Date()
      await device.save()

      // Update campaign stats
      await this.updateCampaignStatsAfterSend(campaign._id)

      this.logger.log(`Message ${message._id} sent successfully`)
      return 'sent'
    } catch (error) {
      // Handle retry with backoff
      this.logger.error(`Failed to send message ${message._id}:`, error)
      await this.handleSendFailure(message, campaign, error)
      return 'failed'
    }
  }

  /**
   * Handle message send failure with retry logic
   */
  private async handleSendFailure(
    message: CampaignMessageDocument,
    campaign: CampaignDocument,
    error: Error,
  ) {
    message.retryCount = (message.retryCount || 0) + 1
    message.lastError = error.message

    if (message.retryCount >= message.maxRetries) {
      // Move to DLQ
      message.status = MessageStatus.FAILED
      this.logger.warn(
        `Message ${message._id} failed after ${message.retryCount} attempts, moving to DLQ`,
      )

      // Update campaign stats for permanent failure
      await message.save()
      await this.updateCampaignStatsAfterFailure(campaign._id)
      return
    } else {
      // Retry with exponential backoff
      const backoffMs = Math.min(
        300000,
        Math.pow(2, message.retryCount) * 60000,
      ) // Max 5 min
      const nextAttempt = new Date(Date.now() + backoffMs)

      // Push to next valid window after backoff
      const nextWindow = this.getNextSendingWindow(campaign, nextAttempt)
      message.not_before = nextWindow || nextAttempt
      message.status = MessageStatus.QUEUED
      message.claimedBy = undefined
      message.claimUntil = undefined

      this.logger.debug(
        `Message ${message._id} retry scheduled for ${message.not_before.toISOString()} (attempt ${message.retryCount}/${message.maxRetries})`,
      )
    }

    await message.save()
  }

  /**
   * Mark a message as failed
   */
  private async markMessageFailed(
    message: CampaignMessageDocument,
    error: string,
  ) {
    message.status = MessageStatus.FAILED
    message.lastError = error
    await message.save()
  }

  /**
   * Check if device can send message now
   * Enforces device gates: cooldown, rolling window capacity, min_wait delay
   */
  private async canDeviceSendNow(device: DeviceDocument): Promise<boolean> {
    // 1. Check tier progression cooldown
    if (device.is_on_cooldown && device.cooldown_reason === 'tier_promotion') {
      if (device.cooldown_end_time && device.cooldown_end_time > new Date()) {
        return false
      }
    }

    // 2. Check rolling window capacity
    const stats = await this.usageCalculator.getDeviceUsageStats(device)
    if (stats.isOverLimit) {
      return false
    }

    // 3. Check min_wait delay since last message
    if (device.lastMessageSentAt) {
      const currentTier =
        await this.usagePlanService.getCurrentTierForDevice(device)
      if (!currentTier) return false

      const minWaitMs = currentTier.min_wait_seconds * 1000
      const timeSinceLastMs = Date.now() - device.lastMessageSentAt.getTime()

      if (timeSinceLastMs < minWaitMs) {
        return false // Still on sending delay cooldown
      }
    }

    return true
  }

  /**
   * Calculate next delay based on current tier's min_wait with randomization
   */
  private async calculateNextDelay(device: DeviceDocument): Promise<number> {
    const currentTier =
      await this.usagePlanService.getCurrentTierForDevice(device)
    if (!currentTier) return 5000 // Default 5 sec

    // Use randomized delay service with gamma distribution
    const randomizedWaitSeconds =
      this.randomizedDelayService.calculateRandomizedWait(
        currentTier.min_wait_seconds,
      )

    return randomizedWaitSeconds * 1000
  }

  /**
   * Check if current time is within campaign's valid sending windows
   */
  private isInSendingWindow(campaign: CampaignDocument, now: Date): boolean {
    // Check if campaign has any sending windows defined
    if (!campaign.sendingWindows || campaign.sendingWindows.length === 0) {
      this.logger.warn(
        `Campaign ${campaign._id} has no sending windows defined`,
      )
      return false
    }

    // Check if current time falls within any of the defined windows
    // All times in sendingWindows are stored in UTC for consistency
    return campaign.sendingWindows.some((window) => {
      const windowStart = new Date(
        `${window.startDate}T${window.startTime}:00Z`,
      )
      const windowEnd = new Date(`${window.endDate}T${window.endTime}:59Z`)
      return now >= windowStart && now <= windowEnd
    })
  }

  /**
   * Find the next valid sending window for a campaign after a given time
   */
  private getNextSendingWindow(
    campaign: CampaignDocument,
    afterTime: Date,
  ): Date | null {
    if (!campaign.sendingWindows || campaign.sendingWindows.length === 0) {
      return null
    }

    // Parse all windows and convert to Date objects
    const futureWindows = campaign.sendingWindows
      .map((window) => ({
        start: new Date(`${window.startDate}T${window.startTime}:00Z`),
        end: new Date(`${window.endDate}T${window.endTime}:59Z`),
      }))
      .filter((window) => {
        // Include windows that haven't ended yet
        return window.end > afterTime
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    if (futureWindows.length === 0) {
      return null
    }

    // Check if we're currently in the first future window
    const firstWindow = futureWindows[0]
    if (afterTime >= firstWindow.start && afterTime <= firstWindow.end) {
      return afterTime // We're in a valid window
    }

    // Otherwise, return the start of the next window
    return firstWindow.start
  }

  /**
   * Update message's not_before to next valid sending window
   */
  private async pushToNextWindow(
    message: CampaignMessageDocument,
    campaign: CampaignDocument,
  ) {
    const nextWindow = this.getNextSendingWindow(campaign, new Date())

    if (!nextWindow) {
      // No more valid windows - mark as failed
      message.status = MessageStatus.FAILED
      message.lastError = 'No valid sending windows available'
      this.logger.warn(
        `Message ${message._id} has no more valid sending windows`,
      )
    } else {
      message.not_before = nextWindow
      message.status = MessageStatus.QUEUED
      message.claimedBy = undefined
      message.claimUntil = undefined
      this.logger.debug(
        `Message ${message._id} rescheduled for next window: ${nextWindow.toISOString()}`,
      )
    }

    await message.save()
  }

  /**
   * Redis lease operations for multi-instance deployment
   */

  private async acquireDeviceLease(leaseKey: string): Promise<boolean> {
    const podId = process.env.POD_ID || process.env.HOSTNAME || 'local'
    const result = await this.redis.set(leaseKey, podId, 'EX', 10, 'NX')
    return result === 'OK'
  }

  private async renewLease(leaseKey: string): Promise<void> {
    const podId = process.env.POD_ID || process.env.HOSTNAME || 'local'
    // Only renew if we still own it (atomic check-and-set)
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `
    await this.redis.eval(script, 1, leaseKey, podId, '10')
  }

  private async releaseLease(leaseKey: string): Promise<void> {
    const podId = process.env.POD_ID || process.env.HOSTNAME || 'local'
    // Only delete if we own it (atomic check-and-delete)
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `
    await this.redis.eval(script, 1, leaseKey, podId)
  }

  /**
   * Update campaign statistics after a message is successfully sent
   */
  private async updateCampaignStatsAfterSend(campaignId: Types.ObjectId) {
    try {
      // Increment sent count and decrement pending/queued counts
      await this.campaignModel.findByIdAndUpdate(campaignId, {
        $inc: {
          sentMessages: 1,
          pendingMessages: -1,
          queuedMessages: -1,
        },
        $set: {
          lastMessageSentAt: new Date(),
        },
      })

      this.logger.debug(
        `Updated campaign ${campaignId} stats: incremented sentMessages`,
      )

      // Check if campaign is complete
      await this.checkCampaignCompletion(campaignId)
    } catch (error) {
      this.logger.error(
        `Error updating campaign stats after send for campaign ${campaignId}:`,
        error,
      )
    }
  }

  /**
   * Update campaign statistics after a message permanently fails
   */
  private async updateCampaignStatsAfterFailure(campaignId: Types.ObjectId) {
    try {
      // Increment failed count and decrement pending/queued counts
      await this.campaignModel.findByIdAndUpdate(campaignId, {
        $inc: {
          failedMessages: 1,
          pendingMessages: -1,
          queuedMessages: -1,
        },
      })

      this.logger.debug(
        `Updated campaign ${campaignId} stats: incremented failedMessages`,
      )

      // Check if campaign is complete
      await this.checkCampaignCompletion(campaignId)
    } catch (error) {
      this.logger.error(
        `Error updating campaign stats after failure for campaign ${campaignId}:`,
        error,
      )
    }
  }

  /**
   * Update campaign statistics after a message is skipped
   */
  private async updateCampaignStatsAfterSkip(campaignId: Types.ObjectId) {
    try {
      // Decrement pending/queued counts (cancelled messages are not counted as failed or sent)
      await this.campaignModel.findByIdAndUpdate(campaignId, {
        $inc: {
          pendingMessages: -1,
          queuedMessages: -1,
        },
      })

      this.logger.debug(
        `Updated campaign ${campaignId} stats: decremented queuedMessages after skip`,
      )

      // Check if campaign is complete
      await this.checkCampaignCompletion(campaignId)
    } catch (error) {
      this.logger.error(
        `Error updating campaign stats after skip for campaign ${campaignId}:`,
        error,
      )
    }
  }

  /**
   * Check if campaign is complete (no pending messages) and mark as completed
   */
  private async checkCampaignCompletion(campaignId: Types.ObjectId) {
    try {
      const pendingCount = await this.campaignMessageModel.countDocuments({
        campaign: campaignId,
        status: {
          $in: [
            MessageStatus.PENDING,
            MessageStatus.SCHEDULED,
            MessageStatus.QUEUED,
            MessageStatus.CLAIMED,
            MessageStatus.SENDING,
          ],
        },
      })

      if (pendingCount === 0) {
        await this.campaignModel.findByIdAndUpdate(campaignId, {
          status: CampaignStatus.COMPLETED,
          completedAt: new Date(),
        })
        this.logger.log(
          `Campaign ${campaignId} completed - all messages sent or failed`,
        )
      }
    } catch (error) {
      this.logger.error(
        `Error checking campaign completion for campaign ${campaignId}:`,
        error,
      )
    }
  }

  /**
   * Check if a specific contact has been messaged (for worker-level redundancy check)
   * @param userId - The user ID
   * @param phoneNumber - The phone number to check
   * @param excludeCampaignId - Campaign ID to exclude from check
   * @returns true if contact has been messaged, false otherwise
   */
  private async checkIfContactMessaged(
    userId: string,
    phoneNumber: string,
    excludeCampaignId: string,
  ): Promise<boolean> {
    // Get user's device IDs
    const userDevices = await this.deviceModel
      .find({
        user: new Types.ObjectId(userId),
      })
      .select('_id')
    const userDeviceIds = userDevices.map((device) => device._id)

    // Check SMS records for this specific phone number
    const smsExists = await this.smsModel.exists({
      device: { $in: userDeviceIds },
      type: SMSType.SENT,
      recipient: phoneNumber,
      status: { $in: ['pending', 'sent', 'delivered', 'unknown', 'failed'] },
    })

    if (smsExists) return true

    // Check CampaignMessage records (excluding current campaign and deleted campaigns)
    // Only count messages that were actually attempted (not just queued)
    const messageExists = await this.campaignMessageModel.exists({
      user: new Types.ObjectId(userId),
      campaign: { $ne: new Types.ObjectId(excludeCampaignId) },
      recipient: phoneNumber,
      campaignIsDeleted: { $ne: true },
      status: {
        $in: [
          MessageStatus.SENDING, // Currently being sent
          MessageStatus.SENT, // Successfully sent
          MessageStatus.FAILED, // Attempted but failed
        ],
      },
    })

    return !!messageExists
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
