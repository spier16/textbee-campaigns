import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Conversation } from '../users/schemas/conversation.schema'

async function clearConversations() {
  console.log('Clearing conversations collection...\n')

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const conversationModel = app.get<Model<Conversation>>(
      getModelToken(Conversation.name),
    )

    const result = await conversationModel.deleteMany({})
    console.log(`✓ Deleted ${result.deletedCount} conversations\n`)
  } catch (error) {
    console.error('Error during clearing:', error)
    process.exit(1)
  } finally {
    await app.close()
  }
}

clearConversations()
