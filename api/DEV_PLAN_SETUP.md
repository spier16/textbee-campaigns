# Development Plan Setup

This document explains how to set up the 'dev' plan for unlimited access during development and testing.

## What is the 'dev' Plan?

The 'dev' plan is a special billing plan designed for development and testing environments. It provides:

- **Unlimited daily SMS limit** (dailyLimit: -1)
- **Unlimited monthly SMS limit** (monthlyLimit: -1)
- **Unlimited bulk send limit** (bulkSendLimit: -1)
- **$0 pricing** (free for development)

## How to Create the 'dev' Plan

Run the following command in the `api` directory:

```bash
npm run seed:dev-plan
```

Or directly with ts-node:

```bash
npx ts-node -r tsconfig-paths/register src/seed-dev-plan.ts
```

### Expected Output

**If the plan doesn't exist yet:**
```
===========================================
Seeding Dev Plan
===========================================

✓ Dev plan created successfully!
  Plan ID: 507f1f77bcf86cd799439011
  Name: dev
  Daily Limit: Unlimited
  Monthly Limit: Unlimited
  Bulk Send Limit: Unlimited
  Monthly Price: $0

===========================================
Seeding completed successfully!
===========================================
```

**If the plan already exists:**
```
===========================================
Seeding Dev Plan
===========================================

✓ Dev plan already exists
  Plan ID: 507f1f77bcf86cd799439011
  Name: dev
  Daily Limit: Unlimited
  Monthly Limit: Unlimited
  Bulk Send Limit: Unlimited

===========================================
Seeding completed successfully!
===========================================
```

## How to Assign the 'dev' Plan to a User

### Option 1: Update via MongoDB

Connect to your MongoDB database and update the user's subscription:

```javascript
// Create a subscription with the dev plan
db.subscriptions.updateOne(
  { user: ObjectId("YOUR_USER_ID") },
  {
    $set: {
      plan: ObjectId("DEV_PLAN_ID_FROM_ABOVE"),
      isActive: true,
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date("2099-12-31"),
      subscriptionStartDate: new Date(),
      amount: 0,
      currency: "USD",
      recurringInterval: "month"
    }
  },
  { upsert: true }
)
```

### Option 2: Create via API

You can also use the billing service's `switchPlan` method programmatically.

## How It Works

The billing service checks for the 'dev' plan in the `canPerformAction` method:

```typescript
// Allow unlimited access for dev and custom plans
if (plan.name === 'dev' || plan.name?.startsWith('custom')) {
  return true
}
```

When a user with the 'dev' plan tries to send SMS messages, the billing service will:
1. Find the user's active subscription
2. Check if the plan name is 'dev'
3. Immediately return `true` (allow the action) without checking any limits

## Troubleshooting

### Error: "No billing plan found"

This error occurs when:
1. The 'dev' plan hasn't been created in the database
2. The user has no active subscription

**Solution:** Run `npm run seed:dev-plan` to create the plan.

### Messages still not sending

Make sure:
1. The 'dev' plan exists in the database
2. The user has an active subscription assigned to the 'dev' plan
3. The user's email is verified (required by billing service)
4. The user is not banned

## Related Files

- [api/src/seed-dev-plan.ts](./src/seed-dev-plan.ts) - Script to seed the dev plan
- [api/src/billing/billing.service.ts](./src/billing/billing.service.ts) - Billing logic
- [api/src/billing/schemas/plan.schema.ts](./src/billing/schemas/plan.schema.ts) - Plan schema
