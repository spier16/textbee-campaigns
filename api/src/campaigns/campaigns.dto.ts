import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsOptional, IsNotEmpty, IsMongoId, IsArray, IsEnum, IsObject, ValidateNested, IsBoolean, IsNumber } from 'class-validator'
import { Type } from 'class-transformer'
import { CampaignStatus, ScheduleType } from './schemas/campaign.schema'

export class CreateMessageTemplateGroupDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string
}

export class UpdateMessageTemplateGroupDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string
}

export class CreateMessageTemplateDto {
  @ApiProperty()
  @IsMongoId()
  groupId: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content: string
}

export class UpdateMessageTemplateDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  content?: string
}

export class ReorderTemplateGroupsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsMongoId({ each: true })
  templateGroupIds: string[]
}

export class MessageTemplateResponseDto {
  @ApiProperty()
  _id: string

  @ApiProperty()
  userId: string

  @ApiProperty()
  groupId: string

  @ApiProperty()
  name: string

  @ApiProperty()
  content: string

  @ApiProperty()
  createdAt: Date

  @ApiProperty()
  updatedAt: Date
}

export class MessageTemplateGroupResponseDto {
  @ApiProperty()
  _id: string

  @ApiProperty()
  userId: string

  @ApiProperty()
  name: string

  @ApiProperty({ required: false })
  description?: string

  @ApiProperty()
  order: number

  @ApiProperty()
  createdAt: Date

  @ApiProperty()
  updatedAt: Date

  @ApiProperty({ type: [MessageTemplateResponseDto] })
  templates: MessageTemplateResponseDto[]
}

// Campaign DTOs
export class SendingWindowDto {
  @ApiProperty()
  @IsString()
  startDate: string

  @ApiProperty()
  @IsString()
  startTime: string

  @ApiProperty()
  @IsString()
  endDate: string

  @ApiProperty()
  @IsString()
  endTime: string
}

export class CreateCampaignDto {
  @ApiProperty({ description: 'Campaign name' })
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty({ description: 'Campaign description', required: false })
  @IsOptional()
  @IsString()
  description?: string

