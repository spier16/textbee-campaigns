// SendingScheduleCalendar.tsx

import { useMemo } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { CreateCampaignData, CalendarEvent } from '@/components/campaigns/types/campaign.types'

interface SendingScheduleCalendarProps {
  campaignData: CreateCampaignData
}

export function SendingScheduleCalendar({ campaignData }: SendingScheduleCalendarProps) {
  // Get current time in the selected timezone
  const timezone = campaignData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone

  // Calculate current time in the selected timezone for the now indicator
  const currentTimeInTimezone = useMemo(() => {
    const nowUTC = new Date()
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })

    const parts = formatter.formatToParts(nowUTC)
    const year = parts.find(p => p.type === 'year')?.value
    const month = parts.find(p => p.type === 'month')?.value
    const day = parts.find(p => p.type === 'day')?.value
    const hour = parts.find(p => p.type === 'hour')?.value
    const minute = parts.find(p => p.type === 'minute')?.value
    const second = parts.find(p => p.type === 'second')?.value

    const timeString = `${year}-${month}-${day}T${hour}:${minute}:${second}`
    return timeString
  }, [timezone])


  // Convert Schedule Send settings to calendar events
  const calendarEvents = useMemo(() => {
    const events: CalendarEvent[] = []
    const now = new Date()


    if (campaignData.scheduleType === 'now') {
      // Shade all time from now through campaign end date
      if (campaignData.campaignEndDate) {
        // Get current time in the selected timezone
        const nowUTC = new Date()

        // Get the current time in the selected timezone as individual parts
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })

        const parts = formatter.formatToParts(nowUTC)
        const year = parts.find(p => p.type === 'year')?.value
        const month = parts.find(p => p.type === 'month')?.value
        const day = parts.find(p => p.type === 'day')?.value
        const hour = parts.find(p => p.type === 'hour')?.value
        const minute = parts.find(p => p.type === 'minute')?.value
        const second = parts.find(p => p.type === 'second')?.value

        const startTime = `${year}-${month}-${day}T${hour}:${minute}:${second}`
        const endTime = `${campaignData.campaignEndDate}T23:59:59`


        const event: CalendarEvent = {
          id: 'send-now-period',
          title: '',
          start: startTime,
          end: endTime,
          display: 'background' as const,
          backgroundColor: '#3b82f6', // blue
          className: 'send-now-period'
        }

        events.push(event)
      }
    } else if (campaignData.scheduleType === 'later') {
      // Shade all time from campaign start date through campaign end date, but not before current time
      if (campaignData.campaignStartDate && campaignData.campaignEndDate) {
        // Check if campaign start date is today in the selected timezone
        const todayInTimezone = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(now)
        const isStartDateToday = campaignData.campaignStartDate === todayInTimezone


        let startTime: string
        let endTime: string

        if (isStartDateToday) {
          // If start date is today, use current time like "Start sending now"
          const nowUTC = new Date()
          const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          })

          const parts = formatter.formatToParts(nowUTC)
          const year = parts.find(p => p.type === 'year')?.value
          const month = parts.find(p => p.type === 'month')?.value
          const day = parts.find(p => p.type === 'day')?.value
          const hour = parts.find(p => p.type === 'hour')?.value
          const minute = parts.find(p => p.type === 'minute')?.value
          const second = parts.find(p => p.type === 'second')?.value

          startTime = `${year}-${month}-${day}T${hour}:${minute}:${second}`
        } else {
          // Use midnight of the campaign start date in the selected timezone
          startTime = `${campaignData.campaignStartDate}T00:00:00`
        }

        // End time is always midnight of the end date
        endTime = `${campaignData.campaignEndDate}T23:59:59`


        events.push({
          id: 'scheduled-send-period',
          title: '',
          start: startTime,
          end: endTime,
          display: 'background' as const,
          backgroundColor: '#3b82f6', // blue
          className: 'scheduled-send-period'
        })
      }
    } else if (campaignData.scheduleType === 'windows' && campaignData.sendingWindows.length > 0) {
      // Show sending windows as background events, but not before current time
      campaignData.sendingWindows.forEach((window, index) => {
        if (window.startDate && window.startTime && window.endDate && window.endTime) {
          const windowStart = new Date(`${window.startDate}T${window.startTime}`)
          const windowEnd = new Date(`${window.endDate}T${window.endTime}`)

          // Use the later of window start time or current time
          const effectiveStart = windowStart > now ? windowStart : now

          // Only create event if there's still time remaining after current time
          if (effectiveStart < windowEnd) {
            events.push({
              id: `window-${index}`,
              title: '',
              start: effectiveStart.toISOString(),
              end: windowEnd.toISOString(),
              display: 'background' as const,
              backgroundColor: '#3b82f6', // blue
              className: 'sending-window-available'
            })
          }
        }
      })
    } else if (campaignData.scheduleType === 'weekday') {
      // Show weekday-based windows for all weeks from campaign start to end date
      if (campaignData.campaignStartDate && campaignData.campaignEndDate) {
        // Get current time in the campaign timezone for comparison
        const nowUTC = new Date()
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })

        const parts = formatter.formatToParts(nowUTC)
        const nowYear = parts.find(p => p.type === 'year')?.value
        const nowMonth = parts.find(p => p.type === 'month')?.value
        const nowDay = parts.find(p => p.type === 'day')?.value
        const nowHour = parts.find(p => p.type === 'hour')?.value
        const nowMinute = parts.find(p => p.type === 'minute')?.value
        const nowSecond = parts.find(p => p.type === 'second')?.value
        const currentTimeString = `${nowYear}-${nowMonth}-${nowDay}T${nowHour}:${nowMinute}:${nowSecond}`

        // DEBUG: Log current time calculation
        console.log('=== WEEKDAY WINDOW DEBUG ===')
        console.log('Timezone:', timezone)
        console.log('Current time in timezone:', currentTimeString)
        console.log('Campaign Start Date:', campaignData.campaignStartDate)
        console.log('Campaign End Date:', campaignData.campaignEndDate)

        // Parse start and end dates (using Date object for iteration only)
        // We'll use UTC to avoid timezone shifts during iteration
        const [startYear, startMonth, startDay] = campaignData.campaignStartDate.split('-').map(Number)
        const [endYear, endMonth, endDay] = campaignData.campaignEndDate.split('-').map(Number)
        const startDate = new Date(Date.UTC(startYear, startMonth - 1, startDay))
        const endDate = new Date(Date.UTC(endYear, endMonth - 1, endDay))

        // Generate events for each day between start and end dates
        const currentDate = new Date(startDate)
        while (currentDate <= endDate) {
          // Get date components in UTC (since we're using UTC dates for iteration)
          const year = currentDate.getUTCFullYear()
          const month = String(currentDate.getUTCMonth() + 1).padStart(2, '0')
          const day = String(currentDate.getUTCDate()).padStart(2, '0')
          const dateStr = `${year}-${month}-${day}`

          // Determine day of week
          const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][currentDate.getUTCDay()]
          const dayWindows = campaignData.weekdayWindows[dayName as keyof typeof campaignData.weekdayWindows]

          // DEBUG: Log date being processed
          console.log(`\n--- Processing Date: ${dateStr} (${dayName}) ---`)
          console.log('Day enabled:', campaignData.weekdayEnabled[dayName as keyof typeof campaignData.weekdayEnabled])
          console.log('Day windows:', dayWindows)

          if (campaignData.weekdayEnabled[dayName as keyof typeof campaignData.weekdayEnabled] && Array.isArray(dayWindows)) {
            dayWindows.forEach((window, index) => {
              if (window.startTime && window.endTime) {
                // Validate that end time is after start time
                const startTimeMinutes = window.startTime.split(':').reduce((acc, time) => (60 * acc) + +time, 0)
                const endTimeMinutes = window.endTime.split(':').reduce((acc, time) => (60 * acc) + +time, 0)

                if (endTimeMinutes <= startTimeMinutes) {
                  // Skip invalid time ranges (end time before or equal to start time)
                  return
                }

                // Construct datetime strings in the campaign timezone
                // These times are already in the campaign timezone since user entered them there
                // FullCalendar's timeZone prop will interpret these plain ISO strings as being in the calendar's timezone
                const windowStartStr = `${dateStr}T${window.startTime}:00`
                const windowEndStr = `${dateStr}T${window.endTime}:00`

                // DEBUG: Log window datetime construction
                console.log(`\nWindow ${index}:`)
                console.log('  Window start time (user input):', window.startTime)
                console.log('  Window end time (user input):', window.endTime)
                console.log('  windowStartStr:', windowStartStr)
                console.log('  windowEndStr:', windowEndStr)
                console.log('  currentTimeString:', currentTimeString)
                console.log('  Comparison: windowStartStr < currentTimeString?', windowStartStr < currentTimeString)

                // Compare with current time to determine effective start
                let effectiveStart = windowStartStr
                if (windowStartStr < currentTimeString) {
                  // Normalize to :00 seconds format to match windowEndStr
                  // This prevents FullCalendar parsing inconsistencies with mixed seconds precision
                  effectiveStart = currentTimeString.substring(0, 16) + ':00'
                }

                // DEBUG: Log effective start calculation
                console.log('  effectiveStart (final):', effectiveStart)
                console.log('  Comparison: effectiveStart < windowEndStr?', effectiveStart < windowEndStr)

                // Only create event if there's still time remaining after current time
                if (effectiveStart < windowEndStr) {
                  const eventToPush = {
                    id: `${dayName}-${dateStr}-${index}`,
                    title: '',
                    start: effectiveStart,
                    end: windowEndStr,
                    display: 'background' as const,
                    backgroundColor: '#3b82f6', // blue
                    className: 'weekday-window-available'
                  }

                  // DEBUG: Log event being created
                  console.log('  ✓ Pushing event:', JSON.stringify(eventToPush, null, 2))

                  events.push(eventToPush)
                }
              }
            })
          }

          // Move to next day (using UTC date methods to avoid timezone issues)
          currentDate.setUTCDate(currentDate.getUTCDate() + 1)
        }

        // DEBUG: Log final events array
        console.log('\n=== FINAL EVENTS ARRAY (WEEKDAY) ===')
        console.log('Total events:', events.filter(e => e.className === 'weekday-window-available').length)
        console.log('All weekday events:', JSON.stringify(events.filter(e => e.className === 'weekday-window-available'), null, 2))
        console.log('=== END DEBUG ===\n')
      }
    }

    return events
  }, [campaignData, timezone])


  return (
    <div className="calendar-wrapper" style={{ height: '100%', overflow: 'auto' }}>
      <FullCalendar
        key={timezone}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek'
        }}
        initialView="timeGridWeek"
        editable={false}
        selectable={false}
        selectMirror={true}
        dayMaxEvents={true}
        weekends={true}
        events={calendarEvents}
        height="auto"
        nowIndicator={true}
        now={currentTimeInTimezone}
        timeZone={timezone}
        locale="en-US"
        firstDay={0}
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        allDaySlot={false}
        slotDuration="01:00:00"
        slotLabelInterval="01:00:00"
        snapDuration="00:15:00"
        eventDisplay="background"
        eventMinHeight={0}
        dayHeaderContent={(args) => {
          // args.date is a Date object - we need to format it without timezone conversion
          // Get the UTC date components to avoid timezone shifting
          const year = args.date.getUTCFullYear()
          const month = args.date.getUTCMonth()
          const day = args.date.getUTCDate()

          // Create a local date with these components (no timezone conversion)
          const localDate = new Date(year, month, day)
          const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(localDate)

          // Only show dates in week view, not in month view
          const isWeekView = args.view.type === 'timeGridWeek'

          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div>{weekday}</div>
              {isWeekView && <div>{month + 1}/{day}</div>}
            </div>
          )
        }}
        eventDidMount={(info) => {
          // DEBUG: Log when FullCalendar mounts an event (all events)
          const computedStyle = window.getComputedStyle(info.el)
          console.log('FullCalendar eventDidMount:', {
            eventId: info.event.id,
            title: info.event.title,
            start: info.event.start,
            startStr: info.event.startStr,
            end: info.event.end,
            endStr: info.event.endStr,
            display: info.event.display,
            backgroundColor: info.event.backgroundColor,
            classNames: info.event.classNames,
            extendedProps: info.event.extendedProps,
            computedHeight: computedStyle.height,
            computedMinHeight: computedStyle.minHeight,
            computedFlexBasis: computedStyle.flexBasis,
            computedFlexGrow: computedStyle.flexGrow,
            computedFlexShrink: computedStyle.flexShrink
          })
        }}
        eventContent={(info) => {
          // DEBUG: Log when FullCalendar renders event content (all events)
          console.log('FullCalendar eventContent rendering:', {
            eventId: info.event.id,
            timeText: info.timeText,
            start: info.event.start,
            end: info.event.end,
            classNames: info.event.classNames
          })
          return null
        }}
      />
      <style jsx>{`
        :global(.fc-now-indicator-line) {
          border-color: #15803d !important;
          border-width: 2px !important;
        }
        :global(.fc-now-indicator-arrow) {
          border-top-color: #15803d !important;
          border-bottom-color: #15803d !important;
        }
        :global(.fc) {
          font-size: 0.7rem !important;
          color: #1e293b !important;
        }
        :global(.fc-toolbar) {
          font-size: 0.7rem !important;
        }
        :global(.fc-button) {
          font-size: 0.7rem !important;
          padding: 0.2rem 0.4rem !important;
        }
        :global(.fc-col-header-cell) {
          font-size: 0.7rem !important;
          color: #1e293b !important;
        }
        :global(.fc-col-header-cell-cushion) {
          white-space: pre-line !important;
          color: #1e293b !important;
        }
        :global(.fc-timegrid-slot-label) {
          font-size: 0.7rem !important;
          color: #1e293b !important;
        }
        :global(.fc-toolbar-title) {
          font-size: 0.7rem !important;
          color: #1e293b !important;
        }
        :global(.fc-timegrid-slot-label-cushion) {
          color: #1e293b !important;
        }
        :global(.fc-timegrid-axis-cushion) {
          color: #1e293b !important;
        }
        :global(.fc-daygrid-day-number) {
          color: #1e293b !important;
        }
        :global(.fc-daygrid-day-top) {
          color: #1e293b !important;
        }
        :global(.fc-theme-standard td),
        :global(.fc-theme-standard th) {
          color: #1e293b !important;
          border-color: #e2e8f0 !important;
        }
        :global(.fc-scrollgrid) {
          border-color: #e2e8f0 !important;
        }
        :global(.fc-button-primary:not(:disabled)) {
          color: #ffffff !important;
          background-color: #3b82f6 !important;
          border-color: #3b82f6 !important;
        }
        /* Fix for background events displaying longer than their actual duration */
        /* FullCalendar applies min-height which causes short events to appear extended */
        :global(.fc-timegrid-event-harness) {
          min-height: 0 !important;
        }
        :global(.fc-timegrid-event) {
          min-height: 0 !important;
          flex-basis: auto !important;
        }
        :global(.fc-bg-event) {
          min-height: 0 !important;
          flex-basis: auto !important;
        }
        :global(.fc-timegrid-bg-harness) {
          min-height: 0 !important;
        }
      `}</style>
    </div>
  )
}