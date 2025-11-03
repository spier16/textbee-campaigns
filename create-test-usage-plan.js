/**
 * Quick Test Usage Plan Creator
 *
 * This script creates a temporary usage plan with a 5-minute rolling window
 * instead of the default 24 hours. This allows you to test the message aging
 * behavior without waiting 24 hours.
 *
 * Usage:
 *   node create-test-usage-plan.js <your-api-key>
 *
 * After creating the plan:
 * 1. Assign your test device to this plan
 * 2. Send campaign messages to exceed the limit
 * 3. Wait 5 minutes
 * 4. Verify the counter drops back to zero
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001/api/v1';

const testPlan = {
  name: 'TEST - 5 Minute Window',
  description: 'Temporary test plan with 5-minute rolling window for testing message aging behavior. DELETE AFTER TESTING!',
  usageWindowMinutes: 5, // 5 minutes instead of 1440 (24 hours)
  tiers: [
    { tier: 1, timeDelayBetweenMessages: 30, dailyLimit: 5 },   // 30 seconds between messages
    { tier: 2, timeDelayBetweenMessages: 30, dailyLimit: 10 },  // 30 seconds between messages
    { tier: 3, timeDelayBetweenMessages: 30, dailyLimit: 15 },  // 30 seconds between messages
  ],
  isDefault: false,
};

async function createTestPlan(apiKey) {
  console.log('Creating test usage plan with 5-minute window...\n');

  try {
    const response = await fetch(`${API_BASE_URL}/gateway/usage-plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(testPlan),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create plan: ${JSON.stringify(error, null, 2)}`);
    }

    const result = await response.json();
    console.log('✅ Test usage plan created successfully!');
    console.log('\nPlan Details:');
    console.log('  ID:', result.data._id);
    console.log('  Name:', result.data.name);
    console.log('  Window:', result.data.usageWindowMinutes, 'minutes');
    console.log('  Tiers:', result.data.tiers.length);

    console.log('\n📋 Next Steps:');
    console.log('1. Go to your dashboard and assign a test device to this plan');
    console.log('2. Send campaign messages from that device to exceed the tier limit');
    console.log('3. Wait 5 minutes');
    console.log('4. Verify the message counter drops back to zero');
    console.log('\n⚠️  Remember to delete this test plan after testing!');

    return result.data;
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Get API key from command line
const apiKey = process.argv[2];

if (!apiKey) {
  console.error('Usage: node create-test-usage-plan.js <your-api-key>');
  console.error('\nYou can find your API key in your dashboard settings.');
  process.exit(1);
}

createTestPlan(apiKey);
