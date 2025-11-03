import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file
config({ path: resolve(__dirname, '../../.env') })

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Campaign } from '../campaigns/schemas/campaign.schema'
import {
  CampaignMessage,
  MessageStatus,
} from '../campaigns/schemas/campaign-message.schema'

/**
 * Migration script to populate queuedMessages field in Campaign records
 *
 * This script:
 * 1. Finds all campaigns without queuedMessages field
 * 2. Calculates queuedMessages by counting messages with PENDING/SCHEDULED/QUEUED/CLAIMED/SENDING status
 * 3. Updates each campaign with the correct count
 * 4. Verifies the migration completed successfully
 *
 * Background:
 * - New field added to track messages actively in queue
 * - Existing campaigns created before this field was added need to be populated
 * - Count includes: PENDING, SCHEDULED, QUEUED, CLAIMED, SENDING statuses
 *
 * Usage: npx ts-node -r tsconfig-paths/register src/migrations/populate-queued-messages.ts
 */

async function migrate() {
  console.log(
    'Starting migration: Populate queuedMessages field in Campaign...\n',
  )
  console.log(
    `MongoDB URI: ${process.env.MONGO_URI ? 'Loaded ✓' : 'Missing ✗'}\n`,
  )

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const campaignModel = app.get<Model<Campaign>>(
      getModelToken(Campaign.name),
    )
    const campaignMessageModel = app.get<Model<CampaignMessage>>(
      getModelToken(CampaignMessage.name),
    )

    // Step 1: Find campaigns that need updating
    console.log('Step 1: Finding campaigns to update...')

    const campaignsToUpdate = await campaignModel
      .find({
        $or: [
          { queuedMessages: { $exists: false } },
          { queuedMessages: null },
        ],
      })
      .select('_id')
      .exec()

    console.log(`✓ Found ${campaignsToUpdate.length} campaigns to update\n`)

    if (campaignsToUpdate.length === 0) {
      console.log('✅ No campaigns need updating. Migration complete!')
      return
    }

    // Step 2: Update each campaign with calculated queuedMessages
    console.log('Step 2: Calculating and updating queuedMessages...')

    let updatedCount = 0
    for (const campaign of campaignsToUpdate) {
      // Count queued messages for this campaign
      const queuedCount = await campaignMessageModel.countDocuments({
        campaign: campaign._id,
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

      // Update campaign
      await campaignModel.findByIdAndUpdate(campaign._id, {
        queuedMessages: queuedCount,
      })

      updatedCount++
      if (updatedCount % 10 === 0) {
        console.log(`  Progress: ${updatedCount}/${campaignsToUpdate.length}`)
      }
    }

    console.log(`✓ Updated ${updatedCount} campaigns\n`)

    // Step 3: Verification
    console.log('Step 3: Verifying migration...')

    const totalCampaigns = await campaignModel.countDocuments({})
    const campaignsWithField = await campaignModel.countDocuments({
      queuedMessages: { $exists: true, $ne: null },
    })

    console.log(`  Total campaigns: ${totalCampaigns}`)
    console.log(`  Campaigns with queuedMessages field: ${campaignsWithField}`)

    if (campaignsWithField === totalCampaigns) {
      console.log(
        '✓ Verification passed - all campaigns have queuedMessages field\n',
      )
    } else {
      console.warn(
        `⚠ Warning: ${totalCampaigns - campaignsWithField} campaigns missing queuedMessages field\n`,
      )
    }

    // Step 4: Sample verification
    console.log('Step 4: Sample verification (first 5 campaigns)...')
    const samples = await campaignModel
      .find({})
      .limit(5)
      .select('_id name queuedMessages sentMessages totalMessages')
      .lean()

    for (const sample of samples) {
      console.log(
        `  Campaign "${sample.name}": queued=${sample.queuedMessages}, sent=${sample.sentMessages}, total=${sample.totalMessages}`,
      )
    }

    console.log('\n✅ Migration completed successfully!')
    console.log('\nSummary:')
    console.log(`  - Campaigns updated: ${updatedCount}`)
    console.log(`  - Total campaigns: ${totalCampaigns}`)
    console.log(`  - Campaigns with queuedMessages: ${campaignsWithField}`)
    console.log('\nNext steps:')
    console.log('1. Restart your API server to pick up the new field')
    console.log('2. Refresh your web dashboard to see the Queued column')
    console.log('3. New campaigns will automatically have this field populated')
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
