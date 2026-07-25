import type { LLMMessage, LLMResponse, LLMOptions } from './client.interface.js';

/**
 * Base class for LLM clients.
 * Provides common retry logic, timeout handling, and error recovery.
 */
export abstract class BaseLLMClient {
  protected readonly modelId: string;
  protected readonly apiKey: string;
  protected readonly baseUrl?: string;
  protected readonly timeout: number;
  protected readonly maxRetries: number;
  protected readonly retryDelayMs: number;

  constructor(modelId: string, apiKey: string, baseUrl?: string, timeout = 30000) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('API key cannot be empty');
    }
    if (!modelId || modelId.trim() === '') {
      throw new Error('Model ID cannot be empty');
    }
    this.modelId = modelId;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeout = timeout;
    this.maxRetries = parseInt(process.env.LLM_MAX_RETRIES || '3', 10);
    this.retryDelayMs = parseInt(process.env.LLM_RETRY_DELAY_MS || '1000', 10);
  }

  /**
   * Send a message to the LLM and get a response.
   * Implements exponential backoff retry logic.
   */
  async sendMessage(
    messages: LLMMessage[],
    options?: LLMOptions,
  ): Promise<LLMResponse> {
    if (!messages || messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    return this.sendWithRetry(messages, options, 0);
  }

  /**
   * Internal retry loop with exponential backoff.
   */
  private async sendWithRetry(
    messages: LLMMessage[],
    options: LLMOptions | undefined,
    attempt: number,
  ): Promise<LLMResponse> {
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await this.call(messages, options, controller.signal);
        clearTimeout(timeoutHandle);

        if (!response || typeof response !== 'object') {
          throw new Error('Invalid response from LLM provider');
        }
        if (!response.text || typeof response.text !== 'string') {
          throw new Error('Response missing required text field');
        }

        return response;
      } catch (err) {
        clearTimeout(timeoutHandle);
        throw err;
      }
    } catch (err) {
      const isRetryable = this.isRetryableError(err);
      const hasAttemptsLeft = attempt < this.maxRetries;

      if (isRetryable && hasAttemptsLeft) {
        const delayMs = this.retryDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.sendWithRetry(messages, options, attempt + 1);
      }

      if (err instanceof Error) {
        throw new Error(`LLM request failed after ${attempt + 1} attempt(s): ${err.message}`);
      }
      throw new Error(`LLM request failed: ${String(err)}`);
    }
  }

  /**
   * Determine if an error is retryable (network issues, rate limits, timeouts).
   */
  private isRetryableError(err: unknown): boolean {
    if (!(err instanceof Error)) {
      return false;
    }

    const message = err.message.toLowerCase();
    const retryablePatterns = [
      'econnrefused',
      'econnreset',
      'timeout',
      'enotfound',
      'enetunreach',
      '429',
      '503',
      '502',
      'rate limit',
      'too many requests',
      'service unavailable',
    ];

    return retryablePatterns.some((pattern) => message.includes(pattern));
  }

  /**
   * Abstract method to be implemented by subclasses.
   */
  abstract call(
    messages: LLMMessage[],
    options: LLMOptions | undefined,
    signal: AbortSignal,
  ): Promise<LLMResponse>;
}
