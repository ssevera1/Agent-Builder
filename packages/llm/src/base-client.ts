import type { LLMClientInterface, LLMRequest, LLMResponse, LLMStreamChunk } from './client.interface.js';
import { LLMError } from '@agentbuilder/core';
import { logger } from '@agentbuilder/core';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

export abstract class BaseLLMClient implements LLMClientInterface {
  protected timeoutMs: number = DEFAULT_TIMEOUT_MS;
  protected maxRetries: number = DEFAULT_MAX_RETRIES;
  protected retryDelayMs: number = DEFAULT_RETRY_DELAY_MS;

  protected async withRetry<T>(
    fn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        return await this.withTimeout(fn, operationName);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        const isRetryable = this.isRetryableError(lastError);
        const isLastAttempt = attempt > this.maxRetries;

        if (!isRetryable || isLastAttempt) {
          logger.error(
            `${operationName} failed after ${attempt} attempt(s)`,
            { error: lastError.message, isRetryable },
          );
          throw lastError;
        }

        const delayMs = this.retryDelayMs * Math.pow(2, attempt - 2);
        logger.warn(
          `${operationName} attempt ${attempt} failed, retrying in ${delayMs}ms`,
          { error: lastError.message },
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError || new Error(`${operationName} failed after ${this.maxRetries + 1} attempts`);
  }

  protected async withTimeout<T>(
    fn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new LLMError(`${operationName} timed out after ${this.timeoutMs}ms`)),
          this.timeoutMs,
        ),
      ),
    ]);
  }

  protected isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('temporary') ||
      message.includes('unavailable') ||
      message.includes('too many requests')
    );
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  abstract complete(request: LLMRequest): Promise<LLMResponse>;
  abstract stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk>;
}
