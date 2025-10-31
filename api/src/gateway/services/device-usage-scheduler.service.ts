import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { DeviceUsageCalculatorService } from './device-usage-calculator.service'

@Injectable()
export class DeviceUsageSchedulerService {
  private readonly logger = new Logger(DeviceUsageSchedulerService.name)

  constructor(private readonly usageCalculator: DeviceUsageCalculatorService) {}

  /**
   * Recalculate device usage and cooldown status every 5 minutes
   * This ensures the dashboard reflects reality even when no messages are being sent
   */
  @Cron('*/5 * * * *')
  async recalculateAllDeviceUsage() {
    this.logger.log('Starting scheduled device usage recalculation...')

    try {
      await this.usageCalculator.batchRecalculateAllDevices()
      this.logger.log(
        'Scheduled device usage recalculation completed successfully',
      )
    } catch (error) {
      this.logger.error('Failed to recalculate device usage', error.stack)
    }
  }

  /**
   * Optional: Clean up old SMS records daily at midnight
   * This can help prevent the SMS collection from growing indefinitely
   * Note: Adjust retention policy based on your needs
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async logDailyMaintenanceTask() {
    this.logger.log(
      'Daily maintenance task triggered (placeholder for future cleanup logic)',
    )
    // Future: Implement SMS archival or deletion for messages older than max window + buffer
  }
}
