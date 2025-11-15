import httpBrowserClient from '../httpBrowserClient'
import { ApiEndpoints } from '@/config/api'

export interface MessageTemplate {
  _id: string
  userId: string
  groupId: string
  name: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface MessageTemplateGroup {
  _id: string
  userId: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  templates: MessageTemplate[]
}

export interface CreateTemplateGroupDto {
  name: string
  description?: string
}

export interface UpdateTemplateGroupDto {
  name?: string
  description?: string
}

export interface ReorderTemplateGroupsDto {
  templateGroupIds: string[]
}

export interface CreateTemplateDto {
  groupId: string
  name: string
  content: string
}

export interface UpdateTemplateDto {
  name?: string
  content?: string
}

export interface SendingWindow {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

export interface WeekdayWindow {
  startTime: string
  endTime: string
}

export interface WeekdayWindows {
  monday: WeekdayWindow[]
  tuesday: WeekdayWindow[]
  wednesday: WeekdayWindow[]
  thursday: WeekdayWindow[]
  friday: WeekdayWindow[]
  saturday: WeekdayWindow[]
  sunday: WeekdayWindow[]
}

export enum CampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export enum ScheduleType {
  NOW = 'now',
  LATER = 'later',
  WINDOWS = 'windows',
  WEEKDAY = 'weekday'
}

export interface CreateCampaignDto {
  name: string
  description?: string
  selectedContacts: string[]
  selectedTemplates: string[]
  sendDevices: string[]
  scheduleType: ScheduleType
  campaignStartDate: string
  campaignEndDate: string
  timezone: string
  sendingWindows?: SendingWindow[]
  weekdayWindows?: WeekdayWindows
  excludeDnc?: boolean
  includePreviouslyMessaged?: boolean
}

export interface UpdateCampaignStatusDto {
  status: CampaignStatus
}

export interface Campaign {
  _id: string
  name: string
  description?: string
  status: CampaignStatus
  totalMessages: number
  sentMessages: number
  failedMessages: number
  pendingMessages: number
  queuedMessages: number
  startedAt?: string
  completedAt?: string
  lastMessageSentAt?: string
  createdAt: string
  updatedAt: string
  selectedContacts: string[]
  selectedTemplates: string[]
  sendDevices: string[]
  scheduleType: ScheduleType
  campaignStartDate: string
  campaignEndDate: string
  timezone: string
  sendingWindows?: SendingWindow[] // Unified scheduling format (all times in UTC)
  weekdayWindows?: WeekdayWindows // Preserved for editing weekday-mode campaigns
  excludeDnc?: boolean
  includePreviouslyMessaged?: boolean
  isDeleted?: boolean
  deletedAt?: string
  statusBeforeDelete?: CampaignStatus
  deliveryRate?: number
  responseRate?: number
  responsesCount?: number
}

// Template Preview Processing interfaces
export interface ProcessTemplatePreviewDto {
  templateIds: string[]
  contactSpreadsheetIds: string[]
  excludeDnc?: boolean
  includePreviouslyMessaged?: boolean
  maxPreviewCount?: number
  highlightVariables?: boolean
}

export interface ContactData {
  id?: string
  firstName?: string
  lastName?: string
  phone: string
  email?: string
  propertyAddress?: string
  propertyCity?: string
  propertyState?: string
  propertyZip?: string
  mailingAddress?: string
  mailingCity?: string
  mailingState?: string
  mailingZip?: string
}

export interface TemplateData {
  _id: string
  name: string
  content: string
}

export interface ValidationError {
  variableName: string
  errorType: 'missing_field' | 'empty_value' | 'unsupported_variable'
  message: string
}

export interface HighlightedSegment {
  text: string
  isVariable: boolean
  variableName?: string
  variableType?: string
}

export interface HighlightedContent {
  segments: HighlightedSegment[]
  plainText: string
  validationErrors?: ValidationError[]
}

export interface TemplatePreview {
  contact: ContactData
  template: TemplateData
  templateIndex: number
  processedContent: string
  highlightedContent?: HighlightedContent
}

export interface ProcessedTemplateResponse {
  previews: TemplatePreview[]
  totalContacts: number
  templatesUsed: number
}

export interface SidebarCampaign {
  _id: string
  name: string
  sentMessages: number
  createdAt: string
}

export interface SidebarCampaignsResponse {
  campaigns: SidebarCampaign[]
  totalCount: number
  page: number
  limit: number
  hasMore: boolean
}

export const campaignsApi = {
  // Template Groups
  async createTemplateGroup(data: CreateTemplateGroupDto): Promise<MessageTemplateGroup> {
    const response = await httpBrowserClient.post(ApiEndpoints.campaigns.templateGroups(), data)
    return response.data
  },

  async getTemplateGroups(): Promise<MessageTemplateGroup[]> {
    const response = await httpBrowserClient.get(ApiEndpoints.campaigns.templateGroups())
    return response.data
  },

  async getTemplateGroup(id: string): Promise<MessageTemplateGroup> {
    const response = await httpBrowserClient.get(ApiEndpoints.campaigns.templateGroup(id))
    return response.data
  },

  async updateTemplateGroup(id: string, data: UpdateTemplateGroupDto): Promise<MessageTemplateGroup> {
    const response = await httpBrowserClient.put(ApiEndpoints.campaigns.templateGroup(id), data)
    return response.data
  },

  async deleteTemplateGroup(id: string): Promise<void> {
    await httpBrowserClient.delete(ApiEndpoints.campaigns.templateGroup(id))
  },

  async reorderTemplateGroups(data: ReorderTemplateGroupsDto): Promise<MessageTemplateGroup[]> {
    const response = await httpBrowserClient.put(ApiEndpoints.campaigns.reorderTemplateGroups(), data)
    return response.data
  },

  // Templates
  async createTemplate(data: CreateTemplateDto): Promise<MessageTemplate> {
    const response = await httpBrowserClient.post(ApiEndpoints.campaigns.templates(), data)
    return response.data
  },

  async getTemplates(groupId?: string): Promise<MessageTemplate[]> {
    const params = groupId ? { groupId } : {}
    const response = await httpBrowserClient.get(ApiEndpoints.campaigns.templates(), { params })
    return response.data
  },

  async getTemplate(id: string): Promise<MessageTemplate> {
    const response = await httpBrowserClient.get(ApiEndpoints.campaigns.template(id))
    return response.data
  },

  async updateTemplate(id: string, data: UpdateTemplateDto): Promise<MessageTemplate> {
    const response = await httpBrowserClient.put(ApiEndpoints.campaigns.template(id), data)
    return response.data
  },

  async deleteTemplate(id: string): Promise<void> {
    await httpBrowserClient.delete(ApiEndpoints.campaigns.template(id))
  },

  async processTemplatePreview(data: ProcessTemplatePreviewDto): Promise<ProcessedTemplateResponse> {
    const response = await httpBrowserClient.post(ApiEndpoints.campaigns.processTemplatePreview(), data)
    return response.data
  },

  // Campaigns
  async createCampaign(data: CreateCampaignDto): Promise<Campaign> {
    const response = await httpBrowserClient.post(ApiEndpoints.campaigns.campaigns(), data)
    return response.data
  },

  async getCampaigns(): Promise<Campaign[]> {
    const response = await httpBrowserClient.get(ApiEndpoints.campaigns.campaigns())
    return response.data
  },

  async getSidebarCampaigns(page: number = 1, limit: number = 10): Promise<SidebarCampaignsResponse> {
    const response = await httpBrowserClient.get(`${ApiEndpoints.campaigns.campaigns()}/sidebar`, {
      params: { page: page.toString(), limit: limit.toString() }
    })
    return response.data
  },

  async getCampaign(id: string): Promise<Campaign> {
    const response = await httpBrowserClient.get(ApiEndpoints.campaigns.campaign(id))
    return response.data
  },

  async updateCampaignStatus(id: string, data: UpdateCampaignStatusDto): Promise<Campaign> {
    const response = await httpBrowserClient.put(ApiEndpoints.campaigns.campaignStatus(id), data)
    return response.data
  },

  async deleteCampaign(id: string): Promise<void> {
    await httpBrowserClient.delete(ApiEndpoints.campaigns.campaign(id))
  },

  async getDeletedCampaigns(): Promise<Campaign[]> {
    const response = await httpBrowserClient.get(`${ApiEndpoints.campaigns.campaigns()}/deleted/list`)
    return response.data
  },

  async restoreCampaign(id: string): Promise<Campaign> {
    const response = await httpBrowserClient.put(`${ApiEndpoints.campaigns.campaign(id)}/restore`)
    return response.data
  },
}