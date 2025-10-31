import { Test, TestingModule } from '@nestjs/testing'
import { RandomizedDelayService } from './randomized-delay.service'

describe('RandomizedDelayService', () => {
  let service: RandomizedDelayService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RandomizedDelayService],
    }).compile()

    service = module.get<RandomizedDelayService>(RandomizedDelayService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('calculateRandomizedWait', () => {
    it('should return value >= minWaitSeconds (hard minimum)', () => {
      const minWait = 60

      // Test 100 times to verify minimum is enforced
      for (let i = 0; i < 100; i++) {
        const result = service.calculateRandomizedWait(minWait)
        expect(result).toBeGreaterThanOrEqual(minWait)
      }
    })

    it('should return 0 for invalid input', () => {
      expect(service.calculateRandomizedWait(0)).toBe(0)
      expect(service.calculateRandomizedWait(-10)).toBe(0)
    })

    it('should return different values on multiple calls (randomness)', () => {
      const minWait = 60
      const results = new Set<number>()

      // Generate 50 samples
      for (let i = 0; i < 50; i++) {
        results.add(service.calculateRandomizedWait(minWait))
      }

      // Should have at least 15 different values (accounting for rounding and right-skew)
      expect(results.size).toBeGreaterThan(15)
    })

    it('should scale with input value', () => {
      const smallWait = 10
      const largeWait = 1000

      const smallResults: number[] = []
      const largeResults: number[] = []

      for (let i = 0; i < 100; i++) {
        smallResults.push(service.calculateRandomizedWait(smallWait))
        largeResults.push(service.calculateRandomizedWait(largeWait))
      }

      const smallAvg =
        smallResults.reduce((a, b) => a + b) / smallResults.length
      const largeAvg =
        largeResults.reduce((a, b) => a + b) / largeResults.length

      // For Gamma(5.1039, 0.154n), mean = n + k*theta = n + 5.1039 * 0.154n ≈ n + 0.786n = 1.786n
      // Small: min=10, expected mean ≈ 17.86
      expect(smallAvg).toBeGreaterThanOrEqual(10)
      expect(smallAvg).toBeLessThan(30) // Well below theoretical max

      // Large: min=1000, expected mean ≈ 1786
      expect(largeAvg).toBeGreaterThanOrEqual(1000)
      expect(largeAvg).toBeLessThan(3000) // Well below theoretical max
    })

    it('should exhibit right-skewed distribution', () => {
      const minWait = 100
      const samples: number[] = []

      // Generate large sample
      for (let i = 0; i < 1000; i++) {
        samples.push(service.calculateRandomizedWait(minWait))
      }

      const mean = samples.reduce((a, b) => a + b) / samples.length
      const sortedSamples = [...samples].sort((a, b) => a - b)
      const median = sortedSamples[500]

      // For right-skewed distribution: mean > median
      expect(mean).toBeGreaterThan(median)

      // Most values should cluster near minimum
      const nearMin = samples.filter((s) => s < minWait + 20).length
      const percentNearMin = (nearMin / samples.length) * 100

      // At least 20% of values should be within 20 seconds of minimum
      expect(percentNearMin).toBeGreaterThan(20)
    })

    it('should respect hard maximum (99.99th percentile)', () => {
      const minWait = 60
      const samples: number[] = []

      // Generate very large sample to test maximum
      for (let i = 0; i < 10000; i++) {
        samples.push(service.calculateRandomizedWait(minWait))
      }

      const stats = service.getStatistics(minWait, 1000)
      const maxObserved = Math.max(...samples)

      // All values should be <= hard maximum (with small tolerance for rounding)
      expect(maxObserved).toBeLessThanOrEqual(stats.hardMax + 2)
    })
  })

  describe('calculateNextAvailableTime', () => {
    it('should return future timestamp', () => {
      const now = new Date()
      const minWait = 60

      const nextTime = service.calculateNextAvailableTime(now, minWait)

      expect(nextTime.getTime()).toBeGreaterThan(now.getTime())
    })

    it('should add at least minWaitSeconds', () => {
      const now = new Date('2025-10-24T10:00:00Z')
      const minWait = 60

      const nextTime = service.calculateNextAvailableTime(now, minWait)
      const diffSeconds = (nextTime.getTime() - now.getTime()) / 1000

      // Should be at least minimum wait time
      expect(diffSeconds).toBeGreaterThanOrEqual(minWait)
    })

    it('should respect lastSentAt parameter', () => {
      const pastTime = new Date('2025-10-24T10:00:00Z')
      const minWait = 120

      const nextTime = service.calculateNextAvailableTime(pastTime, minWait)

      // Next time should be after pastTime + minWait
      const expectedMin = new Date(pastTime.getTime() + minWait * 1000)
      expect(nextTime.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime())
    })
  })

  describe('calculateDelayFromNow', () => {
    it('should return positive delay for recent lastSentAt', () => {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000)
      const minWait = 120 // 2 minutes

      const delay = service.calculateDelayFromNow(oneMinuteAgo, minWait)

      // Should still have delay remaining (sent 1 min ago, wait is >= 2 min)
      expect(delay).toBeGreaterThan(0)
    })

    it('should return 0 if enough time has passed', () => {
      const longAgo = new Date(Date.now() - 300 * 1000) // 5 minutes ago
      const minWait = 60 // 1 minute

      const delay = service.calculateDelayFromNow(longAgo, minWait)

      // Enough time passed, delay should be 0
      expect(delay).toBe(0)
    })

    it('should return delay in milliseconds', () => {
      const now = new Date()
      const minWait = 60

      const delay = service.calculateDelayFromNow(now, minWait)

      // Should be at least minWait seconds in milliseconds
      expect(delay).toBeGreaterThanOrEqual(minWait * 1000)
    })
  })

  describe('generateBatchDelays', () => {
    it('should generate correct number of delays', () => {
      const count = 5
      const minWait = 60
      const startTime = new Date()

      const delays = service.generateBatchDelays(count, minWait, startTime)

      expect(delays).toHaveLength(count)
    })

    it('should return increasing timestamps', () => {
      const count = 10
      const minWait = 60
      const startTime = new Date()

      const delays = service.generateBatchDelays(count, minWait, startTime)

      // Each timestamp should be later than the previous
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i].getTime()).toBeGreaterThan(delays[i - 1].getTime())
      }
    })

    it('should start after startTime + minWait', () => {
      const count = 3
      const minWait = 60
      const startTime = new Date('2025-10-24T10:00:00Z')

      const delays = service.generateBatchDelays(count, minWait, startTime)

      // First delay should be at least minWait after startTime
      const expectedMin = new Date(startTime.getTime() + minWait * 1000)
      expect(delays[0].getTime()).toBeGreaterThanOrEqual(expectedMin.getTime())
    })

    it('should space delays appropriately', () => {
      const count = 5
      const minWait = 60 // 1 minute minimum
      const startTime = new Date()

      const delays = service.generateBatchDelays(count, minWait, startTime)

      // Each gap should be at least minWait
      for (let i = 1; i < delays.length; i++) {
        const gapSeconds =
          (delays[i].getTime() - delays[i - 1].getTime()) / 1000
        expect(gapSeconds).toBeGreaterThanOrEqual(minWait)
      }

      // Last delay should be at least 5 * minWait after start (5 * 60s = 300s)
      const totalTime =
        delays[delays.length - 1].getTime() - startTime.getTime()
      const totalSeconds = totalTime / 1000

      expect(totalSeconds).toBeGreaterThanOrEqual(count * minWait)
    })
  })

  describe('getStatistics', () => {
    it('should calculate mean close to theoretical value', () => {
      const minWait = 60
      const stats = service.getStatistics(minWait, 2000)

      // Theoretical mean for Gamma(5.1039, 0.154*60) + 60
      // = 60 + 5.1039 * 9.24 ≈ 60 + 47.16 = 107.16
      const expectedMean = stats.targetMean

      // Observed mean should be within 15% of theoretical mean
      expect(stats.mean).toBeGreaterThan(expectedMean * 0.85)
      expect(stats.mean).toBeLessThan(expectedMean * 1.15)
    })

    it('should have minimum value equal to minWaitSeconds', () => {
      const minWait = 100
      const stats = service.getStatistics(minWait, 1000)

      // Theoretical minimum should match input
      expect(stats.theoreticalMin).toBe(minWait)

      // Observed minimum should be >= theoretical minimum (within rounding)
      expect(stats.min).toBeGreaterThanOrEqual(minWait)
      expect(stats.min).toBeLessThan(minWait + 10) // Should be close to minimum
    })

    it('should respect hard maximum', () => {
      const minWait = 60
      const stats = service.getStatistics(minWait, 1000)

      expect(stats.hardMax).toBeDefined()
      expect(stats.hardMax).toBeGreaterThan(minWait)

      // Observed max should not exceed hard max (with small tolerance)
      expect(stats.max).toBeLessThanOrEqual(stats.hardMax + 2)
    })

    it('should work with different sample sizes', () => {
      const minWait = 60

      const smallStats = service.getStatistics(minWait, 100)
      const largeStats = service.getStatistics(minWait, 5000)

      // Both should be defined
      expect(smallStats.mean).toBeDefined()
      expect(largeStats.mean).toBeDefined()

      // Theoretical values should be the same
      expect(smallStats.targetMean).toBe(largeStats.targetMean)
      expect(smallStats.theoreticalMin).toBe(largeStats.theoreticalMin)
    })

    it('should return correct structure', () => {
      const minWait = 60
      const stats = service.getStatistics(minWait)

      expect(stats).toHaveProperty('mean')
      expect(stats).toHaveProperty('stdDev')
      expect(stats).toHaveProperty('min')
      expect(stats).toHaveProperty('max')
      expect(stats).toHaveProperty('targetMean')
      expect(stats).toHaveProperty('targetStdDev')
      expect(stats).toHaveProperty('theoreticalMin')
      expect(stats).toHaveProperty('hardMax')

      expect(typeof stats.mean).toBe('number')
      expect(typeof stats.stdDev).toBe('number')
      expect(typeof stats.min).toBe('number')
      expect(typeof stats.max).toBe('number')
      expect(typeof stats.targetMean).toBe('number')
      expect(typeof stats.targetStdDev).toBe('number')
      expect(typeof stats.theoreticalMin).toBe('number')
      expect(typeof stats.hardMax).toBe('number')
    })
  })

  describe('Gamma Distribution Validation', () => {
    it('should follow right-skewed distribution pattern', () => {
      const minWait = 100
      const samples: number[] = []

      // Generate large sample
      for (let i = 0; i < 10000; i++) {
        samples.push(service.calculateRandomizedWait(minWait))
      }

      // Calculate statistics
      const mean = samples.reduce((a, b) => a + b) / samples.length
      const sortedSamples = [...samples].sort((a, b) => a - b)
      const median = sortedSamples[5000]
      const mode = sortedSamples[0] // Approximate mode as most common value near minimum

      // Right-skewed: mean > median > mode (approximately)
      expect(mean).toBeGreaterThan(median)
      expect(median).toBeGreaterThan(minWait + 10) // Median should be above minimum

      // Verify mean is close to theoretical
      // Theoretical: 100 + 5.1039 * 0.154 * 100 = 100 + 78.6 = 178.6
      expect(mean).toBeGreaterThan(150)
      expect(mean).toBeLessThan(200)
    })

    it('should have most values near minimum with long right tail', () => {
      const minWait = 60
      const samples: number[] = []

      for (let i = 0; i < 5000; i++) {
        samples.push(service.calculateRandomizedWait(minWait))
      }

      // Count values in different ranges
      const nearMin = samples.filter(
        (s) => s >= minWait && s < minWait + 20,
      ).length
      const midRange = samples.filter(
        (s) => s >= minWait + 20 && s < minWait + 60,
      ).length
      const farRange = samples.filter((s) => s >= minWait + 60).length

      const percentNearMin = (nearMin / samples.length) * 100
      const percentMidRange = (midRange / samples.length) * 100
      const percentFarRange = (farRange / samples.length) * 100

      // Right-skewed: more values near minimum
      expect(percentNearMin).toBeGreaterThan(percentFarRange)

      // But should still have some spread
      expect(percentMidRange).toBeGreaterThan(10)
      expect(percentFarRange).toBeGreaterThan(1)
    })

    it('should have positive skewness', () => {
      const minWait = 100
      const samples: number[] = []

      for (let i = 0; i < 5000; i++) {
        samples.push(service.calculateRandomizedWait(minWait))
      }

      const mean = samples.reduce((a, b) => a + b) / samples.length
      const variance =
        samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
        samples.length
      const stdDev = Math.sqrt(variance)

      // Calculate skewness
      const skewness =
        samples.reduce(
          (sum, val) => sum + Math.pow((val - mean) / stdDev, 3),
          0,
        ) / samples.length

      // Right-skewed distribution should have positive skewness
      expect(skewness).toBeGreaterThan(0)
    })
  })
})
