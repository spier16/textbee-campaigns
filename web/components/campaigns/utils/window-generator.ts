/**
 * Window Generator Utility
 *
 * Converts different campaign schedule types into unified sendingWindows format.
 * All times are converted to UTC for consistent backend storage.
 */

import { CreateCampaignData, SendingWindow } from '../types/campaign.types'
import { zonedTimeToUtc, format } from 'date-fns-tz'

/**
 * Convert local time to UTC ISO string
 *
 * Takes a date/time in a specific timezone and converts it to UTC.
 * Example: "2025-01-15" "09:00" "America/Chicago" -> "2025-01-15 15:00" (UTC)
 *
 * @param dateStr - Date in YYYY-MM-DD format
 * @param timeStr - Time in HH:mm format (24-hour)
 * @param timezone - IANA timezone identifier (e.g., "America/Chicago")
 * @returns UTC datetime string in "YYYY-MM-DD HH:mm" format
 */
function convertToUTC(dateStr: string, timeStr: string, timezone: string): string {
  try {
    // Construct a datetime string in the local timezone
    const localDateTimeStr = `${dateStr}T${timeStr}:00`

    // Parse as a date in the specified timezone and convert to UTC
    // This properly handles DST transitions
    const utcDate = zonedTimeToUtc(localDateTimeStr, timezone)

    // Format as "YYYY-MM-DD HH:mm" for database storage
    return format(utcDate, 'yyyy-MM-dd HH:mm', { timeZone: 'UTC' })
  } catch (error) {
    console.error(`Error converting time to UTC: ${dateStr} ${timeStr} ${timezone}`, error)
    // Fallback: return original time (will be incorrect but prevents crash)
    return `${dateStr} ${timeStr}`
  }
}

/**
 * Format UTC datetime for database storage (YYYY-MM-DD and HH:mm format)
 */
function formatUTCDateTime(isoString: string): { date: string; time: string } {
  const [datePart, timePart] = isoString.split(' ')
  const [hour, minute] = timePart.split(':')

  return {
    date: datePart,
    time: `${hour}:${minute}`
  }
}

/**
 * Generate windows for "Start sending now" mode
 * Creates a single window covering the entire campaign duration
 */
export function generateWindowsForNow(
  campaignStartDate: string,
  campaignEndDate: string,
  timezone: string
): SendingWindow[] {
  const startUTC = convertToUTC(campaignStartDate, '00:00', timezone)
  const endUTC = convertToUTC(campaignEndDate, '23:59', timezone)

  const start = formatUTCDateTime(startUTC)
  const end = formatUTCDateTime(endUTC)

  return [
    {
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time
    }
  ]
}

/**
 * Generate windows for "Schedule start for later" mode
 * Creates a single window from the scheduled start time to campaign end
 */
export function generateWindowsForLater(
  scheduledDate: string,
  scheduledTime: string,
  campaignEndDate: string,
  timezone: string
): SendingWindow[] {
  const startUTC = convertToUTC(scheduledDate, scheduledTime, timezone)
  const endUTC = convertToUTC(campaignEndDate, '23:59', timezone)

  const start = formatUTCDateTime(startUTC)
  const end = formatUTCDateTime(endUTC)

  return [
    {
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time
    }
  ]
}

/**
 * Generate windows for "Define by weekday" mode
 * Expands weekday patterns into explicit date-specific windows
 */
export function generateWindowsForWeekday(
  campaignData: CreateCampaignData
): SendingWindow[] {
  const windows: SendingWindow[] = []

  if (!campaignData.campaignStartDate || !campaignData.campaignEndDate) {
    return windows
  }

  const startDate = new Date(campaignData.campaignStartDate + 'T00:00:00')
  const endDate = new Date(campaignData.campaignEndDate + 'T23:59:59')
  const timezone = campaignData.timezone

  // Iterate through each day in the campaign range
  const currentDate = new Date(startDate)
  while (currentDate <= endDate) {
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      currentDate.getDay()
    ] as keyof typeof campaignData.weekdayWindows

    const dayWindows = campaignData.weekdayWindows[dayName]
    const isDayEnabled = campaignData.weekdayEnabled?.[dayName]

    // Only process if day is enabled and has windows defined
    if (isDayEnabled && Array.isArray(dayWindows) && dayWindows.length > 0) {
      const year = currentDate.getFullYear()
      const month = String(currentDate.getMonth() + 1).padStart(2, '0')
      const day = String(currentDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`

      // Create a window for each time range on this day
      dayWindows.forEach(window => {
        if (window.startTime && window.endTime) {
          // Validate that end time is after start time
          const startTimeMinutes = window.startTime.split(':').reduce((acc, time) => (60 * acc) + +time, 0)
          const endTimeMinutes = window.endTime.split(':').reduce((acc, time) => (60 * acc) + +time, 0)

          if (endTimeMinutes > startTimeMinutes) {
            // Convert to UTC
            const startUTC = convertToUTC(dateStr, window.startTime, timezone)
            const endUTC = convertToUTC(dateStr, window.endTime, timezone)

            const start = formatUTCDateTime(startUTC)
            const end = formatUTCDateTime(endUTC)

            windows.push({
              startDate: start.date,
              startTime: start.time,
              endDate: end.date,
              endTime: end.time
            })
          }
        }
      })
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1)
  }

  return windows
}

/**
 * Convert "Define by slot" windows to UTC
 * The windows are already in the correct format, just need timezone conversion
 */
export function convertWindowsToUTC(
  windows: SendingWindow[],
  timezone: string
): SendingWindow[] {
  return windows.map(window => {
    const startUTC = convertToUTC(window.startDate, window.startTime, timezone)
    const endUTC = convertToUTC(window.endDate, window.endTime, timezone)

    const start = formatUTCDateTime(startUTC)
    const end = formatUTCDateTime(endUTC)

    return {
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time
    }
  })
}

/**
 * Main function to generate sendingWindows based on campaign schedule type
 */
export function generateSendingWindows(campaignData: CreateCampaignData): SendingWindow[] {
  const { scheduleType, timezone } = campaignData

  switch (scheduleType) {
    case 'now':
      return generateWindowsForNow(
        campaignData.campaignStartDate,
        campaignData.campaignEndDate,
        timezone
      )

    case 'later':
      if (!campaignData.scheduledDate || !campaignData.scheduledTime) {
        console.warn('Schedule type is "later" but scheduledDate/scheduledTime are missing')
        return []
      }
      return generateWindowsForLater(
        campaignData.scheduledDate,
        campaignData.scheduledTime,
        campaignData.campaignEndDate,
        timezone
      )

    case 'weekday':
      return generateWindowsForWeekday(campaignData)

    case 'windows':
      if (!campaignData.sendingWindows || campaignData.sendingWindows.length === 0) {
        console.warn('Schedule type is "windows" but no sendingWindows defined')
        return []
      }
      return convertWindowsToUTC(campaignData.sendingWindows, timezone)

    default:
      console.error(`Unknown schedule type: ${scheduleType}`)
      return []
  }
}
