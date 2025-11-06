/**
 * Manual test file for timezone conversion in window-generator
 *
 * This file can be executed with ts-node to verify timezone conversions are working correctly.
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
  log(`Output: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (UTC)`, 'blue')

  // In CST (UTC-6), 00:00 local = 06:00 UTC
  // In CST (UTC-6), 23:59 local = 05:59 UTC next day
  assert(windows.length === 1, 'Should generate 1 window for NOW mode')
  assert(windows[0].startDate === '2025-01-15', 'Start date should be 2025-01-15')
  assert(windows[0].startTime === '06:00', 'Start time should be 06:00 UTC (00:00 CST + 6 hours)')
  assert(windows[0].endDate === '2025-01-17', 'End date should be 2025-01-17 (crosses day boundary)')
  assert(windows[0].endTime === '05:59', 'End time should be 05:59 UTC (23:59 CST + 6 hours)')
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

  log(`Input: 2025-06-15 09:00 to 2025-06-16 23:59 (America/Los_Angeles, PDT)`, 'blue')
  log(`Output: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (UTC)`, 'blue')

  // In PDT (UTC-7), 09:00 local = 16:00 UTC
  // In PDT (UTC-7), 23:59 local = 06:59 UTC next day
  assert(windows.length === 1, 'Should generate 1 window for LATER mode')
  assert(windows[0].startDate === '2025-06-15', 'Start date should be 2025-06-15')
  assert(windows[0].startTime === '16:00', 'Start time should be 16:00 UTC (09:00 PDT + 7 hours)')
  assert(windows[0].endDate === '2025-06-17', 'End date should be 2025-06-17')
  assert(windows[0].endTime === '06:59', 'End time should be 06:59 UTC (23:59 PDT + 7 hours)')
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

  log(`Input Window 1: 2025-01-20 09:00-17:00 (America/New_York, EST)`, 'blue')
  log(`Output Window 1: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (UTC)`, 'blue')

  // In EST (UTC-5), 09:00 local = 14:00 UTC
  // In EST (UTC-5), 17:00 local = 22:00 UTC
  assert(windows.length === 2, 'Should generate 2 windows for WINDOWS mode')
  assert(windows[0].startTime === '14:00', 'Window 1 start should be 14:00 UTC (09:00 EST + 5 hours)')
  assert(windows[0].endTime === '22:00', 'Window 1 end should be 22:00 UTC (17:00 EST + 5 hours)')
  assert(windows[1].startTime === '15:00', 'Window 2 start should be 15:00 UTC (10:00 EST + 5 hours)')
  assert(windows[1].endTime === '23:00', 'Window 2 end should be 23:00 UTC (18:00 EST + 5 hours)')
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

  log(`Input: Mon-Wed 09:00-17:00 (America/Denver, MST)`, 'blue')
  log(`Output: ${windows.length} windows generated`, 'blue')
  if (windows.length > 0) {
    log(`First window: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (UTC)`, 'blue')
  }

  // In MST (UTC-7), 09:00 local = 16:00 UTC
  // In MST (UTC-7), 17:00 local = 00:00 UTC next day
  assert(windows.length === 3, 'Should generate 3 windows (Mon, Tue, Wed)')
  assert(windows[0].startTime === '16:00', 'Monday start should be 16:00 UTC (09:00 MST + 7 hours)')
  assert(windows[0].endTime === '00:00', 'Monday end should be 00:00 UTC (17:00 MST + 7 hours)')
}

// Test 5: UTC timezone (no conversion needed)
function testUTCTimezone() {
  log('\n=== Test 5: UTC timezone (no conversion) ===', 'cyan')

  const campaignData: CreateCampaignData = {
    scheduleType: 'now',
    campaignStartDate: '2025-01-15',
    campaignEndDate: '2025-01-16',
    timezone: 'UTC',
  } as CreateCampaignData

  const windows = generateSendingWindows(campaignData)

  log(`Input: 2025-01-15 00:00 to 2025-01-16 23:59 (UTC)`, 'blue')
  log(`Output: ${windows[0].startDate} ${windows[0].startTime} to ${windows[0].endDate} ${windows[0].endTime} (UTC)`, 'blue')

  // UTC should remain unchanged
  assert(windows[0].startDate === '2025-01-15', 'Start date should be 2025-01-15')
  assert(windows[0].startTime === '00:00', 'Start time should be 00:00 UTC (no conversion)')
  assert(windows[0].endDate === '2025-01-16', 'End date should be 2025-01-16')
  assert(windows[0].endTime === '23:59', 'End time should be 23:59 UTC (no conversion)')
}

// Test 6: DST transition - Spring forward (CST to CDT)
function testDSTSpringForward() {
  log('\n=== Test 6: DST Spring Forward - America/Chicago ===', 'cyan')

  const campaignData: CreateCampaignData = {
    scheduleType: 'later',
    scheduledDate: '2025-03-09', // DST starts (2 AM becomes 3 AM)
    scheduledTime: '09:00',
    campaignEndDate: '2025-03-10',
    timezone: 'America/Chicago',
  } as CreateCampaignData

  const windows = generateSendingWindows(campaignData)

  log(`Input: 2025-03-09 09:00 (America/Chicago, during DST transition)`, 'blue')
  log(`Output: ${windows[0].startDate} ${windows[0].startTime} (UTC)`, 'blue')

  // After DST, Chicago is UTC-5 instead of UTC-6
  assert(windows[0].startDate === '2025-03-09', 'Start date should be 2025-03-09')
  assert(windows[0].startTime === '15:00', 'Start time should be 15:00 UTC (09:00 CDT + 6 hours, DST active)')
}

// Run all tests
function runAllTests() {
  log('\n╔════════════════════════════════════════════════╗', 'yellow')
  log('║   Window Generator Timezone Conversion Tests   ║', 'yellow')
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
    log('\nTimezone conversion is working correctly!\n', 'green')
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
