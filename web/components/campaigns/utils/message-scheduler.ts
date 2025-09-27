// message-scheduler.ts

// Message scheduling optimization system
// Optimizes message delivery to send messages as quickly as possible within device constraints

import {
  Device,
  DeviceUtilization,
  ScheduledMessage,
  MessageSchedule,
  OptimizedSchedule,
  CampaignSegment,
  getDeviceUtilization,
  getTierForPlan,
  getNextTier,
  canUpgradeTier
} from '../types/device-tiers.types'
import { CreateCampaignData, SendingWindow } from '../types/campaign.types'

export interface MessageToSchedule {
  id: string
  content: string
  recipient: string
  campaignId: string
  campaignName: string
  priority: number
}

export interface ExistingMessage extends MessageToSchedule {
  scheduledTime: Date
  deviceId: string
  locked: boolean  // true if message cannot be rescheduled
}

// Partial device interface for scheduling context
interface PartialDevice {
  _id: string
  enabled: boolean
  current_tier?: number
  messages_sent_today?: number
  messages_sent_this_hour?: number
  hourly_counter_reset?: Date
  daily_counter_reset?: Date
  last_tier_upgrade?: Date
  plan_type?: number
}

export interface SchedulingContext {
  devices: PartialDevice[]
  newMessages: MessageToSchedule[]
  existingMessages: ExistingMessage[]
  sendingWindows: SendingWindow[]
  timezone: string
  campaignStartDate?: string
  campaignEndDate?: string
}

export class MessageScheduler {
  private context: SchedulingContext
  private deviceUtilizations: Map<string, DeviceUtilization>

  constructor(context: SchedulingContext) {
    this.context = context
    this.deviceUtilizations = new Map()

    // Initialize device utilizations
    console.log('🔧 Initializing device utilizations for', this.context.devices.length, 'devices')
    this.context.devices.forEach(device => {
      console.log('🔧 Processing device:', device._id, 'enabled:', device.enabled)

      // Convert to Device type with defaults for missing fields
      const deviceWithDefaults: Device = {
        _id: device._id,
        enabled: device.enabled,
        current_tier: device.current_tier || 1,
        messages_sent_today: device.messages_sent_today || 0,
        messages_sent_this_hour: device.messages_sent_this_hour || 0,
        hourly_counter_reset: device.hourly_counter_reset || new Date(),
        daily_counter_reset: device.daily_counter_reset || new Date(),
        last_tier_upgrade: device.last_tier_upgrade,
        plan_type: device.plan_type || 1
      }

      const utilization = getDeviceUtilization(deviceWithDefaults)
      console.log('🔧 Device utilization:', {
        deviceId: device._id,
        currentTier: utilization.currentTier,
        hourlyCapacity: utilization.hourlyCapacity,
        dailyCapacity: utilization.dailyCapacity
      })

      this.deviceUtilizations.set(device._id, utilization)
    })
  }