  @ApiProperty({ description: 'Contact spreadsheet IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  selectedContacts: string[]

  @ApiProperty({ description: 'Template IDs (will be rotated through)', type: [String] })
  @IsArray()
  @IsString({ each: true })
  selectedTemplates: string[]

  @ApiProperty({ description: 'Device IDs to send from', type: [String] })
  @IsArray()
  @IsString({ each: true })
  sendDevices: string[]

  @ApiProperty({ enum: ScheduleType, description: 'Schedule type' })
  @IsEnum(ScheduleType)
  scheduleType: ScheduleType

  @ApiProperty({ description: 'Campaign start date (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  campaignStartDate: string

  @ApiProperty({ description: 'Campaign end date (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  campaignEndDate: string

  @ApiProperty({ description: 'Campaign timezone' })
  @IsString()
  @IsNotEmpty()
  timezone: string

  @ApiProperty({ type: [SendingWindowDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SendingWindowDto)
  sendingWindows?: SendingWindowDto[]

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  weekdayWindows?: any

  @ApiProperty({ description: 'Exclude DNC contacts', required: false, default: true })
  @IsOptional()
  @IsBoolean()
  excludeDnc?: boolean

  @ApiProperty({ description: 'Include previously messaged contacts', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  includePreviouslyMessaged?: boolean
}

export class UpdateCampaignStatusDto {
  @ApiProperty({ enum: CampaignStatus })
  @IsEnum(CampaignStatus)
  status: CampaignStatus
}

export class CampaignResponseDto {
  @ApiProperty()
  _id: string

  @ApiProperty()
  name: string

  @ApiProperty({ required: false })
  description?: string

  @ApiProperty({ enum: CampaignStatus })
  status: CampaignStatus

  @ApiProperty()
  totalMessages: number

  @ApiProperty()
  sentMessages: number

  @ApiProperty()
  failedMessages: number

  @ApiProperty()
  pendingMessages: number

  @ApiProperty({ required: false })
  startedAt?: Date

  @ApiProperty({ required: false })
  completedAt?: Date

  @ApiProperty({ required: false })
  lastMessageSentAt?: Date

  @ApiProperty()
  createdAt: Date

  @ApiProperty()
  updatedAt: Date

  @ApiProperty()
  selectedContacts: string[]

  @ApiProperty()
  selectedTemplates: string[]

  @ApiProperty()
  sendDevices: string[]

  @ApiProperty()
  scheduleType: ScheduleType

  @ApiProperty()
  campaignStartDate: string

  @ApiProperty()
  campaignEndDate: string

  @ApiProperty()
  timezone: string

  @ApiProperty({ required: false })
  isDeleted?: boolean

  @ApiProperty({ required: false })
  deletedAt?: Date

  @ApiProperty({ required: false, enum: CampaignStatus })
  statusBeforeDelete?: CampaignStatus

  @ApiProperty({ required: false })
  excludeDnc?: boolean

  @ApiProperty({ required: false })
  includePreviouslyMessaged?: boolean
}

// Template Preview Processing DTOs
export class ProcessTemplatePreviewDto {
  @ApiProperty({ description: 'Template IDs to process', type: [String] })
  @IsArray()
  @IsString({ each: true })
  templateIds: string[]

  @ApiProperty({ description: 'Contact spreadsheet IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  contactSpreadsheetIds: string[]

  @ApiProperty({ description: 'Exclude DNC contacts', required: false, default: true })
  @IsOptional()
  @IsBoolean()
  excludeDnc?: boolean

  @ApiProperty({ description: 'Include previously messaged contacts', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  includePreviouslyMessaged?: boolean

  @ApiProperty({ description: 'Maximum number of previews to return', required: false, default: 100 })
  @IsOptional()
  @IsNumber()
  maxPreviewCount?: number

  @ApiProperty({ description: 'Enable variable highlighting in processed content', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  highlightVariables?: boolean
}

export class ContactDataDto {
  @ApiProperty({ required: false })
  id?: string

  @ApiProperty({ required: false })
  firstName?: string

  @ApiProperty({ required: false })
  lastName?: string

  @ApiProperty()
  phone: string

  @ApiProperty({ required: false })
  email?: string

  @ApiProperty({ required: false })
  propertyAddress?: string

  @ApiProperty({ required: false })
  propertyCity?: string

  @ApiProperty({ required: false })
  propertyState?: string

  @ApiProperty({ required: false })
  propertyZip?: string

  @ApiProperty({ required: false })
  mailingAddress?: string

  @ApiProperty({ required: false })
  mailingCity?: string

  @ApiProperty({ required: false })
  mailingState?: string

  @ApiProperty({ required: false })
  mailingZip?: string
}

export class TemplateDataDto {
  @ApiProperty()
  _id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  content: string
}

export class ValidationErrorDto {
  @ApiProperty()
  variableName: string

  @ApiProperty({ enum: ['missing_field', 'empty_value', 'unsupported_variable'] })
  errorType: 'missing_field' | 'empty_value' | 'unsupported_variable'

  @ApiProperty()
  message: string
}

export class HighlightedSegmentDto {
  @ApiProperty()
  text: string

  @ApiProperty()
  isVariable: boolean

  @ApiProperty({ required: false })
  variableName?: string

  @ApiProperty({ required: false })
  variableType?: string
}

export class HighlightedContentDto {
  @ApiProperty({ type: [HighlightedSegmentDto] })
  segments: HighlightedSegmentDto[]

  @ApiProperty()
  plainText: string

  @ApiProperty({ type: [ValidationErrorDto], required: false })
  validationErrors?: ValidationErrorDto[]
}

export class TemplatePreviewDto {
  @ApiProperty({ type: ContactDataDto })
  contact: ContactDataDto

  @ApiProperty({ type: TemplateDataDto })
  template: TemplateDataDto

  @ApiProperty()
  templateIndex: number

  @ApiProperty()
  processedContent: string

  @ApiProperty({ type: HighlightedContentDto, required: false })
  highlightedContent?: HighlightedContentDto
}

export class ProcessedTemplateResponseDto {
  @ApiProperty({ type: [TemplatePreviewDto] })
  previews: TemplatePreviewDto[]

  @ApiProperty()
  totalContacts: number

  @ApiProperty()
  templatesUsed: number
}

export class SidebarCampaignDto {
  @ApiProperty()
  _id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  sentMessages: number

  @ApiProperty()
  createdAt: Date
}

export class SidebarCampaignsResponseDto {
  @ApiProperty({ type: [SidebarCampaignDto] })
  campaigns: SidebarCampaignDto[]

  @ApiProperty()
  totalCount: number

  @ApiProperty()
  page: number

  @ApiProperty()
  limit: number

  @ApiProperty()
  hasMore: boolean
}