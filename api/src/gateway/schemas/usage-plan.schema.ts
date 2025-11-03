import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type UsagePlanDocument = UsagePlan & Document

export interface UsagePlanTier {
  tier: number
  min_wait_seconds: number // Minimum wait time between messages in seconds (with right-skewed randomization)
  messages_per_cycle: number // Maximum messages allowed in the rolling window
}

@Schema({ timestamps: true })
export class UsagePlan {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User

  @Prop({ type: String, required: true })
  name: string

  @Prop({ type: String })
  description?: string

  @Prop({ type: Number, default: 1440 })
  usageWindowMinutes: number // Rolling window period in minutes (default: 1440 = 24 hours)

  @Prop({ type: Number, default: 24 })
  tierPromotionCooldownHours: number // Cooldown period after tier promotion (default: 24 hours)

  @Prop({
    type: [
      {
        tier: { type: Number, required: true },
        min_wait_seconds: { type: Number, required: true },
        messages_per_cycle: { type: Number, required: true },
      },
    ],
    required: true,
  })
  tiers: UsagePlanTier[]

  @Prop({ type: Boolean, default: false })
  isDefault: boolean

  @Prop({ type: Boolean, default: true })
  isActive: boolean

  @Prop({ type: Boolean, default: false })
  isTemplate?: boolean

  createdAt?: Date
  updatedAt?: Date
}

export const UsagePlanSchema = SchemaFactory.createForClass(UsagePlan)

// Ensure tiers are sorted by tier number
UsagePlanSchema.pre('save', function () {
  if (this.tiers) {
    this.tiers.sort((a, b) => a.tier - b.tier)

    // Validate tier numbers are sequential starting from 1
    this.tiers.forEach((tier, index) => {
      if (tier.tier !== index + 1) {
        throw new Error(
          `Tiers must be sequential starting from 1. Found tier ${tier.tier} at position ${index + 1}`,
        )
      }
    })
  }
})
