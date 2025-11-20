import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type ConversationDocument = Conversation & Document

/**
 * Materialized conversation view for efficient Inbox queries
 *
 * This collection denormalizes conversation data from the SMS collection
 * to enable fast filtering, sorting, and pagination without aggregation.
 *
 * Sync Strategy:
 * - Created/updated on every new message (incoming or outgoing)
 * - Updated when user marks as read/unread
 * - Updated when user archives/blocks/stars conversation
 */
@Schema({ timestamps: true })
export class Conversation {
  _id?: Types.ObjectId

  // ========== Ownership ==========
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Device', required: true })
  device: Types.ObjectId

  // ========== Phone Number Identifiers ==========
  @Prop({ type: String, required: true })
  phoneNumber: string // Original phone number (as first seen)

  @Prop({ type: String, required: true, index: true })
  normalizedPhoneNumber: string // Normalized for deduplication (E.164 format)

  // ========== Last Message Data (Denormalized from SMS) ==========
  @Prop({ type: Types.ObjectId, ref: 'SMS' })
  lastMessageId: Types.ObjectId // Reference to most recent SMS document

  @Prop({ type: String })
  lastMessage: string // Text content of last message

  @Prop({ type: Date, required: true, index: true })
  lastMessageAt: Date // Timestamp for sorting (receivedAt or requestedAt)

  @Prop({ type: String, enum: ['user', 'contact'], required: true })
  lastSender: 'user' | 'contact' // Who sent last message

  // ========== Conversation Statistics ==========
  @Prop({ type: Number, default: 0 })
  messageCount: number // Total messages in conversation (incoming + outgoing)

  @Prop({ type: Number, default: 0, index: true })
  unseenCount: number // Unread incoming messages

  // ========== Filter Flags ==========
  @Prop({ type: Boolean, default: false, index: true })
  hasReceivedMessage: boolean // Ever received a reply (for "engaged"/"two-way" filter)

  // ========== Campaign Tracking ==========
  @Prop({ type: String })
  firstCampaignId: string // First campaign that contacted this number

  @Prop({ type: String })
  firstCampaignName: string // Cached campaign name (for campaign filtering)

  // ========== Metadata (Consolidated from ConversationMetadata) ==========
  @Prop({ type: Boolean, default: false, index: true })
  isArchived: boolean

  @Prop({ type: Boolean, default: false, index: true })
  isBlocked: boolean

  @Prop({ type: Boolean, default: false, index: true })
  isStarred: boolean

  @Prop({ type: Date })
  archivedAt?: Date

  @Prop({ type: Date })
  blockedAt?: Date

  @Prop({ type: Date })
  starredAt?: Date

  // ========== Additional Metadata ==========
  @Prop({ type: String })
  preferredDeviceId?: string // User's preferred device for sending to this contact

  // ========== Timestamps ==========
  // createdAt and updatedAt are auto-managed by Mongoose timestamps: true
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation)

// ========== Indexes ==========

// Unique constraint: One conversation per user per phone number
ConversationSchema.index(
  { user: 1, normalizedPhoneNumber: 1 },
  { unique: true },
)

// Main inbox query (newest sort, exclude archived/blocked)
ConversationSchema.index({
  user: 1,
  isArchived: 1,
  isBlocked: 1,
  lastMessageAt: -1,
})

// Unread filter
ConversationSchema.index({
  user: 1,
  unseenCount: 1,
  isArchived: 1,
  isBlocked: 1,
  lastMessageAt: -1,
})

// Unreplied/Awaiting Reply filter (by lastSender)
ConversationSchema.index({
  user: 1,
  lastSender: 1,
  isArchived: 1,
  isBlocked: 1,
  lastMessageAt: -1,
})

// Engaged/Two-Way filter
ConversationSchema.index({
  user: 1,
  hasReceivedMessage: 1,
  isArchived: 1,
  isBlocked: 1,
  lastMessageAt: -1,
})

// Starred filter
ConversationSchema.index({
  user: 1,
  isStarred: 1,
  isArchived: 1,
  isBlocked: 1,
  lastMessageAt: -1,
})

// Campaign filter
ConversationSchema.index({
  user: 1,
  firstCampaignId: 1,
  lastMessageAt: -1,
})
