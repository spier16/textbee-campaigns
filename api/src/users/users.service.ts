import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { User, UserDocument } from './schemas/user.schema'
import {
  ConversationReadStatus,
  ConversationReadStatusDocument,
} from './schemas/conversation-read-status.schema'
import {
  ConversationMetadata,
  ConversationMetadataDocument,
} from './schemas/conversation-metadata.schema'
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema'
import { Model, Types } from 'mongoose'
import { Cron, CronExpression } from '@nestjs/schedule'
import { MailService } from '../mail/mail.service'
import { BillingService } from '../billing/billing.service'
import { Device, DeviceDocument } from '../gateway/schemas/device.schema'
import { SMS } from '../gateway/schemas/sms.schema'
import { Contact } from '../contacts/schemas/contact.schema'
import { Campaign } from '../campaigns/schemas/campaign.schema'
import { normalizePhoneNumber } from '../contacts/utils/phone.utils'

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(ConversationReadStatus.name)
    private conversationReadStatusModel: Model<ConversationReadStatusDocument>,
    @InjectModel(ConversationMetadata.name)
    private conversationMetadataModel: Model<ConversationMetadataDocument>,
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    @InjectModel(Contact.name) private contactModel: Model<Contact>,
    @InjectModel(Campaign.name) private campaignModel: Model<Campaign>,
    private mailService: MailService,
    private billingService: BillingService,
  ) {}

  async findOne(params) {
    return await this.userModel.findOne(params)
  }

  async findAll() {
    return await this.userModel.find()
  }

  async create({
    name,
    email,
    password,
    phone,
  }: {
    name: string
    email: string
    password?: string
    phone?: string
  }) {
    if (await this.findOne({ email })) {
      throw new HttpException(
        {
          error: 'user exists with the same email',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const newUser = new this.userModel({
      name,
      email,
      password,
      phone,
    })
    return await newUser.save()
  }

  async updateProfile(
    input: { name: string; phone: string },
    user: UserDocument,
  ) {
    const userToUpdate = await this.findOne({ _id: user._id })
    if (!userToUpdate) {
      throw new HttpException({ error: 'User not found' }, HttpStatus.NOT_FOUND)
    }

    if (input.name) {
      userToUpdate.name = input.name
    }
    if (input.phone) {
      userToUpdate.phone = input.phone
    }

    return await userToUpdate.save()
  }

  @Cron('0 12 * * *') // Every day at 12 PM
  async sendEmailToInactiveNewUsers() {
    try {
      // Get users who signed up between 3-4 days ago (not 1-2 days)
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

      const newUsers = await this.userModel.find({
        createdAt: {
          $gte: fourDaysAgo,
          $lt: threeDaysAgo,
        },
      })

      for (const user of newUsers) {
        try {
          // Check if user has any devices registered or has sent/received any SMS
          const devices = await this.deviceModel.find({ user: user._id })

          if (
            devices.length === 0 ||
            devices
              .map((device) => device.sentSMSCount + device.receivedSMSCount)
              .reduce((a, b) => a + b, 0) == 0
          ) {
            // User hasn't registered any device, send email
            await this.mailService.sendEmailFromTemplate({
              to: user.email,
              subject: 'Getting Started with textbee.dev - How Can We Help?',
              template: 'inactive-new-user',
              context: {
                name: user.name,
                registerDeviceUrl: `${process.env.FRONTEND_URL}/dashboard`,
              },
            })
            console.log(`Sent inactive new user email to ${user.email}`)
          }
          // Wait 200ms before processing the next user
          await new Promise((resolve) => setTimeout(resolve, 200))
        } catch (error) {
          console.error(`Error processing email for user ${user.email}:`, error)
        }
      }
    } catch (error) {
      console.error('Error sending emails to inactive new users:', error)
    }
  }

  @Cron('0 13 * * *') // Every day at 1 PM
  async sendEmailToFreeUsers() {
    try {
      // Get users who signed up between 13-14 days ago
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      const thirteenDaysAgo = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000)

      const usersToEmail = await this.userModel.find({
        createdAt: {
          $gte: fourteenDaysAgo,
          $lt: thirteenDaysAgo,
        },
      })

      for (const user of usersToEmail) {
        try {
          const subscription = await this.billingService.getActiveSubscription(
            user._id.toString(),
          )

          if (subscription?.plan?.name === 'free') {
            const devices = await this.deviceModel.find({ user: user._id })

            if (
              devices.length === 0 ||
              devices
                .map((device) => device.sentSMSCount + device.receivedSMSCount)
                .reduce((a, b) => a + b, 0) == 0
            ) {
              // Only send this if they haven't set up any devices after 10-14 days
              await this.mailService.sendEmailFromTemplate({
                to: user.email,
                subject: `${user.name?.split(' ')[0]}, we'd love to help you get started with textbee.dev`,
                template: 'inactive-new-user-day-10',
                context: {
                  name: user.name,
                  registerDeviceUrl: `${process.env.FRONTEND_URL}/dashboard`,
                },
              })

              console.log(`Sent inactive new user email to ${user.email}`)
            } else {
              // Only send upgrade email to active users who have at least one device
              await this.mailService.sendEmailFromTemplate({
                to: user.email,
                subject: `${user.name?.split(' ')[0]}, unlock more capabilities with textbee.dev Pro`,
                template: 'upgrade-to-pro',
                context: {
                  name: user.name,
                  upgradeUrl: `${process.env.FRONTEND_URL}/checkout/pro`,
                  deviceCount: devices.length,
                },
              })
              console.log(`Sent upgrade to pro email to ${user.email}`)
            }
          }

          // Wait 200ms before processing the next user
          await new Promise((resolve) => setTimeout(resolve, 200))
        } catch (error) {
          console.error(`Error processing email for user ${user.email}:`, error)
        }
      }
    } catch (error) {
      console.error('Error sending emails to free plan users:', error)
    }
  }

  async markConversationAsRead(
    userId: string,
    normalizedPhoneNumber: string,
    lastSeenAt: Date = new Date(),
  ) {
    const userObjectId = new Types.ObjectId(userId)

    // Update read status (existing logic)
    await this.conversationReadStatusModel.findOneAndUpdate(
      { user: userObjectId, normalizedPhoneNumber },
      { lastSeenAt },
      { upsert: true, new: true },
    )

    // NEW: Also update unseenCount in conversations collection
    // Recalculate unseen count for this conversation
    const userDevices = await this.deviceModel
      .find({ user: userObjectId })
      .select('_id')
    const deviceIds = userDevices.map((device) => device._id)

    if (deviceIds.length > 0) {
      // Count unseen messages (messages received after lastSeenAt)
      const unseenCount = await this.smsModel.countDocuments({
        device: { $in: deviceIds },
        sender: normalizedPhoneNumber, // Only incoming messages
        $or: [
          { receivedAt: { $gt: lastSeenAt } },
          { requestedAt: { $gt: lastSeenAt } }, // Edge case handling
        ],
      })

      // Update conversation with new unseen count
      await this.conversationModel.findOneAndUpdate(
        { user: userObjectId, normalizedPhoneNumber },
        { $set: { unseenCount } },
      )
    }
  }

  async getConversationReadStatuses(userId: string) {
    const statuses = await this.conversationReadStatusModel.find({
      user: new Types.ObjectId(userId),
    })

    const statusMap: Record<string, Date> = {}
    statuses.forEach((status) => {
      statusMap[status.normalizedPhoneNumber] = status.lastSeenAt
    })

    return statusMap
  }

  async getConversationReadStatus(
    userId: string,
    normalizedPhoneNumber: string,
  ) {
    const status = await this.conversationReadStatusModel.findOne({
      user: new Types.ObjectId(userId),
      normalizedPhoneNumber,
    })

    return status?.lastSeenAt || null
  }

  async getConversationMetadata(userId: string) {
    const metadata = await this.conversationMetadataModel.find({
      user: new Types.ObjectId(userId),
    })

    const metadataMap: Record<
      string,
      {
        isArchived: boolean
        isBlocked: boolean
        isStarred: boolean
        archivedAt?: Date
        firstCampaignName?: string
        preferredDeviceId?: string
      }
    > = {}
    metadata.forEach((meta) => {
      metadataMap[meta.normalizedPhoneNumber] = {
        isArchived: meta.isArchived,
        isBlocked: meta.isBlocked,
        isStarred: meta.isStarred,
        archivedAt: meta.archivedAt,
        firstCampaignName: meta.firstCampaignName,
        preferredDeviceId: meta.preferredDeviceId,
      }
    })

    return metadataMap
  }

  async archiveConversations(userId: string, phoneNumbers: string[]) {
    const userObjectId = new Types.ObjectId(userId)
    const operations = phoneNumbers.map((phoneNumber) => ({
      updateOne: {
        filter: {
          user: userObjectId,
          normalizedPhoneNumber: phoneNumber,
        },
        update: {
          $set: {
            isArchived: true,
            archivedAt: new Date(),
          },
        },
        upsert: true,
      },
    }))

    await this.conversationMetadataModel.bulkWrite(operations)

    // NEW: Also update conversations collection
    await this.conversationModel.updateMany(
      { user: userObjectId, normalizedPhoneNumber: { $in: phoneNumbers } },
      { $set: { isArchived: true, archivedAt: new Date() } },
    )

    return { success: true, archivedCount: phoneNumbers.length }
  }

  async unarchiveConversations(userId: string, phoneNumbers: string[]) {
    const userObjectId = new Types.ObjectId(userId)
    const operations = phoneNumbers.map((phoneNumber) => ({
      updateOne: {
        filter: {
          user: userObjectId,
          normalizedPhoneNumber: phoneNumber,
        },
        update: {
          $set: {
            isArchived: false,
            archivedAt: null,
          },
        },
        upsert: true,
      },
    }))

    await this.conversationMetadataModel.bulkWrite(operations)

    // NEW: Also update conversations collection
    await this.conversationModel.updateMany(
      { user: userObjectId, normalizedPhoneNumber: { $in: phoneNumbers } },
      { $set: { isArchived: false, archivedAt: null } },
    )

    return { success: true, unarchivedCount: phoneNumbers.length }
  }

  async blockContacts(userId: string, phoneNumbers: string[]) {
    const userObjectId = new Types.ObjectId(userId)
    const operations = phoneNumbers.map((phoneNumber) => ({
      updateOne: {
        filter: {
          user: userObjectId,
          normalizedPhoneNumber: phoneNumber,
        },
        update: {
          $set: {
            isBlocked: true,
            blockedAt: new Date(),
            // When blocking, remove from archived status - spam is separate from archived
            isArchived: false,
            archivedAt: null,
          },
        },
        upsert: true,
      },
    }))

    await this.conversationMetadataModel.bulkWrite(operations)

    // NEW: Also update conversations collection
    await this.conversationModel.updateMany(
      { user: userObjectId, normalizedPhoneNumber: { $in: phoneNumbers } },
      {
        $set: {
          isBlocked: true,
          blockedAt: new Date(),
          isArchived: false, // Blocking removes from archive
          archivedAt: null,
        },
      },
    )

    return { success: true, blockedCount: phoneNumbers.length }
  }

  async unblockContacts(userId: string, phoneNumbers: string[]) {
    const userObjectId = new Types.ObjectId(userId)
    const operations = phoneNumbers.map((phoneNumber) => ({
      updateOne: {
        filter: {
          user: userObjectId,
          normalizedPhoneNumber: phoneNumber,
        },
        update: {
          $set: {
            isBlocked: false,
            blockedAt: null,
          },
        },
        upsert: true,
      },
    }))

    await this.conversationMetadataModel.bulkWrite(operations)

    // NEW: Also update conversations collection
    await this.conversationModel.updateMany(
      { user: userObjectId, normalizedPhoneNumber: { $in: phoneNumbers } },
      { $set: { isBlocked: false, blockedAt: null } },
    )

    return { success: true, unblockedCount: phoneNumbers.length }
  }

  async toggleConversationStar(
    userId: string,
    phoneNumber: string,
    isStarred: boolean,
  ) {
    const userObjectId = new Types.ObjectId(userId)
    const result = await this.conversationMetadataModel.findOneAndUpdate(
      { user: userObjectId, normalizedPhoneNumber: phoneNumber },
      {
        $set: {
          isStarred,
          starredAt: isStarred ? new Date() : null,
        },
      },
      { upsert: true, new: true },
    )

    // NEW: Also update conversations collection
    await this.conversationModel.findOneAndUpdate(
      { user: userObjectId, normalizedPhoneNumber: phoneNumber },
      { $set: { isStarred, starredAt: isStarred ? new Date() : null } },
    )

    return { success: true, isStarred: result.isStarred }
  }

  async updateConversationDevice(
    userId: string,
    phoneNumber: string,
    deviceId: string,
  ) {
    const userObjectId = new Types.ObjectId(userId)
    const result = await this.conversationMetadataModel.findOneAndUpdate(
      { user: userObjectId, normalizedPhoneNumber: phoneNumber },
      {
        $set: {
          preferredDeviceId: deviceId,
        },
      },
      { upsert: true, new: true },
    )

    // NEW: Also update conversations collection
    await this.conversationModel.findOneAndUpdate(
      { user: userObjectId, normalizedPhoneNumber: phoneNumber },
      { $set: { preferredDeviceId: deviceId } },
    )

    return { success: true, deviceId: result.preferredDeviceId }
  }

  // Helper function to check and populate first campaign information for conversations
  private async checkAndPopulateFirstCampaignInfo(
    userId: string,
    deviceIds: any[],
    conversationMetadata: Record<string, any>,
    normalizedPhoneNumbers: string[],
  ) {
    // Find conversations that don't have firstCampaignName set yet
    const phonesToCheck = normalizedPhoneNumbers.filter(
      (phone) => !conversationMetadata[phone]?.firstCampaignName,
    )

    if (phonesToCheck.length === 0) return

    // For each phone number, find the first outgoing message
    const firstMessagesWithCampaigns = await Promise.all(
      phonesToCheck.map(async (normalizedPhone) => {
        // Find the very first outgoing message to this contact (regardless of campaign status)
        const firstOutgoingMessage = await this.smsModel
          .findOne({
            device: { $in: deviceIds },
            recipient: { $exists: true, $ne: null },
            $or: [
              { recipient: normalizedPhone },
              // Also check for messages to any phone number that normalizes to this
              {
                recipient: {
                  $regex: normalizedPhone
                    .replace(/^\+1/, '')
                    .replace(/[^\d]/g, ''),
                },
              },
            ],
          })
          .sort({ requestedAt: 1 }) // Get the earliest message

        // Check if this first message was from a campaign
        if (firstOutgoingMessage && firstOutgoingMessage.campaignId) {
          // Get campaign name
          const campaign = await this.campaignModel.findById(
            firstOutgoingMessage.campaignId,
          )
          if (campaign) {
            return {
              normalizedPhone,
              campaignName: campaign.name,
            }
          }
        }

        return null
      }),
    )

    // Update conversation metadata for conversations that started with campaigns
    const updates = firstMessagesWithCampaigns
      .filter((result) => result !== null)
      .map((result) => ({
        updateOne: {
          filter: {
            user: new Types.ObjectId(userId),
            normalizedPhoneNumber: result.normalizedPhone,
          },
          update: { $set: { firstCampaignName: result.campaignName } },
          upsert: true,
        },
      }))

    if (updates.length > 0) {
      await this.conversationMetadataModel.bulkWrite(updates)

      // Update the local metadata object
      firstMessagesWithCampaigns.forEach((result) => {
        if (result) {
          if (!conversationMetadata[result.normalizedPhone]) {
            conversationMetadata[result.normalizedPhone] = {
              isArchived: false,
              isBlocked: false,
              isStarred: false,
            }
          }
          conversationMetadata[result.normalizedPhone].firstCampaignName =
            result.campaignName
        }
      })
    }
  }

  // ========== Conversation Collection Sync Methods ==========

  /**
   * Upsert conversation document when a new message is created (incoming or outgoing)
   *
   * This method maintains the materialized conversation view by updating it
   * whenever a new SMS is created. It handles both incoming and outgoing messages.
   *
   * @param sms - The SMS document that was just created
   * @param deviceUserId - The user ID who owns the device (to avoid extra query)
   */
  async upsertConversationOnMessage(
    sms: any,
    deviceUserId: Types.ObjectId,
  ): Promise<void> {
    const phoneNumber = sms.sender || sms.recipient
    const normalized = normalizePhoneNumber(phoneNumber)
    const isIncoming = !!sms.sender
    const messageDate = sms.receivedAt || sms.requestedAt

    // Get current read status for unseen count calculation
    const readStatus = await this.conversationReadStatusModel.findOne({
      user: deviceUserId,
      normalizedPhoneNumber: normalized,
    })

    const lastSeenAt = readStatus?.lastSeenAt || new Date(0)
    const isUnseen = isIncoming && messageDate > lastSeenAt

    // Prepare update operations
    const updateOps: any = {
      $set: {
        phoneNumber: phoneNumber, // Will only set on insert
        device: sms.device,
        lastMessageId: sms._id,
        lastMessage: sms.message,
        lastMessageAt: messageDate,
        lastSender: isIncoming ? 'contact' : 'user',
        updatedAt: new Date(),
      },
      $inc: {
        messageCount: 1,
        unseenCount: isUnseen ? 1 : 0,
      },
      $setOnInsert: {
        user: deviceUserId,
        normalizedPhoneNumber: normalized,
        isArchived: false,
        isBlocked: false,
        isStarred: false,
        createdAt: new Date(),
      },
    }

    // If incoming message, ensure hasReceivedMessage is set
    if (isIncoming) {
      updateOps.$set.hasReceivedMessage = true
    }

    // If first campaign message, set campaign fields
    if (sms.campaignId) {
      updateOps.$setOnInsert.firstCampaignId = sms.campaignId
      // Campaign name will be populated lazily or via migration
    }

    await this.conversationModel.findOneAndUpdate(
      { user: deviceUserId, normalizedPhoneNumber: normalized },
      updateOps,
      { upsert: true, new: true },
    )
  }

  /**
   * Update conversation when message status changes (sent, delivered, failed)
   *
   * Currently, we only update the lastMessageAt timestamp when a message
   * is successfully sent. Failed messages don't update the conversation.
   *
   * @param sms - The SMS document with updated status
   * @param deviceUserId - The user ID who owns the device
   * @param newStatus - The new status of the message
   */
  async updateConversationOnStatusChange(
    sms: any,
    deviceUserId: Types.ObjectId,
    newStatus: string,
  ): Promise<void> {
    // Only update lastMessageAt if status changes to sent/delivered
    // This ensures failed messages don't appear as "last message"
    if (newStatus === 'sent' && sms.sentAt) {
      const phoneNumber = sms.sender || sms.recipient
      const normalized = normalizePhoneNumber(phoneNumber)

      await this.conversationModel.findOneAndUpdate(
        {
          user: deviceUserId,
          normalizedPhoneNumber: normalized,
          lastMessageId: sms._id, // Only update if this is still the last message
        },
        {
          $set: {
            lastMessageAt: sms.sentAt, // Update with actual send time
          },
        },
      )
    }
    // For failures, don't update conversation (keep previous successful message as last)
  }

  // Shared function to build conversation aggregation pipeline
  private buildConversationsPipeline(
    deviceIds: any[],
    includeMessages: boolean = false,
    pagination?: { skip: number; limit: number },
  ) {
    const matchStage: any = {
      device: { $in: deviceIds },
      $or: [
        { sender: { $exists: true, $ne: null } },
        { recipient: { $exists: true, $ne: null } },
      ],
    }

    const pipeline: any[] = [
      { $match: matchStage },
      {
        $addFields: {
          phoneNumber: {
            $cond: {
              if: { $ifNull: ['$sender', false] },
              then: '$sender',
              else: '$recipient',
            },
          },
          messageDate: {
            $cond: {
              if: { $ifNull: ['$receivedAt', false] },
              then: '$receivedAt',
              else: '$requestedAt',
            },
          },
          isIncoming: { $toBool: '$sender' },
        },
      },
    ]

    // Group stage with different fields depending on use case
    const groupStage: any = {
      $group: {
        _id: '$phoneNumber',
        phoneNumber: { $first: '$phoneNumber' },
        lastMessage: { $first: '$message' },
        lastMessageDate: { $max: '$messageDate' },
        lastMessageIsIncoming: { $first: '$isIncoming' },
      },
    }

    // Only push necessary fields instead of entire document for memory efficiency
    groupStage.$group.messages = {
      $push: {
        sender: '$sender',
        campaignId: '$campaignId',
        type: '$type',
        message: '$message',
        messageDate: '$messageDate',
        isIncoming: '$isIncoming',
      },
    }

    if (includeMessages) {
      groupStage.$group.deviceId = { $first: '$device' }
      groupStage.$group.messageCount = { $sum: 1 }
    }

    pipeline.push(groupStage)

    // Add fields to get actual last message data
    pipeline.push({
      $addFields: {
        lastMessageData: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$messages',
                cond: { $eq: ['$$this.messageDate', '$lastMessageDate'] },
              },
            },
            0,
          ],
        },
      },
    })

    pipeline.push({
      $addFields: {
        lastMessage: '$lastMessageData.message',
        lastMessageIsIncoming: '$lastMessageData.isIncoming',
      },
    })

    // Sort by most recent message date (default sorting)
    // Note: firstName/lastName sorting still needs to happen in JS after contact enrichment
    pipeline.push({
      $sort: { lastMessageDate: -1 },
    })

    // Add pagination if specified (for getConversations)
    if (pagination) {
      pipeline.push({ $skip: pagination.skip })
      pipeline.push({ $limit: pagination.limit })
    }

    return pipeline
  }

  async getConversations(
    userId: string,
    page: number = 1,
    limit: number = 9,
    sortBy: string = 'newest',
    filter: string = 'all',
    campaignIds?: string[],
  ) {
    const skip = (page - 1) * limit
    const userObjectId = new Types.ObjectId(userId)

    // Build filter query for conversations collection
    const query: any = { user: userObjectId }

    switch (filter) {
      case 'unread':
        query.unseenCount = { $gt: 0 }
        query.isArchived = false
        query.isBlocked = false
        break
      case 'unreplied':
        query.lastSender = 'contact'
        query.isArchived = false
        query.isBlocked = false
        break
      case 'awaiting-reply':
        query.lastSender = 'user'
        query.isArchived = false
        query.isBlocked = false
        break
      case 'starred':
        query.isStarred = true
        query.isArchived = false
        query.isBlocked = false
        break
      case 'engaged':
        query.hasReceivedMessage = true
        query.isArchived = false
        query.isBlocked = false
        break
      case 'archived':
        query.isArchived = true
        break
      case 'spam':
        query.isBlocked = true
        break
      case 'all':
      default:
        query.isArchived = false
        query.isBlocked = false
        break
    }

    // Campaign filtering
    if (campaignIds?.length > 0) {
      query.firstCampaignId = { $in: campaignIds }
    }

    // Get total count
    const totalCount = await this.conversationModel.countDocuments(query)

    // Query conversations
    const conversations = await this.conversationModel
      .find(query)
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()

    // Enrich with contacts
    const contacts = await this.contactModel.find({
      userId: userObjectId,
      phone: { $in: conversations.map((c) => c.phoneNumber) },
    })

    const contactsByPhone = contacts.reduce((acc, c) => {
      acc[c.phone] = c
      return acc
    }, {})

    // Map to response format
    let enriched = conversations.map((conv) => ({
      phoneNumber: conv.phoneNumber,
      normalizedPhoneNumber: conv.normalizedPhoneNumber,
      deviceId: conv.device.toString(),
      hasReceivedMessage: conv.hasReceivedMessage,
      contact: contactsByPhone[conv.phoneNumber] ||
        contactsByPhone[conv.normalizedPhoneNumber]
        ? {
            id: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            )._id.toString(),
            firstName: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).firstName,
            lastName: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).lastName,
            email: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).email,
            propertyAddress: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).propertyAddress,
            propertyCity: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).propertyCity,
            propertyState: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).propertyState,
            propertyZip: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).propertyZip,
            parcelCounty: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).parcelCounty,
            parcelState: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).parcelState,
            parcelAcres: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).parcelAcres,
            apn: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).apn,
            mailingAddress: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).mailingAddress,
            mailingCity: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).mailingCity,
            mailingState: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).mailingState,
            mailingZip: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).mailingZip,
            dnc: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).dnc,
            dncUpdatedAt: (
              contactsByPhone[conv.phoneNumber] ||
              contactsByPhone[conv.normalizedPhoneNumber]
            ).dncUpdatedAt,
          }
        : undefined,
      lastMessage: {
        message: conv.lastMessage,
        timestamp: conv.lastMessageAt,
        isIncoming: conv.lastSender === 'contact',
      },
      lastMessageDate: conv.lastMessageAt,
      messageCount: conv.messageCount,
      unseenCount: conv.unseenCount,
      isArchived: conv.isArchived,
      isBlocked: conv.isBlocked,
      isStarred: conv.isStarred,
      archivedAt: conv.archivedAt,
      firstCampaignName: conv.firstCampaignName,
    }))

    // Name sorting (after contact enrichment)
    if (sortBy === 'firstName' || sortBy === 'lastName') {
      enriched.sort((a, b) => {
        const fieldA =
          sortBy === 'firstName'
            ? a.contact?.firstName || a.normalizedPhoneNumber
            : a.contact?.lastName || a.normalizedPhoneNumber
        const fieldB =
          sortBy === 'firstName'
            ? b.contact?.firstName || b.normalizedPhoneNumber
            : b.contact?.lastName || b.normalizedPhoneNumber
        return fieldA.toLowerCase().localeCompare(fieldB.toLowerCase())
      })
    }

    return {
      data: enriched,
      meta: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalConversations: totalCount,
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1,
        limit,
      },
    }
  }

  async getConversationCounts(userId: string) {
    const userObjectId = new Types.ObjectId(userId)
    const baseQuery = { user: userObjectId, isArchived: false, isBlocked: false }

    const [all, unread, unreplied, awaitingReply, starred, engaged, archived, spam] =
      await Promise.all([
        this.conversationModel.countDocuments(baseQuery),
        this.conversationModel.countDocuments({ ...baseQuery, unseenCount: { $gt: 0 } }),
        this.conversationModel.countDocuments({ ...baseQuery, lastSender: 'contact' }),
        this.conversationModel.countDocuments({ ...baseQuery, lastSender: 'user' }),
        this.conversationModel.countDocuments({ ...baseQuery, isStarred: true }),
        this.conversationModel.countDocuments({ ...baseQuery, hasReceivedMessage: true }),
        this.conversationModel.countDocuments({ user: userObjectId, isArchived: true }),
        this.conversationModel.countDocuments({ user: userObjectId, isBlocked: true }),
      ])

    return { all, unread, unreplied, awaitingReply, starred, engaged, archived, spam }
  }
}
