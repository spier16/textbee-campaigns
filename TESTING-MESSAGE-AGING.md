# Testing Message Aging Behavior

This guide provides multiple ways to test the 24-hour message aging behavior without waiting 24 hours.

## Method 1: Test Usage Plan (RECOMMENDED) ✅

The fastest and safest way to test the aging behavior.

### Steps:

1. **Create the test plan:**
   ```bash
   node create-test-usage-plan.js YOUR_API_KEY
   ```
   This creates a usage plan with a 5-minute rolling window instead of 24 hours.

2. **Assign a device:**
   - Go to your dashboard
   - Find a test device
   - Assign it to the "TEST - 5 Minute Window" plan

3. **Test the aging:**
   - Send campaign messages from that device until it exceeds the limit (5 messages for tier 1)
   - Observe that the counter increments
   - Wait 5 minutes
   - Check the device stats - the counter should drop back to zero

4. **Clean up:**
   - Delete the test usage plan
   - Reassign your device to its original plan

### Why this works:
The counter calculation in [device-usage-calculator.service.ts:44](api/src/gateway/services/device-usage-calculator.service.ts#L44) uses the `usageWindowMinutes` from the usage plan:

```typescript
const cutoffTime = new Date(Date.now() - windowMinutes * 60 * 1000)
```

By setting `windowMinutes: 5`, messages older than 5 minutes are automatically excluded from the count.

---

## Method 2: Manual Database Time Manipulation

If you're comfortable with MongoDB, you can manually age the messages.

### Steps:

1. **Send campaign messages** to increment the counter

2. **Connect to MongoDB** and run:
   ```javascript
   // Make all campaign messages appear 25 hours old
   db.sms.updateMany(
     { campaignId: { $exists: true, $ne: null } },
     { $set: { sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } }
   )
   ```

3. **Refresh your dashboard** or trigger a recalculation

4. **Verify** the counter drops to zero

### Pros:
- Very fast (immediate)
- No code changes needed

### Cons:
- Modifies your database data
- Need to be careful with the query

---

## Method 3: Environment Variable Override

Add a test environment variable to override the window duration.

### Changes needed:

1. **Modify the service** - Edit [device-usage-calculator.service.ts:106](api/src/gateway/services/device-usage-calculator.service.ts#L106):
   ```typescript
   const windowMinutes =
     (process.env.TEST_WINDOW_MINUTES && parseInt(process.env.TEST_WINDOW_MINUTES)) ||
     usagePlan.usageWindowMinutes ||
     1440
   ```

2. **Set environment variable** in `.env`:
   ```bash
   TEST_WINDOW_MINUTES=5
   ```

3. **Restart the API server**

4. **Test the aging** (wait 5 minutes instead of 24 hours)

5. **Clean up** - Remove the environment variable and restart

### Pros:
- Clean, doesn't modify production data
- Easy to toggle on/off

### Cons:
- Requires code change
- Need to restart server

---

## Method 4: Direct MongoDB Query Test

Test the query logic directly in MongoDB without creating plans.

### Query to test:

```javascript
// This is the exact query used by the service
// Replace DEVICE_ID with your device's ID
const deviceId = ObjectId('YOUR_DEVICE_ID');
const cutoffTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes

db.sms.find({
  device: deviceId,
  sentAt: { $gte: cutoffTime },
  status: { $in: ['sent', 'delivered'] },
  campaignId: { $exists: true, $ne: null }
}).count();
```

This lets you see exactly which messages would be counted with different window sizes.

---

## Understanding the Code

The message counting happens in [device-usage-calculator.service.ts:39-70](api/src/gateway/services/device-usage-calculator.service.ts#L39-L70):

```typescript
async calculateMessagesInWindow(
  deviceId: string | Types.ObjectId,
  windowMinutes: number,
  campaignOnly: boolean = true,
): Promise<{ count: number; oldestMessageTime: Date | null }> {
  // Calculate cutoff time
  const cutoffTime = new Date(Date.now() - windowMinutes * 60 * 1000)

  const query: any = {
    device: deviceId,
    sentAt: { $gte: cutoffTime }, // Only messages after cutoff
    status: { $in: ['sent', 'delivered'] },
  }

  if (campaignOnly) {
    query.campaignId = { $exists: true, $ne: null } // Only campaign messages
  }

  // Count messages
  const count = await this.smsModel.countDocuments(query).exec()

  // ... return count
}
```

**Key points:**
- Only messages with `sentAt >= cutoffTime` are counted
- Only messages with status 'sent' or 'delivered' are counted
- Only messages with a `campaignId` are counted (when `campaignOnly: true`)
- Manual messages (no `campaignId`) are excluded

---

## Recommended Testing Flow

1. ✅ Use Method 1 (Test Usage Plan) - it's the cleanest and fastest
2. Send 5 campaign messages to exceed tier 1 limit
3. Verify counter shows 5 messages
4. Wait 5 minutes
5. Verify counter shows 0 messages
6. Done! Delete the test plan

This tests the exact same code path as production, just with a shorter window.
