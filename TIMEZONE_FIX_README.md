# Campaign Timezone Conversion Bug Fix

## Problem Summary

A critical timezone conversion bug was discovered in the campaign scheduling system:

- **Root Cause**: Frontend's `convertToUTC()` function in `web/components/campaigns/utils/window-generator.ts` was **not actually converting** local times to UTC
- **Impact**: Campaign sending windows were stored in **local timezone** instead of UTC
- **Backend Behavior**: Backend appends `'Z'` to times, **assuming they're already in UTC**
- **Result**: Messages were being sent **5-6 hours earlier** than intended

### Example

| User Intent | What Was Stored | Backend Interpretation | Actual Send Time |
|-------------|----------------|----------------------|------------------|
| 9 AM - 8 PM Chicago | `"09:00"` - `"20:00"` | 9 AM - 8 PM **UTC** | **3 AM - 2 PM Chicago** |

---

## Affected Schedule Modes

All 4 schedule modes were affected:

1. ✅ **NOW** - Immediate sending
2. ✅ **LATER** - Scheduled start time
3. ✅ **WINDOWS** - Custom sending windows
4. ✅ **WEEKDAY** - Weekday-based patterns

---

## Fix Applied

### 1. Frontend Fix (web/components/campaigns/utils/window-generator.ts)

**Before (Broken)**:
```typescript
function convertToUTC(dateStr: string, timeStr: string, timezone: string): string {
  // Broken logic using Intl.DateTimeFormat incorrectly
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }))
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offset = tzDate.getTime() - utcDate.getTime()
  const correctedDate = new Date(date.getTime() - offset) // Wrong!
  return correctedDate.toISOString().slice(0, 19).replace('T', ' ')
}
```

**After (Fixed)**:
```typescript
import { zonedTimeToUtc, format } from 'date-fns-tz'

function convertToUTC(dateStr: string, timeStr: string, timezone: string): string {
  const localDateTimeStr = `${dateStr}T${timeStr}:00`
  const utcDate = zonedTimeToUtc(localDateTimeStr, timezone)
  return format(utcDate, 'yyyy-MM-dd HH:mm', { timeZone: 'UTC' })
}
```

### 2. Backend Validation (api/src/campaigns/campaigns.service.ts)

Added validation in `createCampaign()` to detect if times appear to be in local TZ:

```typescript
private validateSendingWindowsAreUTC(sendingWindows: any[], timezone: string): void {
  // Heuristic checks to detect if times weren't converted to UTC
  // Logs warnings if suspicious patterns detected
}
```

### 3. Migration Script for Production Data

Created `api/src/migrations/fix-campaign-timezones.migration.ts`:

- Converts existing campaign windows from local TZ → UTC
- Only processes active campaigns (RUNNING, SCHEDULED, PAUSED)
- Backs up original windows before conversion
- Supports dry-run mode for safety

---

## Deployment Steps

### Step 1: Install Dependencies

```bash
# Frontend
cd web
npm install

# Backend
cd ../api
npm install
```

### Step 2: Test the Fix (Optional but Recommended)

Run the frontend timezone conversion tests:

```bash
cd web
npx ts-node -r tsconfig-paths/register components/campaigns/utils/__tests__/window-generator.test.ts
```

Expected output:
```
✓ All tests should pass
✓ Timezone conversion is working correctly!
```

### Step 3: Fix Existing Production Campaigns

**IMPORTANT**: This migration will modify your production database. Run dry-run first!

#### 3a. Dry Run (Preview Changes)

```bash
cd api
npx ts-node src/run-timezone-fix-migration.ts
```

This shows what will be changed **without** modifying the database.

Example output:
```
Campaign 690a508c634db9dc3085a180 (Chase Solar) - America/Chicago:
  Window 1: 2025-11-04 09:00 → 2025-11-04 15:00 (UTC)
           2025-11-04 20:00 → 2025-11-05 02:00 (UTC)
  ... and 26 more windows

Timezone fix migration completed: 2 fixed, 0 skipped, 0 errors
```

#### 3b. Apply Fix (LIVE)

After verifying the dry-run output, apply the changes:

```bash
npx ts-node src/run-timezone-fix-migration.ts --apply
```

**Recovery**: If something goes wrong, original windows are backed up in:
```
campaign.metadata.originalWindowsBeforeTimezoneFix
```

### Step 4: Deploy Code Changes

#### Docker Deployment (Production)

```bash
# Build and restart services
docker-compose -f docker-compose.prebuilt.yaml down
docker-compose -f docker-compose.prebuilt.yaml build
docker-compose -f docker-compose.prebuilt.yaml up -d

# Check logs
docker logs textbee-api --tail 100 -f
docker logs textbee-web --tail 100 -f
```

