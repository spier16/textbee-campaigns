// Device utilization tiers and rate limiting types

export interface DeviceTier {
  tier: number
  hourlyRate: number
  dailyRate: number
}

export interface DevicePlanType {
  id: number
  name: string
  tiers: DeviceTier[]
}

// Device plan type 1: Initial rollout tiers
export const DEVICE_PLAN_TYPE_1: DevicePlanType = {
  id: 1,
  name: 'Standard',
  tiers: [
    { tier: 1, hourlyRate: 30, dailyRate: 30 },
    { tier: 2, hourlyRate: 45, dailyRate: 60 },
    { tier: 3, hourlyRate: 60, dailyRate: 90 },
    { tier: 4, hourlyRate: 60, dailyRate: 150 }
  ]
}

export const DEVICE_PLAN_TYPES: DevicePlanType[] = [
  DEVICE_PLAN_TYPE_1
]

export interface Device {
  _id: string
  enabled: boolean
  current_tier: number
  messages_sent_today: number
  messages_sent_this_hour: number
  hourly_counter_reset: Date
  daily_counter_reset: Date
  last_tier_upgrade?: Date
  plan_type: number
}

export interface DeviceUtilization {
  device: Device
  currentTier: DeviceTier
  hourlyCapacity: number
  dailyCapacity: number
  canUpgradeTier: boolean
}

// Message scheduling types
export interface ScheduledMessage {
  id: string
  content: string
  recipient: string
  campaignId: string
  scheduledTime: Date
  deviceId: string
  priority: number
}

export interface MessageSchedule {
  deviceId: string
  timeSlot: Date
  messages: ScheduledMessage[]
  capacity: number
}

export interface OptimizedSchedule {
  schedules: MessageSchedule[]
  campaignSegments: CampaignSegment[]
  totalMessages: number
  estimatedCompletionTime: Date
}

export interface CampaignSegment {
  campaignId: string
  campaignName: string
  startTime: Date
  endTime: Date
  messageCount: number
  deviceIds: string[]
}

// Utility functions for tier management
export function getTierForPlan(planType: number, tierNumber: number): DeviceTier | null {
  const plan = DEVICE_PLAN_TYPES.find(p => p.id === planType)
  if (!plan) return null

  return plan.tiers.find(t => t.tier === tierNumber) || null
}

export function getNextTier(planType: number, currentTier: number): DeviceTier | null {
  const plan = DEVICE_PLAN_TYPES.find(p => p.id === planType)
  if (!plan) return null

  return plan.tiers.find(t => t.tier === currentTier + 1) || null
}

export function canUpgradeTier(device: Device): boolean {
  const currentTier = getTierForPlan(device.plan_type || 1, device.current_tier)
  const nextTier = getNextTier(device.plan_type || 1, device.current_tier)

  if (!currentTier || !nextTier) return false

  // Can upgrade if daily limit was exceeded
  return device.messages_sent_today >= currentTier.dailyRate
}

export function getDeviceUtilization(device: Device): DeviceUtilization {
  const currentTier = getTierForPlan(device.plan_type || 1, device.current_tier)
  if (!currentTier) {
    throw new Error(`Invalid tier configuration for device ${device._id}`)
  }

  const now = new Date()
  const hourlyReset = new Date(device.hourly_counter_reset)
  const dailyReset = new Date(device.daily_counter_reset)

  // Reset counters if needed
  const hourlyCapacity = Math.max(0, currentTier.hourlyRate - (now > hourlyReset ? 0 : device.messages_sent_this_hour))
  const dailyCapacity = Math.max(0, currentTier.dailyRate - (now > dailyReset ? 0 : device.messages_sent_today))

  return {
    device,
    currentTier,
    hourlyCapacity,
    dailyCapacity,
    canUpgradeTier: canUpgradeTier(device)
  }
}