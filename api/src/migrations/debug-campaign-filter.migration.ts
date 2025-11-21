import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Conversation } from '../users/schemas/conversation.schema'

async function debug() {
  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const conversationModel = app.get<Model<Conversation>>(
      getModelToken(Conversation.name),
    )

    // Test campaign filter with a known campaign ID
    const testCampaignId = '6909303ef02a6f8b694c9eb7'

    console.log(`Testing filter with campaign ID: ${testCampaignId}\n`)

    // Test exact match
    const exactMatch = await conversationModel.countDocuments({
      firstCampaignId: testCampaignId,
    })
    console.log(`Exact match count: ${exactMatch}`)

    // Test $in with array
    const inMatch = await conversationModel.countDocuments({
      firstCampaignId: { $in: [testCampaignId] },
    })
    console.log(`$in match count: ${inMatch}`)

    // Get sample
    const sample = await conversationModel
      .findOne({ firstCampaignId: testCampaignId })
      .lean()
    console.log('\nSample conversation:')
    console.log(
      `firstCampaignId: ${sample?.firstCampaignId} (type: ${typeof sample?.firstCampaignId})`,
    )

    // Check all unique campaign IDs
    const allCampaigns = await conversationModel.distinct('firstCampaignId')
    console.log(`\nTotal unique campaign IDs: ${allCampaigns.length}`)
    console.log('Sample campaign IDs:')
    allCampaigns
      .filter((id) => id !== null)
      .slice(0, 5)
      .forEach((id) => {
        console.log(`  - ${id} (type: ${typeof id})`)
      })
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await app.close()
  }
}

debug()
