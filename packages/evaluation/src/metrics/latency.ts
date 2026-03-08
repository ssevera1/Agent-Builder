/**
 * Latency metrics for evaluating agent performance.
 *
 * Provides utilities for measuring execution timing and computing
 * percentile statistics across test suites.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Result of a latency measurement.
 */
export interface LatencyMeasurement<T> {
  /** The result produced by the function. */
  result: T;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Time to first yield/token in milliseconds (for async iterables). */
  firstTokenMs?: number;
}

/**
 * Percentile statistics computed from a set of latency measurements.
 */
export interface LatencyStats {
  /** Minimum latency in ms. */
  min: number;
  /** Maximum latency in ms. */
  max: number;
  /** Mean (average) latency in ms. */
  mean: number;
  /** Median (P50) latency in ms. */
  median: number;
  /** 50th percentile (same as median). */
  p50: number;
  /** 90th percentile latency in ms. */
  p90: number;
  /** 95th percentile latency in ms. */
  p95: number;
  /** 99th percentile latency in ms. */
  p99: number;
  /** Standard deviation in ms. */
  stdDev: number;
  /** Number of measurements. */
  count: number;
}

// ─── Measurement ────────────────────────────────────────────────────────────

/**
 * Measure the latency of an async function.
 *
 * @param fn - The async function to measure.
 * @returns The function result along with timing information.
 */
export async function measureLatency<T>(
  fn: () => Promise<T>,
): Promise<LatencyMeasurement<T>> {
  const startTime = performance.now();
  const result = await fn();
  const durationMs = performance.now() - startTime;

  return {
    result,
    durationMs,
  };
}

/**
 * Measure the latency of an async iterable, tracking both total duration
 * and time to first token.
 *
 * @param fn - Function that returns an async iterable.
 * @param collector - Function to collect/reduce the iterable's yielded values into a single result.
 * @returns The collected result along with timing information.
 */
export async function measureIterableLatency<TYield, TResult>(
  fn: () => AsyncIterable<TYield>,
  collector: (values: TYield[]) => TResult,
): Promise<LatencyMeasurement<TResult>> {
  const startTime = performance.now();
  let firstTokenMs: number | undefined;
  const values: TYield[] = [];

  const iterable = fn();
  for await (const value of iterable) {
    if (firstTokenMs === undefined) {
      firstTokenMs = performance.now() - startTime;
    }
    values.push(value);
  }

  const durationMs = performance.now() - startTime;
  const result = collector(values);

  return {
    result,
    durationMs,
    firstTokenMs,
  };
}

// ─── Percentile Calculation ─────────────────────────────────────────────────

/**
 * Compute percentile statistics from an array of latency measurements.
 *
 * @param values - Array of latency values in milliseconds.
 * @returns Computed statistics including percentiles.
 */
export function computeLatencyStats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      stdDev: 0,
      count: 0,
    };
  }

  // Sort ascending for percentile calculations
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const min = sorted[0]!;
  const max = sorted[n - 1]!;

  // Mean
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;

  // Standard deviation
  const variance =
    sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  // Percentile calculation using the nearest-rank method
  const p50 = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);

  return {
    min,
    max,
    mean,
    median: p50,
    p50,
    p90,
    p95,
    p99,
    stdDev,
    count: n,
  };
}

/**
 * Compute a percentile value from a sorted array using linear interpolation.
 *
 * @param sorted - Pre-sorted array of values (ascending).
 * @param p - The percentile to compute (0-1).
 * @returns The interpolated value at the given percentile.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;

  // Use linear interpolation between adjacent ranks
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower]!;

  const fraction = index - lower;
  return (sorted[lower]!) * (1 - fraction) + (sorted[upper]!) * fraction;
}

/**
 * Compute time-to-first-token statistics from an array of measurements.
 */
export function computeFirstTokenStats(
  values: Array<number | undefined>,
): LatencyStats | null {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length === 0) return null;
  return computeLatencyStats(defined);
}
