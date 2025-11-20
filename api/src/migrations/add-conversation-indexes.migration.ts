import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SMS } from '../gateway/schemas/sms.schema';

/**
 * Migration to add optimized indexes for conversation queries
 *
 * This addresses the performance issues when loading the Inbox page
 * by ensuring MongoDB can efficiently execute the conversation aggregation pipeline.
 */
async function migrate() {
  console.log('Starting conversation indexes migration...\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const smsModel = app.get<Model<SMS>>(getModelToken(SMS.name));

    console.log('Current indexes:');
    const existingIndexes = await smsModel.collection.getIndexes();
    console.log(JSON.stringify(existingIndexes, null, 2));
    console.log('');

    // Helper function to safely create index (skip if exists)
    const createIndexSafely = async (keys: any, options: any, description: string) => {
      try {
        console.log(`Creating index: ${description}`);
        await smsModel.collection.createIndex(keys, options);
        console.log('✓ Created\n');
      } catch (error: any) {
        if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
          console.log('⊘ Skipped (already exists with different configuration)\n');
        } else if (error.code === 86 || error.codeName === 'IndexKeySpecsConflict') {
          console.log('⊘ Skipped (already exists)\n');
        } else {
          throw error;
        }
      }
    };

    // Index 1: Optimize the conversation aggregation grouping stage
    // Covers: { device: X, $or: [sender exists, recipient exists] } + sorting by date
    await createIndexSafely(
      { device: 1, sender: 1, receivedAt: -1 },
      { name: 'device_sender_receivedAt_desc', background: true },
      '{ device: 1, sender: 1, receivedAt: -1 }'
    );

    await createIndexSafely(
      { device: 1, recipient: 1, requestedAt: -1 },
      { name: 'device_recipient_requestedAt_desc', background: true },
      '{ device: 1, recipient: 1, requestedAt: -1 }'
    );

    // Index 2: Optimize unseen message count queries (already exists, will skip)
    // Covers: { device: X, sender: Y, receivedAt > Z }
    await createIndexSafely(
      { device: 1, sender: 1, receivedAt: 1 },
      { name: 'device_sender_receivedAt_asc', background: true },
      '{ device: 1, sender: 1, receivedAt: 1 }'
    );

    // Index 3: Optimize first campaign lookup
    // Covers: { device: X, recipient: Y, campaignId: exists } + sort by requestedAt
    await createIndexSafely(
      { device: 1, recipient: 1, campaignId: 1, requestedAt: 1 },
      { name: 'device_recipient_campaign_requestedAt', background: true },
      '{ device: 1, recipient: 1, campaignId: 1, requestedAt: 1 }'
    );

    console.log('Final indexes:');
    const finalIndexes = await smsModel.collection.getIndexes();
    console.log(JSON.stringify(finalIndexes, null, 2));
    console.log('');

    console.log('✓ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Monitor the Inbox page load time on your VPS');
    console.log('2. Check MongoDB logs for slow queries: db.setProfilingLevel(2)');
    console.log('3. If still slow, consider implementing Level 2 optimizations (caching)');

  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

migrate();
