import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Campaign, CampaignDocument } from './campaigns/schemas/campaign.schema'

async function verifyMigration() {
  console.log('🔍 Verifying campaign scheduling migration...\n')

  try {
    const app = await NestFactory.createApplicationContext(AppModule)

    // Get the campaign model
    const campaignModel = app.get<Model<CampaignDocument>>('CampaignModel')

    // Fetch a few campaigns to verify
    const campaigns = await campaignModel.find({}).limit(3).lean()

    console.log(`Found ${campaigns.length} campaigns to verify:\n`)

    campaigns.forEach((campaign, index) => {
      console.log(`Campaign ${index + 1}:`)
      console.log(`  ID: ${campaign._id}`)
      console.log(`  Name: ${campaign.name}`)
      console.log(`  Schedule Type: ${campaign.scheduleType}`)
      console.log(`  Campaign Dates: ${campaign.campaignStartDate} to ${campaign.campaignEndDate}`)
      console.log(`  Timezone: ${campaign.timezone}`)
      console.log(`  Sending Windows:`, JSON.stringify(campaign.sendingWindows, null, 4))
      console.log('')
    })

    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('❌ Verification failed:', error)
    process.exit(1)
  }
}

verifyMigration()
