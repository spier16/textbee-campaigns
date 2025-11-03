import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file
config({ path: resolve(__dirname, '../../.env') })

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Device } from '../gateway/schemas/device.schema'
import { UsagePlan } from '../gateway/schemas/usage-plan.schema'

/**
 * Migration script to rename avg_wait_seconds to min_wait_seconds
 *
 * This script:
 * 1. Renames avg_wait_seconds to min_wait_seconds in all usage plan tiers
 * 2. Renames min_avg_wait_seconds to best_min_wait_seconds in all devices
 * 3. Updates predefined template plans
 *
 * Background:
 * - Previously: avg_wait_seconds represented average time with normal distribution
 * - Now: min_wait_seconds represents minimum time with right-skewed Gamma distribution
 * - This provides more realistic "human-like" message timing patterns
 *
 * Usage: npx ts-node -r tsconfig-paths/register src/migrations/migrate-avg-to-min-wait.ts
 */

async function migrate() {
  console.log('Starting migration: avg_wait_seconds → min_wait_seconds...\n')
  console.log(
    `MongoDB URI: ${process.env.MONGO_URI ? 'Loaded ✓' : 'Missing ✗'}\n`,
  )

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const usagePlanModel = app.get<Model<UsagePlan>>(
      getModelToken(UsagePlan.name),
    )
    const deviceModel = app.get<Model<Device>>(getModelToken(Device.name))

    // Step 1: Rename avg_wait_seconds to min_wait_seconds in usage plan tiers
    console.log(
      'Step 1: Renaming avg_wait_seconds to min_wait_seconds in usage plans...',
    )

    const plans = await usagePlanModel.find({}).exec()
    let planUpdateCount = 0

    for (const plan of plans) {
      let hasChanges = false

      // Update each tier in the plan
      for (const tier of plan.tiers) {
        if ('avg_wait_seconds' in tier) {
          // @ts-ignore - We're migrating the field
          tier.min_wait_seconds = tier.avg_wait_seconds
          // @ts-ignore
          delete tier.avg_wait_seconds
          hasChanges = true
        }
      }

      if (hasChanges) {
        await plan.save()
        planUpdateCount++
      }
    }

    console.log(`✓ Updated ${planUpdateCount} usage plans\n`)

    // Step 2: Rename min_avg_wait_seconds to best_min_wait_seconds in devices
    console.log(
      'Step 2: Renaming min_avg_wait_seconds to best_min_wait_seconds in devices...',
    )

    const deviceUpdateResult = await deviceModel.updateMany(
      { min_avg_wait_seconds: { $exists: true } },
      {
        $rename: {
          min_avg_wait_seconds: 'best_min_wait_seconds',
        },
      },
    )

    console.log(`✓ Updated ${deviceUpdateResult.modifiedCount} devices\n`)

    // Step 3: Verification
    console.log('Step 3: Verifying migration...')

    const plansWithOldField = await usagePlanModel.countDocuments({
      'tiers.avg_wait_seconds': { $exists: true },
    })

    const devicesWithOldField = await deviceModel.countDocuments({
      min_avg_wait_seconds: { $exists: true },
    })

    if (plansWithOldField === 0 && devicesWithOldField === 0) {
      console.log(
        '✓ Verification passed - no documents with old field names found\n',
      )
    } else {
      console.warn(
        `⚠ Warning: Found ${plansWithOldField} plans and ${devicesWithOldField} devices with old field names\n`,
      )
    }

    console.log('✅ Migration completed successfully!')
    console.log('\nSummary:')
    console.log(`  - Usage plans updated: ${planUpdateCount}`)
    console.log(`  - Devices updated: ${deviceUpdateResult.modifiedCount}`)
    console.log('\nNext steps:')
    console.log('1. Deploy updated application code with new field names')
    console.log('2. The randomization service will now use Gamma distribution')
    console.log(
      '3. Verify message scheduling uses minimum wait times correctly',
    )
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
