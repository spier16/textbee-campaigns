import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Conversation } from '../users/schemas/conversation.schema'

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const conversationModel = app.get<Model<Conversation>>(
      getModelToken(Conversation.name),
    )

    // These are the actual campaign IDs from the user's debug log
    const campaignIds = [
      '690934767ede81f189796e54',
      '6909303ef02a6f8b694c9eb7',
      '69092f4ab5d8bd1eea24ed4d',
      '69092b4c2a61dee714ad00ab',
      '69092924dd1f1732dee1d66d',
    ]

    console.log('Testing with actual campaign IDs from frontend:\n')

    // Test the exact query that getConversations would use
    const userObjectId = new Types.ObjectId('68ed2ae5abbf934c1ae02db7')
    const query: any = {
      user: userObjectId,
      isArchived: false,
      isBlocked: false,
      firstCampaignId: { $in: campaignIds },
    }

    const count = await conversationModel.countDocuments(query)
    console.log(`Query: ${JSON.stringify(query, null, 2)}`)
    console.log(`\nResult count: ${count}`)

    // Get sample results
    const results = await conversationModel.find(query).limit(5).lean()
    console.log('\nSample results:')
    results.forEach((r) => {
      console.log(
        `  - Phone: ${r.phoneNumber}, Campaign: ${r.firstCampaignId} (${r.firstCampaignName})`,
      )
    })

    // Check which campaign IDs actually have conversations
    console.log('\nBreakdown by campaign ID:')
    for (const id of campaignIds) {
      const count = await conversationModel.countDocuments({
        user: userObjectId,
        firstCampaignId: id,
      })
      console.log(`  ${id}: ${count} conversations`)
    }
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await app.close()
  }
}

test()
