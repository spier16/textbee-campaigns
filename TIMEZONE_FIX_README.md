# Campaign Timezone Architecture

## Overview

Campaign sending windows are **stored in local timezone** and **converted to UTC at runtime** on the backend. This architecture preserves user intent across Daylight Saving Time (DST) transitions.

---

## Why Local Time Storage?

### The DST Problem with UTC Storage

When times are stored in UTC, user intent breaks during DST transitions:

**Example:**
- User sets: "Send 9 AM - 8 PM Chicago time every Friday"
- Before DST (CST, UTC-6): 9 AM = 15:00 UTC ✓
- After DST (CDT, UTC-5): 9 AM = 14:00 UTC
- **But we stored 15:00 UTC**, which is now 10 AM local time ✗

**User intent broken**: They wanted "9 AM local time" but get "10 AM local time" after DST.

### The Solution: Local Time + Runtime Conversion

By storing times in local timezone:
- Times represent what the user sees: "9:00 AM" stays "9:00 AM"
- Backend converts to UTC at runtime using current DST rules
- User intent preserved: "9 AM local" remains "9 AM local" year-round

---

## Architecture

### Frontend (web/)

**Responsibility**: Send all times in **LOCAL timezone** (no conversion needed).

**Files Modified:**
- [web/components/campaigns/utils/window-generator.ts](web/components/campaigns/utils/window-generator.ts)
  - Removed all UTC conversion logic
  - All `generate*` functions return local times as-is
  - Added `[TIMEZONE DEBUG]` logging for testing

**Example:**
```typescript
// User selects: 9:00 AM - 8:00 PM Chicago time
// Frontend sends to API:
{
  startTime: "09:00",
  endTime: "20:00",
  timezone: "America/Chicago"
}
```

### Backend (api/)

**Responsibility**: Convert local times to UTC **at runtime** when scheduling/validating messages.

**Files Modified:**

1. **[api/src/campaigns/campaigns.service.ts](api/src/campaigns/campaigns.service.ts)**
   - Added `convertLocalWindowToUTC()` utility function
   - Uses `fromZonedTime()` from date-fns-tz
   - Removed `validateSendingWindowsAreUTC()` validation

2. **[api/src/campaigns/queue/campaign-queue.processor.ts](api/src/campaigns/queue/campaign-queue.processor.ts)**
   - Updated `calculateInitialNotBefore()` to convert local → UTC
   - Sets `not_before` as UTC timestamp for efficient comparison

3. **[api/src/gateway/queue/device-worker.service.ts](api/src/gateway/queue/device-worker.service.ts)**
   - Updated `isInSendingWindow()` to convert local → UTC at claim time
   - Updated `getNextSendingWindow()` to convert local → UTC
   - Ensures messages only send during valid windows

**Conversion Logic:**
```typescript
import { fromZonedTime } from 'date-fns-tz'

// Local time: "2025-01-15" "09:00" in "America/Chicago"
const localStr = `${date}T${time}:00`
const utcDate = fromZonedTime(localStr, timezone)
// Result: Date object in UTC (handles DST automatically)
```

---

## Database Schema

### Campaign Schema

```typescript
{
  timezone: string,              // e.g., "America/Chicago"
  campaignStartDate: string,     // LOCAL date: "2025-01-15"
  campaignEndDate: string,       // LOCAL date: "2025-01-20"
  sendingWindows: [
    {
      startDate: string,         // LOCAL date: "2025-01-15"
      startTime: string,         // LOCAL time: "09:00"
      endDate: string,           // LOCAL date: "2025-01-15"
      endTime: string            // LOCAL time: "20:00"
    }
  ],
  weekdayWindows: {
    monday: [
      { startTime: "09:00", endTime: "17:00" }  // LOCAL times
    ],
    // ...
  }
}
```

### Message Schema

```typescript
{
  not_before: Date,  // UTC timestamp (converted from local at scheduling time)
  queuedAt: Date,    // UTC timestamp
  // ...
}
```

**Key Points:**
- `sendingWindows` are in **local timezone**
- `not_before` is in **UTC** (converted at runtime)
- This allows fast UTC-based comparisons while preserving user intent

---

## Message Flow

### 1. Campaign Creation
```
User sets windows → Frontend sends local times → Backend stores local times
                                                    ↓
                                             Database: "09:00" (local)
```

