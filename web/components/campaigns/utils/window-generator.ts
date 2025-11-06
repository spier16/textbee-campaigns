/**
 * Window Generator Utility
 *
 * Converts different campaign schedule types into unified sendingWindows format.
 * All times are stored in LOCAL timezone. The backend handles conversion to UTC at runtime.
 */

import { CreateCampaignData, SendingWindow } from '../types/campaign.types'

/**
 * Generate windows for "Start sending now" mode
 * Creates a single window covering the entire campaign duration (in local timezone)
 */
export function generateWindowsForNow(
  campaignStartDate: string,
  campaignEndDate: string,
  timezone: string
): SendingWindow[] {
  console.log(`[TIMEZONE DEBUG] NOW mode: ${campaignStartDate} 00:00 to ${campaignEndDate} 23:59 (${timezone} - stored as local time)`)

  return [
    {
      startDate: campaignStartDate,
      startTime: '00:00',
      endDate: campaignEndDate,
      endTime: '23:59'
    }
  ]
}

/**
 * Generate windows for "Schedule start for later" mode
 * Creates a single window from the scheduled start time to campaign end (in local timezone)
 */
export function generateWindowsForLater(
  scheduledDate: string,
  scheduledTime: string,
  campaignEndDate: string,
  timezone: string
): SendingWindow[] {
  console.log(`[TIMEZONE DEBUG] LATER mode: ${scheduledDate} ${scheduledTime} to ${campaignEndDate} 23:59 (${timezone} - stored as local time)`)

  return [
    {
      startDate: scheduledDate,
      startTime: scheduledTime,
      endDate: campaignEndDate,
      endTime: '23:59'
    }
  ]
}

/**
 * Generate windows for "Define by weekday" mode
 * Expands weekday patterns into explicit date-specific windows (in local timezone)
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

  console.log(`[TIMEZONE DEBUG] WEEKDAY mode: Generating windows for ${campaignData.campaignStartDate} to ${campaignData.campaignEndDate} (${timezone} - stored as local time)`)

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
            // Store in local timezone - backend will convert at runtime
            windows.push({
              startDate: dateStr,
              startTime: window.startTime,
              endDate: dateStr,
              endTime: window.endTime
            })
          }
        }
      })
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1)
  }

  console.log(`[TIMEZONE DEBUG] WEEKDAY mode: Generated ${windows.length} windows`)

  return windows
}


/**
 * Main function to generate sendingWindows based on campaign schedule type
 * All times are returned in LOCAL timezone - backend will convert at runtime
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
      console.log(`[TIMEZONE DEBUG] WINDOWS mode: Using ${campaignData.sendingWindows.length} custom windows (${timezone} - stored as local time)`)
      // Windows are already in local time, return as-is
      return campaignData.sendingWindows

    default:
      console.error(`Unknown schedule type: ${scheduleType}`)
      return []
  }
}
