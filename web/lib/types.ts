export interface WebhookData {
  _id?: string
  deliveryUrl: string
  events: string[]
  isActive: boolean
  signingSecret: string
}

export interface WebhookPayload {
  smsId: string
  sender: string
  message: string
  receivedAt: string
  deviceId: string
  webhookSubscriptionId: string
  webhookEvent: string
}

export interface ConversationSummary {
  phoneNumber: string
  normalizedPhoneNumber: string
  deviceId: string
  contact?: {
    id?: string
    firstName?: string
    lastName?: string
    email?: string
    propertyAddress?: string
    propertyCity?: string
    propertyState?: string
    propertyZip?: string
    parcelCounty?: string
    parcelState?: string
    parcelAcres?: number
    apn?: string
    mailingAddress?: string
    mailingCity?: string
    mailingState?: string
    mailingZip?: string
    dnc?: boolean
    dncUpdatedAt?: Date
  }
  lastMessage: {
    message: string
    timestamp: Date
    isIncoming: boolean
  }
  lastMessageDate: Date
  messageCount: number
  unseenCount: number
  isArchived?: boolean
  isBlocked?: boolean
  isStarred?: boolean
  archivedAt?: Date
  firstCampaignName?: string
}

export interface ConversationsResponse {
  data: ConversationSummary[]
  meta: {
    currentPage: number
    totalPages: number
    totalConversations: number
    hasNextPage: boolean
    hasPrevPage: boolean
    limit: number
  }
}
