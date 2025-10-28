import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { MigrateCampaignSchedulingMigration } from './migrations/migrate-campaign-scheduling.migration'

/**
 * Standalone script to run the campaign scheduling migration
 *
 * Usage: npx ts-node src/run-campaign-migration.ts
 */
async function runMigration() {
  console.log('🚀 Starting campaign scheduling migration...\n')

  try {
    // Bootstrap the NestJS application
    const app = await NestFactory.createApplicationContext(AppModule)

    // Get the migration service
    const migration = app.get(MigrateCampaignSchedulingMigration)

    // Execute the migration
    await migration.execute()

    console.log('\n✅ Migration completed successfully!')

    // Close the application
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  }
}

runMigration()
