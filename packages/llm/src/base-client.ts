/**
 * Base LLM client implementation with common functionality.
 *
 * Provides shared logic for all LLM provider clients, including request
 * building, response parsing, error handling, and retry logic.
 */

import type {
  LLMClientInterface,
  LLMRequest,
  LLMResponse,
  LLMStreamResponse,
} from './client.interface.js';
import { LLMError, RateLimitError, ProviderError } from '@agentbuilder/core';
import { retryWithExponentialBackoff } from '@agentbuilder/core/utils/retry';

export abstract class BaseLLMClient implements LLMClientInterface {
  protected apiKey: string;
  protected model: string;
  protected baseUrl?: string;
  protected timeout: number = 30000; // 30 seconds default

  constructor(apiKey: string, model: string, baseUrl?: string) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new LLMError('API key is required and cannot be empty');
    }
    if (!model || model.trim().length === 0) {
      throw new LLMError('Model name is required and cannot be empty');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  setTimeout(ms: number): void {
    if (ms <= 0) {
      throw new LLMError('Timeout must be a positive number');
    }
    this.timeout = ms;
  }

  abstract complete(request: LLMRequest): Promise<LLMResponse>;
  abstract stream(request: LLMRequest): Promise<LLMStreamResponse>;

  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    operation: string,
    maxRetries: number = 3,
  ): Promise<T> {
    return retryWithExponentialBackoff(
      fn,
      {
        maxRetries,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
      },
      (error: Error, attempt: number) => {
        const isRetryable = this.isRetryableError(error);
        if (isRetryable) {
          console.warn(
            `[LLM] ${operation} failed (attempt ${attempt}/${maxRetries}): ${error.message}`,
          );
        }
        return isRetryable;
      },
    );
  }

  protected isRetryableError(error: Error): boolean {
    if (error instanceof RateLimitError) return true;
    if (error instanceof ProviderError) {
      // Retry on 5xx errors and specific 4xx transient errors
      const statusCode = (error as any).statusCode;
      if (statusCode >= 500) return true;
      if ([408, 429].includes(statusCode)) return true;
      return false;
    }
    // Retry on network-level errors
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up')
    );
  }

  protected buildHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'agentbuilder/1.0',
      ...additionalHeaders,
    };
    return headers;
  }

  protected validateRequest(request: LLMRequest): void {
    if (!request) {
      throw new LLMError('Request object is required');
    }
    if (!request.messages || request.messages.length === 0) {
      throw new LLMError('Request must contain at least one message');
    }
    if (request.temperature !== undefined) {
      if (request.temperature < 0 || request.temperature > 2) {
        throw new LLMError('Temperature must be between 0 and 2');
      }
    }
    if (request.maxTokens !== undefined && request.maxTokens < 1) {
      throw new LLMError('maxTokens must be at least 1');
    }
    if (request.topP !== undefined) {
      if (request.topP < 0 || request.topP > 1) {
        throw new LLMError('topP must be between 0 and 1');
      }
    }
  }

  protected createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new LLMError(
            `Request timeout after ${this.timeout}ms. The LLM provider did not respond in time.`,
          ),
        );
      }, this.timeout);
    });
  }
}
