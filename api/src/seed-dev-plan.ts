import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file
config({ path: resolve(__dirname, '../.env') })

import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Plan, PlanDocument } from './billing/schemas/plan.schema'

/**
 * CLI script to seed a 'dev' plan for development/testing
 *
 * Usage:
 *   npm run seed:dev-plan
 *
 * Or with ts-node:
 *   npx ts-node -r tsconfig-paths/register src/seed-dev-plan.ts
 */
async function seedDevPlan() {
  console.log('Initializing NestJS application...')
  console.log(`MongoDB URI: ${process.env.MONGO_URI ? 'Loaded ✓' : 'Missing ✗'}`)

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    // Get the Plan model
    const planModel = app.get<Model<PlanDocument>>('PlanModel')

    console.log('\n===========================================')
    console.log('Seeding Dev Plan')
    console.log('===========================================\n')

    // Check if 'dev' plan already exists
    const existingDevPlan = await planModel.findOne({ name: 'dev' })

    if (existingDevPlan) {
      console.log('✓ Dev plan already exists')
      console.log(`  Plan ID: ${existingDevPlan._id}`)
      console.log(`  Name: ${existingDevPlan.name}`)
      console.log(`  Daily Limit: ${existingDevPlan.dailyLimit === -1 ? 'Unlimited' : existingDevPlan.dailyLimit}`)
      console.log(`  Monthly Limit: ${existingDevPlan.monthlyLimit === -1 ? 'Unlimited' : existingDevPlan.monthlyLimit}`)
      console.log(`  Bulk Send Limit: ${existingDevPlan.bulkSendLimit === -1 ? 'Unlimited' : existingDevPlan.bulkSendLimit}`)
    } else {
      // Create the 'dev' plan with unlimited access
      const devPlan = await planModel.create({
        name: 'dev',
        dailyLimit: -1,        // -1 means unlimited
        monthlyLimit: -1,      // -1 means unlimited
        bulkSendLimit: -1,     // -1 means unlimited
        monthlyPrice: 0,       // Free for dev
        yearlyPrice: 0,        // Free for dev
        isActive: true,
      })

      console.log('✓ Dev plan created successfully!')
      console.log(`  Plan ID: ${devPlan._id}`)
      console.log(`  Name: ${devPlan.name}`)
      console.log(`  Daily Limit: Unlimited`)
      console.log(`  Monthly Limit: Unlimited`)
      console.log(`  Bulk Send Limit: Unlimited`)
      console.log(`  Monthly Price: $0`)
    }

    console.log('\n===========================================')
    console.log('Seeding completed successfully!')
    console.log('===========================================\n')

  } catch (error) {
    console.error('\n===========================================')
    console.error('Seeding failed!')
    console.error('===========================================\n')
    console.error(error)
    process.exit(1)
  } finally {
    await app.close()
  }
}

seedDevPlan()
