import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Conversation } from '../users/schemas/conversation.schema'

async function inspect() {
  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const conversationModel = app.get<Model<Conversation>>(
      getModelToken(Conversation.name),
    )

    const count = await conversationModel.countDocuments({})
    console.log(`Total conversations: ${count}\n`)

    const sample = await conversationModel.find({}).limit(2).lean()
    console.log('Sample conversations:')
    console.log(JSON.stringify(sample, null, 2))
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await app.close()
  }
}

inspect()
