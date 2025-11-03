import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types, Schema as MongooseSchema } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { UsagePlan } from './usage-plan.schema'

export type DeviceDocument = Device & Document

@Schema({ timestamps: true })
export class Device {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name })
  user: User

  @Prop({ type: Boolean, default: false })
  enabled: boolean

  @Prop({ type: String })
  fcmToken: string

  @Prop({ type: String })
  brand: string

  @Prop({ type: String })
  manufacturer: string

  @Prop({ type: String })
  model: string

  @Prop({ type: String })
  serial: string

  @Prop({ type: String })
  buildId: string

  @Prop({ type: String })
  os: string

  @Prop({ type: String })
  osVersion: string

  @Prop({ type: String })
  appVersionName: string

  @Prop({ type: Number })
  appVersionCode: number

  @Prop({ type: Number, default: 0 })
  sentSMSCount: number

  @Prop({ type: Number, default: 0 })
  receivedSMSCount: number

  @Prop({ type: Number, default: 1 })
  current_tier: number

  @Prop({ type: Number })
  best_min_wait_seconds?: number // Lowest minimum wait time ever achieved (historical tracking)

  @Prop({ type: Number })
  max_messages_per_cycle?: number

  @Prop({ type: Date })
  last_tier_upgrade: Date

  @Prop({ type: MongooseSchema.Types.Mixed })
  usagePlan?: Types.ObjectId | string

  @Prop({ type: Boolean, default: false })
  is_on_cooldown?: boolean

  @Prop({ type: Date })
  cooldown_end_time?: Date

  @Prop({ type: String, enum: ['tier_promotion', 'max_tier_limit'] })
  cooldown_reason?: 'tier_promotion' | 'max_tier_limit'

  @Prop({ type: Number })
  pending_tier_upgrade?: number

  @Prop({ type: Date })
  lastMessageSentAt?: Date

  @Prop({ type: String })
  phoneNumber: string

  @Prop({ type: String })
  phoneNumber2: string

  @Prop({ type: Date })
  phoneNumberLastUpdated: Date

  @Prop({ type: String })
  previousPhoneNumber: string
}

export const DeviceSchema = SchemaFactory.createForClass(Device)
