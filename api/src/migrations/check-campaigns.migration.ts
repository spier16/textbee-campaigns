import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Conversation } from '../users/schemas/conversation.schema'
import { SMS } from '../gateway/schemas/sms.schema'

async function checkCampaigns() {
  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const conversationModel = app.get<Model<Conversation>>(
      getModelToken(Conversation.name),
    )
    const smsModel = app.get<Model<SMS>>(getModelToken(SMS.name))

    // Check conversations with campaigns
    const withCampaigns = await conversationModel.countDocuments({
      firstCampaignId: { $ne: null },
    })
    console.log(`Conversations with campaigns: ${withCampaigns}`)

    // Check SMS messages with campaigns
    const smsWithCampaigns = await smsModel.countDocuments({
      campaignId: { $exists: true, $ne: null },
    })
    console.log(`SMS messages with campaigns: ${smsWithCampaigns}`)

    // Sample SMS with campaign
    const sampleSMS = await smsModel
      .findOne({ campaignId: { $exists: true, $ne: null } })
      .lean()
    console.log('\nSample SMS with campaign:')
    console.log(JSON.stringify(sampleSMS, null, 2))

    // Sample conversation
    const sampleConv = await conversationModel
      .findOne({ firstCampaignId: { $ne: null } })
      .lean()
    console.log('\nSample conversation with campaign:')
    console.log(JSON.stringify(sampleConv, null, 2))
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await app.close()
  }
}

checkCampaigns()
