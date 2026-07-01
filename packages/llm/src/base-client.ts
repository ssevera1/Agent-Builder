import type { LLMRequest, LLMResponse, LLMStreamEvent } from './client.interface.js';
import { LLMError } from '@agentbuilder/core';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export interface BaseClientOptions {
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

export abstract class BaseLLMClient {
  protected timeoutMs: number;
  protected retryAttempts: number;
  protected retryDelayMs: number;

  constructor(options: BaseClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    if (this.timeoutMs <= 0) {
      throw new LLMError('timeoutMs must be positive', { timeoutMs: this.timeoutMs });
    }
    if (this.retryAttempts < 0) {
      throw new LLMError('retryAttempts must be non-negative', { retryAttempts: this.retryAttempts });
    }
    if (this.retryDelayMs <= 0) {
      throw new LLMError('retryDelayMs must be positive', { retryDelayMs: this.retryDelayMs });
    }
  }

  protected async withRetry<T>(
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        return await this.withTimeout(fn);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        const isRetryable = this.isRetryableError(lastError);
        const isLastAttempt = attempt === this.retryAttempts;

        if (!isRetryable || isLastAttempt) {
          throw new LLMError(
            `Request failed after ${attempt} attempt${attempt !== 1 ? 's' : ''}: ${lastError.message}`,
            {
              cause: lastError,
              attempt,
              retriable: isRetryable,
              ...context,
            },
          );
        }

        const delayMs = this.retryDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new LLMError('Unexpected retry loop exit', context);
  }

  protected async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new LLMError(`Request timeout after ${this.timeoutMs}ms`)),
          this.timeoutMs,
        ),
      ),
    ]);
  }

  protected isRetryableError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('eagain') ||
      msg.includes('503') ||
      msg.includes('429') ||
      msg.includes('rate limit')
    );
  }

  abstract complete(request: LLMRequest): Promise<LLMResponse>;
  abstract stream(request: LLMRequest): AsyncIterable<LLMStreamEvent>;
}
