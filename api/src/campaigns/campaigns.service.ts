import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { InjectQueue } from '@nestjs/bull'
import { Model, Types } from 'mongoose'
import { Queue } from 'bull'
import {
  MessageTemplateGroup,
  MessageTemplateGroupDocument,
} from './schemas/message-template-group.schema'
import {
  MessageTemplate,
  MessageTemplateDocument,
} from './schemas/message-template.schema'
import {
  Campaign,
  CampaignDocument,
  CampaignStatus,
} from './schemas/campaign.schema'
import {
  CampaignMessage,
  CampaignMessageDocument,
  MessageStatus,
} from './schemas/campaign-message.schema'
import {
  CreateMessageTemplateGroupDto,
  UpdateMessageTemplateGroupDto,
  CreateMessageTemplateDto,
  UpdateMessageTemplateDto,
  ReorderTemplateGroupsDto,
  MessageTemplateGroupResponseDto,
  MessageTemplateResponseDto,
  CreateCampaignDto,
  UpdateCampaignStatusDto,
  CampaignResponseDto,
  ProcessTemplatePreviewDto,
  ProcessedTemplateResponseDto,
  TemplatePreviewDto,
  ContactDataDto,
  TemplateDataDto,
  HighlightedContentDto,
  HighlightedSegmentDto,
} from './campaigns.dto'
import { ContactsService } from '../contacts/contacts.service'
import { GetContactsDto } from '../contacts/contacts.dto'
import { User } from '../users/schemas/user.schema'
import { CampaignQueueService } from './queue/campaign-queue.service'
import { processTemplateVariables, processTemplateVariablesWithHighlighting, ContactData } from './utils/template-processor'

