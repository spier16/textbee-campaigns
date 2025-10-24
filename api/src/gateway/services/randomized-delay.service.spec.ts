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
    it('should return value within bounds [0.5μ, 1.5μ]', () => {
      const avgWait = 60
      const min = 0.5 * avgWait // 30
      const max = 1.5 * avgWait // 90

      // Test 100 times to verify bounds
      for (let i = 0; i < 100; i++) {
        const result = service.calculateRandomizedWait(avgWait)
        expect(result).toBeGreaterThanOrEqual(min)
        expect(result).toBeLessThanOrEqual(max)
      }
    })

    it('should return 0 for invalid input', () => {
      expect(service.calculateRandomizedWait(0)).toBe(0)
      expect(service.calculateRandomizedWait(-10)).toBe(0)
    })

    it('should return different values on multiple calls (randomness)', () => {
      const avgWait = 60
      const results = new Set<number>()

      // Generate 50 samples
      for (let i = 0; i < 50; i++) {
        results.add(service.calculateRandomizedWait(avgWait))
      }

      // Should have at least 20 different values (accounting for rounding)
      expect(results.size).toBeGreaterThan(20)
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

      const smallAvg = smallResults.reduce((a, b) => a + b) / smallResults.length
      const largeAvg = largeResults.reduce((a, b) => a + b) / largeResults.length

      // Averages should be close to target values
      expect(smallAvg).toBeGreaterThan(8) // 10 ± 20%
      expect(smallAvg).toBeLessThan(12)
      expect(largeAvg).toBeGreaterThan(900) // 1000 ± 10%
      expect(largeAvg).toBeLessThan(1100)
    })
  })

  describe('calculateNextAvailableTime', () => {
    it('should return future timestamp', () => {
      const now = new Date()
      const avgWait = 60

      const nextTime = service.calculateNextAvailableTime(now, avgWait)

      expect(nextTime.getTime()).toBeGreaterThan(now.getTime())
    })

    it('should add approximately avgWaitSeconds', () => {
      const now = new Date('2025-10-24T10:00:00Z')
      const avgWait = 60

      const nextTime = service.calculateNextAvailableTime(now, avgWait)
      const diffSeconds = (nextTime.getTime() - now.getTime()) / 1000

      // Should be within bounds [30, 90] seconds
      expect(diffSeconds).toBeGreaterThanOrEqual(30)
      expect(diffSeconds).toBeLessThanOrEqual(90)
    })

    it('should respect lastSentAt parameter', () => {
      const pastTime = new Date('2025-10-24T10:00:00Z')
      const avgWait = 120

      const nextTime = service.calculateNextAvailableTime(pastTime, avgWait)

      // Next time should be after pastTime + avgWait
      const expectedMin = new Date(pastTime.getTime() + 60 * 1000) // 0.5 * 120
      expect(nextTime.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime())
    })
  })

  describe('calculateDelayFromNow', () => {
    it('should return positive delay for past lastSentAt', () => {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000)
      const avgWait = 120 // 2 minutes

      const delay = service.calculateDelayFromNow(oneMinuteAgo, avgWait)

      // Should still have delay remaining (sent 1 min ago, wait is 2 min)
      expect(delay).toBeGreaterThan(0)
    })

    it('should return 0 or small value if enough time has passed', () => {
      const longAgo = new Date(Date.now() - 300 * 1000) // 5 minutes ago
      const avgWait = 60 // 1 minute

      const delay = service.calculateDelayFromNow(longAgo, avgWait)

      // Enough time passed, delay should be 0
      expect(delay).toBe(0)
    })

    it('should return delay in milliseconds', () => {
      const now = new Date()
      const avgWait = 60

      const delay = service.calculateDelayFromNow(now, avgWait)

      // Should be roughly 30-90 seconds in milliseconds
      expect(delay).toBeGreaterThanOrEqual(30 * 1000)
      expect(delay).toBeLessThanOrEqual(90 * 1000)
    })
  })

  describe('generateBatchDelays', () => {
    it('should generate correct number of delays', () => {
      const count = 5
      const avgWait = 60
      const startTime = new Date()

      const delays = service.generateBatchDelays(count, avgWait, startTime)

      expect(delays).toHaveLength(count)
    })

    it('should return increasing timestamps', () => {
      const count = 10
      const avgWait = 60
      const startTime = new Date()

      const delays = service.generateBatchDelays(count, avgWait, startTime)

      // Each timestamp should be later than the previous
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i].getTime()).toBeGreaterThan(delays[i - 1].getTime())
      }
    })

    it('should start after startTime', () => {
      const count = 3
      const avgWait = 60
      const startTime = new Date('2025-10-24T10:00:00Z')

      const delays = service.generateBatchDelays(count, avgWait, startTime)

      // First delay should be after startTime
      expect(delays[0].getTime()).toBeGreaterThan(startTime.getTime())
    })

    it('should space delays appropriately', () => {
      const count = 5
      const avgWait = 60 // 1 minute average
      const startTime = new Date()

      const delays = service.generateBatchDelays(count, avgWait, startTime)

      // Last delay should be roughly 5 minutes after start (5 * 60s)
      // With randomization, allow 2.5 to 7.5 minutes (0.5 to 1.5 per message)
      const totalTime = delays[delays.length - 1].getTime() - startTime.getTime()
      const totalSeconds = totalTime / 1000

      expect(totalSeconds).toBeGreaterThan(150) // 5 * 30s minimum
      expect(totalSeconds).toBeLessThan(450) // 5 * 90s maximum
    })
  })

  describe('getStatistics', () => {
    it('should calculate mean close to target', () => {
      const avgWait = 60
      const stats = service.getStatistics(avgWait, 1000)

      // Mean should be within ±10% of target
      expect(stats.mean).toBeGreaterThan(54) // 90% of 60
      expect(stats.mean).toBeLessThan(66) // 110% of 60
      expect(stats.targetMean).toBe(avgWait)
    })

    it('should calculate stdDev close to 20% of mean', () => {
      const avgWait = 100
      const expectedStdDev = 0.20 * avgWait // 20

      const stats = service.getStatistics(avgWait, 1000)

      // StdDev should be within ±30% of expected (accounting for clipping)
      expect(stats.stdDev).toBeGreaterThan(expectedStdDev * 0.7) // 14
      expect(stats.stdDev).toBeLessThan(expectedStdDev * 1.3) // 26
      expect(stats.targetStdDev).toBe(expectedStdDev)
    })

    it('should respect bounds in min/max', () => {
      const avgWait = 60
      const stats = service.getStatistics(avgWait, 1000)

      expect(stats.min).toBeGreaterThanOrEqual(30) // 0.5 * 60
      expect(stats.max).toBeLessThanOrEqual(90) // 1.5 * 60
    })

    it('should work with different sample sizes', () => {
      const avgWait = 60

      const smallStats = service.getStatistics(avgWait, 100)
      const largeStats = service.getStatistics(avgWait, 5000)

      // Both should be defined
      expect(smallStats.mean).toBeDefined()
      expect(largeStats.mean).toBeDefined()

      // Larger sample should have mean closer to target
      const smallDiff = Math.abs(smallStats.mean - avgWait)
      const largeDiff = Math.abs(largeStats.mean - avgWait)

      // This is probabilistic, but should generally hold
      expect(largeDiff).toBeLessThan(10)
    })

    it('should return correct structure', () => {
      const avgWait = 60
      const stats = service.getStatistics(avgWait)

      expect(stats).toHaveProperty('mean')
      expect(stats).toHaveProperty('stdDev')
      expect(stats).toHaveProperty('min')
      expect(stats).toHaveProperty('max')
      expect(stats).toHaveProperty('targetMean')
      expect(stats).toHaveProperty('targetStdDev')

      expect(typeof stats.mean).toBe('number')
      expect(typeof stats.stdDev).toBe('number')
      expect(typeof stats.min).toBe('number')
      expect(typeof stats.max).toBe('number')
    })
  })

  describe('Statistical Distribution Validation', () => {
    it('should follow normal distribution (central limit theorem)', () => {
      const avgWait = 100
      const samples: number[] = []

      // Generate large sample
      for (let i = 0; i < 10000; i++) {
        samples.push(service.calculateRandomizedWait(avgWait))
      }

      // Calculate mean and stdDev
      const mean = samples.reduce((a, b) => a + b) / samples.length
      const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length
      const stdDev = Math.sqrt(variance)

      // Mean should be very close to 100
      expect(mean).toBeGreaterThan(95)
      expect(mean).toBeLessThan(105)

      // StdDev should be close to 20 (20% of 100)
      // Note: clipping will reduce stdDev slightly
      expect(stdDev).toBeGreaterThan(15)
      expect(stdDev).toBeLessThan(25)

      // Check distribution shape (roughly 68-95-99.7 rule)
      const withinOneSigma = samples.filter(s => Math.abs(s - mean) <= stdDev).length
      const percentWithinOneSigma = (withinOneSigma / samples.length) * 100

      // Should be roughly 68% within one sigma (allow 60-75% due to clipping)
      expect(percentWithinOneSigma).toBeGreaterThan(60)
      expect(percentWithinOneSigma).toBeLessThan(75)
    })
  })
})