#### Development

```bash
# Install dependencies
npm install  # in both web/ and api/

# Restart dev servers
npm run dev  # in both web/ and api/
```

### Step 5: Verify Fix

1. **Create a new campaign** with specific time windows (e.g., 9 AM - 8 PM)
2. **Check the database**:
   ```bash
   docker exec -it textbee-db mongosh -u adminUser -p adminPassword --authenticationDatabase admin
   use textbee
   db.campaigns.findOne({ name: "Your Test Campaign" })
   ```
3. **Verify times are in UTC**:
   - For Chicago (UTC-6): 9 AM local → 15:00 UTC ✓
   - For LA (UTC-8): 9 AM local → 17:00 UTC ✓

4. **Monitor backend logs** for validation warnings:
   ```bash
   docker logs textbee-api --tail 100 -f | grep "⚠️"
   ```

---

## Files Modified

### Frontend
- ✅ `web/package.json` - Added date-fns-tz
- ✅ `web/components/campaigns/utils/window-generator.ts` - Fixed convertToUTC()
- ✅ `web/components/campaigns/utils/__tests__/window-generator.test.ts` - New test file

### Backend
- ✅ `api/package.json` - Added date-fns-tz
- ✅ `api/src/campaigns/campaigns.service.ts` - Added validation
- ✅ `api/src/migrations/fix-campaign-timezones.migration.ts` - New migration
- ✅ `api/src/run-timezone-fix-migration.ts` - New runner script
- ✅ `api/src/app.module.ts` - Registered migration

---

## Verification Checklist

- [ ] Dependencies installed (`npm install` in web/ and api/)
- [ ] Tests pass (run window-generator.test.ts)
- [ ] Migration dry-run successful (shows expected changes)
- [ ] Migration applied (--apply flag)
- [ ] Code deployed to production
- [ ] New campaign created with correct UTC times in DB
- [ ] Backend validation logs reviewed (no warnings for new campaigns)
- [ ] Existing campaigns sending at correct times

---

## Rollback Plan

If issues occur:

1. **Revert code changes**:
   ```bash
   git revert <commit-hash>
   ```

2. **Restore original windows** (if migration was applied):
   ```javascript
   // In MongoDB
   db.campaigns.find({
     'metadata.timezoneFixAppliedAt': { $exists: true }
   }).forEach(campaign => {
     db.campaigns.updateOne(
       { _id: campaign._id },
       {
         $set: {
           sendingWindows: campaign.metadata.originalWindowsBeforeTimezoneFix
         },
         $unset: {
           'metadata.originalWindowsBeforeTimezoneFix': '',
           'metadata.timezoneFixAppliedAt': ''
         }
       }
     )
   })
   ```

3. **Redeploy previous version**

---

## Technical Details

### Timezone Conversion Logic

The fix uses `date-fns-tz` library for proper timezone handling:

```typescript
import { zonedTimeToUtc } from 'date-fns-tz'

// Input: "2025-01-15" "09:00" "America/Chicago"
// Process:
//   1. Construct: "2025-01-15T09:00:00"
//   2. Interpret as: 9 AM in America/Chicago timezone
//   3. Convert to UTC: Adds 6 hours (CST) or 5 hours (CDT)
//   4. Output: "2025-01-15 15:00" (UTC)
```

### DST Handling

The library automatically handles Daylight Saving Time transitions:

- **Standard Time (CST)**: UTC-6 (9 AM → 15:00 UTC)
- **Daylight Time (CDT)**: UTC-5 (9 AM → 14:00 UTC)

### Backend Interpretation

The backend expects UTC and appends 'Z' suffix:

```typescript
const windowStart = new Date(`${window.startDate}T${window.startTime}:00Z`)
//                                                                     ^^^ UTC indicator
```

---

## Future Improvements

1. **Add proper test framework** (Jest/Vitest) to web project
2. **Unit tests** for all schedule mode conversions
3. **E2E tests** for campaign creation flow
4. **Monitoring** for timezone conversion accuracy
5. **UI indicator** showing both local and UTC times to users

---

## Questions or Issues?

If you encounter any problems:

1. Check logs: `docker logs textbee-api --tail 100`
2. Verify database: `db.campaigns.find().pretty()`
3. Review validation warnings in backend logs
4. Contact development team with campaign ID and timezone details

---

## Summary

✅ **Frontend** now properly converts local times to UTC using date-fns-tz
✅ **Backend** validates incoming times with heuristic checks
✅ **Migration** fixes existing production campaigns
✅ **Tests** verify conversion accuracy across timezones and DST

**Next campaigns will send at the correct times!**
