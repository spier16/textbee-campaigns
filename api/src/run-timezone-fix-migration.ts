import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { FixCampaignTimezonesMigration } from './migrations/fix-campaign-timezones.migration'

/**
 * Standalone script to fix timezone conversion bug in campaign sending windows
 *
 * Usage:
 *   DRY RUN (preview changes): npx ts-node src/run-timezone-fix-migration.ts
 *   LIVE (apply changes):      npx ts-node src/run-timezone-fix-migration.ts --apply
 */
async function runMigration() {
  const isDryRun = !process.argv.includes('--apply')

  console.log('🕐 Campaign Timezone Fix Migration\n')
  console.log('📋 This migration fixes the timezone conversion bug where:')
  console.log('   - Sending windows were stored in local timezone instead of UTC')
  console.log('   - Backend expected UTC, causing messages to send at wrong times')
  console.log('   - Example: 9 AM Chicago was interpreted as 9 AM UTC (3 AM Chicago)\n')

  if (isDryRun) {
    console.log('🔍 Running in DRY RUN mode (no changes will be made)')
    console.log('   To apply changes, run with: --apply flag\n')
  } else {
    console.log('⚠️  Running in LIVE mode (database will be updated)')
    console.log('   Original windows will be backed up in campaign.metadata\n')
  }

  try {
    // Bootstrap the NestJS application
    const app = await NestFactory.createApplicationContext(AppModule)

    // Get the migration service
    const migration = app.get(FixCampaignTimezonesMigration)

    // Execute the migration
    await migration.execute(isDryRun)

    console.log('\n✅ Migration completed successfully!')

    if (isDryRun) {
      console.log('\n💡 To apply these changes, run:')
      console.log('   npx ts-node src/run-timezone-fix-migration.ts --apply')
    }

    // Close the application
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  }
}

runMigration()
