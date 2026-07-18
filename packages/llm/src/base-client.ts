/**
 * Base LLM client class.
 *
 * Provides common functionality for all LLM provider implementations,
 * including request/response handling, error management, and token counting.
 */

import type { ClientOptions, ClientResponse } from './client.interface.js';
import { LLMError } from '@agentbuilder/core';
import { getTokenCounter } from '@agentbuilder/core';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1_000;

export abstract class BaseLLMClient {
  protected name: string;
  protected apiKey: string;
  protected baseUrl?: string;
  protected timeoutMs: number;
  protected maxRetries: number;

  constructor(
    name: string,
    apiKey: string,
    options: ClientOptions = {},
  ) {
    if (!apiKey || apiKey.trim() === '') {
      throw new LLMError(`Missing API key for provider "${name}"`);
    }

    this.name = name;
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
  }

  /**
   * Execute a request with automatic retry on transient failures.
   * Implements exponential backoff for retries.
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

        const isRetryable =
          err instanceof Error &&
          (err.message.includes('ECONNREFUSED') ||
            err.message.includes('ETIMEDOUT') ||
            err.message.includes('EHOSTUNREACH') ||
            err.message.includes('429') ||
            err.message.includes('503'));

        if (attempt === this.maxRetries || !isRetryable) {
          break;
        }

        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new LLMError(
      `${operationName} failed after ${this.maxRetries + 1} attempts: ${lastError?.message || 'unknown error'}`,
      { cause: lastError },
    );
  }

  /**
   * Wrap a promise with a timeout.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Request timeout after ${ms}ms`)),
          ms,
        ),
      ),
    ]);
  }

  /**
   * Count tokens in a text using the provider's model.
   * Falls back to a heuristic estimate if exact counting is unavailable.
   */
  protected countTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    try {
      const counter = getTokenCounter();
      return counter.estimate(text);
    } catch {
      // Fallback: rough heuristic (1 token ≈ 4 chars)
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Validate response structure and throw if critical fields are missing.
   */
  protected validateResponse(response: unknown): asserts response is ClientResponse {
    if (
      !response ||
      typeof response !== 'object' ||
      !('content' in response) ||
      !('model' in response) ||
      !('usage' in response)
    ) {
      throw new LLMError(
        `Invalid response structure from ${this.name}: missing required fields (content, model, usage)`,
      );
    }
  }

  /**
   * Sanitize and validate model name to catch typos early.
   */
  protected validateModel(model: string): string {
    if (!model || model.trim() === '') {
      throw new LLMError('Model name cannot be empty');
    }
    return model.trim();
  }
}
