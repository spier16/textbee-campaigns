import { Injectable, Logger } from '@nestjs/common'

/**
 * Service for calculating randomized message delays using Gamma distribution
 *
 * This implements a right-skewed randomization strategy where:
 * - Minimum wait time = min_wait_seconds from usage plan tier
 * - Uses Gamma distribution with k=5.1039, θ=0.154×min_wait_seconds
 * - Values cluster near minimum with occasional longer delays (right tail)
 * - Hard maximum cap at 99.99th percentile to prevent extreme outliers
 *
 * The goal is to make message sending patterns appear more "human-like"
 * and avoid detection by anti-spam systems.
 */
@Injectable()
export class RandomizedDelayService {
  private readonly logger = new Logger(RandomizedDelayService.name)

  // Gamma distribution parameters
  private readonly GAMMA_SHAPE = 5.1039 // k (shape parameter)
  private readonly GAMMA_SCALE_MULTIPLIER = 0.154 // θ = 0.154 × n

  /**
   * Calculate the 99.99th percentile of Gamma distribution
   * Used as hard maximum to prevent extreme outliers
   *
   * @param shape - Gamma shape parameter (k)
   * @param scale - Gamma scale parameter (θ)
   * @returns 99.99th percentile value
   */
  private calculateGammaPercentile99_99(shape: number, scale: number): number {
    // For Gamma distribution, we use Wilson-Hilferty transformation
    // This transforms Gamma to approximately normal for percentile calculation
    const p = 0.9999
    const z = this.inverseNormalCDF(p)

    // Wilson-Hilferty transformation formula:
    // ((X/(k*θ))^(1/3) - (1 - 1/(9k))) / sqrt(1/(9k)) ≈ N(0,1)
    // Solving for X at the p-th percentile:
    // X = k*θ * (1 - 1/(9k) + z*sqrt(1/(9k)))^3
    const term1 = 1 - 1 / (9 * shape)
    const term2 = z * Math.sqrt(1 / (9 * shape))
    const percentile = shape * scale * Math.pow(term1 + term2, 3)

    // Sanity check: For human-like delays, percentile should be reasonable
    // Expected: for typical minWait of 10-100s, percentile should be < 1000s
    const expectedMax = shape * scale * 20 // Heuristic: ~20x the mean
    if (percentile > expectedMax) {
      this.logger.warn(
        `Gamma percentile (${percentile.toFixed(2)}s) exceeds sanity bound (${expectedMax.toFixed(2)}s). Using bounded value.`,
      )
      return expectedMax
    }

    return percentile
  }

