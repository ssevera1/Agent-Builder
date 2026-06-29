/**
 * Base LLM client with common functionality across all providers.
 */

import { LLMError, RateLimitError } from '@agentbuilder/core';
import type { LLMRequest, LLMResponse, LLMStreamChunk } from '@agentbuilder/core';
import { logger } from '@agentbuilder/core';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export interface RetryConfig {
  maxRetries: number;
  initialBackoffMs: number;
  requestTimeoutMs: number;
}

export abstract class BaseLLMClient {
  protected maxRetries: number;
  protected initialBackoffMs: number;
  protected requestTimeoutMs: number;

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.maxRetries = retryConfig?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialBackoffMs = retryConfig?.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.requestTimeoutMs = retryConfig?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Execute a request with exponential backoff retry on transient failures.
   * Retries on rate limits and network timeouts; fails immediately on auth/validation.
   */
  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        try {
          const result = await Promise.race([
            fn(),
            new Promise<never>((_, reject) =>
              controller.signal.addEventListener('abort', () =>
                reject(new Error('Request timeout')),
              ),
            ),
          ]);
          clearTimeout(timeoutId);
          return result;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const isRateLimit = error instanceof RateLimitError;
        const isTimeout = lastError.message.includes('timeout') || lastError.message.includes('ETIMEDOUT');
        const isTransient = isRateLimit || isTimeout || lastError.message.includes('ECONNRESET');

        if (!isTransient) {
          throw error;
        }

        if (attempt < this.maxRetries - 1) {
          const backoffMs = this.initialBackoffMs * Math.pow(2, attempt);
          const jitterMs = Math.random() * 1000;
          const totalWaitMs = backoffMs + jitterMs;

          logger.debug(
            `${operationName} failed with ${lastError.message}, retrying in ${totalWaitMs.toFixed(0)}ms (attempt ${attempt + 1}/${this.maxRetries - 1})`,
          );

          await new Promise((resolve) => setTimeout(resolve, totalWaitMs));
        }
      }
    }

    throw new LLMError(
      `${operationName} failed after ${this.maxRetries} attempts: ${lastError?.message || 'unknown error'}`,
      { cause: lastError },
    );
  }

  abstract complete(request: LLMRequest): Promise<LLMResponse>;
  abstract stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}
