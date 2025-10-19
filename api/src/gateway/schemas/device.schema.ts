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

  // @deprecated Legacy field - replaced by usage plan system's timeDelayBetweenMessages
  // TODO: Remove this field in future migration after all devices use usage plans
  @Prop({ type: Number, default: 60 })
  max_hourly_send_rate: number

  // @deprecated Legacy field - replaced by usage plan system's dailyLimit per tier
  // TODO: Remove this field in future migration after all devices use usage plans
  @Prop({ type: Number, default: 50 })
  daily_send_limit: number

  @Prop({ type: Number, default: 1 })
  current_tier: number

  @Prop({ type: Date })
  last_tier_upgrade: Date

  @Prop({ type: MongooseSchema.Types.Mixed })
  usagePlan?: Types.ObjectId | string

  @Prop({ type: Boolean, default: false })
  is_on_cooldown?: boolean

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
