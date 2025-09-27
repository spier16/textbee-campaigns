import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { User, UserDocument } from './schemas/user.schema'
import { ConversationReadStatus, ConversationReadStatusDocument } from './schemas/conversation-read-status.schema'
import { ConversationMetadata, ConversationMetadataDocument } from './schemas/conversation-metadata.schema'
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
    @InjectModel(ConversationReadStatus.name) private conversationReadStatusModel: Model<ConversationReadStatusDocument>,
    @InjectModel(ConversationMetadata.name) private conversationMetadataModel: Model<ConversationMetadataDocument>,
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

          if (devices.length === 0 || devices.map(device=>device.sentSMSCount + device.receivedSMSCount).reduce((a,b)=>a+b,0) == 0) {
            // User hasn't registered any device, send email
            await this.mailService.sendEmailFromTemplate({
              to: user.email,
              subject:
                'Getting Started with textbee.dev - How Can We Help?',
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

            if (devices.length === 0 || devices.map(device=>device.sentSMSCount + device.receivedSMSCount).reduce((a,b)=>a+b,0) == 0) {
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
    lastSeenAt: Date = new Date()
  ) {
    return await this.conversationReadStatusModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId), normalizedPhoneNumber },
      { lastSeenAt },
      { upsert: true, new: true }
    )
  }

  async getConversationReadStatuses(userId: string) {
    const statuses = await this.conversationReadStatusModel.find({
      user: new Types.ObjectId(userId)
    })

    const statusMap: Record<string, Date> = {}
    statuses.forEach(status => {
      statusMap[status.normalizedPhoneNumber] = status.lastSeenAt
    })

    return statusMap
  }

  async getConversationReadStatus(userId: string, normalizedPhoneNumber: string) {
    const status = await this.conversationReadStatusModel.findOne({
      user: new Types.ObjectId(userId),
      normalizedPhoneNumber
    })

    return status?.lastSeenAt || null
  }

  async getConversationMetadata(userId: string) {
    const metadata = await this.conversationMetadataModel.find({
      user: new Types.ObjectId(userId)
    })

    const metadataMap: Record<string, { isArchived: boolean; isBlocked: boolean; isStarred: boolean; archivedAt?: Date; firstCampaignName?: string }> = {}
    metadata.forEach(meta => {
      metadataMap[meta.normalizedPhoneNumber] = {
        isArchived: meta.isArchived,
        isBlocked: meta.isBlocked,
        isStarred: meta.isStarred,
        archivedAt: meta.archivedAt,
        firstCampaignName: meta.firstCampaignName
      }
    })

    return metadataMap
  }

  async archiveConversations(userId: string, phoneNumbers: string[]) {
    const operations = phoneNumbers.map(phoneNumber => ({
      updateOne: {
        filter: { user: new Types.ObjectId(userId), normalizedPhoneNumber: phoneNumber },
        update: {
          $set: {
            isArchived: true,
            archivedAt: new Date()
          }
        },
        upsert: true
      }
    }))

    await this.conversationMetadataModel.bulkWrite(operations)
    return { success: true, archivedCount: phoneNumbers.length }
  }

  async unarchiveConversations(userId: string, phoneNumbers: string[]) {
    const operations = phoneNumbers.map(phoneNumber => ({
      updateOne: {
        filter: { user: new Types.ObjectId(userId), normalizedPhoneNumber: phoneNumber },
        update: {
          $set: {
            isArchived: false,
            archivedAt: null
          }
        },
        upsert: true
      }
    }))

    await this.conversationMetadataModel.bulkWrite(operations)
    return { success: true, unarchivedCount: phoneNumbers.length }
  }

  async blockContacts(userId: string, phoneNumbers: string[]) {
    const operations = phoneNumbers.map(phoneNumber => ({
      updateOne: {
        filter: { user: new Types.ObjectId(userId), normalizedPhoneNumber: phoneNumber },
        update: {
          $set: {
            isBlocked: true,
            blockedAt: new Date(),
            // When blocking, remove from archived status - spam is separate from archived
            isArchived: false,
            archivedAt: null
          }
        },
        upsert: true
      }
    }))

    await this.conversationMetadataModel.bulkWrite(operations)
    return { success: true, blockedCount: phoneNumbers.length }
  }

  async unblockContacts(userId: string, phoneNumbers: string[]) {
    const operations = phoneNumbers.map(phoneNumber => ({
      updateOne: {
        filter: { user: new Types.ObjectId(userId), normalizedPhoneNumber: phoneNumber },
        update: {
          $set: {
            isBlocked: false,
            blockedAt: null
          }
        },
        upsert: true
      }
    }))

    await this.conversationMetadataModel.bulkWrite(operations)
    return { success: true, unblockedCount: phoneNumbers.length }
  }

  async toggleConversationStar(userId: string, phoneNumber: string, isStarred: boolean) {
    const result = await this.conversationMetadataModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId), normalizedPhoneNumber: phoneNumber },
      {
        $set: {
          isStarred,
          starredAt: isStarred ? new Date() : null
        }
      },
      { upsert: true, new: true }
    )

    return { success: true, isStarred: result.isStarred }
  }

  // Helper function to check and populate first campaign information for conversations
  private async checkAndPopulateFirstCampaignInfo(userId: string, deviceIds: any[], conversationMetadata: Record<string, any>, normalizedPhoneNumbers: string[]) {
    // Find conversations that don't have firstCampaignName set yet
    const phonesToCheck = normalizedPhoneNumbers.filter(phone =>
      !conversationMetadata[phone]?.firstCampaignName
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
              { recipient: { $regex: normalizedPhone.replace(/^\+1/, '').replace(/[^\d]/g, '') } }
            ]
          })
          .sort({ requestedAt: 1 }) // Get the earliest message

        // Check if this first message was from a campaign
        if (firstOutgoingMessage && firstOutgoingMessage.campaignId) {
          // Get campaign name
          const campaign = await this.campaignModel.findById(firstOutgoingMessage.campaignId)
          if (campaign) {
            return {
              normalizedPhone,
              campaignName: campaign.name
            }
          }
        }

        return null
      })
    )

    // Update conversation metadata for conversations that started with campaigns
    const updates = firstMessagesWithCampaigns
      .filter(result => result !== null)
      .map(result => ({
        updateOne: {
          filter: { user: new Types.ObjectId(userId), normalizedPhoneNumber: result.normalizedPhone },
          update: { $set: { firstCampaignName: result.campaignName } },
          upsert: true
        }
      }))

    if (updates.length > 0) {
      await this.conversationMetadataModel.bulkWrite(updates)

      // Update the local metadata object
      firstMessagesWithCampaigns.forEach(result => {
        if (result) {
          if (!conversationMetadata[result.normalizedPhone]) {
            conversationMetadata[result.normalizedPhone] = {
              isArchived: false,
              isBlocked: false,
              isStarred: false
            }
          }
          conversationMetadata[result.normalizedPhone].firstCampaignName = result.campaignName
        }
      })
    }
  }

  // Shared function to build conversation aggregation pipeline
  private buildConversationsPipeline(deviceIds: any[], includeMessages: boolean = false) {
    const matchStage: any = {
      device: { $in: deviceIds },
      $or: [
        { sender: { $exists: true, $ne: null } },
        { recipient: { $exists: true, $ne: null } }
      ]
    }

    const pipeline: any[] = [
      { $match: matchStage },
      {
        $addFields: {
          phoneNumber: {
            $cond: {
              if: { $ifNull: ['$sender', false] },
              then: '$sender',
              else: '$recipient'
            }
          },
          messageDate: {
            $cond: {
              if: { $ifNull: ['$receivedAt', false] },
              then: '$receivedAt',
              else: '$requestedAt'
            }
          },
          isIncoming: { $toBool: '$sender' }
        }
      },
    ]

    // Group stage with different fields depending on use case
    const groupStage: any = {
      $group: {
        _id: '$phoneNumber',
        phoneNumber: { $first: '$phoneNumber' },
        lastMessage: { $first: '$message' },
        lastMessageDate: { $max: '$messageDate' },
        lastMessageIsIncoming: { $first: '$isIncoming' }
      }
    }

    // Always include messages for processing, and conditionally include extra fields
    groupStage.$group.messages = { $push: '$$ROOT' }

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
                cond: { $eq: ['$$this.messageDate', '$lastMessageDate'] }
              }
            },
            0
          ]
        }
      }
    })

    pipeline.push({
      $addFields: {
        lastMessage: '$lastMessageData.message',
        lastMessageIsIncoming: '$lastMessageData.isIncoming'
      }
    })

    return pipeline
  }

  async getConversations(userId: string, page: number = 1, limit: number = 9, sortBy: string = 'newest', filter: string = 'all', campaignIds?: string[]) {
    const userObjectId = new Types.ObjectId(userId)
    const skip = (page - 1) * limit

    // Get user's devices to filter messages
    const userDevices = await this.deviceModel.find({ user: userObjectId }).select('_id')
    const deviceIds = userDevices.map(device => device._id)

    if (deviceIds.length === 0) {
      return {
        data: [],
        meta: {
          currentPage: page,
          totalPages: 0,
          totalConversations: 0,
          hasNextPage: false,
          hasPrevPage: false
        }
      }
    }

    // Get conversation metadata and read statuses
    const [conversationMetadata, readStatuses] = await Promise.all([
      this.getConversationMetadata(userId),
      this.getConversationReadStatuses(userId)
    ])

    // Use shared pipeline builder with messages included
    const pipeline = this.buildConversationsPipeline(deviceIds, true)

    // Execute the initial aggregation to get all conversations with basic data
    const allConversations = await this.smsModel.aggregate(pipeline)

    // Normalize phone numbers and deduplicate conversations
    const conversationMap = new Map()

    for (const conv of allConversations) {
      const normalizedPhone = normalizePhoneNumber(conv.phoneNumber)

      // If we already have a conversation for this normalized number, keep the one with more recent message
      if (conversationMap.has(normalizedPhone)) {
        const existing = conversationMap.get(normalizedPhone)
        if (new Date(conv.lastMessageDate) > new Date(existing.lastMessageDate)) {
          conversationMap.set(normalizedPhone, { ...conv, normalizedPhoneNumber: normalizedPhone })
        }
      } else {
        conversationMap.set(normalizedPhone, { ...conv, normalizedPhoneNumber: normalizedPhone })
      }
    }

    const deduplicatedConversations = Array.from(conversationMap.values())

    // Get contact information for both raw and normalized phone numbers
    const rawPhoneNumbers = deduplicatedConversations.map(conv => conv.phoneNumber)
    const normalizedPhoneNumbers = deduplicatedConversations.map(conv => conv.normalizedPhoneNumber)
    const allPhoneNumbers = [...rawPhoneNumbers, ...normalizedPhoneNumbers]

    const contacts = await this.contactModel.find({
      userId: userObjectId,
      phone: { $in: allPhoneNumbers }
    })

    const contactsByPhone = contacts.reduce((acc, contact) => {
      acc[contact.phone] = contact
      return acc
    }, {})

    // Check and populate first campaign information for conversations
    await this.checkAndPopulateFirstCampaignInfo(userId, deviceIds, conversationMetadata, normalizedPhoneNumbers)

    // Process all conversations with contacts and metadata
    const processedConversations = await Promise.all(
      deduplicatedConversations.map(async (conv) => {
        const normalizedPhone = conv.normalizedPhoneNumber
        const contact = contactsByPhone[conv.phoneNumber] || contactsByPhone[normalizedPhone]

        // Apply metadata (archived, blocked, starred status)
        const metadata = conversationMetadata[normalizedPhone] || {
          isArchived: false,
          isBlocked: false,
          isStarred: false,
          firstCampaignName: undefined
        }

        // Calculate unseen count
        const lastSeenAt = readStatuses[normalizedPhone] || new Date(0)
        const unseenCount = await this.smsModel.countDocuments({
          device: { $in: deviceIds },
          sender: conv.phoneNumber,
          $or: [
            { receivedAt: { $gt: lastSeenAt } },
            { requestedAt: { $gt: lastSeenAt } }
          ]
        })

        return {
          phoneNumber: conv.phoneNumber,
          normalizedPhoneNumber: normalizedPhone,
          deviceId: conv.deviceId.toString(),
          contact: contact ? {
            id: contact._id.toString(),
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            propertyAddress: contact.propertyAddress,
            propertyCity: contact.propertyCity,
            propertyState: contact.propertyState,
            propertyZip: contact.propertyZip,
            parcelCounty: contact.parcelCounty,
            parcelState: contact.parcelState,
            parcelAcres: contact.parcelAcres,
            apn: contact.apn,
            mailingAddress: contact.mailingAddress,
            mailingCity: contact.mailingCity,
            mailingState: contact.mailingState,
            mailingZip: contact.mailingZip,
            dnc: contact.dnc,
            dncUpdatedAt: contact.dncUpdatedAt
          } : undefined,
          lastMessage: {
            message: conv.lastMessage || '',
            timestamp: conv.lastMessageDate,
            isIncoming: conv.lastMessageIsIncoming
          },
          lastMessageDate: conv.lastMessageDate,
          messageCount: conv.messageCount,
          unseenCount,
          isArchived: metadata.isArchived,
          isBlocked: metadata.isBlocked,
          isStarred: metadata.isStarred,
          archivedAt: metadata.archivedAt,
          firstCampaignName: metadata.firstCampaignName
        }
      })
    )

    // Apply filtering based on filter parameter
    let filteredConversations = processedConversations

    switch (filter) {
      case 'unread':
        filteredConversations = processedConversations.filter(conv =>
          conv.unseenCount > 0 && !conv.isArchived && !conv.isBlocked
        )
        break
      case 'unreplied':
        filteredConversations = processedConversations.filter(conv =>
          conv.lastMessage.isIncoming && !conv.isArchived && !conv.isBlocked
        )
        break
      case 'awaiting-reply':
        filteredConversations = processedConversations.filter(conv =>
          !conv.lastMessage.isIncoming && !conv.isArchived && !conv.isBlocked
        )
        break
      case 'starred':
        filteredConversations = processedConversations.filter(conv =>
          conv.isStarred === true && !conv.isArchived && !conv.isBlocked
        )
        break
      case 'archived':
        filteredConversations = processedConversations.filter(conv => conv.isArchived === true)
        break
      case 'spam':
        filteredConversations = processedConversations.filter(conv => conv.isBlocked === true)
        break
      case 'all':
      default:
        // For 'all' view, exclude archived and blocked
        filteredConversations = processedConversations.filter(conv => !conv.isArchived && !conv.isBlocked)
        break
    }

    // Apply campaign filtering if specified (OR logic - conversations from any of the selected campaigns)
    if (campaignIds && campaignIds.length > 0) {
      // Get campaign names for all selected campaign IDs
      const campaigns = await this.campaignModel.find({
        _id: { $in: campaignIds.map(id => new Types.ObjectId(id)) }
      }).select('name')

      if (campaigns.length > 0) {
        const campaignNames = campaigns.map(campaign => campaign.name)
        filteredConversations = filteredConversations.filter(conv =>
          campaignNames.includes(conv.firstCampaignName)
        )
      } else {
        // If no campaigns found, return empty results
        filteredConversations = []
      }
    }

    // Apply sorting
    let sortedConversations = [...filteredConversations]

    if (sortBy === 'firstName' || sortBy === 'lastName') {
      sortedConversations.sort((a, b) => {
        const getNameField = (conv, field) => {
          if (field === 'firstName') {
            return conv.contact?.firstName || conv.normalizedPhoneNumber
          } else {
            return conv.contact?.lastName || conv.normalizedPhoneNumber
          }
        }

        const nameA = getNameField(a, sortBy).toLowerCase()
        const nameB = getNameField(b, sortBy).toLowerCase()
        return nameA.localeCompare(nameB)
      })
    } else {
      // Default to newest first
      sortedConversations.sort((a, b) =>
        new Date(b.lastMessageDate).getTime() - new Date(a.lastMessageDate).getTime()
      )
    }

    // Apply pagination to filtered and sorted results
    const totalFiltered = sortedConversations.length
    const totalPages = Math.ceil(totalFiltered / limit)
    const paginatedResults = sortedConversations.slice(skip, skip + limit)

    return {
      data: paginatedResults,
      meta: {
        currentPage: page,
        totalPages,
        totalConversations: totalFiltered,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        limit
      }
    }
  }

  async getConversationCounts(userId: string) {
    const userObjectId = new Types.ObjectId(userId)

    // Get user's devices
    const userDevices = await this.deviceModel.find({ user: userObjectId }).select('_id')
    const deviceIds = userDevices.map(device => device._id)

    if (deviceIds.length === 0) {
      return {
        all: 0,
        unread: 0,
        unreplied: 0,
        awaitingReply: 0,
        starred: 0,
        archived: 0,
        spam: 0
      }
    }

    // Get conversation metadata and read statuses
    const [conversationMetadata, readStatuses] = await Promise.all([
      this.getConversationMetadata(userId),
      this.getConversationReadStatuses(userId)
    ])

    // Use shared pipeline builder (no extra fields needed for counts)
    const pipeline = this.buildConversationsPipeline(deviceIds, false)

    // Execute the aggregation to get all conversations
    const allConversations = await this.smsModel.aggregate(pipeline)

    // Normalize phone numbers and deduplicate conversations
    const conversationMap = new Map()

    for (const conv of allConversations) {
      const normalizedPhone = normalizePhoneNumber(conv.phoneNumber)

      // If we already have a conversation for this normalized number, keep the one with more recent message
      if (conversationMap.has(normalizedPhone)) {
        const existing = conversationMap.get(normalizedPhone)
        if (new Date(conv.lastMessageDate) > new Date(existing.lastMessageDate)) {
          conversationMap.set(normalizedPhone, { ...conv, normalizedPhoneNumber: normalizedPhone })
        }
      } else {
        conversationMap.set(normalizedPhone, { ...conv, normalizedPhoneNumber: normalizedPhone })
      }
    }

    const deduplicatedConversations = Array.from(conversationMap.values())

    // Process conversations with metadata
    const processedConversations = await Promise.all(
      deduplicatedConversations.map(async (conv) => {
        const normalizedPhone = conv.normalizedPhoneNumber
        const metadata = conversationMetadata[normalizedPhone] || {
          isArchived: false,
          isBlocked: false,
          isStarred: false
        }

        // Calculate unseen count
        const lastSeenAt = readStatuses[normalizedPhone] || new Date(0)
        const unseenCount = await this.smsModel.countDocuments({
          device: { $in: deviceIds },
          sender: conv.phoneNumber,
          $or: [
            { receivedAt: { $gt: lastSeenAt } },
            { requestedAt: { $gt: lastSeenAt } }
          ]
        })

        return {
          normalizedPhoneNumber: normalizedPhone,
          lastMessageIsIncoming: conv.lastMessageIsIncoming,
          unseenCount,
          isArchived: metadata.isArchived,
          isBlocked: metadata.isBlocked,
          isStarred: metadata.isStarred
        }
      })
    )

    // Calculate counts for each category
    const inboxConversations = processedConversations.filter(conv => !conv.isArchived && !conv.isBlocked)

    return {
      all: inboxConversations.length,
      unread: inboxConversations.filter(conv => conv.unseenCount > 0).length,
      unreplied: inboxConversations.filter(conv => conv.lastMessageIsIncoming).length,
      awaitingReply: inboxConversations.filter(conv => !conv.lastMessageIsIncoming).length,
      starred: inboxConversations.filter(conv => conv.isStarred === true).length,
      archived: processedConversations.filter(conv => conv.isArchived === true).length,
      spam: processedConversations.filter(conv => conv.isBlocked === true).length
    }
  }
}