  /**
   * Optimize message scheduling to send messages as quickly as possible
   * Decision variables: x_ijt (message i sent from device j at time t)
   */
  optimize(): OptimizedSchedule {
    const schedules = new Map<string, MessageSchedule[]>()  // deviceId -> time slots
    const campaignSegments: CampaignSegment[] = []

    // Initialize device schedules
    this.context.devices.forEach(device => {
      schedules.set(device._id, [])
    })

    // Step 1: Process existing messages that can be rescheduled
    const reschedulableMessages = this.context.existingMessages.filter(msg => !msg.locked)
    const fixedMessages = this.context.existingMessages.filter(msg => msg.locked)

    // Step 2: Combine new messages with reschedulable messages
    const allMessagesToSchedule = [
      ...this.context.newMessages,
      ...reschedulableMessages
    ]

    // Step 3: Sort messages by priority and campaign
    allMessagesToSchedule.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority  // Higher priority first
      return a.campaignId.localeCompare(b.campaignId)  // Group by campaign
    })

    // Step 4: Reserve capacity for fixed messages
    this.reserveCapacityForFixedMessages(fixedMessages, schedules)

    // Step 5: Generate available time slots based on sending windows
    const availableTimeSlots = this.generateTimeSlots()

    // Step 6: Assign messages to devices and time slots
    const assignedMessages = this.assignMessagesToSlots(
      allMessagesToSchedule,
      availableTimeSlots,
      schedules
    )

    // Step 7: Generate campaign segments
    const segments = this.generateCampaignSegments(assignedMessages)

    // Step 8: Convert to final schedule format
    const finalSchedules: MessageSchedule[] = []
    schedules.forEach((deviceSchedules, deviceId) => {
      finalSchedules.push(...deviceSchedules)
    })

    const totalMessages = assignedMessages.length + fixedMessages.length
    const estimatedCompletionTime = this.calculateCompletionTime(finalSchedules)

    return {
      schedules: finalSchedules,
      campaignSegments: segments,
      totalMessages,
      estimatedCompletionTime
    }
  }

  private reserveCapacityForFixedMessages(
    fixedMessages: ExistingMessage[],
    schedules: Map<string, MessageSchedule[]>
  ) {
    fixedMessages.forEach(message => {
      const deviceSchedules = schedules.get(message.deviceId) || []
      const timeSlot = this.findOrCreateTimeSlot(deviceSchedules, message.scheduledTime, true, message.deviceId)

      if (timeSlot) {
        timeSlot.messages.push({
          id: message.id,
          content: message.content,
          recipient: message.recipient,
          campaignId: message.campaignId,
          scheduledTime: message.scheduledTime,
          deviceId: message.deviceId,
          priority: message.priority
        })

        timeSlot.capacity--
        schedules.set(message.deviceId, deviceSchedules)
      }
    })
  }

  private generateTimeSlots(): Date[] {
    const timeSlots: Date[] = []
    const now = new Date()

    // If no specific windows, use campaign start/end dates
    if (this.context.sendingWindows.length === 0) {
      const startDate = this.context.campaignStartDate
        ? new Date(this.context.campaignStartDate + 'T00:00:00')
        : now

      const endDate = this.context.campaignEndDate
        ? new Date(this.context.campaignEndDate + 'T23:59:59')
        : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)  // Default 7 days

      // Generate hourly slots
      const current = new Date(Math.max(startDate.getTime(), now.getTime()))
      while (current <= endDate) {
        timeSlots.push(new Date(current))
        current.setHours(current.getHours() + 1)
      }
    } else {
      // Generate slots based on sending windows
      this.context.sendingWindows.forEach(window => {
        const startTime = new Date(`${window.startDate}T${window.startTime}`)
        const endTime = new Date(`${window.endDate}T${window.endTime}`)

        const current = new Date(Math.max(startTime.getTime(), now.getTime()))
        while (current <= endTime) {
          timeSlots.push(new Date(current))
          current.setHours(current.getHours() + 1)
        }
      })
    }

    return timeSlots.sort((a, b) => a.getTime() - b.getTime())
  }

  private assignMessagesToSlots(
    messages: MessageToSchedule[],
    timeSlots: Date[],
    schedules: Map<string, MessageSchedule[]>
  ): ScheduledMessage[] {
    const assignedMessages: ScheduledMessage[] = []

    for (const message of messages) {
      let assigned = false

      // Try to assign to earliest available slot
      for (const timeSlot of timeSlots) {
        // Find device with available capacity
        const availableDevice = this.findBestDevice(timeSlot, schedules)

        if (availableDevice) {
          const deviceSchedules = schedules.get(availableDevice) || []
          const slot = this.findOrCreateTimeSlot(deviceSchedules, timeSlot, true, availableDevice)

          if (slot && slot.capacity > 0) {
            const scheduledMessage: ScheduledMessage = {
              id: message.id,
              content: message.content,
              recipient: message.recipient,
              campaignId: message.campaignId,
              scheduledTime: timeSlot,
              deviceId: availableDevice,
              priority: message.priority
            }

            slot.messages.push(scheduledMessage)
            slot.capacity--
            assignedMessages.push(scheduledMessage)
            schedules.set(availableDevice, deviceSchedules)
            assigned = true
            break
          }
        }
      }

      if (!assigned) {
        console.warn(`Could not schedule message ${message.id} - no available capacity`)
      }
    }

    return assignedMessages
  }

  private findBestDevice(timeSlot: Date, schedules: Map<string, MessageSchedule[]>): string | null {
    let bestDevice: string | null = null
    let maxCapacity = 0

    for (const [deviceId, utilization] of Array.from(this.deviceUtilizations)) {
      if (!utilization.device.enabled) continue

      const deviceSchedules = schedules.get(deviceId) || []
      const slot = this.findOrCreateTimeSlot(deviceSchedules, timeSlot, false, deviceId)

      const capacity = slot ? slot.capacity : this.calculateSlotCapacity(deviceId, timeSlot)

      if (capacity > maxCapacity) {
        maxCapacity = capacity
        bestDevice = deviceId
      }
    }

    return bestDevice
  }

  private calculateSlotCapacity(deviceId: string, timeSlot: Date): number {
    const utilization = this.deviceUtilizations.get(deviceId)
    if (!utilization) {
      console.warn(`No utilization data for device ${deviceId}`)
      return 0
    }

    // Base capacity on current tier limits
    const hourlyCapacity = utilization.currentTier.hourlyRate
    const dailyCapacity = utilization.currentTier.dailyRate

    // For preview purposes, use a simplified capacity calculation
    // Assume each time slot can handle up to the hourly rate
    return hourlyCapacity
  }

  private findOrCreateTimeSlot(
    deviceSchedules: MessageSchedule[],
    timeSlot: Date,
    create: boolean = true,
    deviceId?: string
  ): MessageSchedule | null {
    const existing = deviceSchedules.find(schedule =>
      schedule.timeSlot.getTime() === timeSlot.getTime()
    )

    if (existing) return existing

    if (!create) return null

    // Need deviceId to calculate capacity properly
    if (!deviceId) {
      console.warn('Cannot create time slot without deviceId')
      return null
    }

    const newSlot: MessageSchedule = {
      deviceId: deviceId,
      timeSlot: new Date(timeSlot),
      messages: [],
      capacity: this.calculateSlotCapacity(deviceId, timeSlot)
    }

    deviceSchedules.push(newSlot)
    return newSlot
  }

  private generateCampaignSegments(assignedMessages: ScheduledMessage[]): CampaignSegment[] {
    const campaignGroups = new Map<string, ScheduledMessage[]>()

    // Group messages by campaign
    assignedMessages.forEach(message => {
      if (!campaignGroups.has(message.campaignId)) {
        campaignGroups.set(message.campaignId, [])
      }
      campaignGroups.get(message.campaignId)!.push(message)
    })

    const segments: CampaignSegment[] = []

    campaignGroups.forEach((messages, campaignId) => {
      if (messages.length === 0) return

      // Sort by scheduled time
      messages.sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime())

      const startTime = messages[0].scheduledTime
      const endTime = messages[messages.length - 1].scheduledTime
      const deviceIds = Array.from(new Set(messages.map(m => m.deviceId)))

      segments.push({
        campaignId,
        campaignName: messages[0].campaignId,  // TODO: Get actual campaign name
        startTime,
        endTime,
        messageCount: messages.length,
        deviceIds
      })
    })

    return segments
  }

  private calculateCompletionTime(schedules: MessageSchedule[]): Date {
    let latestTime = new Date()

    schedules.forEach(schedule => {
      if (schedule.messages.length > 0) {
        const scheduleEnd = new Date(schedule.timeSlot)
        scheduleEnd.setHours(scheduleEnd.getHours() + 1)  // Assume 1 hour to complete slot

        if (scheduleEnd > latestTime) {
          latestTime = scheduleEnd
        }
      }
    })

    return latestTime
  }
}

// Utility functions for scheduling
export function createSchedulingContext(
  devices: PartialDevice[],
  newMessages: MessageToSchedule[],
  existingMessages: ExistingMessage[],
  campaignData: CreateCampaignData
): SchedulingContext {
  return {
    devices,
    newMessages,
    existingMessages,
    sendingWindows: campaignData.sendingWindows,
    timezone: campaignData.timezone,
    campaignStartDate: campaignData.campaignStartDate,
    campaignEndDate: campaignData.campaignEndDate
  }
}

export function optimizeMessageSchedule(context: SchedulingContext): OptimizedSchedule {
  const scheduler = new MessageScheduler(context)
  return scheduler.optimize()
}