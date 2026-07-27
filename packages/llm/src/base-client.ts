import type {
  ILLMClient,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  ModelInfo,
} from './client.interface.js';
import { LLMError } from '@agentbuilder/core';
import { logger } from '@agentbuilder/core';

export abstract class BaseLLMClient implements ILLMClient {
  protected model: string;
  protected baseUrl?: string;
  protected timeout: number = 60000;
  protected maxRetries: number = 3;
  protected retryDelayMs: number = 1000;

  constructor(model: string, baseUrl?: string) {
    if (!model || model.trim().length === 0) {
      throw new LLMError('Model name cannot be empty');
    }
    this.model = model;
    this.baseUrl = baseUrl;
  }

  abstract call(request: LLMRequest): Promise<LLMResponse>;

  abstract stream(
    request: LLMRequest
  ): AsyncIterable<LLMStreamEvent>;

  abstract getModelInfo(): Promise<ModelInfo>;

  /**
   * Retry logic with exponential backoff for transient failures.
   * Does not retry on validation errors (4xx) or rate limit exhaustion after max retries.
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const error = err instanceof Error ? err : new Error(String(err));
        const statusCode = (err as any)?.statusCode;
        const isRetryable =
          statusCode === undefined ||
          statusCode >= 500 ||
          statusCode === 429 ||
          error.message.includes('timeout') ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT');

        if (!isRetryable || attempt === this.maxRetries) {
          logger.error(`[${operationName}] Failed after ${attempt} attempt(s)`, {
            error: error.message,
            attempt,
            statusCode,
          });
          throw error;
        }

        const delayMs = this.retryDelayMs * Math.pow(2, attempt - 1);
        logger.debug(`[${operationName}] Retry attempt ${attempt}/${this.maxRetries} after ${delayMs}ms`, {
          error: error.message,
          statusCode,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new LLMError(`${operationName} failed after ${this.maxRetries} retries`);
  }

  protected async withTimeout<T>(
    promise: Promise<T>,
    operationName: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new LLMError(`${operationName} timed out after ${this.timeout}ms`)),
          this.timeout
        )
      ),
    ]);
  }

  protected validateRequest(request: LLMRequest): void {
    if (!request.messages || request.messages.length === 0) {
      throw new LLMError('Request must contain at least one message');
    }

    for (const msg of request.messages) {
      if (!msg.role || !['user', 'assistant', 'system'].includes(msg.role)) {
        throw new LLMError(`Invalid message role: ${msg.role}`);
      }
      if (typeof msg.content !== 'string' || msg.content.trim().length === 0) {
        throw new LLMError('Message content must be a non-empty string');
      }
    }

    if (request.maxTokens && request.maxTokens <= 0) {
      throw new LLMError('maxTokens must be a positive integer');
    }

    if (request.temperature !== undefined) {
      if (request.temperature < 0 || request.temperature > 2) {
        throw new LLMError('temperature must be between 0 and 2');
      }
    }
  }
}
