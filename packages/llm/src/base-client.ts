import type { LLMMessage, LLMResponse, LLMOptions } from './client.interface.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export abstract class BaseLLMClient {
  protected timeoutMs: number;
  protected retryCount: number;
  protected retryDelayMs: number;

  constructor(
    timeoutMs?: number,
    retryCount?: number,
    retryDelayMs?: number,
  ) {
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryCount = retryCount ?? DEFAULT_RETRY_COUNT;
    this.retryDelayMs = retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    if (this.timeoutMs <= 0) {
      throw new Error('timeoutMs must be greater than 0');
    }
    if (this.retryCount < 0) {
      throw new Error('retryCount must be non-negative');
    }
    if (this.retryDelayMs < 0) {
      throw new Error('retryDelayMs must be non-negative');
    }
  }

  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      try {
        return await this.executeWithTimeout(fn, operationName);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        const isRetryable = this.isRetryableError(lastError);
        const isLastAttempt = attempt === this.retryCount;

        if (!isRetryable || isLastAttempt) {
          throw lastError;
        }

        const delayMs = this.retryDelayMs * Math.pow(2, attempt);
        await this.delay(delayMs);
      }
    }

    throw lastError ?? new Error('Unknown error in executeWithRetry');
  }

  protected async executeWithTimeout<T>(
    fn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${operationName} timed out after ${this.timeoutMs}ms`)),
          this.timeoutMs,
        ),
      ),
    ]);
  }

  protected isRetryableError(err: Error): boolean {
    const message = err.message.toLowerCase();
    if (message.includes('timeout')) return true;
    if (message.includes('econnrefused')) return true;
    if (message.includes('econnreset')) return true;
    if (message.includes('503') || message.includes('service unavailable')) return true;
    if (message.includes('429') || message.includes('rate limit')) return true;
    return false;
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  abstract complete(
    messages: LLMMessage[],
    options?: LLMOptions,
  ): Promise<LLMResponse>;

  abstract stream(
    messages: LLMMessage[],
    options?: LLMOptions,
  ): AsyncGenerator<string>;
}
