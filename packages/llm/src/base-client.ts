/**
 * Base LLM client with shared logic for all providers.
 *
 * Handles request/response marshalling, retry logic, token counting,
 * and error handling across all LLM providers.
 */

import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
} from './client.interface.js';
import { LLMError, ValidationError } from '@agentbuilder/core';
import { logger } from '@agentbuilder/core';
import { retryWithExponentialBackoff } from '@agentbuilder/core';
import { countTokens } from '@agentbuilder/core';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

export interface BaseClientConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export abstract class BaseClient {
  protected apiKey?: string;
  protected baseUrl?: string;
  protected timeout: number;
  protected maxRetries: number;
  protected retryDelayMs: number;

  constructor(config: BaseClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    if (this.timeout <= 0) {
      throw new ValidationError('timeout must be a positive number');
    }
    if (this.maxRetries < 0) {
      throw new ValidationError('maxRetries must be non-negative');
    }
  }

  /**
   * Make a request with automatic retry, timeout, and error handling.
   */
  protected async makeRequest<T>(
    fn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`${operationName} attempt ${attempt + 1}/${this.maxRetries + 1}`);

        const result = await Promise.race([
          fn(),
          this.createTimeoutPromise(),
        ]);

        if (attempt > 0) {
          logger.debug(`${operationName} succeeded after ${attempt} retries`);
        }

        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if error is retryable
        if (!this.isRetryableError(lastError) || attempt === this.maxRetries) {
          throw lastError;
        }

        const delayMs = this.retryDelayMs * Math.pow(2, attempt);
        logger.warn(
          `${operationName} failed (attempt ${attempt + 1}): ${lastError.message}. ` +
          `Retrying in ${delayMs}ms...`,
        );

        await this.delay(delayMs);
      }
    }

    throw lastError || new LLMError('Unknown error during request');
  }

  /**
   * Determine if an error is worth retrying.
   */
  protected isRetryableError(err: Error): boolean {
    const message = err.message.toLowerCase();

    // Network/timeout errors
    if (
      err.name === 'TimeoutError' ||
      err.name === 'AbortError' ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up') ||
      message.includes('network') ||
      message.includes('timeout')
    ) {
      return true;
    }

    // Rate limiting / service unavailable
    if (
      message.includes('429') ||
      message.includes('503') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('service unavailable')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Create a promise that rejects after the configured timeout.
   */
  private createTimeoutPromise<T>(): Promise<T> {
    return new Promise((_, reject) => {
      const timeoutId = setTimeout(
        () => {
          const err = new Error(
            `Request timeout after ${this.timeout}ms`,
          );
          err.name = 'TimeoutError';
          reject(err);
        },
        this.timeout,
      );

      // Ensure timeout doesn't keep process alive
      if (typeof timeoutId === 'object' && timeoutId.unref) {
        timeoutId.unref();
      }
    });
  }

  /**
   * Sleep for the given duration in milliseconds.
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Validate the response structure.
   */
  protected validateResponse(response: unknown): asserts response is LLMResponse {
    if (typeof response !== 'object' || response === null) {
      throw new ValidationError('Response is not an object');
    }

    const obj = response as Record<string, unknown>;

    if (typeof obj.content !== 'string') {
      throw new ValidationError('Response.content must be a string');
    }

    if (obj.finishReason !== undefined && typeof obj.finishReason !== 'string') {
      throw new ValidationError('Response.finishReason must be a string if provided');
    }

    if (obj.usage !== undefined) {
      if (typeof obj.usage !== 'object' || obj.usage === null) {
        throw new ValidationError('Response.usage must be an object if provided');
      }
      const usage = obj.usage as Record<string, unknown>;
      if (typeof usage.inputTokens !== 'number') {
        throw new ValidationError('Response.usage.inputTokens must be a number');
      }
      if (typeof usage.outputTokens !== 'number') {
        throw new ValidationError('Response.usage.outputTokens must be a number');
      }
    }
  }

  /**
   * Estimate token count for a message.
   * Subclasses can override for provider-specific implementations.
   */
  protected estimateTokenCount(text: string): number {
    return countTokens(text);
  }

  /**
   * Abstract methods that subclasses must implement.
   */
  abstract call(request: LLMRequest): Promise<LLMResponse>;

  abstract stream(
    request: LLMRequest,
  ): AsyncIterable<LLMStreamChunk>;

  abstract getModelInfo(modelId: string): ModelInfo | null;
}
