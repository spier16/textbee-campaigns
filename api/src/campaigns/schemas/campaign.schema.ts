import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type CampaignDocument = Campaign & Document

export enum CampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum ScheduleType {
  NOW = 'now',
  LATER = 'later',
  WINDOWS = 'windows',
  WEEKDAY = 'weekday',
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

@Schema({ timestamps: true })
export class Campaign {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User

  @Prop({ type: String, required: true })
  name: string

  @Prop({ type: String })
  description?: string

  @Prop({
    type: String,
    enum: Object.values(CampaignStatus),
    default: CampaignStatus.DRAFT,
  })
  status: CampaignStatus

  // Contact and template references
  @Prop({ type: [String], required: true })
  selectedContacts: string[] // Contact spreadsheet IDs

  @Prop({ type: [String], required: true })
  selectedTemplates: string[] // Template IDs

  @Prop({ type: [String], required: true })
  sendDevices: string[] // Device IDs

  // Scheduling configuration
  @Prop({
    type: String,
    enum: Object.values(ScheduleType),
    required: true,
  })
  scheduleType: ScheduleType

  @Prop({ type: String, required: true })
  campaignStartDate: string

  @Prop({ type: String, required: true })
  campaignEndDate: string

  @Prop({ type: String, required: true })
  timezone: string

  @Prop({ type: Array, default: [] })
  sendingWindows: SendingWindow[]

  @Prop({ type: Object })
  weekdayWindows?: WeekdayWindows

  // Contact filtering preferences
  @Prop({ type: Boolean, default: true })
  excludeDnc: boolean

  @Prop({ type: Boolean, default: false })
  includePreviouslyMessaged: boolean

  // Campaign execution tracking
  @Prop({ type: Number, default: 0 })
  totalMessages: number

  @Prop({ type: Number, default: 0 })
  sentMessages: number

  @Prop({ type: Number, default: 0 })
  failedMessages: number

  @Prop({ type: Number, default: 0 })
  pendingMessages: number

  @Prop({ type: Date })
  startedAt?: Date

  @Prop({ type: Date })
  completedAt?: Date

  @Prop({ type: Date })
  lastMessageSentAt?: Date

  // Error tracking
  @Prop({ type: String })
  lastError?: string

  @Prop({ type: Number, default: 0 })
  retryCount: number

  @Prop({ type: Number, default: 3 })
  maxRetries: number

  // Soft delete fields
  @Prop({ type: Boolean, default: false })
  isDeleted: boolean

  @Prop({ type: Date })
  deletedAt?: Date

  @Prop({ type: String })
  statusBeforeDelete?: CampaignStatus

  createdAt?: Date
  updatedAt?: Date
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign)

// Add indexes for efficient queries
CampaignSchema.index({ user: 1, status: 1 })
CampaignSchema.index({ user: 1, createdAt: -1 })
CampaignSchema.index({ status: 1, campaignStartDate: 1 })
CampaignSchema.index({ user: 1, isDeleted: 1 })
