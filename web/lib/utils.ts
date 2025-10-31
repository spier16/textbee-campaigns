import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { parsePhoneNumberFromString } from 'libphonenumber-js'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a phone number for display with automatic country detection and fallbacks
 * @param phoneNumber - The phone number to format (can be null/undefined)
 * @returns Formatted phone number string or fallback message
 * @example
 * formatPhoneNumberDisplay('+12345678901') // Returns: "+1 234 567-8901"
 * formatPhoneNumberDisplay('2345678901') // Returns: "+1 234 567-8901" (assumes US)
 * formatPhoneNumberDisplay(null) // Returns: "Not detected"
 */
export function formatPhoneNumberDisplay(phoneNumber: string | null | undefined): string {
  if (!phoneNumber) return 'Not detected'

  try {
    // Try to parse with automatic country detection
    const parsed = parsePhoneNumberFromString(phoneNumber)
    if (parsed && parsed.isValid()) {
      // Use INTERNATIONAL format: "+1 234 567-8901"
      return parsed.formatInternational()
    }

    // Fallback: Try parsing as US number
    const usNumber = parsePhoneNumberFromString(phoneNumber, 'US')
    if (usNumber && usNumber.isValid()) {
      return usNumber.formatInternational()
    }

    // Return original if parsing fails
    return phoneNumber
  } catch (error) {
    // Gracefully handle errors - return original number
    return phoneNumber
  }
}

export function normalizePhoneNumber(phoneNumber: string): string {
  if (!phoneNumber) return phoneNumber

  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, '')

  // If it's a US number (10 digits) or US number with country code (11 digits starting with 1)
  if (cleaned.length === 10) {
    // Assume US number, prepend +1
    return `+1${cleaned}`
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    // US number with country code, add +
    return `+${cleaned}`
  }

  // For other formats, if it doesn't start with +, prepend it
  if (cleaned.length > 0 && !phoneNumber.startsWith('+')) {
    return `+${cleaned}`
  }

  // Return cleaned version or original if already normalized
  return cleaned ? `+${cleaned}` : phoneNumber
}

export function formatMessageTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

export function formatDateSeparator(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (messageDate.getTime() === today.getTime()) {
    return 'Today'
  } else if (messageDate.getTime() === today.getTime() - 24 * 60 * 60 * 1000) {
    return 'Yesterday'
  } else {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }
}

export function isSameDay(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate()
}

export interface MessageWithDate {
  id: string
  message: string
  date: Date
  isIncoming: boolean
  status?: MessageStatus
  deviceId?: string
  senderPhoneNumber?: string
  [key: string]: any
}

export interface MessageGroup {
  type: 'date' | 'message' | 'metadata-change'
  date?: Date
  dateLabel?: string
  message?: MessageWithDate
  changeInfo?: {
    deviceId: string
    phoneNumber: string
  }
}

export function groupMessagesWithDateSeparators(messages: MessageWithDate[]): MessageGroup[] {
  if (!messages || messages.length === 0) return []

  const groups: MessageGroup[] = []
  let lastDate: Date | null = null

  for (const message of messages) {
    const messageDate = message.date

    // Add date separator if this is the first message or if the date has changed
    if (!lastDate || !isSameDay(lastDate, messageDate)) {
      groups.push({
        type: 'date',
        date: messageDate,
        dateLabel: formatDateSeparator(messageDate)
      })
      lastDate = messageDate
    }

    // Add the message
    groups.push({
      type: 'message',
      message
    })
  }

  return groups
}

export function groupMessagesWithMetadataChanges(messages: MessageWithDate[]): MessageGroup[] {
  if (!messages || messages.length === 0) return []

  // Normalize empty values to null for consistent comparison
  // Also handle the string "undefined" which sometimes comes from the backend
  const normalizeValue = (val: string | undefined) => {
    if (!val || val.trim() === '' || val === 'undefined') {
      return null
    }
    return val
  }

  const groups: MessageGroup[] = []
  let lastDate: Date | null = null
  let lastDeviceId: string | null = null
  let lastPhoneNumber: string | null = null

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    const messageDate = message.date

    // Add date separator if this is the first message or if the date has changed
    if (!lastDate || !isSameDay(lastDate, messageDate)) {
      groups.push({
        type: 'date',
        date: messageDate,
        dateLabel: formatDateSeparator(messageDate)
      })
      lastDate = messageDate
    }

    // Normalize current message values
    const currentDeviceId = normalizeValue(message.deviceId)
    const currentPhoneNumber = normalizeValue(message.senderPhoneNumber)

    // Check if device ID or phone number changed from previous message
    // For the first message, show bubble if device/phone info exists
    // For subsequent messages, show bubble only if changed
    const isFirstMessage = i === 0
    const deviceChanged = lastDeviceId !== currentDeviceId
    const phoneChanged = lastPhoneNumber !== currentPhoneNumber

    if ((isFirstMessage || deviceChanged || phoneChanged) && (currentDeviceId || currentPhoneNumber)) {
      groups.push({
        type: 'metadata-change',
        changeInfo: {
          deviceId: currentDeviceId || '',
          phoneNumber: currentPhoneNumber || ''
        }
      })
    }

    // Add the message
    groups.push({
      type: 'message',
      message
    })

    // Update tracking variables with normalized values
    lastDeviceId = currentDeviceId
    lastPhoneNumber = currentPhoneNumber
  }

  return groups
}

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'unknown' | 'received'

export function getStatusDisplay(status: MessageStatus): { label: string; icon?: string } {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending',
        icon: '○'
      }
    case 'sent':
      return {
        label: 'Sent',
        icon: '✓'
      }
    case 'delivered':
      return {
        label: 'Delivered',
        icon: '✓✓'
      }
    case 'failed':
      return {
        label: 'Failed',
        icon: '✗'
      }
    case 'unknown':
      return {
        label: 'Unknown',
        icon: '?'
      }
    case 'received':
      return {
        label: 'Received',
        icon: ''
      }
    default:
      return {
        label: 'Unknown',
        icon: '?'
      }
  }
}
