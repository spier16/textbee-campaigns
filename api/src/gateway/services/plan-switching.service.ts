import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Device, DeviceDocument } from '../schemas/device.schema'
import { UsagePlan, UsagePlanDocument } from '../schemas/usage-plan.schema'
import { PREDEFINED_PLANS } from '../constants/usage-plan-templates'

/**
 * Service for handling usage plan switching with intelligent tier placement
 *
 * When a device switches to a new usage plan, this service automatically
 * places it at the highest tier it has historically achieved, based on:
 * - min_avg_wait_seconds: Lowest wait time the device has successfully maintained
 * - max_messages_per_cycle: Highest message volume the device has handled
 *
 * This prevents forcing devices to "re-warm-up" when switching plans.
 */
@Injectable()
export class PlanSwitchingService {
  private readonly logger = new Logger(PlanSwitchingService.name)

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(UsagePlan.name) private usagePlanModel: Model<UsagePlanDocument>,
  ) {}

  /**
   * Get usage plan by ID, supporting both template and user-created plans
   */
  private async getUsagePlanById(planId: string | Types.ObjectId): Promise<UsagePlan | null> {
    // Handle template plans
    if (typeof planId === 'string' && planId.startsWith('template_')) {
      const templatePlan = PREDEFINED_PLANS.find(template => template._id === planId)
      return templatePlan ? templatePlan as any : null
    }

    // Handle user-created plans
    if (Types.ObjectId.isValid(planId as string)) {
      return await this.usagePlanModel.findById(planId).exec()
    }

    return null
  }

  /**
   * Switch a device to a new usage plan and auto-place at highest eligible tier
   *
   * @param deviceId - Device to switch
   * @param newPlanId - ID of the new usage plan
   * @returns Updated device document
   *
   * @example
   * await planSwitchingService.switchDevicePlan(
   *   'device123',
   *   'template_verizon_business'
   * )
   */
  async switchDevicePlan(deviceId: string, newPlanId: string): Promise<DeviceDocument> {
    const device = await this.deviceModel.findById(deviceId).exec()
    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`)
    }

    const newPlan = await this.getUsagePlanById(newPlanId)
    if (!newPlan) {
      throw new NotFoundException(`Usage plan ${newPlanId} not found`)
    }

    // Find highest eligible tier
    const eligibleTier = this.findHighestEligibleTier(device, newPlan)

    const previousPlan = device.usagePlan?.toString()
    const previousTier = device.current_tier

    // Find the tier configuration for the eligible tier
    const tierConfig = newPlan.tiers.find(t => t.tier === eligibleTier)
    if (!tierConfig) {
      throw new NotFoundException(`Tier ${eligibleTier} not found in plan ${newPlanId}`)
    }

    // Update device
    device.usagePlan = newPlanId as any
    device.current_tier = eligibleTier
    device.last_tier_upgrade = new Date()

    // Initialize/update historical limits based on the tier being placed at
    const hadHistoricalData = !!(device.min_avg_wait_seconds && device.max_messages_per_cycle)

    // Always update min_avg_wait_seconds (wait time is cycle-independent)
    if (!device.min_avg_wait_seconds || tierConfig.avg_wait_seconds < device.min_avg_wait_seconds) {
      device.min_avg_wait_seconds = tierConfig.avg_wait_seconds
      this.logger.log(
        `Device ${deviceId} historical min_avg_wait_seconds set to ${tierConfig.avg_wait_seconds}s (tier ${eligibleTier})`
      )
    }

    // Only update max_messages_per_cycle if using standard 24-hour window (1440 minutes)
    const usageWindowMinutes = (newPlan as any).usageWindowMinutes || 1440
    if (usageWindowMinutes === 1440) {
      if (!device.max_messages_per_cycle || tierConfig.messages_per_cycle > device.max_messages_per_cycle) {
        device.max_messages_per_cycle = tierConfig.messages_per_cycle
        this.logger.log(
          `Device ${deviceId} historical max_messages_per_cycle set to ${tierConfig.messages_per_cycle} (tier ${eligibleTier})`
        )
      }
    }

    // Reset cooldown status when switching plans
    device.is_on_cooldown = false
    device.cooldown_end_time = undefined
    device.cooldown_reason = undefined

    await device.save()

    const historyStatus = hadHistoricalData ? 'based on history' : 'initialized with tier 1 baseline'
    this.logger.log(
      `Device ${deviceId} switched from plan ${previousPlan} tier ${previousTier} ` +
      `to plan ${newPlanId} tier ${eligibleTier} (auto-placed ${historyStatus})`
    )

    return device
  }

  /**
   * Find the highest tier in a plan where device meets historical requirements
   *
   * Rules:
   * 1. Device must have maintained avg_wait_seconds <= tier requirement
   * 2. Device must have handled messages_per_cycle >= tier requirement
   * 3. If no historical data exists, start at tier 1 (safe default)
   * 4. Walk tiers from highest to lowest, return first match
   *
   * @param device - Device with historical performance data
   * @param plan - Target usage plan
   * @returns Tier number (1-based)
   */
  findHighestEligibleTier(device: DeviceDocument, plan: UsagePlanDocument | UsagePlan): number {
    // If no historical data, start at tier 1 (warm-up required)
    if (!device.min_avg_wait_seconds || !device.max_messages_per_cycle) {
      this.logger.log(
        `Device ${device._id} has no historical data, starting at tier 1`
      )
      return 1
    }

    // Sort tiers from highest to lowest
    const sortedTiers = [...plan.tiers].sort((a, b) => b.tier - a.tier)

    // Find highest tier where device meets both requirements
    for (const tier of sortedTiers) {
      const meetsWaitRequirement = tier.avg_wait_seconds >= device.min_avg_wait_seconds
      const meetsCycleRequirement = tier.messages_per_cycle <= device.max_messages_per_cycle

      if (meetsWaitRequirement && meetsCycleRequirement) {
        this.logger.log(
          `Device ${device._id} qualifies for tier ${tier.tier}: ` +
          `historical min_wait=${device.min_avg_wait_seconds}s (tier requires ${tier.avg_wait_seconds}s), ` +
          `historical max_cycle=${device.max_messages_per_cycle} (tier allows ${tier.messages_per_cycle})`
        )
        return tier.tier
      }
    }

    // If no tier matches (device hasn't performed well enough), start at tier 1
    this.logger.log(
      `Device ${device._id} doesn't meet any tier requirements, starting at tier 1`
    )
    return 1
  }

  /**
   * Get recommended tier for a device on a specific plan (without actually switching)
   *
   * Useful for UI to show users what tier they'll get before switching
   *
   * @param deviceId - Device to evaluate
   * @param planId - Plan to evaluate against
   * @returns Tier number and explanation
   */
  async getRecommendedTier(
    deviceId: string,
    planId: string
  ): Promise<{
    tier: number
    reason: string
    tierDetails: {
      avg_wait_seconds: number
      messages_per_cycle: number
    } | null
  }> {
    const device = await this.deviceModel.findById(deviceId).exec()
    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`)
    }

    const plan = await this.getUsagePlanById(planId)
    if (!plan) {
      throw new NotFoundException(`Usage plan ${planId} not found`)
    }

    const tier = this.findHighestEligibleTier(device, plan)
    const tierDetails = plan.tiers.find(t => t.tier === tier)

    let reason: string
    if (!device.min_avg_wait_seconds || !device.max_messages_per_cycle) {
      reason = 'No historical performance data available. Starting at tier 1.'
    } else {
      reason =
        `Based on historical performance: ` +
        `min wait time ${device.min_avg_wait_seconds}s, ` +
        `max ${device.max_messages_per_cycle} messages/cycle`
    }

    return {
      tier,
      reason,
      tierDetails: tierDetails || null
    }
  }

  /**
   * Batch switch multiple devices to a new plan
   *
   * Useful when user wants to migrate all devices to a new plan at once
   *
   * @param deviceIds - Array of device IDs
   * @param newPlanId - ID of new usage plan
   * @returns Summary of switches
   */
  async batchSwitchDevices(
    deviceIds: string[],
    newPlanId: string
  ): Promise<{
    success: number
    failed: number
    results: Array<{ deviceId: string; tier: number; error?: string }>
  }> {
    const results: Array<{ deviceId: string; tier: number; error?: string }> = []
    let success = 0
    let failed = 0

    for (const deviceId of deviceIds) {
      try {
        const device = await this.switchDevicePlan(deviceId, newPlanId)
        results.push({ deviceId, tier: device.current_tier })
        success++
      } catch (error) {
        results.push({ deviceId, tier: 0, error: error.message })
        failed++
        this.logger.error(`Failed to switch device ${deviceId}:`, error)
      }
    }

    this.logger.log(
      `Batch plan switch completed: ${success} successful, ${failed} failed`
    )

    return { success, failed, results }
  }

  /**
   * Reset device historical tracking (force warm-up from tier 1)
   *
   * Use with caution - this erases performance history
   *
   * @param deviceId - Device to reset
   */
  async resetDeviceHistory(deviceId: string): Promise<void> {
    const device = await this.deviceModel.findById(deviceId).exec()
    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`)
    }

    device.min_avg_wait_seconds = undefined
    device.max_messages_per_cycle = undefined
    device.current_tier = 1
    device.last_tier_upgrade = new Date()

    await device.save()

    this.logger.warn(
      `Device ${deviceId} historical performance data reset - will start at tier 1`
    )
  }
}
