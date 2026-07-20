/**
 * Base LLM client with common retry, timeout, and error handling logic.
 *
 * All provider-specific clients inherit from this to ensure consistent
 * behavior across different LLM providers.
 */

import { LLMError, LLMRateLimitError, LLMTimeoutError } from '@agentbuilder/core';
import type { ClientMessage, ClientOptions, CompletionResponse } from './client.interface.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const RATE_LIMIT_RETRY_DELAY_MS = 5_000;

export abstract class BaseClient {
  protected timeoutMs: number;
  protected maxRetries: number;
  protected retryDelayMs: number;

  constructor(options?: ClientOptions) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /**
   * Execute a request with automatic retry logic, timeout enforcement, and error handling.
   */
  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.withTimeout(fn(), this.timeoutMs);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        const isRateLimit = this.isRateLimitError(lastError);
        const isTimeout = lastError instanceof LLMTimeoutError;
        const isTransient = isRateLimit || isTimeout || this.isTransientError(lastError);

        if (!isTransient) {
          throw lastError;
        }

        if (attempt < this.maxRetries) {
          const delayMs = isRateLimit ? RATE_LIMIT_RETRY_DELAY_MS : this.retryDelayMs;
          await this.delay(delayMs);
        }
      }
    }

    throw new LLMError(
      `${operationName} failed after ${this.maxRetries + 1} attempts: ${lastError?.message ?? 'Unknown error'}`,
    );
  }

  /**
   * Enforce a timeout on an async operation.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new LLMTimeoutError(`Operation exceeded timeout of ${ms}ms`)),
          ms,
        ),
      ),
    ]);
  }

  /**
   * Sleep for a given duration.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if an error is a rate limit error that should be retried.
   */
  protected isRateLimitError(err: Error): boolean {
    if (err instanceof LLMRateLimitError) {
      return true;
    }
    const message = err.message?.toLowerCase() ?? '';
    return (
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('quota') ||
      message.includes('too many requests')
    );
  }

  /**
   * Check if an error is transient and may succeed on retry.
   */
  protected isTransientError(err: Error): boolean {
    const message = err.message?.toLowerCase() ?? '';
    return (
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('network') ||
      message.includes('temporarily unavailable') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('504')
    );
  }

  /**
   * Subclasses implement this to make the actual API call.
   */
  abstract complete(
    messages: ClientMessage[],
    options?: ClientOptions,
  ): Promise<CompletionResponse>;

  /**
   * Subclasses implement this to compute token count.
   */
  abstract countTokens(text: string): number;
}
