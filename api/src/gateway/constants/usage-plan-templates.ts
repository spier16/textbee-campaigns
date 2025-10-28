/**
 * Predefined usage plan templates
 *
 * These templates are available to all users and can be assigned to devices.
 * They represent common carrier configurations and testing scenarios.
 */
export const PREDEFINED_PLANS = [
  {
    _id: 'template_verizon_business',
    name: 'Verizon Business SIM',
    description: 'Best for high-volume sending',
    usageWindowMinutes: 1440, // 24 hours rolling window
    tierPromotionCooldownHours: 24,
    tiers: [
      { tier: 1, min_wait_seconds: 300, messages_per_cycle: 70 },  // 10%
      { tier: 2, min_wait_seconds: 240, messages_per_cycle: 140 }, // 20%
      { tier: 3, min_wait_seconds: 180, messages_per_cycle: 280 }, // 40%
      { tier: 4, min_wait_seconds: 120, messages_per_cycle: 420 }, // 60%
      { tier: 5, min_wait_seconds: 90, messages_per_cycle: 560 },  // 80%
      { tier: 6, min_wait_seconds: 60, messages_per_cycle: 700 },  // 100%
    ],
    isDefault: false,
    isActive: true,
    isTemplate: true,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'template_verizon_prepaid',
    name: 'Verizon Prepaid SIM',
    description: 'Reliable mid-volume option',
    usageWindowMinutes: 1440, // 24 hours rolling window
    tierPromotionCooldownHours: 24,
    tiers: [
      { tier: 1, min_wait_seconds: 300, messages_per_cycle: 20 },  // 10%
      { tier: 2, min_wait_seconds: 240, messages_per_cycle: 40 },  // 20%
      { tier: 3, min_wait_seconds: 180, messages_per_cycle: 80 },  // 40%
      { tier: 4, min_wait_seconds: 120, messages_per_cycle: 120 }, // 60%
      { tier: 5, min_wait_seconds: 90, messages_per_cycle: 160 },  // 80%
      { tier: 6, min_wait_seconds: 60, messages_per_cycle: 200 },  // 100%
    ],
    isDefault: false,
    isActive: true,
    isTemplate: true,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'template_total_wireless',
    name: 'Total Wireless SIM',
    description: "Reliable mid-volume option on Verizon's network",
    usageWindowMinutes: 1440, // 24 hours rolling window
    tierPromotionCooldownHours: 24,
    tiers: [
      { tier: 1, min_wait_seconds: 300, messages_per_cycle: 15 },  // 10%
      { tier: 2, min_wait_seconds: 240, messages_per_cycle: 30 },  // 20%
      { tier: 3, min_wait_seconds: 180, messages_per_cycle: 60 },  // 40%
      { tier: 4, min_wait_seconds: 120, messages_per_cycle: 90 },  // 60%
      { tier: 5, min_wait_seconds: 90, messages_per_cycle: 120 },  // 80%
      { tier: 6, min_wait_seconds: 60, messages_per_cycle: 150 },  // 100%
    ],
    isDefault: false,
    isActive: true,
    isTemplate: true,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'template_tracfone',
    name: 'Tracfone SIM',
    description: 'Tracfone uses both T-Mobile & Verizon network, depending on your area code. Only use Tracfone if they provide Verizon SIM cards',
    usageWindowMinutes: 1440, // 24 hours rolling window
    tierPromotionCooldownHours: 24,
    tiers: [
      { tier: 1, min_wait_seconds: 300, messages_per_cycle: 15 },  // 10%
      { tier: 2, min_wait_seconds: 240, messages_per_cycle: 30 },  // 20%
      { tier: 3, min_wait_seconds: 180, messages_per_cycle: 60 },  // 40%
      { tier: 4, min_wait_seconds: 120, messages_per_cycle: 90 },  // 60%
      { tier: 5, min_wait_seconds: 90, messages_per_cycle: 120 },  // 80%
      { tier: 6, min_wait_seconds: 60, messages_per_cycle: 150 },  // 100%
    ],
    isDefault: false,
    isActive: true,
    isTemplate: true,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'template_dev_testing',
    name: 'Dev Testing Plan',
    description: 'For testing tier progression and rate limiting (5-minute cycles)',
    usageWindowMinutes: 5, // 5 minutes rolling window for fast testing
    tierPromotionCooldownHours: 5 / 60, // 5 minutes cooldown for testing
    tiers: [
      { tier: 1, min_wait_seconds: 50, messages_per_cycle: 3 },
      { tier: 2, min_wait_seconds: 40, messages_per_cycle: 4 },
      { tier: 3, min_wait_seconds: 30, messages_per_cycle: 5 },
    ],
    isDefault: false,
    isActive: true,
    isTemplate: true,
    createdAt: new Date().toISOString(),
  },
]
