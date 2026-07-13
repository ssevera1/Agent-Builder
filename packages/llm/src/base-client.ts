import type {
  LLMClientInterface,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
} from './client.interface.js';
import { LLMError } from '@agentbuilder/core';
import { retryWithBackoff } from '@agentbuilder/core/utils/retry.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export abstract class BaseLLMClient implements LLMClientInterface {
  protected timeoutMs: number = DEFAULT_TIMEOUT_MS;
  protected maxRetries: number = DEFAULT_MAX_RETRIES;
  protected retryDelayMs: number = DEFAULT_RETRY_DELAY_MS;

  abstract generateCompletion(request: LLMRequest): Promise<LLMResponse>;
  abstract streamCompletion(request: LLMRequest): AsyncGenerator<LLMStreamEvent>;

  setTimeoutMs(ms: number): void {
    if (ms <= 0) {
      throw new Error('Timeout must be positive');
    }
    this.timeoutMs = ms;
  }

  setMaxRetries(count: number): void {
    if (count < 0) {
      throw new Error('Max retries must be non-negative');
    }
    this.maxRetries = count;
  }

  setRetryDelayMs(ms: number): void {
    if (ms < 0) {
      throw new Error('Retry delay must be non-negative');
    }
    this.retryDelayMs = ms;
  }

  protected async withTimeout<T>(
    promise: Promise<T>,
    label: string,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new LLMError(`Request timeout after ${this.timeoutMs}ms: ${label}`, 'TIMEOUT')),
          this.timeoutMs,
        ),
      ),
    ]);
  }

  protected async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<T> {
    return retryWithBackoff(
      fn,
      this.maxRetries,
      this.retryDelayMs,
      (err) => {
        if (err instanceof LLMError) {
          return err.isRetryable();
        }
        return err instanceof TypeError || err instanceof Error && err.message.includes('timeout');
      },
      label,
    );
  }

  protected validateRequest(request: LLMRequest): void {
    if (!request) {
      throw new LLMError('Request cannot be null or undefined', 'VALIDATION_ERROR');
    }
    if (!request.messages || request.messages.length === 0) {
      throw new LLMError('Request must contain at least one message', 'VALIDATION_ERROR');
    }
    if (!request.model) {
      throw new LLMError('Request must specify a model', 'VALIDATION_ERROR');
    }
    if (typeof request.model !== 'string' || request.model.trim().length === 0) {
      throw new LLMError('Model must be a non-empty string', 'VALIDATION_ERROR');
    }
    if (request.maxTokens !== undefined && request.maxTokens <= 0) {
      throw new LLMError('maxTokens must be positive', 'VALIDATION_ERROR');
    }
    if (request.temperature !== undefined && (request.temperature < 0 || request.temperature > 2)) {
      throw new LLMError('Temperature must be between 0 and 2', 'VALIDATION_ERROR');
    }
  }

  protected validateResponse(response: LLMResponse): void {
    if (!response) {
      throw new LLMError('Response cannot be null or undefined', 'VALIDATION_ERROR');
    }
    if (!response.content || response.content.trim().length === 0) {
      throw new LLMError('Response content cannot be empty', 'VALIDATION_ERROR');
    }
    if (typeof response.content !== 'string') {
      throw new LLMError('Response content must be a string', 'VALIDATION_ERROR');
    }
    if (response.usage) {
      if (response.usage.promptTokens < 0 || response.usage.completionTokens < 0) {
        throw new LLMError('Token counts cannot be negative', 'VALIDATION_ERROR');
      }
    }
  }
}
