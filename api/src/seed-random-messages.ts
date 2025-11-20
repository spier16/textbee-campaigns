import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SMS } from './gateway/schemas/sms.schema';
import { Device } from './gateway/schemas/device.schema';
import { User } from './users/schemas/user.schema';
import { normalizePhoneNumber } from './contacts/utils/phone.utils';
import { SMSType } from './gateway/sms-type.enum';

/**
 * Configuration for message generation
 */
const MESSAGE_TEMPLATES = [
  'Hi! Just wanted to check in with you.',
  'Thanks for your interest! Let me know if you have any questions.',
  'Great to hear from you! Looking forward to connecting.',
  'Hope you are doing well!',
  'Just following up on our last conversation.',
  'Thank you for reaching out!',
  'Happy to help! What can I do for you today?',
  'This is a reminder about our upcoming event.',
  'Thanks for being a valued customer!',
  'Let me know if you need anything else.',
];

/**
 * Generate a random phone number
 */
function generateRandomPhoneNumber(): string {
  const areaCode = Math.floor(Math.random() * 900) + 100;
  const prefix = Math.floor(Math.random() * 900) + 100;
  const lineNumber = Math.floor(Math.random() * 9000) + 1000;
  return `+1${areaCode}${prefix}${lineNumber}`;
}

/**
 * Generate a random date within the last m days
 */
function generateRandomDate(daysBack: number): Date {
  const now = new Date();
  const millisecondsBack = daysBack * 24 * 60 * 60 * 1000;
  const randomTime = Math.random() * millisecondsBack;
  return new Date(now.getTime() - randomTime);
}

/**
 * Get random element from array
 */
function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Main seed function
 */
async function seed() {
  console.log('Starting random message seed script...\n');

  // Parse command-line arguments
  const args = process.argv.slice(2);
  const numMessages = parseInt(args[0]) || 100;
  const daysBack = parseInt(args[1]) || 30;

  console.log(`Configuration:`);
  console.log(`- Number of messages: ${numMessages}`);
  console.log(`- Days back: ${daysBack}`);
  console.log(`- Message templates: ${MESSAGE_TEMPLATES.length}\n`);

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    // Get models
    const smsModel = app.get<Model<SMS>>(getModelToken(SMS.name));
    const deviceModel = app.get<Model<Device>>(getModelToken(Device.name));
    const userModel = app.get<Model<User>>(getModelToken(User.name));

    // Find a device to use for sending messages
    const device = await deviceModel.findOne({ enabled: true }).exec();
    if (!device) {
      console.error('Error: No enabled device found in the database.');
      console.error('Please ensure you have at least one enabled device.');
      await app.close();
      process.exit(1);
    }

    console.log(`Using device: ${device._id} (${device.phoneNumber || 'No phone number'})\n`);

    // Generate messages
    console.log(`Generating ${numMessages} random messages...\n`);
    const messages = [];
    const batchSize = 100;

    for (let i = 0; i < numMessages; i++) {
      const randomDate = generateRandomDate(daysBack);
      const sentDate = new Date(randomDate.getTime() + Math.random() * 60000); // 0-60 seconds after request
      const messageContent = getRandomElement(MESSAGE_TEMPLATES);
      const rawRecipient = generateRandomPhoneNumber();
      const recipient = normalizePhoneNumber(rawRecipient);
      const status = Math.random() > 0.1 ? 'delivered' : 'sent'; // 90% delivered, 10% sent

      messages.push({
        device: device._id,
        type: SMSType.SENT,
        recipient,
        message: messageContent,
        status,
        requestedAt: randomDate,
        sentAt: sentDate,
        deliveredAt: status === 'delivered' ? new Date(sentDate.getTime() + Math.random() * 30000) : undefined,
        encrypted: false,
      });

      // Insert in batches for better performance
      if (messages.length >= batchSize || i === numMessages - 1) {
        await smsModel.insertMany(messages);
        console.log(`Progress: ${i + 1}/${numMessages} messages created`);
        messages.length = 0; // Clear array
      }
    }

    // Update device sent count
    const totalSentCount = await smsModel.countDocuments({
      device: device._id,
      type: 'sent'
    });
    await deviceModel.updateOne(
      { _id: device._id },
      { sentSMSCount: totalSentCount }
    );

    console.log('\n✓ Seed completed successfully!');
    console.log(`\nSummary:`);
    console.log(`- Total messages created: ${numMessages}`);
    console.log(`- Date range: ${new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toLocaleDateString()} to ${new Date().toLocaleDateString()}`);
    console.log(`- Device sent count updated to: ${totalSentCount}`);

  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

seed();