  /**
   * Inverse normal CDF approximation (for percentile calculations)
   * Uses Acklam's algorithm for accurate results
   */
  private inverseNormalCDF(p: number): number {
    if (p <= 0 || p >= 1) {
      throw new Error('p must be between 0 and 1')
    }

    // Acklam's algorithm coefficients
    const a1 = -3.969683028665376e1
    const a2 = 2.209460984245205e2
    const a3 = -2.759285104469687e2
    const a4 = 1.383577518672690e2
    const a5 = -3.066479806614716e1
    const a6 = 2.506628277459239e0

    const b1 = -5.447609879822406e1
    const b2 = 1.615858368580409e2
    const b3 = -1.556989798598866e2
    const b4 = 6.680131188771972e1
    const b5 = -1.328068155288572e1

    const c1 = -7.784894002430293e-3
    const c2 = -3.223964580411365e-1
    const c3 = -2.400758277161838e0
    const c4 = -2.549732539343734e0
    const c5 = 4.374664141464968e0
    const c6 = 2.938163982698783e0

    const d1 = 7.784695709041462e-3
    const d2 = 3.224671290700398e-1
    const d3 = 2.445134137142996e0
    const d4 = 3.754408661907416e0

    const pLow = 0.02425
    const pHigh = 1 - pLow

    let q: number, r: number, x: number

    if (p < pLow) {
      // Lower tail
      q = Math.sqrt(-2 * Math.log(p))
      x = (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    } else if (p <= pHigh) {
      // Central region
      q = p - 0.5
      r = q * q
      x = (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q / (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
    } else {
      // Upper tail
      q = Math.sqrt(-2 * Math.log(1 - p))
      x = -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    }

    return x
  }

  /**
   * Generate a random sample from Gamma distribution
   * Uses Marsaglia and Tsang's method for Gamma(k, θ)
   *
   * @param shape - Shape parameter (k)
   * @param scale - Scale parameter (θ)
   * @returns Random sample from Gamma(k, θ)
   */
  private sampleGamma(shape: number, scale: number): number {
    // Marsaglia and Tsang's method
    const d = shape - 1 / 3
    const c = 1 / Math.sqrt(9 * d)

    while (true) {
      let x: number
      let v: number

      do {
        x = this.sampleNormal(0, 1)
        v = 1 + c * x
      } while (v <= 0)

      v = v * v * v
      const u = Math.random()

      const x2 = x * x
      if (u < 1 - 0.0331 * x2 * x2) {
        return d * v * scale
      }

      if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) {
        return d * v * scale
      }
    }
  }

  /**
   * Generate a random sample from normal distribution
   * Uses Box-Muller transform
   *
   * @param mean - Mean of normal distribution
   * @param stdDev - Standard deviation
   * @returns Random sample from N(mean, stdDev²)
   */
  private sampleNormal(mean: number, stdDev: number): number {
    const u1 = Math.random()
    const u2 = Math.random()
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return mean + z0 * stdDev
  }

  /**
   * Generate a randomized wait time using Gamma distribution
   *
   * @param minWaitSeconds - Minimum wait time in seconds
   * @returns Randomized delay in seconds, >= minWaitSeconds, capped at 99.99th percentile
   *
   * @example
   * // For a 40-second minimum wait:
   * const delay = calculateRandomizedWait(40)
   * // Returns value >= 40 seconds, clustered near 40 with occasional higher values
   */
  calculateRandomizedWait(minWaitSeconds: number): number {
    if (minWaitSeconds <= 0) {
      this.logger.warn(`Invalid minWaitSeconds: ${minWaitSeconds}, returning 0`)
      return 0
    }

    const shape = this.GAMMA_SHAPE
    const scale = this.GAMMA_SCALE_MULTIPLIER * minWaitSeconds

    // Sample from Gamma distribution
    const gammaSample = this.sampleGamma(shape, scale)

    // Calculate hard maximum (99.99th percentile of the gamma distribution)
    const gammaMax = this.calculateGammaPercentile99_99(shape, scale)

    // Cap gamma sample at its 99.99th percentile, then add minimum offset
    const cappedGammaSample = Math.min(gammaSample, gammaMax)
    const sample = minWaitSeconds + cappedGammaSample

    // Calculate total hard maximum for logging (min + gamma percentile)
    const hardMaxTotal = minWaitSeconds + gammaMax

    // Round to nearest second for practical use
    const result = Math.round(sample)

    this.logger.debug(
      `Randomized wait: min=${minWaitSeconds}s, result=${result}s, gamma_sample=${gammaSample.toFixed(2)}s, max=${hardMaxTotal.toFixed(2)}s`,
    )

    return result
  }

  /**
   * Calculate next available send time for a device based on last send
   *
   * @param lastSentAt - Timestamp of last message sent
   * @param minWaitSeconds - Minimum wait time from usage plan tier
   * @returns Date object representing when device can send next message
   *
   * @example
   * const lastSent = new Date('2025-10-24T10:00:00Z')
   * const nextAvailable = calculateNextAvailableTime(lastSent, 40)
   * // Returns date >= 40 seconds after lastSent (with right-skewed randomization)
   */
  calculateNextAvailableTime(lastSentAt: Date, minWaitSeconds: number): Date {
    const randomizedWait = this.calculateRandomizedWait(minWaitSeconds)
    const nextTime = new Date(lastSentAt.getTime() + randomizedWait * 1000)

    this.logger.debug(
      `Next available time: lastSent=${lastSentAt.toISOString()}, wait=${randomizedWait}s, next=${nextTime.toISOString()}`,
    )

    return nextTime
  }

  /**
   * Calculate delay in milliseconds from now until next available time
   *
   * @param lastSentAt - Timestamp of last message sent
   * @param minWaitSeconds - Minimum wait time from usage plan tier
   * @returns Delay in milliseconds (for use with queue delay parameter)
   *
   * @example
   * const delay = calculateDelayFromNow(device.lastMessageSentAt, 40)
   * await queue.add('send-message', data, { delay })
   */
  calculateDelayFromNow(lastSentAt: Date, minWaitSeconds: number): number {
    const nextTime = this.calculateNextAvailableTime(lastSentAt, minWaitSeconds)
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
   * @param minWaitSeconds - Minimum wait time from usage plan tier
   * @returns Array of cumulative timestamps
   *
   * @example
   * const startTime = new Date()
   * const times = generateBatchDelays(5, 40, startTime)
   * // Returns [startTime + ~40s, startTime + ~80s, ...] with right-skewed randomization
   */
  generateBatchDelays(
    count: number,
    minWaitSeconds: number,
    startTime: Date = new Date(),
  ): Date[] {
    const times: Date[] = []
    let currentTime = new Date(startTime)

    for (let i = 0; i < count; i++) {
      currentTime = this.calculateNextAvailableTime(currentTime, minWaitSeconds)
      times.push(new Date(currentTime))
    }

    return times
  }

  /**
   * Get statistical properties of the randomization
   * Useful for testing and validation
   *
   * @param minWaitSeconds - Minimum wait time to analyze
   * @param sampleSize - Number of samples to generate (default: 1000)
   * @returns Statistics object with mean, stdDev, min, max
   */
  getStatistics(
    minWaitSeconds: number,
    sampleSize: number = 1000,
  ): {
    mean: number
    stdDev: number
    min: number
    max: number
    targetMean: number
    targetStdDev: number
    theoreticalMin: number
    hardMax: number
  } {
    const samples: number[] = []

    for (let i = 0; i < sampleSize; i++) {
      samples.push(this.calculateRandomizedWait(minWaitSeconds))
    }

    const mean = samples.reduce((sum, val) => sum + val, 0) / samples.length
    const variance =
      samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      samples.length
    const stdDev = Math.sqrt(variance)
    const min = Math.min(...samples)
    const max = Math.max(...samples)

    // Calculate theoretical values for Gamma distribution
    const shape = this.GAMMA_SHAPE
    const scale = this.GAMMA_SCALE_MULTIPLIER * minWaitSeconds
    const targetMean = minWaitSeconds + shape * scale
    const targetStdDev = Math.sqrt(shape) * scale
    const hardMax =
      minWaitSeconds + this.calculateGammaPercentile99_99(shape, scale)

    return {
      mean: parseFloat(mean.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      min,
      max,
      targetMean: parseFloat(targetMean.toFixed(2)),
      targetStdDev: parseFloat(targetStdDev.toFixed(2)),
      theoreticalMin: minWaitSeconds,
      hardMax: parseFloat(hardMax.toFixed(2)),
    }
  }
}
