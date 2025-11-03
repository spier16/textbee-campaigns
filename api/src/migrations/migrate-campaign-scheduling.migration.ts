import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  Campaign,
  CampaignDocument,
  ScheduleType,
} from '../campaigns/schemas/campaign.schema'

/**
 * Migration script to unify campaign scheduling under sendingWindows format
 *
 * This migration converts all existing campaigns to use the unified sendingWindows[] format:
 * - NOW mode: Creates single window from campaignStartDate to campaignEndDate
 * - LATER mode: Creates single window from scheduledDate/scheduledTime to campaignEndDate
 * - WINDOWS mode: Already uses correct format (validates only)
 * - WEEKDAY mode: Expands weekday patterns into explicit date windows
 *
 * All times are converted to UTC for consistent backend storage.
 */
@Injectable()
export class MigrateCampaignSchedulingMigration {
  private readonly logger = new Logger(MigrateCampaignSchedulingMigration.name)

  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
  ) {}

  /**
   * Execute the migration
   */
  async execute(): Promise<void> {
    this.logger.log('Starting campaign scheduling migration...')

    try {
      const campaigns = await this.campaignModel.find({}).exec()
      this.logger.log(`Found ${campaigns.length} campaigns to process`)

      let migrated = 0
      let skipped = 0
      let errors = 0

      for (const campaign of campaigns) {
        try {
          if (campaign.sendingWindows && campaign.sendingWindows.length > 0) {
            this.logger.debug(
              `Campaign ${campaign._id} already has sendingWindows, skipping`,
            )
            skipped++
            continue
          }

          const sendingWindows = this.generateWindowsForCampaign(campaign)

          if (sendingWindows.length === 0) {
            this.logger.warn(
              `Could not generate windows for campaign ${campaign._id} (${campaign.scheduleType})`,
            )
            errors++
            continue
          }

          await this.campaignModel.updateOne(
            { _id: campaign._id },
            { $set: { sendingWindows } },
          )

          this.logger.debug(
            `Migrated campaign ${campaign._id} (${campaign.scheduleType}): ${sendingWindows.length} windows`,
          )
          migrated++
        } catch (error) {
          this.logger.error(`Error migrating campaign ${campaign._id}:`, error)
          errors++
        }
      }

      this.logger.log(
        `Campaign scheduling migration completed: ${migrated} migrated, ${skipped} skipped, ${errors} errors`,
      )
    } catch (error) {
      this.logger.error('Migration failed:', error)
      throw error
    }
  }

  /**
   * Generate sendingWindows based on campaign schedule type
   */
  private generateWindowsForCampaign(campaign: CampaignDocument): any[] {
    const timezone = campaign.timezone || 'UTC'

    switch (campaign.scheduleType) {
      case ScheduleType.NOW:
        return this.generateWindowsForNow(campaign, timezone)

      case ScheduleType.LATER:
        return this.generateWindowsForLater(campaign, timezone)

      case ScheduleType.WINDOWS:
        // Already in correct format, just validate and convert to UTC
        return this.convertWindowsToUTC(campaign.sendingWindows || [], timezone)

      case ScheduleType.WEEKDAY:
        return this.generateWindowsForWeekday(campaign, timezone)

      default:
        this.logger.warn(
          `Unknown schedule type: ${campaign.scheduleType} for campaign ${campaign._id}`,
        )
        return []
    }
  }

  /**
   * Generate windows for NOW mode
   */
  private generateWindowsForNow(
    campaign: CampaignDocument,
    timezone: string,
  ): any[] {
    const startUTC = this.convertToUTC(
      campaign.campaignStartDate,
      '00:00',
      timezone,
    )
    const endUTC = this.convertToUTC(
      campaign.campaignEndDate,
      '23:59',
      timezone,
    )

    return [
      {
        startDate: startUTC.date,
        startTime: startUTC.time,
        endDate: endUTC.date,
        endTime: endUTC.time,
      },
    ]
  }

  /**
   * Generate windows for LATER mode
   */
  private generateWindowsForLater(
    campaign: CampaignDocument,
    timezone: string,
  ): any[] {
    // @ts-ignore - scheduledDate/scheduledTime will be removed in schema but exist in old data
    const scheduledDate = campaign.scheduledDate
    // @ts-ignore
    const scheduledTime = campaign.scheduledTime

    if (!scheduledDate || !scheduledTime) {
      this.logger.warn(
        `Campaign ${campaign._id} has LATER schedule but missing scheduledDate/scheduledTime`,
      )
      // Fallback to NOW mode behavior
      return this.generateWindowsForNow(campaign, timezone)
    }

    const startUTC = this.convertToUTC(scheduledDate, scheduledTime, timezone)
    const endUTC = this.convertToUTC(
      campaign.campaignEndDate,
      '23:59',
      timezone,
    )

    return [
      {
        startDate: startUTC.date,
        startTime: startUTC.time,
        endDate: endUTC.date,
        endTime: endUTC.time,
      },
    ]
  }

  /**
   * Generate windows for WEEKDAY mode
   */
  private generateWindowsForWeekday(
    campaign: CampaignDocument,
    timezone: string,
  ): any[] {
    const windows: any[] = []

    if (!campaign.weekdayWindows) {
      this.logger.warn(
        `Campaign ${campaign._id} has WEEKDAY schedule but no weekdayWindows defined`,
      )
      return []
    }

    // @ts-ignore - weekdayEnabled will be removed from schema but exists in old data
    const weekdayEnabled = campaign.weekdayEnabled || {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
    }

    const startDate = new Date(campaign.campaignStartDate + 'T00:00:00')
    const endDate = new Date(campaign.campaignEndDate + 'T23:59:59')

    // Iterate through each day in the campaign range
    const currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      const dayName = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ][currentDate.getDay()]

      const dayWindows = campaign.weekdayWindows[dayName]
      const isDayEnabled = weekdayEnabled[dayName]

      if (isDayEnabled && Array.isArray(dayWindows) && dayWindows.length > 0) {
        const year = currentDate.getFullYear()
        const month = String(currentDate.getMonth() + 1).padStart(2, '0')
        const day = String(currentDate.getDate()).padStart(2, '0')
        const dateStr = `${year}-${month}-${day}`

        dayWindows.forEach((window) => {
          if (window.startTime && window.endTime) {
            // Validate time range
            const startMinutes = this.timeToMinutes(window.startTime)
            const endMinutes = this.timeToMinutes(window.endTime)

            if (endMinutes > startMinutes) {
              const startUTC = this.convertToUTC(
                dateStr,
                window.startTime,
                timezone,
              )
              const endUTC = this.convertToUTC(
                dateStr,
                window.endTime,
                timezone,
              )

              windows.push({
                startDate: startUTC.date,
                startTime: startUTC.time,
                endDate: endUTC.date,
                endTime: endUTC.time,
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
   * Convert existing windows to UTC
   */
  private convertWindowsToUTC(windows: any[], timezone: string): any[] {
    return windows.map((window) => {
      const startUTC = this.convertToUTC(
        window.startDate,
        window.startTime,
        timezone,
      )
      const endUTC = this.convertToUTC(window.endDate, window.endTime, timezone)

      return {
        startDate: startUTC.date,
        startTime: startUTC.time,
        endDate: endUTC.date,
        endTime: endUTC.time,
      }
    })
  }

  /**
   * Convert local time to UTC
   */
  private convertToUTC(
    dateStr: string,
    timeStr: string,
    timezone: string,
  ): { date: string; time: string } {
    try {
      // Create ISO string in local timezone
      const localDateTime = `${dateStr}T${timeStr}:00`

      // Parse as if it's in the specified timezone
      const date = new Date(localDateTime)

      // Get the offset for the timezone at this specific date/time
      const utcDate = new Date(
        date.toLocaleString('en-US', { timeZone: timezone }),
      )
      const tzDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
      const offset = tzDate.getTime() - utcDate.getTime()

      // Apply offset
      const correctedDate = new Date(date.getTime() - offset)

      // Format as YYYY-MM-DD and HH:mm
      const isoString = correctedDate.toISOString()
      const [datePart, timePart] = isoString.split('T')
      const [hour, minute] = timePart.split(':')

      return {
        date: datePart,
        time: `${hour}:${minute}`,
      }
    } catch (error) {
      this.logger.error(
        `Error converting ${dateStr} ${timeStr} in ${timezone} to UTC:`,
        error,
      )
      // Fallback: return as-is
      return { date: dateStr, time: timeStr }
    }
  }

  /**
   * Convert HH:mm time string to minutes since midnight
   */
  private timeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number)
    return hours * 60 + minutes
  }
}
