import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsOptional, IsNotEmpty, IsMongoId, IsArray, IsEnum, IsObject, ValidateNested, IsBoolean } from 'class-validator'
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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  scheduledDate?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  scheduledTime?: string

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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  weekdayEnabled?: any

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