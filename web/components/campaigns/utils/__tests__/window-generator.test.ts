/**
 * Manual test file for window-generator local timezone storage
 *
 * This file verifies that campaign windows are stored in LOCAL timezone (not UTC).
 * The backend will handle conversion to UTC at runtime.
 *
 * Usage: npx ts-node -r tsconfig-paths/register web/components/campaigns/utils/__tests__/window-generator.test.ts
 */

import { generateSendingWindows } from '../window-generator'
import { CreateCampaignData } from '../../types/campaign.types'

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function assert(condition: boolean, message: string) {
  if (condition) {
    log(`✓ ${message}`, 'green')
  } else {
    log(`✗ ${message}`, 'red')
    throw new Error(`Assertion failed: ${message}`)
  }
}

// Test 1: NOW mode - America/Chicago timezone
function testNowModeChicago() {
  log('\n=== Test 1: NOW mode - America/Chicago ===', 'cyan')

  const campaignData: CreateCampaignData = {
    scheduleType: 'now',
    campaignStartDate: '2025-01-15',
    campaignEndDate: '2025-01-16',
    timezone: 'America/Chicago',
  } as CreateCampaignData

  const windows = generateSendingWindows(campaignData)

  log(`Input: 2025-01-15 00:00 to 2025-01-16 23:59 (America/Chicago)`, 'blue')
  log(`Output: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (LOCAL TIME - stored as-is)`, 'blue')

  // Times should be stored in LOCAL timezone, not converted to UTC
  assert(windows.length === 1, 'Should generate 1 window for NOW mode')
  assert(windows[0].startDate === '2025-01-15', 'Start date should be 2025-01-15')
  assert(windows[0].startTime === '00:00', 'Start time should be 00:00 (local time, not UTC)')
  assert(windows[0].endDate === '2025-01-16', 'End date should be 2025-01-16')
  assert(windows[0].endTime === '23:59', 'End time should be 23:59 (local time, not UTC)')
}

// Test 2: LATER mode - America/Los_Angeles timezone
function testLaterModeLosAngeles() {
  log('\n=== Test 2: LATER mode - America/Los_Angeles ===', 'cyan')

  const campaignData: CreateCampaignData = {
    scheduleType: 'later',
    scheduledDate: '2025-06-15',
    scheduledTime: '09:00',
    campaignEndDate: '2025-06-16',
    timezone: 'America/Los_Angeles',
  } as CreateCampaignData

  const windows = generateSendingWindows(campaignData)

  log(`Input: 2025-06-15 09:00 to 2025-06-16 23:59 (America/Los_Angeles)`, 'blue')
  log(`Output: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (LOCAL TIME - stored as-is)`, 'blue')

  // Times should be stored in LOCAL timezone, not converted to UTC
  assert(windows.length === 1, 'Should generate 1 window for LATER mode')
  assert(windows[0].startDate === '2025-06-15', 'Start date should be 2025-06-15')
  assert(windows[0].startTime === '09:00', 'Start time should be 09:00 (local time, not UTC)')
  assert(windows[0].endDate === '2025-06-16', 'End date should be 2025-06-16')
  assert(windows[0].endTime === '23:59', 'End time should be 23:59 (local time, not UTC)')
}

// Test 3: WINDOWS mode - Multiple custom windows
function testWindowsMode() {
  log('\n=== Test 3: WINDOWS mode - America/New_York ===', 'cyan')

  const campaignData: CreateCampaignData = {
    scheduleType: 'windows',
    timezone: 'America/New_York',
    sendingWindows: [
      {
        startDate: '2025-01-20',
        startTime: '09:00',
        endDate: '2025-01-20',
        endTime: '17:00',
      },
      {
        startDate: '2025-01-21',
        startTime: '10:00',
        endDate: '2025-01-21',
        endTime: '18:00',
      },
    ],
  } as CreateCampaignData

  const windows = generateSendingWindows(campaignData)

  log(`Input Window 1: 2025-01-20 09:00-17:00 (America/New_York)`, 'blue')
  log(`Output Window 1: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (LOCAL TIME - stored as-is)`, 'blue')

  // Times should be stored in LOCAL timezone, not converted to UTC
  assert(windows.length === 2, 'Should generate 2 windows for WINDOWS mode')
  assert(windows[0].startTime === '09:00', 'Window 1 start should be 09:00 (local time, not UTC)')
  assert(windows[0].endTime === '17:00', 'Window 1 end should be 17:00 (local time, not UTC)')
  assert(windows[1].startTime === '10:00', 'Window 2 start should be 10:00 (local time, not UTC)')
  assert(windows[1].endTime === '18:00', 'Window 2 end should be 18:00 (local time, not UTC)')
}

