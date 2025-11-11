import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { SMS } from '../gateway/schemas/sms.schema'
import { normalizePhoneNumber } from '../contacts/utils/phone.utils'

/**
 * Migration to normalize all phone numbers in the sms collection
 *
 * This migration ensures all phone numbers are stored in the format +1XXXXXXXXXX
 * for US numbers, which fixes issues with conversation message filtering.
 *
 * Usage:
 *   npm run migration:normalize-phone-numbers
 */

async function runMigration() {
  console.log('Starting phone number normalization migration...')

  const app = await NestFactory.createApplicationContext(AppModule)
  const smsModel = app.get<Model<SMS>>('SMSModel')

  let totalProcessed = 0
  let totalUpdated = 0
  let errors = 0

  try {
    // Find all SMS messages
    const allMessages = await smsModel.find({}).exec()
    totalProcessed = allMessages.length

    console.log(`Found ${totalProcessed} SMS messages to process`)

    const bulkOps = []

    for (const message of allMessages) {
      let needsUpdate = false
      const updateData: any = {}

      // Normalize sender field (for incoming messages)
      if (message.sender) {
        const normalizedSender = normalizePhoneNumber(message.sender)
        if (normalizedSender !== message.sender) {
          updateData.sender = normalizedSender
          needsUpdate = true
        }
      }

      // Normalize recipient field (for outgoing messages)
      if (message.recipient) {
        const normalizedRecipient = normalizePhoneNumber(message.recipient)
        if (normalizedRecipient !== message.recipient) {
          updateData.recipient = normalizedRecipient
          needsUpdate = true
        }
      }

      // Normalize senderPhoneNumber field (dual-SIM tracking)
      if (message.senderPhoneNumber) {
        const normalizedSenderPhone = normalizePhoneNumber(message.senderPhoneNumber)
        if (normalizedSenderPhone !== message.senderPhoneNumber) {
          updateData.senderPhoneNumber = normalizedSenderPhone
          needsUpdate = true
        }
      }

      // Add to bulk operations if update is needed
      if (needsUpdate) {
        bulkOps.push({
          updateOne: {
            filter: { _id: message._id },
            update: { $set: updateData }
          }
        })
        totalUpdated++
      }
    }

    console.log(`\nMigration Summary:`)
    console.log(`  Total messages processed: ${totalProcessed}`)
    console.log(`  Messages requiring updates: ${totalUpdated}`)

    if (bulkOps.length > 0) {
      console.log(`\nExecuting bulk update operations...`)
      const result = await smsModel.bulkWrite(bulkOps)
      console.log(`  Successfully updated ${result.modifiedCount} messages`)
    } else {
      console.log(`\nNo updates needed - all phone numbers are already normalized!`)
    }

  } catch (error) {
    console.error('Error during migration:', error)
    errors++
  } finally {
    await app.close()
  }

  console.log(`\n✓ Migration completed!`)
  console.log(`  Total processed: ${totalProcessed}`)
  console.log(`  Total updated: ${totalUpdated}`)
  console.log(`  Errors: ${errors}`)

  process.exit(errors > 0 ? 1 : 0)
}

runMigration()
