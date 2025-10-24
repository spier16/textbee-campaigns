import { Injectable, Logger } from '@nestjs/common'

/**
 * Service for calculating randomized message delays using normal distribution
 *
 * This implements the randomization strategy where:
 * - μ (mu) = avg_wait_seconds from usage plan tier
 * - σ (sigma) = 0.20 * μ (20% standard deviation)
 * - Samples from N(μ, σ²) using Box-Muller transform
 * - Clips result to [0.5μ, 1.5μ] to prevent extreme outliers
 *
 * The goal is to make message sending patterns appear more "human-like"
 * and avoid detection by anti-spam systems.
 */
@Injectable()
export class RandomizedDelayService {
  private readonly logger = new Logger(RandomizedDelayService.name)
  private readonly SIGMA_MULTIPLIER = 0.20 // 20% variance (configurable)

  /**
   * Generate a randomized wait time using normal distribution
   *
   * @param avgWaitSeconds - Mean wait time in seconds (μ)
   * @returns Randomized delay in seconds, clipped to [0.5μ, 1.5μ]
   *
   * @example
   * // For a 60-second average wait:
   * const delay = calculateRandomizedWait(60)
   * // Returns value between 30 and 90 seconds, centered around 60
   */
  calculateRandomizedWait(avgWaitSeconds: number): number {
    if (avgWaitSeconds <= 0) {
      this.logger.warn(`Invalid avgWaitSeconds: ${avgWaitSeconds}, returning 0`)
      return 0
    }

    const mu = avgWaitSeconds
    const sigma = this.SIGMA_MULTIPLIER * mu

    // Generate random sample from normal distribution using Box-Muller transform
    // This is a standard method for generating normally distributed random numbers
    const u1 = Math.random()
    const u2 = Math.random()
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)

    // Sample from N(μ, σ²)
    const sample = mu + z0 * sigma

    // Clip to [0.5μ, 1.5μ] to prevent extreme outliers
    const min = 0.5 * mu
    const max = 1.5 * mu
    const clipped = Math.max(min, Math.min(max, sample))

    // Round to nearest second for practical use
    const result = Math.round(clipped)

    this.logger.debug(
      `Randomized wait: avg=${avgWaitSeconds}s, result=${result}s, raw_sample=${sample.toFixed(2)}s`
    )

    return result
  }

  /**
   * Calculate next available send time for a device based on last send
   *
   * @param lastSentAt - Timestamp of last message sent
   * @param avgWaitSeconds - Average wait time from usage plan tier
   * @returns Date object representing when device can send next message
   *
   * @example
   * const lastSent = new Date('2025-10-24T10:00:00Z')
   * const nextAvailable = calculateNextAvailableTime(lastSent, 60)
   * // Returns date ~60 seconds after lastSent (with randomization)
   */
  calculateNextAvailableTime(lastSentAt: Date, avgWaitSeconds: number): Date {
    const randomizedWait = this.calculateRandomizedWait(avgWaitSeconds)
    const nextTime = new Date(lastSentAt.getTime() + randomizedWait * 1000)

    this.logger.debug(
      `Next available time: lastSent=${lastSentAt.toISOString()}, wait=${randomizedWait}s, next=${nextTime.toISOString()}`
    )

    return nextTime
  }

  /**
   * Calculate delay in milliseconds from now until next available time
   *
   * @param lastSentAt - Timestamp of last message sent
   * @param avgWaitSeconds - Average wait time from usage plan tier
   * @returns Delay in milliseconds (for use with queue delay parameter)
   *
   * @example
   * const delay = calculateDelayFromNow(device.lastMessageSentAt, 60)
   * await queue.add('send-message', data, { delay })
   */
  calculateDelayFromNow(lastSentAt: Date, avgWaitSeconds: number): number {
    const nextTime = this.calculateNextAvailableTime(lastSentAt, avgWaitSeconds)
    const now = new Date()
    const delayMs = Math.max(0, nextTime.getTime() - now.getTime())

    return delayMs
  }

  /**
   * Generate multiple randomized delays for batch scheduling
   *
   * Useful when scheduling multiple messages at once for a single device.
   * Each subsequent message gets cumulative delay.
   *
   * @param count - Number of delays to generate
   * @param avgWaitSeconds - Average wait time from usage plan tier
   * @returns Array of cumulative timestamps
   *
   * @example
   * const startTime = new Date()
   * const times = generateBatchDelays(5, 60, startTime)
   * // Returns [startTime + ~60s, startTime + ~120s, ...]
   */
  generateBatchDelays(
    count: number,
    avgWaitSeconds: number,
    startTime: Date = new Date()
  ): Date[] {
    const times: Date[] = []
    let currentTime = new Date(startTime)

    for (let i = 0; i < count; i++) {
      currentTime = this.calculateNextAvailableTime(currentTime, avgWaitSeconds)
      times.push(new Date(currentTime))
    }

    return times
  }

  /**
   * Get statistical properties of the randomization
   * Useful for testing and validation
   *
   * @param avgWaitSeconds - Average wait time to analyze
   * @param sampleSize - Number of samples to generate (default: 1000)
   * @returns Statistics object with mean, stdDev, min, max
   */
  getStatistics(avgWaitSeconds: number, sampleSize: number = 1000): {
    mean: number
    stdDev: number
    min: number
    max: number
    targetMean: number
    targetStdDev: number
  } {
    const samples: number[] = []

    for (let i = 0; i < sampleSize; i++) {
      samples.push(this.calculateRandomizedWait(avgWaitSeconds))
    }

    const mean = samples.reduce((sum, val) => sum + val, 0) / samples.length
    const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length
    const stdDev = Math.sqrt(variance)
    const min = Math.min(...samples)
    const max = Math.max(...samples)

    return {
      mean: parseFloat(mean.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      min,
      max,
      targetMean: avgWaitSeconds,
      targetStdDev: parseFloat((this.SIGMA_MULTIPLIER * avgWaitSeconds).toFixed(2))
    }
  }
}
