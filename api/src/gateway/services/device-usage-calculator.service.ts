import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Device, DeviceDocument } from '../schemas/device.schema'
import { SMS, SMSDocument } from '../schemas/sms.schema'
import { UsagePlan, UsagePlanDocument } from '../schemas/usage-plan.schema'
import { UsagePlanService } from '../usage-plan.service'
import { SmsQueueService } from '../queue/sms-queue.service'

export interface DeviceUsageStats {
  messagesSentInWindow: number
  currentTierLimit: number
  usagePercentage: number
  windowMinutes: number
  isOverLimit: boolean
  shouldBeOnCooldown: boolean
  estimatedCooldownEndTime: Date | null
  oldestMessageTime: Date | null
}

export interface CooldownUpdateResult {
  needsUpdate: boolean
  newCooldownStatus: boolean
}

@Injectable()
export class DeviceUsageCalculatorService {
  private readonly logger = new Logger(DeviceUsageCalculatorService.name)

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(SMS.name) private smsModel: Model<SMSDocument>,
    @InjectModel(UsagePlan.name) private usagePlanModel: Model<UsagePlanDocument>,
    @Inject(forwardRef(() => UsagePlanService)) private usagePlanService: UsagePlanService,
    @Inject(forwardRef(() => SmsQueueService)) private smsQueueService: SmsQueueService,
  ) {}

  /**
   * Calculate how many campaign messages were sent from a device in the rolling window
   */
  async calculateMessagesInWindow(
    deviceId: string | Types.ObjectId,
    windowMinutes: number,
    campaignOnly: boolean = true,
  ): Promise<{ count: number; oldestMessageTime: Date | null }> {
    const cutoffTime = new Date(Date.now() - windowMinutes * 60 * 1000)

    // Build query to count messages in rolling window
    // For pending messages, use requestedAt (when queued to FCM)
    // For sent/delivered messages, use sentAt (when device confirms)
    const query: any = {
      device: deviceId,
      $or: [
        // Pending messages - use requestedAt since sentAt isn't set yet
        { status: 'pending', requestedAt: { $gte: cutoffTime } },
        // Sent/delivered messages - use sentAt for accuracy
        { status: { $in: ['sent', 'delivered'] }, sentAt: { $gte: cutoffTime } }
      ]
    }

    if (campaignOnly) {
      query.campaignId = { $exists: true, $ne: null }
    }

    // Count messages in window
    const count = await this.smsModel.countDocuments(query).exec()

    // Find oldest message in window (for estimating cooldown end)
    // Sort by requestedAt for pending, sentAt for sent/delivered
    const oldestMessage = await this.smsModel
      .findOne(query)
      .sort({ requestedAt: 1, sentAt: 1 }) // Oldest first
      .select('sentAt requestedAt status')
      .exec()

    // Use the appropriate timestamp based on status
    const oldestTime = oldestMessage?.status === 'pending'
      ? oldestMessage.requestedAt
      : (oldestMessage?.sentAt || oldestMessage?.requestedAt)

    return {
      count,
      oldestMessageTime: oldestTime || null,
    }
  }

  /**
   * Get comprehensive usage statistics for a device
   */
  async getDeviceUsageStats(device: DeviceDocument): Promise<DeviceUsageStats> {
    // Default stats if no usage plan
    if (!device.usagePlan) {
      return {
        messagesSentInWindow: 0,
        currentTierLimit: 0,
        usagePercentage: 0,
        windowMinutes: 1440,
        isOverLimit: false,
        shouldBeOnCooldown: false,
        estimatedCooldownEndTime: null,
        oldestMessageTime: null,
      }
    }

    // Get usage plan
    const usagePlan = await this.getUsagePlanById(device.usagePlan)
    if (!usagePlan) {
      this.logger.warn(`Usage plan not found for device ${device._id}`)
      return {
        messagesSentInWindow: 0,
        currentTierLimit: 0,
        usagePercentage: 0,
        windowMinutes: 1440,
        isOverLimit: false,
        shouldBeOnCooldown: false,
        estimatedCooldownEndTime: null,
        oldestMessageTime: null,
      }
    }

    const windowMinutes = usagePlan.usageWindowMinutes || 1440
    const currentTier = usagePlan.tiers.find(t => t.tier === device.current_tier)

    if (!currentTier) {
      this.logger.warn(`Current tier ${device.current_tier} not found in usage plan for device ${device._id}`)
      return {
        messagesSentInWindow: 0,
        currentTierLimit: 0,
        usagePercentage: 0,
        windowMinutes,
        isOverLimit: false,
        shouldBeOnCooldown: false,
        estimatedCooldownEndTime: null,
        oldestMessageTime: null,
      }
    }

    // Calculate messages in window
    const { count, oldestMessageTime } = await this.calculateMessagesInWindow(
      device._id,
      windowMinutes,
      true, // Campaign only
    )

    const usagePercentage = Math.min((count / currentTier.messages_per_cycle) * 100, 100)
    const isOverLimit = count >= currentTier.messages_per_cycle

    // Determine if device should be on cooldown
    let shouldBeOnCooldown = false
    let estimatedCooldownEndTime: Date | null = null

    // Check if device has an active tier promotion cooldown
    if (device.cooldown_reason === 'tier_promotion' && device.cooldown_end_time) {
      const now = new Date()
      if (device.cooldown_end_time > now) {
        // Tier promotion cooldown is still active
        shouldBeOnCooldown = true
        estimatedCooldownEndTime = device.cooldown_end_time
      } else {
        // Tier promotion cooldown has expired
        shouldBeOnCooldown = false
      }
    }
    // Check if device is at max tier and over limit (rolling window cooldown)
    else {
      const isMaxTier = device.current_tier === usagePlan.tiers[usagePlan.tiers.length - 1].tier
      shouldBeOnCooldown = isMaxTier && isOverLimit

      // Estimate cooldown end time for max tier cooldown
      if (shouldBeOnCooldown && oldestMessageTime) {
        estimatedCooldownEndTime = new Date(
          oldestMessageTime.getTime() + windowMinutes * 60 * 1000,
        )
      }
    }

    return {
      messagesSentInWindow: count,
      currentTierLimit: currentTier.messages_per_cycle,
      usagePercentage,
      windowMinutes,
      isOverLimit,
      shouldBeOnCooldown,
      estimatedCooldownEndTime,
      oldestMessageTime,
    }
  }

  /**
   * Check if device cooldown status needs updating and return new status
   */
  async checkAndUpdateCooldownStatus(device: DeviceDocument): Promise<CooldownUpdateResult> {
    const stats = await this.getDeviceUsageStats(device)

    const needsUpdate = device.is_on_cooldown !== stats.shouldBeOnCooldown

    return {
      needsUpdate,
      newCooldownStatus: stats.shouldBeOnCooldown,
    }
  }

  /**
   * Batch recalculate usage and cooldown status for all devices with usage plans
   */
  async batchRecalculateAllDevices(): Promise<void> {
    this.logger.log('Starting batch recalculation of device usage...')

    const devices = await this.deviceModel
      .find({ usagePlan: { $exists: true, $ne: null } })
      .exec()

    this.logger.log(`Found ${devices.length} devices with usage plans`)

    let updatedCount = 0

    for (const device of devices) {
      try {
        const stats = await this.getDeviceUsageStats(device)
        const { needsUpdate, newCooldownStatus } = await this.checkAndUpdateCooldownStatus(device)

        if (needsUpdate) {
          const wasOnCooldown = device.is_on_cooldown
          device.is_on_cooldown = newCooldownStatus

          // Clear cooldown metadata when cooldown ends
          if (!newCooldownStatus) {
            device.cooldown_end_time = undefined
            device.cooldown_reason = undefined
          }

          await device.save()
          updatedCount++

          this.logger.debug(
            `Device ${device._id} cooldown status updated to ${newCooldownStatus}`,
          )

          // If device is coming OFF cooldown, schedule a wake-device job
          if (wasOnCooldown && !newCooldownStatus) {
            this.logger.log(`Device ${device._id} is coming off cooldown - scheduling wake-device job`)
            await this.smsQueueService.scheduleWakeDevice(device._id.toString(), new Date())
          }
          // If device is going ON cooldown and we have an estimated end time, schedule wake job
          else if (!wasOnCooldown && newCooldownStatus && stats.estimatedCooldownEndTime) {
            this.logger.log(`Device ${device._id} entering cooldown - scheduling wake for ${stats.estimatedCooldownEndTime}`)
            await this.smsQueueService.scheduleWakeDevice(device._id.toString(), stats.estimatedCooldownEndTime)
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to recalculate usage for device ${device._id}`,
          error.stack,
        )
      }
    }

    this.logger.log(
      `Batch recalculation complete. Updated ${updatedCount} of ${devices.length} devices`,
    )
  }

  /**
   * Helper to get usage plan by ID (supports both custom and template plans)
   */
  private async getUsagePlanById(
    planId: string | Types.ObjectId,
  ): Promise<UsagePlan | null> {
    return await this.usagePlanService.getUsagePlanById(planId)
  }
}
