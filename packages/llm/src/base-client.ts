import type { LLMRequest, LLMResponse, LLMStreamEvent } from './client.interface.js';
import { LLMError, ValidationError } from '@agentbuilder/core';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

export abstract class BaseLLMClient {
  protected timeout: number;
  protected maxRetries: number;

  constructor(timeout?: number, maxRetries?: number) {
    this.timeout = timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = maxRetries ?? DEFAULT_RETRIES;

    if (this.timeout <= 0) {
      throw new ValidationError('Timeout must be positive');
    }
    if (this.maxRetries < 0) {
      throw new ValidationError('Max retries must be non-negative');
    }
  }

  async request(req: LLMRequest): Promise<LLMResponse> {
    if (!req || !req.messages || req.messages.length === 0) {
      throw new ValidationError('LLM request must contain at least one message');
    }

    if (!req.model || typeof req.model !== 'string' || req.model.trim().length === 0) {
      throw new ValidationError('LLM request must specify a non-empty model');
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.executeRequest(req);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        const isRetryable = this.isRetryableError(lastError);
        const isLastAttempt = attempt === this.maxRetries;

        if (!isRetryable || isLastAttempt) {
          throw lastError;
        }

        const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new LLMError('Unknown error during LLM request');
  }

  async stream(req: LLMRequest): Promise<AsyncIterable<LLMStreamEvent>> {
    if (!req || !req.messages || req.messages.length === 0) {
      throw new ValidationError('LLM request must contain at least one message');
    }

    if (!req.model || typeof req.model !== 'string' || req.model.trim().length === 0) {
      throw new ValidationError('LLM request must specify a non-empty model');
    }

    return this.executeStream(req);
  }

  protected isRetryableError(err: Error): boolean {
    if (err instanceof ValidationError) {
      return false;
    }

    const message = err.message.toLowerCase();
    const retryablePatterns = [
      'timeout',
      'econnreset',
      'enotfound',
      'etimedout',
      'connection refused',
      'temporarily unavailable',
      '429',
      '503',
      '502',
      '504',
    ];

    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  protected abstract executeRequest(req: LLMRequest): Promise<LLMResponse>;
  protected abstract executeStream(req: LLMRequest): Promise<AsyncIterable<LLMStreamEvent>>;
}
