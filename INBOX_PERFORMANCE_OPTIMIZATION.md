# Inbox Performance Optimization Guide

## Problem Summary

The Inbox page (`/dashboard/inbox`) times out on the VPS (2 GB RAM, 2 vCPUs) when total message count exceeds ~1500 messages. The `conversations` endpoint takes 1-2 minutes and eventually returns 504 Gateway Timeout.

### Root Causes

1. **Full Collection Scan**: The `getConversations()` aggregation loads ALL messages into memory before filtering
2. **N+1 Queries**: `getConversationCounts()` executes 2 database queries per conversation (100+ conversations = 200+ queries)
3. **Suboptimal Indexes**: Missing compound indexes for the aggregation pipeline's $match and $group stages
4. **Campaign Metadata Lookup**: Additional query for each conversation missing campaign information

See [users.service.ts:588-1015](api/src/users/users.service.ts#L588-L1015) for the problematic code.

---

## Optimization Roadmap

### ✅ Level 1: Index Optimization (IMMEDIATE - Do This First)

**Impact**: Should reduce query time from minutes to seconds
**Effort**: 5 minutes
**Risk**: Low (indexes are additive, don't break existing queries)

#### What This Fixes
- Enables MongoDB to use indexes instead of collection scans
- Speeds up conversation grouping by device/sender/recipient
- Optimizes unseen message count calculations

#### How to Apply

**Local Testing:**
```bash
cd api
npm run migration:add-conversation-indexes
```

**Production (VPS):**
```bash
# SSH into your VPS
cd /path/to/textbee-campaigns/api

# Make sure dependencies are installed
npm install

# Run the migration (uses background index building to avoid blocking)
npm run migration:add-conversation-indexes
```

The migration adds these indexes:
- `{ device: 1, sender: 1, receivedAt: -1 }` - conversation grouping for incoming messages
- `{ device: 1, recipient: 1, requestedAt: -1 }` - conversation grouping for outgoing messages
- `{ device: 1, sender: 1, receivedAt: 1 }` - unseen count queries
- `{ device: 1, recipient: 1, campaignId: 1, requestedAt: 1 }` - first campaign lookup

#### Expected Results
- Inbox load time: **1-2 minutes → 5-15 seconds**
- `conversations` endpoint: **504 timeout → 200 OK**

#### Verification
After applying:
1. Restart your API server on the VPS
2. Clear browser cache and reload `/dashboard/inbox`
3. Check Network tab - `conversations` should complete in <30 seconds

---

### 🟡 Level 2: Query Optimization (IF STILL SLOW)

**Impact**: 5-15 seconds → <2 seconds
**Effort**: 2-4 hours
**Risk**: Medium (requires code changes and testing)

#### Code Changes Needed

**2.1: Fix `getConversationCounts()` N+1 Problem**

Replace the `Promise.all()` loop ([users.service.ts:953-990](api/src/users/users.service.ts#L953-L990)) with a single aggregation:

```typescript
// BEFORE: N+1 queries (2 queries per conversation)
const processedConversations = await Promise.all(
  deduplicatedConversations.map(async (conv) => {
    const unseenCount = await this.smsModel.countDocuments({ ... })
    const hasReceivedMessage = await this.smsModel.countDocuments({ ... })
  })
)

// AFTER: 1 aggregation query for all conversations
const [unseenCountsMap, hasReceivedMap] = await Promise.all([
  // Batch unseen counts
  this.smsModel.aggregate([
    { $match: { device: { $in: deviceIds }, sender: { $in: phoneNumbers }, ... } },
    { $group: { _id: '$sender', unseenCount: { $sum: 1 } } }
  ]),
  // Batch received message checks
  this.smsModel.aggregate([
    { $match: { device: { $in: deviceIds }, sender: { $in: phoneNumbers } } },
    { $group: { _id: '$sender', hasReceived: { $sum: 1 } } }
  ])
])
```

**2.2: Add Limit to Aggregation Pipeline**

Modify [users.service.ts:628](api/src/users/users.service.ts#L628) to paginate at the MongoDB level:

```typescript
// BEFORE: Load ALL conversations, paginate in JS
const allConversations = await this.smsModel.aggregate(pipeline)
// ... then filter/sort/paginate in JavaScript

// AFTER: Paginate in MongoDB
pipeline.push({ $skip: skip })
pipeline.push({ $limit: limit * 2 }) // 2x buffer for deduplication
const conversations = await this.smsModel.aggregate(pipeline)
```

**2.3: Lazy Load Campaign Metadata**

Move `checkAndPopulateFirstCampaignInfo()` to a background job instead of synchronous:
- Only run on page load for the current page's conversations
- Or: Pre-calculate via a nightly cron job

---

### 🔴 Level 3: Architectural Redesign (ONLY IF NEEDED)

**Impact**: <2 seconds → <500ms
**Effort**: 1-2 days
**Risk**: High (database schema changes)

#### Approach: Materialized Conversation View

Create a denormalized `conversations` collection that's updated in real-time:

**Schema:**
```typescript
{
  userId: ObjectId,
  deviceId: ObjectId,
  normalizedPhoneNumber: string,
  lastMessageDate: Date,
  lastMessage: string,
  lastMessageIsIncoming: boolean,
  messageCount: number,
  unseenCount: number,
  hasReceivedMessage: boolean,
  // ... other metadata
}
```

**Update Strategy:**
- Use MongoDB Change Streams to watch the `sms` collection
- On new message: Update the corresponding conversation document
- Query the `conversations` collection directly (no aggregation needed)

**Benefits:**
- O(1) conversation lookups instead of O(n) aggregations
- Scales to millions of messages
- Conversation counts become simple `.countDocuments()` queries

**Tradeoffs:**
- Adds complexity (need to handle edge cases, eventual consistency)
- More storage (denormalized data)
- Requires testing to ensure sync stays accurate

---

## Monitoring & Debugging

### Check MongoDB Query Performance

SSH into your VPS and connect to MongoDB:

```bash
mongosh "mongodb://adminUser:adminPassword@localhost:27018/textbee?authSource=admin"
```

Enable profiling to see slow queries:
```javascript
// Log all queries taking > 100ms
db.setProfilingLevel(1, { slowms: 100 })

// View slow queries
db.system.profile.find().sort({ ts: -1 }).limit(10).pretty()

// Check index usage for a query
db.sms.explain("executionStats").aggregate([
  { $match: { device: ObjectId("...") } },
  // ... rest of pipeline
])
```

### Check Current Indexes

```javascript
db.sms.getIndexes()
```

You should see the new indexes from Level 1 migration.

---

## Testing the Seed Script

To test performance improvements with the 1000 test messages:

```bash
# Generate 1000 test messages across 14 days
npm run seed:random-messages 1000 14

# Test locally first
# Visit http://localhost:3000/dashboard/inbox

# If working, deploy to VPS and test there
```

---

## Next Steps

1. **Run Level 1 migration** on both local and VPS
2. **Test Inbox load time** - should see immediate improvement
3. **If still slow**, implement Level 2 query optimizations
4. **If < 2 seconds is acceptable**, stop here
5. **If need <500ms**, consider Level 3 architectural redesign

---

## Questions?

- Check MongoDB logs: `/var/log/mongodb/mongod.log`
- Check API logs: `pm2 logs` or wherever your NestJS logs go
- Use Chrome DevTools Network tab to see exact request timing breakdown
