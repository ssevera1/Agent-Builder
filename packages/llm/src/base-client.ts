import type { LLMRequest, LLMResponse, ModelConfig } from './client.interface.js';
import { LLMError, ValidationError } from '@agentbuilder/core';
import { logger } from '@agentbuilder/core';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export abstract class BaseClient {
  protected timeoutMs: number = DEFAULT_TIMEOUT_MS;
  protected maxRetries: number = DEFAULT_MAX_RETRIES;
  protected retryDelayMs: number = DEFAULT_RETRY_DELAY_MS;

  abstract complete(request: LLMRequest): Promise<LLMResponse>;

  protected async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new LLMError(
            `Request timeout after ${timeoutMs}ms`,
            'TIMEOUT',
            undefined,
            { timeoutMs },
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  protected async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = this.maxRetries,
    delayMs: number = this.retryDelayMs,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const backoffMs = delayMs * Math.pow(2, attempt - 1);
          logger.debug(
            `Retry attempt ${attempt} after ${backoffMs}ms`,
            { attempt, maxRetries },
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }

        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on validation errors or non-retryable errors
        if (
          error instanceof ValidationError ||
          (error instanceof LLMError && !this.isRetryableError(error))
        ) {
          throw error;
        }

        if (attempt === maxRetries) {
          logger.warn(
            `Request failed after ${maxRetries + 1} attempts`,
            { error: lastError.message, maxRetries },
          );
          break;
        }
      }
    }

    throw lastError || new LLMError('Request failed after retries', 'RETRY_EXHAUSTED');
  }

  protected isRetryableError(error: LLMError): boolean {
    const retryableCodes = [
      'TIMEOUT',
      'RATE_LIMIT',
      'SERVICE_UNAVAILABLE',
      'NETWORK_ERROR',
    ];
    return retryableCodes.includes(error.code);
  }

  protected setTimeoutMs(ms: number): void {
    if (ms <= 0) {
      throw new ValidationError('Timeout must be a positive number');
    }
    this.timeoutMs = ms;
  }

  protected setMaxRetries(count: number): void {
    if (count < 0) {
      throw new ValidationError('Max retries must be non-negative');
    }
    this.maxRetries = count;
  }

  protected setRetryDelayMs(ms: number): void {
    if (ms <= 0) {
      throw new ValidationError('Retry delay must be a positive number');
    }
    this.retryDelayMs = ms;
  }
}
