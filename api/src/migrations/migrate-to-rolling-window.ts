import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Device } from '../gateway/schemas/device.schema'
import { SMS } from '../gateway/schemas/sms.schema'
import { UsagePlan } from '../gateway/schemas/usage-plan.schema'

/**
 * Migration script to transition from calendar-day tracking to rolling window system
 *
 * This script:
 * 1. Adds usageWindowMinutes field to all existing usage plans
 * 2. Removes obsolete counter fields from devices
 * 3. Creates index on SMS collection for efficient rolling window queries
 * 4. Recalculates cooldown status for all devices
 *
 * Usage: ts-node src/migrations/migrate-to-rolling-window.ts
 */

async function migrate() {
  console.log('Starting migration to rolling window system...\n')

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const usagePlanModel = app.get<Model<UsagePlan>>(
      getModelToken(UsagePlan.name),
    )
    const deviceModel = app.get<Model<Device>>(getModelToken(Device.name))
    const smsModel = app.get<Model<SMS>>(getModelToken(SMS.name))

    // Step 1: Add usageWindowMinutes to all existing usage plans
    console.log('Step 1: Adding usageWindowMinutes to existing usage plans...')
    const planUpdateResult = await usagePlanModel.updateMany(
      { usageWindowMinutes: { $exists: false } },
      { $set: { usageWindowMinutes: 1440 } }, // Default to 24 hours
    )
    console.log(`✓ Updated ${planUpdateResult.modifiedCount} usage plans\n`)

    // Step 2: Remove obsolete fields from devices
    console.log('Step 2: Removing obsolete counter fields from devices...')
    const deviceUpdateResult = await deviceModel.updateMany(
      {},
      {
        $unset: {
          messages_sent_today: '',
          messages_sent_this_hour: '',
          daily_counter_reset: '',
          hourly_counter_reset: '',
          cooldown_until: '', // No longer needed with rolling cooldown
        },
      },
    )
    console.log(`✓ Updated ${deviceUpdateResult.modifiedCount} devices\n`)

    // Step 3: Create index on SMS collection for rolling window queries
    console.log('Step 3: Creating index on SMS collection...')
    try {
      await smsModel.collection.createIndex(
        { device: 1, campaignId: 1, sentAt: -1 },
        { name: 'device_campaign_time_idx' },
      )
      console.log('✓ Created device_campaign_time_idx index\n')
    } catch (error) {
      if (error.code === 85) {
        // Index already exists
        console.log('✓ Index already exists (skipped)\n')
      } else {
        throw error
      }
    }

    // Step 4: Reset cooldown status for all devices
    console.log('Step 4: Resetting cooldown status for all devices...')
    const cooldownResetResult = await deviceModel.updateMany(
      {},
      { $set: { is_on_cooldown: false } },
    )
    console.log(
      `✓ Reset cooldown status for ${cooldownResetResult.modifiedCount} devices\n`,
    )

    console.log('✅ Migration completed successfully!')
    console.log('\nNext steps:')
    console.log('1. Restart your application')
    console.log(
      '2. The scheduler will automatically recalculate device usage every 5 minutes',
    )
    console.log('3. Verify dashboard displays correct usage stats')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await app.close()
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('\nMigration script finished')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\nMigration script failed:', error)
    process.exit(1)
  })