// Test 4: WEEKDAY mode - Weekday patterns
function testWeekdayMode() {
  log('\n=== Test 4: WEEKDAY mode - America/Denver ===', 'cyan')

  const campaignData: CreateCampaignData = {
    scheduleType: 'weekday',
    campaignStartDate: '2025-01-20', // Monday
    campaignEndDate: '2025-01-22', // Wednesday
    timezone: 'America/Denver',
    weekdayEnabled: {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
    },
    weekdayWindows: {
      monday: [{ startTime: '09:00', endTime: '17:00' }],
      tuesday: [{ startTime: '09:00', endTime: '17:00' }],
      wednesday: [{ startTime: '09:00', endTime: '17:00' }],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
  } as CreateCampaignData

  const windows = generateSendingWindows(campaignData)

  log(`Input: Mon-Wed 09:00-17:00 (America/Denver)`, 'blue')
  log(`Output: ${windows.length} windows generated`, 'blue')
  if (windows.length > 0) {
    log(`First window: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (LOCAL TIME - stored as-is)`, 'blue')
  }

  // Times should be stored in LOCAL timezone, not converted to UTC
  assert(windows.length === 3, 'Should generate 3 windows (Mon, Tue, Wed)')
  assert(windows[0].startTime === '09:00', 'Monday start should be 09:00 (local time, not UTC)')
  assert(windows[0].endTime === '17:00', 'Monday end should be 17:00 (local time, not UTC)')
}

// Test 5: UTC timezone (stored in local time, which happens to be UTC)
function testUTCTimezone() {
  log('\n=== Test 5: UTC timezone ===', 'cyan')

  const campaignData: CreateCampaignData = {
    scheduleType: 'now',
    campaignStartDate: '2025-01-15',
    campaignEndDate: '2025-01-16',
    timezone: 'UTC',
  } as CreateCampaignData

  const windows = generateSendingWindows(campaignData)

  log(`Input: 2025-01-15 00:00 to 2025-01-16 23:59 (UTC)`, 'blue')
  log(`Output: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (LOCAL TIME - stored as-is)`, 'blue')

  // Times stored in local time (which for UTC timezone is the same as UTC)
  assert(windows[0].startDate === '2025-01-15', 'Start date should be 2025-01-15')
  assert(windows[0].startTime === '00:00', 'Start time should be 00:00 (local time)')
  assert(windows[0].endDate === '2025-01-16', 'End date should be 2025-01-16')
  assert(windows[0].endTime === '23:59', 'End time should be 23:59 (local time)')
}

// Test 6: DST transition - Local time preserved (this is the KEY advantage!)
function testDSTSpringForward() {
  log('\n=== Test 6: DST Transition - Local Time Preserved ===', 'cyan')

  const campaignData: CreateCampaignData = {
    scheduleType: 'later',
    scheduledDate: '2025-03-09', // DST starts (2 AM becomes 3 AM)
    scheduledTime: '09:00',
    campaignEndDate: '2025-03-10',
    timezone: 'America/Chicago',
  } as CreateCampaignData

  const windows = generateSendingWindows(campaignData)

  log(`Input: 2025-03-09 09:00 (America/Chicago, during DST transition)`, 'blue')
  log(`Output: ${windows[0].startDate} ${windows[0].startTime} (LOCAL TIME - stored as-is)`, 'blue')

  // Times stay in local timezone - backend will handle DST conversion at runtime
  // This preserves user intent: "9 AM local time" stays "9 AM local time" before AND after DST
  assert(windows[0].startDate === '2025-03-09', 'Start date should be 2025-03-09')
  assert(windows[0].startTime === '09:00', 'Start time should be 09:00 (local time preserved across DST)')

  log(`\n✓ KEY BENEFIT: User intent "9 AM local" is preserved regardless of DST!`, 'green')
}

// Run all tests
function runAllTests() {
  log('\n╔════════════════════════════════════════════════╗', 'yellow')
  log('║   Window Generator Local Timezone Tests        ║', 'yellow')
  log('╚════════════════════════════════════════════════╝', 'yellow')

  try {
    testNowModeChicago()
    testLaterModeLosAngeles()
    testWindowsMode()
    testWeekdayMode()
    testUTCTimezone()
    testDSTSpringForward()

    log('\n╔════════════════════════════════════════════════╗', 'green')
    log('║            ✓ ALL TESTS PASSED ✓                ║', 'green')
    log('╚════════════════════════════════════════════════╝', 'green')
    log('\nLocal timezone storage is working correctly!\n', 'green')
    log('Backend will handle conversion to UTC at runtime.\n', 'green')
  } catch (error) {
    log('\n╔════════════════════════════════════════════════╗', 'red')
    log('║            ✗ TESTS FAILED ✗                    ║', 'red')
    log('╚════════════════════════════════════════════════╝', 'red')
    log(`\nError: ${error}\n`, 'red')
    process.exit(1)
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests()
}

export { runAllTests }
