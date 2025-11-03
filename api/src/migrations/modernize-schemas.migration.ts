import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Device, DeviceDocument } from '../gateway/schemas/device.schema'
import {
  UsagePlan,
  UsagePlanDocument,
} from '../gateway/schemas/usage-plan.schema'
import {
  CampaignMessage,
  CampaignMessageDocument,
  MessageStatus,
} from '../campaigns/schemas/campaign-message.schema'

/**
 * Migration script to modernize schemas for queue-based messaging system
 *
 * This migration:
 * 1. Populates historical best_min_wait_seconds and max_messages_per_cycle for devices
 * 2. Renames usage plan tier fields (timeDelayBetweenMessages -> min_wait_seconds, dailyLimit -> messages_per_cycle)
 * 3. Adds not_before field to pending campaign messages
 *
 * Run this migration once after deploying new schemas
 */
@Injectable()
export class ModernizeSchemasMigration {
  private readonly logger = new Logger(ModernizeSchemasMigration.name)

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(UsagePlan.name)
    private usagePlanModel: Model<UsagePlanDocument>,
    @InjectModel(CampaignMessage.name)
    private campaignMessageModel: Model<CampaignMessageDocument>,
  ) {}

  /**
   * Execute the full migration
   */
  async execute(): Promise<void> {
    this.logger.log('Starting schema modernization migration...')

    try {
      await this.migrateDevices()
      await this.migrateUsagePlans()
      await this.migrateCampaignMessages()

      this.logger.log('Schema modernization migration completed successfully!')
    } catch (error) {
      this.logger.error('Migration failed:', error)
      throw error
    }
  }

  /**
   * Step 1: Migrate devices to populate historical tracking fields
   */
  private async migrateDevices(): Promise<void> {
    this.logger.log('Migrating devices...')

    const devices = await this.deviceModel.find({}).exec()
    let updatedCount = 0

    for (const device of devices) {
      let needsUpdate = false

      // Get current usage plan to determine tier settings
      if (device.usagePlan) {
        const usagePlan = await this.usagePlanModel
          .findById(device.usagePlan)
          .exec()

        if (usagePlan) {
          const currentTier = usagePlan.tiers.find(
            (t) => t.tier === device.current_tier,
          )

          if (currentTier) {
            // Check if using old field names (for backward compatibility during migration)
            const minWaitSeconds =
              (currentTier as any).min_wait_seconds ||
              (currentTier as any).avg_wait_seconds ||
              (currentTier as any).timeDelayBetweenMessages
            const messagesPerCycle =
              (currentTier as any).messages_per_cycle ||
              (currentTier as any).dailyLimit

            // Populate historical fields if not set
            if (!device.best_min_wait_seconds && minWaitSeconds) {
              device.best_min_wait_seconds = minWaitSeconds
              needsUpdate = true
            }

            if (!device.max_messages_per_cycle && messagesPerCycle) {
              device.max_messages_per_cycle = messagesPerCycle
              needsUpdate = true
            }
          }
        }
      }

      if (needsUpdate) {
        await device.save()
        updatedCount++
      }
    }

    this.logger.log(`Migrated ${updatedCount} of ${devices.length} devices`)
  }

  /**
   * Step 2: Migrate usage plans to rename tier fields
   * Note: This assumes you've already updated the schema definition
   * MongoDB will handle the field renaming on next save
   */
  private async migrateUsagePlans(): Promise<void> {
    this.logger.log('Migrating usage plans...')

    const plans = await this.usagePlanModel.find({}).exec()
    let updatedCount = 0

    for (const plan of plans) {
      let needsUpdate = false

      // Check if tiers are using old field names
      if (plan.tiers && plan.tiers.length > 0) {
        const firstTier = plan.tiers[0] as any

        if (
          firstTier.timeDelayBetweenMessages !== undefined ||
          firstTier.dailyLimit !== undefined
        ) {
          // Migrate tier data from old field names to new
          plan.tiers = plan.tiers.map((tier: any) => ({
            tier: tier.tier,
            min_wait_seconds:
              tier.min_wait_seconds ||
              tier.avg_wait_seconds ||
              tier.timeDelayBetweenMessages,
            messages_per_cycle: tier.messages_per_cycle || tier.dailyLimit,
          }))
          needsUpdate = true
        }
      }

      if (needsUpdate) {
        // Use markModified to ensure nested field changes are saved
        plan.markModified('tiers')
        await plan.save()
        updatedCount++
      }
    }

    this.logger.log(`Migrated ${updatedCount} of ${plans.length} usage plans`)
  }

  /**
   * Step 3: Add not_before field to existing pending campaign messages
   */
  private async migrateCampaignMessages(): Promise<void> {
    this.logger.log('Migrating campaign messages...')

    // Find all pending messages without not_before field
    const pendingMessages = await this.campaignMessageModel
      .find({
        status: { $in: [MessageStatus.PENDING, MessageStatus.SCHEDULED] },
        not_before: { $exists: false },
      })
      .exec()

    let updatedCount = 0

    for (const message of pendingMessages) {
      // Set not_before to scheduledTime if it exists, otherwise current time
      message.not_before = message.scheduledTime || new Date()
      await message.save()
      updatedCount++
    }

    this.logger.log(`Migrated ${updatedCount} campaign messages`)
  }

  /**
   * Rollback method (optional, for testing)
   */
  async rollback(): Promise<void> {
    this.logger.warn('Rolling back migration...')

    // Remove historical fields from devices
    await this.deviceModel.updateMany(
      {},
      {
        $unset: {
          best_min_wait_seconds: '',
          max_messages_per_cycle: '',
        },
      },
    )

    // Remove not_before from campaign messages
    await this.campaignMessageModel.updateMany(
      {},
      { $unset: { not_before: '' } },
    )

    this.logger.log('Rollback completed')
  }
}
