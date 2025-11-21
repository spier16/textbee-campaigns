import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getModelToken } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { User } from '../users/schemas/user.schema'
import { Device } from '../gateway/schemas/device.schema'
import { SMS } from '../gateway/schemas/sms.schema'
import { Conversation } from '../users/schemas/conversation.schema'
import { ConversationMetadata } from '../users/schemas/conversation-metadata.schema'
import { ConversationReadStatus } from '../users/schemas/conversation-read-status.schema'
import { Campaign } from '../campaigns/schemas/campaign.schema'
import { normalizePhoneNumber } from '../contacts/utils/phone.utils'

/**
 * Migration to populate the conversations collection from existing SMS data
 *
 * This script:
 * 1. Iterates through all users
 * 2. For each user, aggregates their SMS messages into conversations
 * 3. Calculates unseenCount, hasReceivedMessage, and other stats
 * 4. Merges with existing metadata (archived, blocked, starred)
 * 5. Bulk inserts into the conversations collection
 */
async function migrate() {
  console.log('Starting conversations population migration...\n')

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const userModel = app.get<Model<User>>(getModelToken(User.name))
    const deviceModel = app.get<Model<Device>>(getModelToken(Device.name))
    const smsModel = app.get<Model<SMS>>(getModelToken(SMS.name))
    const conversationModel = app.get<Model<Conversation>>(
      getModelToken(Conversation.name),
    )
    const conversationMetadataModel = app.get<Model<ConversationMetadata>>(
      getModelToken(ConversationMetadata.name),
    )
    const conversationReadStatusModel = app.get<Model<ConversationReadStatus>>(
      getModelToken(ConversationReadStatus.name),
    )
    const campaignModel = app.get<Model<Campaign>>(
      getModelToken(Campaign.name),
    )

    // Get all users
    const users = await userModel.find({}).select('_id')
    console.log(`Found ${users.length} users\n`)

    let totalConversationsCreated = 0

    for (const user of users) {
      const userId = user._id
      console.log(`Processing user: ${userId}`)

      // Get user's devices
      const devices = await deviceModel.find({ user: userId }).select('_id')
      const deviceIds = devices.map((d) => d._id)

      if (deviceIds.length === 0) {
        console.log('  No devices found, skipping...\n')
        continue
      }

      // Get conversation metadata for this user
      const metadataRecords = await conversationMetadataModel.find({
        user: userId,
      })
      const metadata: Record<string, any> = {}
      metadataRecords.forEach((m) => {
        metadata[m.normalizedPhoneNumber] = m
      })

      // Get read statuses for this user
      const readStatusRecords = await conversationReadStatusModel.find({
        user: userId,
      })
      const readStatuses: Record<string, Date> = {}
      readStatusRecords.forEach((r) => {
        readStatuses[r.normalizedPhoneNumber] = r.lastSeenAt
      })

      // Aggregate conversations from SMS collection
      const aggregation = await smsModel.aggregate([
        {
          $match: {
            device: { $in: deviceIds },
            $or: [
              { sender: { $exists: true, $ne: null } },
              { recipient: { $exists: true, $ne: null } },
            ],
          },
        },
        {
          $addFields: {
            phoneNumber: {
              $cond: [
                { $ifNull: ['$sender', false] },
                '$sender',
                '$recipient',
              ],
            },
            messageDate: {
              $cond: [
                { $ifNull: ['$receivedAt', false] },
                '$receivedAt',
                '$requestedAt',
              ],
            },
            isIncoming: {
              $cond: [{ $ifNull: ['$sender', false] }, true, false],
            },
          },
        },
        // Sort by date BEFORE grouping so $first gets the earliest message
        {
          $sort: { messageDate: 1 },
        },
        {
          $group: {
            _id: '$phoneNumber',
            device: { $first: '$device' },
            lastMessageId: { $last: '$_id' },
            lastMessage: { $last: '$message' },
            lastMessageAt: { $last: '$messageDate' }, // Changed from $max to $last to get the last after sorting
            lastSender: { $last: '$isIncoming' },
            messageCount: { $sum: 1 },
            firstCampaignId: { $first: '$campaignId' }, // Now gets the earliest message's campaign
            // For hasReceivedMessage check
            hasAnyIncoming: {
              $max: {
                $cond: [{ $ifNull: ['$sender', false] }, 1, 0],
              },
            },
          },
        },
        {
          $sort: { lastMessageAt: -1 },
        },
      ])

      console.log(`  Found ${aggregation.length} conversations`)

      if (aggregation.length === 0) {
        console.log('  No conversations to migrate\n')
        continue
      }

      // Build conversation documents
      const conversationDocs = []

      for (const conv of aggregation) {
        const phoneNumber = conv._id
        const normalized = normalizePhoneNumber(phoneNumber)

        // Get metadata for this phone number
        const meta = metadata[normalized] || {
          isArchived: false,
          isBlocked: false,
          isStarred: false,
          archivedAt: null,
          blockedAt: null,
          starredAt: null,
          preferredDeviceId: null,
        }

        // Calculate unseenCount
        const lastSeenAt = readStatuses[normalized] || new Date(0)
        const unseenCount = await smsModel.countDocuments({
          device: { $in: deviceIds },
          sender: phoneNumber,
          $or: [
            { receivedAt: { $gt: lastSeenAt } },
            { requestedAt: { $gt: lastSeenAt } },
          ],
        })

        // Determine lastSender ('user' or 'contact')
        const lastSender = conv.lastSender ? 'contact' : 'user'

        // Get first campaign name if campaign ID exists
        let firstCampaignName = null
        if (conv.firstCampaignId) {
          const campaign = await campaignModel
            .findById(conv.firstCampaignId)
            .select('name')
          firstCampaignName = campaign?.name || null
        }

        conversationDocs.push({
          user: userId,
          device: conv.device,
          phoneNumber: phoneNumber,
          normalizedPhoneNumber: normalized,
          lastMessageId: conv.lastMessageId,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          lastSender: lastSender,
          messageCount: conv.messageCount,
          unseenCount: unseenCount,
          hasReceivedMessage: conv.hasAnyIncoming > 0,
          firstCampaignId: conv.firstCampaignId || null,
          firstCampaignName: firstCampaignName,
          isArchived: meta.isArchived,
          isBlocked: meta.isBlocked,
          isStarred: meta.isStarred,
          archivedAt: meta.archivedAt,
          blockedAt: meta.blockedAt,
          starredAt: meta.starredAt,
          preferredDeviceId: meta.preferredDeviceId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }

      // Bulk insert conversations (ignore duplicates)
      if (conversationDocs.length > 0) {
        try {
          await conversationModel.insertMany(conversationDocs, {
            ordered: false,
          })
          console.log(`  ✓ Created ${conversationDocs.length} conversations`)
          totalConversationsCreated += conversationDocs.length
        } catch (error: any) {
          // Ignore duplicate key errors (E11000)
          if (error.code === 11000) {
            const successCount =
              conversationDocs.length - (error.writeErrors?.length || 0)
            console.log(
              `  ✓ Created ${successCount} conversations (${error.writeErrors?.length || 0} duplicates skipped)`,
            )
            totalConversationsCreated += successCount
          } else {
            throw error
          }
        }
      }

      console.log('') // Blank line between users
    }

    console.log('✓ Migration completed successfully!')
    console.log(`\nTotal conversations created: ${totalConversationsCreated}`)
    console.log('\nNext steps:')
    console.log('1. Restart your API server')
    console.log('2. Test the Inbox page - it should load much faster')
    console.log('3. Verify all 8 filters work correctly')
    console.log('4. Check conversation counts match filtered results')
  } catch (error) {
    console.error('Error during migration:', error)
    process.exit(1)
  } finally {
    await app.close()
  }
}

migrate()
