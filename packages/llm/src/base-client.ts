import type {
  LLMClientConfig,
  LLMMessage,
  LLMResponse,
  LLMStreamEvent,
} from './client.interface.js';
import { LLMError } from '@agentbuilder/core';
import { logger } from '@agentbuilder/core';

export abstract class BaseLLMClient {
  protected config: LLMClientConfig;
  protected maxRetries: number = 3;
  protected retryDelayMs: number = 1000;

  constructor(config: LLMClientConfig) {
    if (!config) {
      throw new LLMError('LLMClientConfig is required');
    }
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new LLMError(`Missing or empty apiKey for provider: ${config.provider}`);
    }
    this.config = config;
  }

  protected async retryWithBackoff<T>(
    fn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRetryable = this.isRetryableError(lastError);

        if (!isRetryable || attempt === this.maxRetries) {
          logger.error(`${operationName} failed after ${attempt} attempt(s)`, {
            error: lastError.message,
            provider: this.config.provider,
            retryable: isRetryable,
          });
          throw lastError;
        }

        const delayMs = this.retryDelayMs * Math.pow(2, attempt - 1);
        logger.debug(`${operationName} attempt ${attempt} failed, retrying in ${delayMs}ms`, {
          error: lastError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new LLMError('Unknown error in retryWithBackoff');
  }

  protected isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('429') ||
      message.includes('500') ||
      message.includes('503')
    );
  }

  protected validateMessages(messages: LLMMessage[]): void {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new LLMError('At least one message is required');
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.role || !['user', 'assistant', 'system'].includes(msg.role)) {
        throw new LLMError(`Invalid message role at index ${i}: ${msg.role}`);
      }
      if (!msg.content || (typeof msg.content === 'string' && msg.content.trim() === '')) {
        throw new LLMError(`Empty or missing content at message index ${i}`);
      }
    }
  }

  protected validateResponse(response: LLMResponse): void {
    if (!response) {
      throw new LLMError('Response object is null or undefined');
    }
    if (!response.content || (typeof response.content === 'string' && response.content.trim() === '')) {
      throw new LLMError('Response content is empty');
    }
    if (typeof response.usage?.inputTokens !== 'number' || response.usage.inputTokens < 0) {
      throw new LLMError('Invalid or missing inputTokens in response');
    }
    if (typeof response.usage?.outputTokens !== 'number' || response.usage.outputTokens < 0) {
      throw new LLMError('Invalid or missing outputTokens in response');
    }
  }

  abstract complete(messages: LLMMessage[]): Promise<LLMResponse>;
  abstract stream(messages: LLMMessage[]): AsyncIterable<LLMStreamEvent>;
}