### 2. Campaign Start
```
Backend reads windows → Converts to UTC → Sets not_before
                        (runtime)          ↓
                                    Message.not_before = UTC timestamp
```

### 3. Message Claiming
```
Device worker claims message → Validates sending window
                               (converts local → UTC at claim time)
                               ↓
                        Checks: now >= windowStart && now <= windowEnd
```

### 4. DST Transition
```
Before DST: "09:00" local → 15:00 UTC (offset -6)
After DST:  "09:00" local → 14:00 UTC (offset -5)
            ↑
        Same local time = User intent preserved!
```

---

## Testing

### Frontend Test File

[web/components/campaigns/utils/__tests__/window-generator.test.ts](web/components/campaigns/utils/__tests__/window-generator.test.ts)

Run tests:
```bash
cd web
npx ts-node -r tsconfig-paths/register components/campaigns/utils/__tests__/window-generator.test.ts
```

**Test Cases:**
1. NOW mode - Verify local times stored as-is
2. LATER mode - Verify local times stored as-is
3. WINDOWS mode - Verify custom windows stored as-is
4. WEEKDAY mode - Verify weekday patterns stored as-is
5. UTC timezone - Verify local time (happens to be UTC)
6. **DST transition** - Verify "9 AM" stays "9 AM" across DST

Expected output:
```
✓ ALL TESTS PASSED ✓
Local timezone storage is working correctly!
Backend will handle conversion to UTC at runtime.
```

### Manual Testing

1. **Create test campaign:**
   ```
   Schedule: Fridays, 9:00 AM - 8:00 PM
   Timezone: America/Chicago
   ```

2. **Verify database:**
   ```javascript
   db.campaigns.findOne({ name: "Test Campaign" })
   // sendingWindows should show:
   // startTime: "09:00", endTime: "20:00"  (LOCAL TIME)
   ```

3. **Check backend logs:**
   ```
   [TIMEZONE] Converting window: 2025-11-07 09:00 - 2025-11-07 20:00 (America/Chicago)
   -> 2025-11-07T15:00:00.000Z - 2025-11-08T02:00:00.000Z (UTC)
   ```

4. **Verify messages:**
   ```javascript
   db.campaignMessages.findOne({ campaign: campaignId })
   // not_before should be UTC timestamp (e.g., 2025-11-07T15:00:00.000Z)
   ```

---

## Deployment

### Dependencies

Already installed (from previous session):
- **Frontend**: `date-fns-tz@^3.0.0` (no longer used, but harmless)
- **Backend**: `date-fns-tz@^3.0.0` (used for runtime conversion)

### Deployment Steps

#### 1. Development
```bash
# Frontend
cd web
npm run dev

# Backend
cd api
npm run start:dev
```

#### 2. Docker (Production)
```bash
# Build and deploy
docker-compose -f docker-compose.prebuilt.yaml down
docker-compose -f docker-compose.prebuilt.yaml build
docker-compose -f docker-compose.prebuilt.yaml up -d

# Check logs
docker logs textbee-api --tail 100 -f
docker logs textbee-web --tail 100 -f
```

#### 3. Verify Deployment

1. Create new campaign with local times
2. Check database shows local times (not UTC)
3. Check backend logs show runtime conversion
4. Verify messages send at correct local times

---

## Key Differences from Previous Approach

| Aspect | Old Approach (UTC Storage) | New Approach (Local Storage) |
|--------|---------------------------|------------------------------|
| **Storage** | UTC times in DB | Local times in DB |
| **Frontend** | Convert local → UTC | Send local as-is |
| **Backend** | Assume UTC, use directly | Convert local → UTC at runtime |
| **DST Behavior** | Times shift ❌ | Times preserved ✓ |
| **not_before** | UTC (from frontend) | UTC (from backend conversion) |
| **User Intent** | Broken during DST | Preserved across DST |

---

## Logging

### Frontend Logs (Browser Console)

```
[TIMEZONE DEBUG] WEEKDAY mode: Generating windows for 2025-11-06 to 2025-12-06 (America/Chicago - stored as local time)
[TIMEZONE DEBUG] WEEKDAY mode: Generated 5 windows
```

### Backend Logs