@Injectable()
export class CampaignsService {
  constructor(
    @InjectModel(MessageTemplateGroup.name)
    private messageTemplateGroupModel: Model<MessageTemplateGroupDocument>,
    @InjectModel(MessageTemplate.name)
    private messageTemplateModel: Model<MessageTemplateDocument>,
    @InjectModel(Campaign.name)
    private campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignMessage.name)
    private campaignMessageModel: Model<CampaignMessageDocument>,
    @InjectQueue('campaign-queue')
    private campaignQueue: Queue,
    private contactsService: ContactsService,
    private campaignQueueService: CampaignQueueService,
  ) {}

  // Template Groups
  async createTemplateGroup(
    userId: string,
    createDto: CreateMessageTemplateGroupDto,
  ): Promise<MessageTemplateGroupResponseDto> {
    try {
      // Get the next order value
      const maxOrder = await this.messageTemplateGroupModel
        .findOne({ userId: new Types.ObjectId(userId) })
        .sort({ order: -1 })
        .select('order')
        .lean()

      const nextOrder = maxOrder ? maxOrder.order + 1 : 0

      const templateGroup = new this.messageTemplateGroupModel({
        ...createDto,
        userId: new Types.ObjectId(userId),
        order: nextOrder,
      })

      const saved = await templateGroup.save()
      return this.formatTemplateGroupResponse(saved, [])
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          'A template group with this name already exists',
        )
      }
      throw error
    }
  }

  async getTemplateGroups(
    userId: string,
  ): Promise<MessageTemplateGroupResponseDto[]> {
    const groups = await this.messageTemplateGroupModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ order: 1, createdAt: 1 })
      .lean()

    const result = []
    for (const group of groups) {
      const templates = await this.messageTemplateModel
        .find({ groupId: group._id })
        .sort({ createdAt: 1 })
        .lean()

      result.push(
        this.formatTemplateGroupResponse(
          group,
          templates.map((t) => this.formatTemplateResponse(t)),
        ),
      )
    }

    return result
  }

  async getTemplateGroup(
    userId: string,
    groupId: string,
  ): Promise<MessageTemplateGroupResponseDto> {
    const group = await this.messageTemplateGroupModel
      .findOne({
        _id: new Types.ObjectId(groupId),
        userId: new Types.ObjectId(userId),
      })
      .lean()

    if (!group) {
      throw new NotFoundException('Template group not found')
    }

    const templates = await this.messageTemplateModel
      .find({ groupId: group._id })
      .sort({ createdAt: 1 })
      .lean()

    return this.formatTemplateGroupResponse(
      group,
      templates.map((t) => this.formatTemplateResponse(t)),
    )
  }

  async updateTemplateGroup(
    userId: string,
    groupId: string,
    updateDto: UpdateMessageTemplateGroupDto,
  ): Promise<MessageTemplateGroupResponseDto> {
    try {
      const updated = await this.messageTemplateGroupModel
        .findOneAndUpdate(
          {
            _id: new Types.ObjectId(groupId),
            userId: new Types.ObjectId(userId),
          },
          { ...updateDto, updatedAt: new Date() },
          { new: true },
        )
        .lean()

      if (!updated) {
        throw new NotFoundException('Template group not found')
      }

      const templates = await this.messageTemplateModel
        .find({ groupId: updated._id })
        .sort({ createdAt: 1 })
        .lean()

      return this.formatTemplateGroupResponse(
        updated,
        templates.map((t) => this.formatTemplateResponse(t)),
      )
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          'A template group with this name already exists',
        )
      }
      throw error
    }
  }

  async deleteTemplateGroup(userId: string, groupId: string): Promise<void> {
    const group = await this.messageTemplateGroupModel.findOne({
      _id: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
    })

    if (!group) {
      throw new NotFoundException('Template group not found')
    }

    // Delete all templates in the group first
    await this.messageTemplateModel.deleteMany({ groupId: group._id })

    // Delete the group
    await this.messageTemplateGroupModel.deleteOne({ _id: group._id })
  }

  async reorderTemplateGroups(
    userId: string,
    reorderDto: ReorderTemplateGroupsDto,
  ): Promise<MessageTemplateGroupResponseDto[]> {
    const { templateGroupIds } = reorderDto

    // Verify all template groups belong to the user
    const groups = await this.messageTemplateGroupModel
      .find({
        _id: { $in: templateGroupIds.map(id => new Types.ObjectId(id)) },
        userId: new Types.ObjectId(userId),
      })
      .lean()

    if (groups.length !== templateGroupIds.length) {
      throw new NotFoundException('One or more template groups not found')
    }

    // Update the order for each group
    const bulkOperations = templateGroupIds.map((groupId, index) => ({
      updateOne: {
        filter: {
          _id: new Types.ObjectId(groupId),
          userId: new Types.ObjectId(userId),
        },
        update: { order: index, updatedAt: new Date() },
      },
    }))

    await this.messageTemplateGroupModel.bulkWrite(bulkOperations)

    // Return the updated groups in their new order
    return this.getTemplateGroups(userId)
  }

  // Templates
  async createTemplate(
    userId: string,
    createDto: CreateMessageTemplateDto,
  ): Promise<MessageTemplateResponseDto> {
    // Verify the group exists and belongs to the user
    const group = await this.messageTemplateGroupModel.findOne({
      _id: new Types.ObjectId(createDto.groupId),
      userId: new Types.ObjectId(userId),
    })

    if (!group) {
      throw new NotFoundException('Template group not found')
    }

    try {
      const template = new this.messageTemplateModel({
        ...createDto,
        userId: new Types.ObjectId(userId),
        groupId: new Types.ObjectId(createDto.groupId),
      })

      const saved = await template.save()
      return this.formatTemplateResponse(saved)
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          'A template with this name already exists in this group',
        )
      }
      throw error
    }
  }

  async getTemplates(
    userId: string,
    groupId?: string,
  ): Promise<MessageTemplateResponseDto[]> {
    const filter: any = { userId: new Types.ObjectId(userId) }
    if (groupId) {
      filter.groupId = new Types.ObjectId(groupId)
    }

    const templates = await this.messageTemplateModel
      .find(filter)
      .sort({ createdAt: 1 })
      .lean()

    return templates.map((t) => this.formatTemplateResponse(t))
  }

  async getTemplate(
    userId: string,
    templateId: string,
  ): Promise<MessageTemplateResponseDto> {
    const template = await this.messageTemplateModel
      .findOne({
        _id: new Types.ObjectId(templateId),
        userId: new Types.ObjectId(userId),
      })
      .lean()

    if (!template) {
      throw new NotFoundException('Template not found')
    }

    return this.formatTemplateResponse(template)
  }

  async updateTemplate(
    userId: string,
    templateId: string,
    updateDto: UpdateMessageTemplateDto,
  ): Promise<MessageTemplateResponseDto> {
    try {
      const updated = await this.messageTemplateModel
        .findOneAndUpdate(
          {
            _id: new Types.ObjectId(templateId),
            userId: new Types.ObjectId(userId),
          },
          { ...updateDto, updatedAt: new Date() },
          { new: true },
        )
        .lean()

      if (!updated) {
        throw new NotFoundException('Template not found')
      }

      return this.formatTemplateResponse(updated)
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          'A template with this name already exists in this group',
        )
      }
      throw error
    }
  }

  async deleteTemplate(userId: string, templateId: string): Promise<void> {
    const result = await this.messageTemplateModel.deleteOne({
      _id: new Types.ObjectId(templateId),
      userId: new Types.ObjectId(userId),
    })

    if (result.deletedCount === 0) {
      throw new NotFoundException('Template not found')
    }
  }

  // Helper methods
  private formatTemplateGroupResponse(
    group: any,
    templates: MessageTemplateResponseDto[],
  ): MessageTemplateGroupResponseDto {
    return {
      _id: group._id.toString(),
      userId: group.userId.toString(),
      name: group.name,
      description: group.description,
      order: group.order || 0,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      templates,
    }
  }

  private formatTemplateResponse(template: any): MessageTemplateResponseDto {
    return {
      _id: template._id.toString(),
      userId: template.userId.toString(),
      groupId: template.groupId.toString(),
      name: template.name,
      content: template.content,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }
  }

  // Campaign Management Methods
  async createCampaign(
    user: User,
    createCampaignDto: CreateCampaignDto,
  ): Promise<CampaignResponseDto> {
    // Validate templates exist and belong to user
    const templates = await this.messageTemplateModel
      .find({
        _id: { $in: createCampaignDto.selectedTemplates.map(id => new Types.ObjectId(id)) },
        userId: new Types.ObjectId(user._id),
      })
      .lean()

    if (templates.length !== createCampaignDto.selectedTemplates.length) {
      throw new BadRequestException('One or more templates not found')
    }

    // Get unique contact count to calculate total messages (deduplicated with filters)
    const excludeDnc = createCampaignDto.excludeDnc ?? true
    const includePreviouslyMessaged = createCampaignDto.includePreviouslyMessaged ?? false

    const uniqueContactResult = await this.contactsService.getUniqueContactCount(
      user._id.toString(),
      createCampaignDto.selectedContacts,
      excludeDnc,
      includePreviouslyMessaged
    )
    const totalContacts = uniqueContactResult.uniqueContactCount

    // Create campaign
    const campaign = new this.campaignModel({
      ...createCampaignDto,
      user: user._id,
      status: CampaignStatus.DRAFT,
      excludeDnc,
      includePreviouslyMessaged,
      totalMessages: totalContacts, // One message per contact (templates rotate)
      sentMessages: 0,
      failedMessages: 0,
      pendingMessages: totalContacts,
    })

    const savedCampaign = await campaign.save()

    // Generate campaign messages with template rotation
    await this.generateCampaignMessages(savedCampaign, templates, user)

    return this.formatCampaignResponse(savedCampaign)
  }

  async getCampaigns(user: User, includeDeleted: boolean = false): Promise<CampaignResponseDto[]> {
    const filter: any = { user: user._id }
    if (!includeDeleted) {
      filter.isDeleted = { $ne: true }
    }

    const campaigns = await this.campaignModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()

    return campaigns.map(campaign => this.formatCampaignResponse(campaign))
  }

  async getDeletedCampaigns(user: User): Promise<CampaignResponseDto[]> {
    const campaigns = await this.campaignModel
      .find({
        user: user._id,
        isDeleted: true
      })
      .sort({ deletedAt: -1 })
      .lean()

    return campaigns.map(campaign => this.formatCampaignResponse(campaign))
  }

  async getCampaign(user: User, campaignId: string, includeDeleted: boolean = false): Promise<CampaignResponseDto> {
    const filter: any = {
      _id: new Types.ObjectId(campaignId),
      user: user._id,
    }

    if (!includeDeleted) {
      filter.isDeleted = { $ne: true }
    }

    const campaign = await this.campaignModel
      .findOne(filter)
      .lean()

    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    return this.formatCampaignResponse(campaign)
  }

  async updateCampaignStatus(
    user: User,
    campaignId: string,
    updateStatusDto: UpdateCampaignStatusDto,
  ): Promise<CampaignResponseDto> {
    const campaign = await this.campaignModel.findOne({
      _id: new Types.ObjectId(campaignId),
      user: user._id,
    })

    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    // Handle status transitions
    const oldStatus = campaign.status
    campaign.status = updateStatusDto.status

    if (updateStatusDto.status === CampaignStatus.RUNNING && oldStatus === CampaignStatus.DRAFT) {
      campaign.startedAt = new Date()
      // Add job to campaign queue for processing
      await this.campaignQueueService.addCampaignToQueue(
        campaign._id.toString(),
        user._id.toString()
      )
    } else if (updateStatusDto.status === CampaignStatus.PAUSED) {
      await this.campaignQueueService.pauseCampaign(campaign._id.toString())
    } else if (updateStatusDto.status === CampaignStatus.RUNNING && oldStatus === CampaignStatus.PAUSED) {
      await this.campaignQueueService.resumeCampaign(campaign._id.toString(), user._id.toString())
    } else if (updateStatusDto.status === CampaignStatus.CANCELLED) {
      await this.campaignQueueService.cancelCampaign(campaign._id.toString())
    }

    const updatedCampaign = await campaign.save()
    return this.formatCampaignResponse(updatedCampaign)
  }

  async deleteCampaign(user: User, campaignId: string): Promise<void> {
    const campaign = await this.campaignModel.findOne({
      _id: new Types.ObjectId(campaignId),
      user: user._id,
      isDeleted: { $ne: true }
    })

    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    // Store the current status before deletion
    const statusBeforeDelete = campaign.status

    // If the campaign is currently running, pause it first
    if (campaign.status === CampaignStatus.RUNNING) {
      await this.campaignQueueService.pauseCampaign(campaign._id.toString())
      campaign.status = CampaignStatus.PAUSED
    }

    // Soft delete the campaign
    await this.campaignModel.findByIdAndUpdate(
      campaign._id,
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          statusBeforeDelete,
          status: campaign.status, // Keep the current status (which might be PAUSED if it was running)
        }
      }
    )
  }

  async restoreCampaign(user: User, campaignId: string): Promise<CampaignResponseDto> {
    const campaign = await this.campaignModel.findOne({
      _id: new Types.ObjectId(campaignId),
      user: user._id,
      isDeleted: true
    })

    if (!campaign) {
      throw new NotFoundException('Deleted campaign not found')
    }

    // Restore the campaign with its original status
    const restoredStatus = campaign.statusBeforeDelete || campaign.status

    const updatedCampaign = await this.campaignModel.findByIdAndUpdate(
      campaign._id,
      {
        $set: {
          isDeleted: false,
          status: restoredStatus,
        },
        $unset: {
          deletedAt: 1,
          statusBeforeDelete: 1,
        }
      },
      { new: true }
    )

    return this.formatCampaignResponse(updatedCampaign)
  }

  // Private helper methods
  private async generateCampaignMessages(
    campaign: CampaignDocument,
    templates: any[],
    user: User,
  ): Promise<void> {
    const messages: any[] = []
    let templateIndex = 0

    // Get unique contacts from selected spreadsheets (deduplicated with stored filters)
    const uniqueContactsResult = await this.contactsService.getUniqueContacts(
      user._id.toString(),
      campaign.selectedContacts,
      campaign.excludeDnc,
      campaign.includePreviouslyMessaged
    )

    // Create messages for each unique contact, rotating through templates
    for (const contact of uniqueContactsResult.data) {
      const template = templates[templateIndex % templates.length]

      // Process template variables with contact data
      const contactData: ContactData = {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        propertyAddress: contact.propertyAddress,
        propertyCity: contact.propertyCity,
        propertyState: contact.propertyState,
        propertyZip: contact.propertyZip,
        mailingAddress: contact.mailingAddress,
        mailingCity: contact.mailingCity,
        mailingState: contact.mailingState,
        mailingZip: contact.mailingZip,
      }

      const processedContent = processTemplateVariables(template.content, contactData)

      messages.push({
        user: user._id,
        campaign: campaign._id,
        templateId: template._id.toString(),
        templateIndex: templateIndex % templates.length,
        content: processedContent, // Now contains processed content with substituted variables
        recipient: contact.phone,
        contactId: contact.id,
        status: MessageStatus.PENDING,
        priority: 1,
      })

      templateIndex++
    }

    // Batch insert messages
    if (messages.length > 0) {
      await this.campaignMessageModel.insertMany(messages)
    }
  }

  private formatCampaignResponse(campaign: any): CampaignResponseDto {
    return {
      _id: campaign._id.toString(),
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      totalMessages: campaign.totalMessages,
      sentMessages: campaign.sentMessages,
      failedMessages: campaign.failedMessages,
      pendingMessages: campaign.pendingMessages,
      startedAt: campaign.startedAt,
      completedAt: campaign.completedAt,
      lastMessageSentAt: campaign.lastMessageSentAt,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      selectedContacts: campaign.selectedContacts,
      selectedTemplates: campaign.selectedTemplates,
      sendDevices: campaign.sendDevices,
      scheduleType: campaign.scheduleType,
      campaignStartDate: campaign.campaignStartDate,
      campaignEndDate: campaign.campaignEndDate,
      timezone: campaign.timezone,
      excludeDnc: campaign.excludeDnc,
      includePreviouslyMessaged: campaign.includePreviouslyMessaged,
      isDeleted: campaign.isDeleted,
      deletedAt: campaign.deletedAt,
      statusBeforeDelete: campaign.statusBeforeDelete,
    }
  }

  // Template Preview Processing
  async processTemplatePreview(
    user: User,
    processPreviewDto: ProcessTemplatePreviewDto,
  ): Promise<ProcessedTemplateResponseDto> {
    const {
      templateIds,
      contactSpreadsheetIds,
      excludeDnc = true,
      includePreviouslyMessaged = false,
      maxPreviewCount = 100,
      highlightVariables = false,
    } = processPreviewDto

    // Validate templates exist and belong to user
    const templates = await this.messageTemplateModel
      .find({
        _id: { $in: templateIds.map(id => new Types.ObjectId(id)) },
        userId: new Types.ObjectId(user._id),
      })
      .lean()

    if (templates.length !== templateIds.length) {
      throw new BadRequestException('One or more templates not found')
    }

    // Get unique contacts from selected spreadsheets (deduplicated with filters)
    const uniqueContactsResult = await this.contactsService.getUniqueContacts(
      user._id.toString(),
      contactSpreadsheetIds,
      excludeDnc,
      includePreviouslyMessaged
    )

    const uniqueContacts = uniqueContactsResult.data.slice(0, maxPreviewCount)

    // Generate message previews with template rotation for UNIQUE contacts only
    const previews: TemplatePreviewDto[] = []
    let templateIndex = 0

    for (let i = 0; i < uniqueContacts.length; i++) {
      const contact = uniqueContacts[i]
      const template = templates[templateIndex % templates.length]

      // Convert contact to ContactData format for processing
      const contactData: ContactData = {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        propertyAddress: contact.propertyAddress,
        propertyCity: contact.propertyCity,
        propertyState: contact.propertyState,
        propertyZip: contact.propertyZip,
        mailingAddress: contact.mailingAddress,
        mailingCity: contact.mailingCity,
        mailingState: contact.mailingState,
        mailingZip: contact.mailingZip,
      }

      // Process template variables with contact data
      const processedContent = processTemplateVariables(template.content, contactData)

      // Generate highlighted content if requested
      let highlightedContentDto: HighlightedContentDto | undefined
      if (highlightVariables) {
        const highlightedContent = processTemplateVariablesWithHighlighting(template.content, contactData)
        highlightedContentDto = {
          segments: highlightedContent.segments.map(segment => ({
            text: segment.text,
            isVariable: segment.isVariable,
            variableName: segment.variableName,
            variableType: segment.variableType,
          })),
          plainText: highlightedContent.plainText,
          validationErrors: highlightedContent.validationErrors?.map(error => ({
            variableName: error.variableName,
            errorType: error.errorType,
            message: error.message,
          })),
        }
      }

      // Convert to DTO format
      const contactDto: ContactDataDto = {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        propertyAddress: contact.propertyAddress,
        propertyCity: contact.propertyCity,
        propertyState: contact.propertyState,
        propertyZip: contact.propertyZip,
        mailingAddress: contact.mailingAddress,
        mailingCity: contact.mailingCity,
        mailingState: contact.mailingState,
        mailingZip: contact.mailingZip,
      }

      const templateDto: TemplateDataDto = {
        _id: template._id.toString(),
        name: template.name,
        content: template.content,
      }

      previews.push({
        contact: contactDto,
        template: templateDto,
        templateIndex: templateIndex % templates.length,
        processedContent,
        highlightedContent: highlightedContentDto,
      })

      templateIndex++
    }

    return {
      previews,
      totalContacts: uniqueContactsResult.data.length,
      templatesUsed: templates.length,
    }
  }
}