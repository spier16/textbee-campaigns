import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema'
import { zonedTimeToUtc, utcToZonedTime, format } from 'date-fns-tz'

/**
 * Migration script to fix timezone conversion bug in campaign sending windows
 *
 * PROBLEM:
 * - Frontend was storing times in local timezone instead of UTC
 * - Backend expects all times to be in UTC (appends 'Z' when parsing)
 * - Result: Messages sent 5-6 hours earlier than intended
 *
 * SOLUTION:
 * - Read existing sendingWindows (which are in local TZ)
 * - Convert them to actual UTC using the campaign's stored timezone field
 * - Update the campaign with corrected UTC times
 *
 * SAFETY:
 * - Only processes campaigns with status RUNNING, SCHEDULED, PAUSED (active campaigns)
 * - Logs all changes for verification
 * - Creates backup of original data in campaign document
 */
@Injectable()
export class FixCampaignTimezonesMigration {
  private readonly logger = new Logger(FixCampaignTimezonesMigration.name)

  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
  ) {}

  /**
   * Execute the migration
   */
  async execute(dryRun: boolean = false): Promise<void> {
    this.logger.log('Starting campaign timezone fix migration...')
    this.logger.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will update database)'}`)

    try {
      // Only fix active campaigns (not completed, cancelled, or failed)
      const campaigns = await this.campaignModel
        .find({
          status: { $in: ['running', 'scheduled', 'paused'] },
          isDeleted: false,
        })
        .exec()

      this.logger.log(`Found ${campaigns.length} active campaigns to process`)

      let fixed = 0
      let skipped = 0
      let errors = 0

      for (const campaign of campaigns) {
        try {
          // Skip if no timezone or sendingWindows
          if (!campaign.timezone || !campaign.sendingWindows || campaign.sendingWindows.length === 0) {
            this.logger.debug(`Skipping campaign ${campaign._id}: missing timezone or windows`)
            skipped++
            continue
          }

          // Skip if timezone is UTC (no conversion needed)
          if (campaign.timezone === 'UTC') {
            this.logger.debug(`Skipping campaign ${campaign._id}: already in UTC`)
            skipped++
            continue
          }

          // Convert windows from local TZ to UTC
          const correctedWindows = this.convertLocalWindowsToUTC(
            campaign.sendingWindows,
            campaign.timezone,
          )

          // Check if any changes were made
          const hasChanges = this.windowsAreDifferent(
            campaign.sendingWindows,
            correctedWindows,
          )

          if (!hasChanges) {
            this.logger.debug(`Skipping campaign ${campaign._id}: no changes needed`)
            skipped++
            continue
          }

          // Log the changes
          this.logger.log(
            `Campaign ${campaign._id} (${campaign.name}) - ${campaign.timezone}:`,
          )
          this.logWindowChanges(campaign.sendingWindows, correctedWindows)

          if (!dryRun) {
            // Backup original windows and update with corrected ones
            await this.campaignModel.updateOne(
              { _id: campaign._id },
              {
                $set: {
                  sendingWindows: correctedWindows,
                  // Store backup for recovery if needed
                  'metadata.originalWindowsBeforeTimezoneFix': campaign.sendingWindows,
                  'metadata.timezoneFixAppliedAt': new Date(),
                },
              },
            )
          }

          fixed++
        } catch (error) {
          this.logger.error(`Error fixing campaign ${campaign._id}:`, error)
          errors++
        }
      }

      this.logger.log(
        `\nTimezone fix migration completed: ${fixed} fixed, ${skipped} skipped, ${errors} errors`,
      )

      if (dryRun && fixed > 0) {
        this.logger.warn(
          '\n⚠️  This was a DRY RUN. No changes were made. Run with dryRun=false to apply changes.',
        )
      }
    } catch (error) {
      this.logger.error('Migration failed:', error)
      throw error
    }
  }

  /**
   * Convert sending windows from local timezone to UTC
   */
  private convertLocalWindowsToUTC(
    windows: any[],
    localTimezone: string,
  ): any[] {
    return windows.map((window) => {
      const startUTC = this.convertLocalToUTC(
        window.startDate,
        window.startTime,
        localTimezone,
      )
      const endUTC = this.convertLocalToUTC(
        window.endDate,
        window.endTime,
        localTimezone,
      )

      return {
        startDate: startUTC.date,
        startTime: startUTC.time,
        endDate: endUTC.date,
        endTime: endUTC.time,
      }
    })
  }

  /**
   * Convert a local datetime to UTC using date-fns-tz
   *
   * Example:
   *   Input: "2025-01-15" "09:00" "America/Chicago"
   *   Output: { date: "2025-01-15", time: "15:00" } (during CST, UTC-6)
   */
  private convertLocalToUTC(
    dateStr: string,
    timeStr: string,
    timezone: string,
  ): { date: string; time: string } {
    try {
      // The existing time is ALREADY in local timezone (that was the bug)
      // So we interpret it as being in the specified timezone
      const localDateTime = `${dateStr}T${timeStr}:00`

      // Convert from local timezone to UTC
      const utcDate = zonedTimeToUtc(localDateTime, timezone)

      // Format as YYYY-MM-DD and HH:mm
      const formattedDate = format(utcDate, 'yyyy-MM-dd', { timeZone: 'UTC' })
      const formattedTime = format(utcDate, 'HH:mm', { timeZone: 'UTC' })

      return {
        date: formattedDate,
        time: formattedTime,
      }
    } catch (error) {
      this.logger.error(
        `Error converting ${dateStr} ${timeStr} in ${timezone} to UTC:`,
        error,
      )
      // Fallback: return as-is (will be incorrect but prevents crash)
      return { date: dateStr, time: timeStr }
    }
  }

  /**
   * Check if two window arrays are different
   */
  private windowsAreDifferent(windows1: any[], windows2: any[]): boolean {
    if (windows1.length !== windows2.length) return true

    for (let i = 0; i < windows1.length; i++) {
      const w1 = windows1[i]
      const w2 = windows2[i]

      if (
        w1.startDate !== w2.startDate ||
        w1.startTime !== w2.startTime ||
        w1.endDate !== w2.endDate ||
        w1.endTime !== w2.endTime
      ) {
        return true
      }
    }

    return false
  }

  /**
   * Log the before/after changes for verification
   */
  private logWindowChanges(originalWindows: any[], correctedWindows: any[]) {
    const maxToShow = 3 // Only show first 3 windows to keep logs readable

    for (let i = 0; i < Math.min(originalWindows.length, maxToShow); i++) {
      const orig = originalWindows[i]
      const corrected = correctedWindows[i]

      this.logger.log(
        `  Window ${i + 1}: ${orig.startDate} ${orig.startTime} → ${corrected.startDate} ${corrected.startTime} (UTC)`,
      )
      this.logger.log(
        `           ${orig.endDate} ${orig.endTime} → ${corrected.endDate} ${corrected.endTime} (UTC)`,
      )
    }

    if (originalWindows.length > maxToShow) {
      this.logger.log(`  ... and ${originalWindows.length - maxToShow} more windows`)
    }
  }
}
