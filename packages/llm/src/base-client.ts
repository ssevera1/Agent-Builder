/**
 * Base LLM client with retry logic, timeout handling, and streaming support.
 */

import { LLMError, ValidationError } from '@agentbuilder/core';
import type {
  ClientConfig,
  CompletionMessage,
  CompletionRequest,
  StreamChunk,
  LLMClientInterface,
} from './client.interface.js';

export abstract class BaseLLMClient implements LLMClientInterface {
  protected config: ClientConfig;
  private readonly defaultTimeout = 120_000; // 2 minutes
  private readonly defaultMaxRetries = 3;
  private readonly defaultRetryDelayMs = 1000;

  constructor(config: ClientConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? this.defaultTimeout,
      maxRetries: config.maxRetries ?? this.defaultMaxRetries,
      retryDelayMs: config.retryDelayMs ?? this.defaultRetryDelayMs,
    };
  }

  /**
   * Execute completion with retry and timeout logic.
   */
  async complete(request: CompletionRequest): Promise<CompletionMessage> {
    if (!request.messages || request.messages.length === 0) {
      throw new ValidationError('CompletionRequest must include at least one message');
    }

    const maxRetries = request.maxRetries ?? this.config.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.withTimeout(
          this.completeImpl(request),
          this.config.timeout!,
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const isRetryable = this.isRetryableError(error);
        const isLastAttempt = attempt === maxRetries - 1;

        if (!isRetryable || isLastAttempt) {
          throw this.normalizeError(lastError);
        }

        const delayMs = this.config.retryDelayMs! * Math.pow(2, attempt);
        await this.sleep(delayMs);
      }
    }

    throw new LLMError('Exhausted retry attempts', { cause: lastError });
  }

  /**
   * Stream completion with retry and timeout logic.
   */
  async *stream(
    request: CompletionRequest,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    if (!request.messages || request.messages.length === 0) {
      throw new ValidationError('CompletionRequest must include at least one message');
    }

    const maxRetries = request.maxRetries ?? this.config.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        yield* this.withTimeoutGenerator(
          this.streamImpl(request),
          this.config.timeout!,
        );
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const isRetryable = this.isRetryableError(error);
        const isLastAttempt = attempt === maxRetries - 1;

        if (!isRetryable || isLastAttempt) {
          throw this.normalizeError(lastError);
        }

        const delayMs = this.config.retryDelayMs! * Math.pow(2, attempt);
        await this.sleep(delayMs);
      }
    }

    throw new LLMError('Exhausted retry attempts', { cause: lastError });
  }

  /**
   * Provider-specific completion implementation.
   */
  protected abstract completeImpl(
    request: CompletionRequest,
  ): Promise<CompletionMessage>;

  /**
   * Provider-specific stream implementation.
   */
  protected abstract streamImpl(
    request: CompletionRequest,
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * Wrap promise with timeout.
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new LLMError(`Request timeout after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Wrap async generator with timeout.
   */
  private async *withTimeoutGenerator<T>(
    generator: AsyncGenerator<T, void, unknown>,
    timeoutMs: number,
  ): AsyncGenerator<T, void, unknown> {
    let timeout: NodeJS.Timeout | null = null;
    let done = false;

    try {
      timeout = setTimeout(() => {
        if (!done) {
          throw new LLMError(`Stream timeout after ${timeoutMs}ms`);
        }
      }, timeoutMs);

      for await (const chunk of generator) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (!done) {
            throw new LLMError(`Stream timeout after ${timeoutMs}ms`);
          }
        }, timeoutMs);
        yield chunk;
      }
    } finally {
      done = true;
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Determine if an error is retryable.
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const retryablePatterns = [
      /timeout/i,
      /econnrefused/i,
      /econnreset/i,
      /etimedout/i,
      /ENOTFOUND/i,
      /temporarily unavailable/i,
      /service unavailable/i,
      /rate.?limit/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(error.message));
  }

  /**
   * Normalize errors into LLMError with context.
   */
  private normalizeError(error: Error): Error {
    if (error instanceof LLMError) return error;
    if (error instanceof ValidationError) return error;
    return new LLMError(error.message, { cause: error });
  }

  /**
   * Sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
