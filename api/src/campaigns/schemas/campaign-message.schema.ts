import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { Campaign } from './campaign.schema'

export type CampaignMessageDocument = CampaignMessage & Document

export enum MessageStatus {
  PENDING = 'pending',
  SCHEDULED = 'scheduled',
  QUEUED = 'queued',
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

@Schema({ timestamps: true })
export class CampaignMessage {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User

  @Prop({ type: Types.ObjectId, ref: Campaign.name, required: true })
  campaign: Campaign

  // Message content
  @Prop({ type: String, required: true })
  templateId: string

  @Prop({ type: Number, required: true })
  templateIndex: number // Index of template in rotation (0-based)

  @Prop({ type: String, required: true })
  content: string

  @Prop({ type: String, required: true })
  recipient: string

  @Prop({ type: String, required: true })
  contactId: string

  // Scheduling and delivery
  @Prop({
    type: String,
    enum: Object.values(MessageStatus),
    default: MessageStatus.PENDING
  })
  status: MessageStatus

  @Prop({ type: Date })
  scheduledTime?: Date

  @Prop({ type: String })
  assignedDevice?: string

  @Prop({ type: Number, default: 1 })
  priority: number

  // Delivery tracking
  @Prop({ type: Date })
  sentAt?: Date

  @Prop({ type: String })
  smsId?: string // Reference to SMS document if sent

  @Prop({ type: String })
  batchId?: string // Reference to SMS batch

  // Error handling
  @Prop({ type: String })
  lastError?: string

  @Prop({ type: Number, default: 0 })
  retryCount: number

  @Prop({ type: Number, default: 3 })
  maxRetries: number

  @Prop({ type: Date })
  nextRetryAt?: Date

  createdAt?: Date
  updatedAt?: Date
}

export const CampaignMessageSchema = SchemaFactory.createForClass(CampaignMessage)

// Add indexes for efficient queries
CampaignMessageSchema.index({ user: 1, campaign: 1 })
CampaignMessageSchema.index({ campaign: 1, status: 1 })
CampaignMessageSchema.index({ status: 1, scheduledTime: 1 })
CampaignMessageSchema.index({ assignedDevice: 1, status: 1 })
CampaignMessageSchema.index({ scheduledTime: 1, status: 1 })