require('dotenv').config();
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');

async function createUser() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('MONGO_URI not found in environment variables');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    const db = client.db();

    const email = 'sapierson87@gmail.com';
    const password = 'christmasLights25';

    console.log('Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if user exists
    console.log('Checking if user exists...');
    let user = await db.collection('users').findOne({ email });

    if (user) {
      // Update existing user's password
      console.log('User found. Updating password...');
      await db.collection('users').updateOne(
        { email },
        {
          $set: {
            password: hashedPassword,
            updatedAt: new Date()
          }
        }
      );
      console.log('✓ User password updated successfully!');
    } else {
      // Create new user
      console.log('User not found. Creating new user...');
      const result = await db.collection('users').insertOne({
        email,
        password: hashedPassword,
        name: 'Dev User',
        role: 'regular',
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
        isBanned: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      user = await db.collection('users').findOne({ _id: result.insertedId });
      console.log('✓ User created successfully!');
    }

    console.log(`\nUser Details:`);
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}`);
    console.log(`  User ID: ${user._id}`);

    // Find or create dev plan
    console.log('\nChecking for dev plan...');
    let devPlan = await db.collection('plans').findOne({ name: 'dev' });

    if (!devPlan) {
      console.log('Dev plan not found. Creating dev plan...');
      const planResult = await db.collection('plans').insertOne({
        name: 'dev',
        dailyLimit: -1, // -1 means unlimited
        monthlyLimit: -1, // -1 means unlimited
        bulkSendLimit: -1, // -1 means unlimited
        monthlyPrice: 0,
        yearlyPrice: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      devPlan = await db.collection('plans').findOne({ _id: planResult.insertedId });
      console.log('✓ Dev plan created successfully!');
    } else {
      console.log('✓ Dev plan found');
    }

    console.log(`  Plan ID: ${devPlan._id}`);
    console.log(`  Daily Limit: Unlimited`);
    console.log(`  Monthly Limit: Unlimited`);
    console.log(`  Bulk Send Limit: Unlimited`);

    // Remove any existing active subscriptions for this user
    console.log('\nRemoving existing active subscriptions...');
    await db.collection('subscriptions').updateMany(
      { user: user._id, isActive: true },
      { $set: { isActive: false, updatedAt: new Date() } }
    );

    // Create or update subscription
    console.log('Creating dev subscription...');
    const existingSub = await db.collection('subscriptions').findOne({
      user: user._id,
      plan: devPlan._id
    });

    if (existingSub) {
      await db.collection('subscriptions').updateOne(
        { _id: existingSub._id },
        {
          $set: {
            status: 'active',
            isActive: true,
            subscriptionStartDate: new Date(),
            currentPeriodStart: new Date(),
            // Set to 100 years from now (essentially unlimited)
            currentPeriodEnd: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
            updatedAt: new Date()
          }
        }
      );
      console.log('✓ Subscription updated successfully!');
    } else {
      await db.collection('subscriptions').insertOne({
        user: user._id,
        plan: devPlan._id,
        status: 'active',
        isActive: true,
        subscriptionStartDate: new Date(),
        currentPeriodStart: new Date(),
        // Set to 100 years from now (essentially unlimited)
        currentPeriodEnd: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log('✓ Subscription created successfully!');
    }

    console.log('\n===========================================');
    console.log('✓ Setup completed successfully!');
    console.log('===========================================');
    console.log('\nYou can now login with:');
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}`);
    console.log('\nYour account has unlimited access for testing!');

  } catch (error) {
    console.error('\n===========================================');
    console.error('Error:', error.message);
    console.error('===========================================');
    console.error(error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

createUser().catch(console.error);
