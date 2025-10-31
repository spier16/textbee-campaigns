import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file
config({ path: resolve(__dirname, '../../.env') })

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { ModernizeSchemasMigration } from './modernize-schemas.migration'

/**
 * CLI script to run schema modernization migration
 *
 * Usage:
 *   npm run migration:modernize
 *
 * Or with ts-node:
 *   npx ts-node -r tsconfig-paths/register src/migrations/run-migration.ts
 */
async function runMigration() {
  console.log('Initializing NestJS application...')
  console.log(
    `MongoDB URI: ${process.env.MONGO_URI ? 'Loaded ✓' : 'Missing ✗'}`,
  )

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const migration = app.get(ModernizeSchemasMigration)

    console.log('\n===========================================')
    console.log('Schema Modernization Migration')
    console.log('===========================================\n')

    await migration.execute()

    console.log('\n===========================================')
    console.log('Migration completed successfully!')
    console.log('===========================================\n')
  } catch (error) {
    console.error('\n===========================================')
    console.error('Migration failed!')
    console.error('===========================================\n')
    console.error(error)
    process.exit(1)
  } finally {
    await app.close()
  }
}

runMigration()
