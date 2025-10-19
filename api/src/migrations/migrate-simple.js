/**
 * Simplified migration script using MongoDB directly
 * Run with: node src/migrations/migrate-simple.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

async function migrate() {
  console.log('Starting migration to rolling window system...\n');

  const client = new MongoClient(process.env.MONGO_URI);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB\n');

    const db = client.db();

    // Step 1: Add usageWindowMinutes to all existing usage plans
    console.log('Step 1: Adding usageWindowMinutes to existing usage plans...');
    const planResult = await db.collection('usageplans').updateMany(
      { usageWindowMinutes: { $exists: false } },
      { $set: { usageWindowMinutes: 1440 } }
    );
    console.log(`✓ Updated ${planResult.modifiedCount} usage plans\n`);

    // Step 2: Remove obsolete fields from devices
    console.log('Step 2: Removing obsolete counter fields from devices...');
    const deviceResult = await db.collection('devices').updateMany(
      {},
      {
        $unset: {
          messages_sent_today: "",
          messages_sent_this_hour: "",
          daily_counter_reset: "",
          hourly_counter_reset: "",
          cooldown_until: ""
        }
      }
    );
    console.log(`✓ Updated ${deviceResult.modifiedCount} devices\n`);

    // Step 3: Create index on SMS collection
    console.log('Step 3: Creating index on SMS collection...');
    try {
      await db.collection('sms').createIndex(
        { device: 1, campaignId: 1, sentAt: -1 },
        { name: 'device_campaign_time_idx' }
      );
      console.log('✓ Created device_campaign_time_idx index\n');
    } catch (error) {
      if (error.code === 85) { // Index already exists
        console.log('✓ Index already exists (skipped)\n');
      } else {
        throw error;
      }
    }

    // Step 4: Reset cooldown status for all devices
    console.log('Step 4: Resetting cooldown status for all devices...');
    const cooldownResult = await db.collection('devices').updateMany(
      {},
      { $set: { is_on_cooldown: false } }
    );
    console.log(`✓ Reset cooldown status for ${cooldownResult.modifiedCount} devices\n`);

    console.log('✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Restart your application');
    console.log('2. The scheduler will automatically recalculate device usage every 5 minutes');
    console.log('3. Verify dashboard displays correct usage stats');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('\nMigration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration script failed:', error);
    process.exit(1);
  });