```
[TIMEZONE] Converting window: 2025-11-07 09:00 - 2025-11-07 20:00 (America/Chicago) -> 2025-11-07T15:00:00.000Z - 2025-11-08T02:00:00.000Z (UTC)
[TIMEZONE] In sending window: 2025-11-07 09:00 - 2025-11-07 20:00 (America/Chicago) = 2025-11-07T15:00:00.000Z - 2025-11-08T02:00:00.000Z (UTC)
[TIMEZONE] Next window starts at 2025-11-14T15:00:00.000Z (UTC)
```

**Log Cleanup:** The `[TIMEZONE DEBUG]` logs can be removed after testing is complete.

---

## Edge Cases

### 1. DST "Spring Forward"
**Scenario**: 2 AM becomes 3 AM (1 hour lost)

If user schedules for 2:30 AM during transition:
- `fromZonedTime()` handles this gracefully
- Time is interpreted as "after the gap" (3:30 AM actual)

### 2. DST "Fall Back"
**Scenario**: 2 AM happens twice (1 hour gained)

If user schedules for 1:30 AM during transition:
- First occurrence (before DST) is used
- Ambiguity resolved by date-fns-tz

### 3. Campaign Spanning DST
**Scenario**: Campaign runs both before and after DST change

- Each window converted independently at runtime
- Messages before DST use old offset
- Messages after DST use new offset
- **User sees consistent local times**

### 4. Timezone Changes
If campaign timezone is changed:
- Existing windows are re-interpreted in new timezone
- May result in different UTC times
- **Recommendation**: Don't allow timezone changes for running campaigns

---

## Rollback Plan

If issues occur:

### 1. Code Rollback
```bash
git revert <commit-hash>
docker-compose -f docker-compose.prebuilt.yaml build
docker-compose -f docker-compose.prebuilt.yaml up -d
```

### 2. Data Considerations
- **Good news**: Existing production campaigns already in local time (never deployed UTC version)
- No data migration needed
- No window restoration required

---

## Files Modified Summary

### Frontend
- ✅ [web/components/campaigns/utils/window-generator.ts](web/components/campaigns/utils/window-generator.ts)
- ✅ [web/components/campaigns/utils/__tests__/window-generator.test.ts](web/components/campaigns/utils/__tests__/window-generator.test.ts)

### Backend
- ✅ [api/src/campaigns/campaigns.service.ts](api/src/campaigns/campaigns.service.ts)
- ✅ [api/src/campaigns/queue/campaign-queue.processor.ts](api/src/campaigns/queue/campaign-queue.processor.ts)
- ✅ [api/src/gateway/queue/device-worker.service.ts](api/src/gateway/queue/device-worker.service.ts)
- ✅ [api/src/app.module.ts](api/src/app.module.ts)
- ❌ Deleted: `api/src/migrations/fix-campaign-timezones.migration.ts`
- ❌ Deleted: `api/src/run-timezone-fix-migration.ts`

### Documentation
- ✅ [TIMEZONE_FIX_README.md](TIMEZONE_FIX_README.md) (this file)

---

## Troubleshooting

### Problem: Messages sending at wrong times

**Check:**
1. Frontend console: Are local times being sent?
   ```
   [TIMEZONE DEBUG] WEEKDAY mode: ... (stored as local time)
   ```

2. Backend logs: Is conversion happening?
   ```
   [TIMEZONE] Converting window: 09:00 (America/Chicago) -> 15:00:00.000Z (UTC)
   ```

3. Database: Are times in local format?
   ```javascript
   db.campaigns.findOne()
   // sendingWindows should show local times like "09:00", not UTC like "15:00"
   ```

### Problem: Conversion errors in logs

**Cause**: Invalid timezone or malformed time strings

**Fix**: Verify campaign timezone is valid IANA identifier (e.g., "America/Chicago", not "CST")

### Problem: Messages not sending after DST change

**Cause**: Cached window calculations (unlikely with runtime conversion)

**Fix**: Restart backend or wait for next worker cycle

---

## Future Improvements

1. **Remove debug logging** after deployment stabilizes
2. **Add UI indicator** showing both local and UTC times to users
3. **Timezone validation** on frontend (dropdown of valid IANA timezones)
4. **Campaign timezone lock** preventing timezone changes for running campaigns
5. **DST notification** warning users about upcoming DST transitions

---

## Summary

✅ **Frontend** sends local times without conversion
✅ **Backend** converts local → UTC at runtime
✅ **Database** stores local times for human readability
✅ **Message scheduling** uses UTC timestamps for performance
✅ **DST handling** preserves user intent across transitions

**The system now correctly handles timezones while preserving user intent!**
