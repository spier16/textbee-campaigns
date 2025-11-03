import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file
config({ path: resolve(__dirname, '../../.env') })

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { CampaignMessage } from '../campaigns/schemas/campaign-message.schema'
import { Campaign } from '../campaigns/schemas/campaign.schema'

/**
 * Migration script to populate campaignIsDeleted field in CampaignMessage records
 *
 * This script:
 * 1. Fetches all Campaign documents and creates a map of deleted status
 * 2. Updates all CampaignMessage documents with the campaignIsDeleted field
 * 3. Verifies the migration completed successfully
 *
 * Background:
 * - Previously: CampaignMessage did not track parent campaign deletion status
 * - Now: campaignIsDeleted field is denormalized for efficient filtering
 * - This ensures "previously messaged" filter excludes messages from deleted campaigns
 *
 * Usage: npx ts-node -r tsconfig-paths/register src/migrations/populate-campaign-is-deleted.ts
 */

async function migrate() {
  console.log(
    'Starting migration: Populate campaignIsDeleted field in CampaignMessage...\n',
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

    // Step 1: Build map of campaign deletion status
    console.log('Step 1: Fetching campaign deletion status...')

    const campaigns = await campaignModel
      .find({})
      .select('_id isDeleted')
      .exec()

    const deletedCampaignIds = new Set(
      campaigns.filter((c) => c.isDeleted).map((c) => c._id.toString()),
    )

    console.log(`✓ Found ${campaigns.length} campaigns`)
    console.log(`✓ Found ${deletedCampaignIds.size} deleted campaigns\n`)

    // Step 2: Update CampaignMessage records
    console.log('Step 2: Updating CampaignMessage records...')

    // Update messages from deleted campaigns
    const deletedUpdateResult = await campaignMessageModel.updateMany(
      { campaign: { $in: Array.from(deletedCampaignIds) } },
      { $set: { campaignIsDeleted: true } },
    )

    console.log(
      `✓ Marked ${deletedUpdateResult.modifiedCount} messages as deleted\n`,
    )

    // Update messages from active campaigns (set to false)
    const activeUpdateResult = await campaignMessageModel.updateMany(
      { campaignIsDeleted: { $ne: true } },
      { $set: { campaignIsDeleted: false } },
    )

    console.log(
      `✓ Marked ${activeUpdateResult.modifiedCount} messages as active\n`,
    )

    // Step 3: Verification
    console.log('Step 3: Verifying migration...')

    const totalMessages = await campaignMessageModel.countDocuments({})
    const messagesWithField = await campaignMessageModel.countDocuments({
      campaignIsDeleted: { $exists: true },
    })
    const deletedMessages = await campaignMessageModel.countDocuments({
      campaignIsDeleted: true,
    })
    const activeMessages = await campaignMessageModel.countDocuments({
      campaignIsDeleted: false,
    })

    console.log(`  Total messages: ${totalMessages}`)
    console.log(`  Messages with campaignIsDeleted field: ${messagesWithField}`)
    console.log(`  Messages marked as deleted: ${deletedMessages}`)
    console.log(`  Messages marked as active: ${activeMessages}`)

    if (messagesWithField === totalMessages) {
      console.log(
        '✓ Verification passed - all messages have campaignIsDeleted field\n',
      )
    } else {
      console.warn(
        `⚠ Warning: ${totalMessages - messagesWithField} messages missing campaignIsDeleted field\n`,
      )
    }

    console.log('✅ Migration completed successfully!')
    console.log('\nSummary:')
    console.log(`  - Campaigns processed: ${campaigns.length}`)
    console.log(`  - Deleted campaigns: ${deletedCampaignIds.size}`)
    console.log(
      `  - Messages marked as deleted: ${deletedUpdateResult.modifiedCount}`,
    )
    console.log(
      `  - Messages marked as active: ${activeUpdateResult.modifiedCount}`,
    )
    console.log('\nNext steps:')
    console.log('1. Deploy updated application code with new filtering logic')
    console.log('2. Verify "previously messaged" filter works correctly')
    console.log('3. Test campaign deletion and restoration workflows')
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
