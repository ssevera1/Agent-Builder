/**
 * Exponential backoff retry utility with jitter.
 */

/**
 * Options for configuring retry behavior.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the initial call). Default: 3. */
  maxRetries: number;

  /** Base delay in milliseconds for exponential backoff. Default: 1000. */
  baseDelayMs: number;

  /** Maximum delay in milliseconds (caps the exponential growth). Default: 30000. */
  maxDelayMs: number;

  /**
   * Predicate to decide whether a given error should be retried.
   * Return `true` to retry, `false` to throw immediately.
   * Default: always retry.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;

  /**
   * Callback invoked before each retry (useful for logging).
   */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;

  /**
   * AbortSignal for cooperative cancellation.
   */
  signal?: AbortSignal;
}

/** Default options. */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'signal'>> & {
  onRetry?: RetryOptions['onRetry'];
  signal?: RetryOptions['signal'];
} = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  shouldRetry: () => true,
  onRetry: undefined,
  signal: undefined,
};

/**
 * Compute the delay for a given attempt using exponential backoff with
 * full jitter: delay = random(0, min(maxDelay, base * 2^attempt)).
 */
function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelayMs);
  // Full jitter: uniform random in [0, capped]
  return Math.floor(Math.random() * capped);
}

/**
 * Sleep for the specified duration, respecting an optional AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Execute an async function with automatic retries using exponential backoff
 * and jitter.
 *
 * @param fn - The async function to execute.
 * @param options - Retry configuration.
 * @returns The result of `fn` on success.
 * @throws The last error if all retries are exhausted, or immediately if
 *         `shouldRetry` returns false.
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => callLLM(request),
 *   {
 *     maxRetries: 3,
 *     baseDelayMs: 1000,
 *     maxDelayMs: 30000,
 *     shouldRetry: (err) => err instanceof RateLimitError,
 *   },
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      // Check for cancellation before each attempt
      if (opts.signal?.aborted) {
        throw opts.signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if we've exhausted attempts
      if (attempt >= opts.maxRetries) {
        break;
      }

      // Don't retry if the predicate says no
      if (opts.shouldRetry && !opts.shouldRetry(error, attempt)) {
        break;
      }

      const delay = computeDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);

      // Notify listener
      opts.onRetry?.(error, attempt + 1, delay);

      // Wait before retrying
      await sleep(delay, opts.signal);
    }
  }

  throw lastError;
}
