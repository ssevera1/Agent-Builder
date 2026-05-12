import type {
  LLMRequest,
  LLMStreamChunk,
  ModelInfo,
  TokenUsage,
} from '@agentbuilder/core';
import type { LLMClient } from './client.interface.js';

/** Classified error codes returned by providers. */
export type ProviderErrorCode =
  | 'rate_limit'
  | 'auth'
  | 'context_length'
  | 'invalid_request'
  | 'server_error'
  | 'network'
  | 'timeout'
  | 'overloaded'
  | 'content_filter'
  | 'unknown';

/**
 * Structured error emitted by LLM clients.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

/**
 * Abstract base class implementing common LLM client functionality:
 * retry logic, token tracking, error classification, and logging.
 */
export abstract class BaseClient implements LLMClient {
  abstract readonly providerId: string;
  abstract readonly modelId: string;

  protected readonly retryConfig: RetryConfig;
  private _totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  constructor(options?: { retry?: Partial<RetryConfig> }) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options?.retry };
  }

  get totalUsage(): Readonly<TokenUsage> {
    return { ...this._totalUsage };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    yield* this.complete(request);
  }

  async *complete(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const startTime = Date.now();
    let attempt = 0;

    while (true) {
      try {
        this.logRequest(request, attempt);
        const stream = this._rawComplete(request);

        for await (const chunk of stream) {
          if (chunk.type === 'usage' && chunk.usage) {
            this._totalUsage.inputTokens += chunk.usage.inputTokens;
            this._totalUsage.outputTokens += chunk.usage.outputTokens;
            this._totalUsage.totalTokens += chunk.usage.totalTokens;
          }
          yield chunk;
        }

        this.logResponse(Date.now() - startTime, attempt);
        return;
      } catch (err) {
        const llmError = this.classifyError(err);
        attempt++;

        if (!llmError.retryable || attempt > this.retryConfig.maxRetries) {
          yield {
            type: 'error' as const,
            error: { code: llmError.code, message: llmError.message },
          };
          yield { type: 'done' as const, finishReason: 'error' as const };
          return;
        }

        const delay = this.computeRetryDelay(attempt, llmError.retryAfterMs);
        this.logRetry(attempt, delay, llmError);
        await this.sleep(delay);
      }
    }
  }

  async countTokens(text: string): Promise<number> {
    try {
      return await this._rawCountTokens(text);
    } catch {
      return Math.ceil(text.length / 4);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return this._rawListModels();
  }

  abstract getModelInfo(): ModelInfo;
  abstract supportsToolUse(): boolean;
  abstract supportsVision(): boolean;
  abstract supportsStreaming(): boolean;

  protected abstract _rawComplete(
    request: LLMRequest,
  ): AsyncIterable<LLMStreamChunk>;

  protected abstract _rawCountTokens(text: string): Promise<number>;

  protected abstract _rawListModels(): Promise<ModelInfo[]>;

  /**
   * Classify a raw error into a structured ProviderError.
   * Subclasses can override to handle provider-specific error formats.
   */
  protected classifyError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    const message = err instanceof Error ? err.message : String(err);
    const statusCode = this.extractStatusCode(err);

    if (statusCode === 401 || statusCode === 403) {
      return new ProviderError(message, 'auth', statusCode, false);
    }
    if (statusCode === 429) {
      const retryAfter = this.extractRetryAfter(err);
      return new ProviderError(message, 'rate_limit', statusCode, true, retryAfter);
    }
    if (statusCode === 400) {
      if (/context.*(length|window|too long|token)/i.test(message)) {
        return new ProviderError(message, 'context_length', statusCode, false);
      }
      return new ProviderError(message, 'invalid_request', statusCode, false);
    }
    if (statusCode === 529 || statusCode === 503) {
      return new ProviderError(message, 'overloaded', statusCode, true, 5000);
    }
    if (statusCode !== undefined && statusCode >= 500) {
      return new ProviderError(message, 'server_error', statusCode, true);
    }
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('ENOTFOUND') ||
      message.includes('fetch failed')
    ) {
      return new ProviderError(message, 'network', undefined, true);
    }
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return new ProviderError(message, 'timeout', undefined, true);
    }

    return new ProviderError(message, 'unknown', statusCode, false);
  }

  protected extractStatusCode(err: unknown): number | undefined {
    if (err && typeof err === 'object') {
      const obj = err as Record<string, unknown>;
      if (typeof obj['status'] === 'number') return obj['status'];
      if (typeof obj['statusCode'] === 'number') return obj['statusCode'];
      if (
        obj['response'] &&
        typeof obj['response'] === 'object' &&
        typeof (obj['response'] as Record<string, unknown>)['status'] === 'number'
      ) {
        return (obj['response'] as Record<string, unknown>)['status'] as number;
      }
    }
    return undefined;
  }

  protected extractRetryAfter(err: unknown): number | undefined {
    if (err && typeof err === 'object') {
      const obj = err as Record<string, unknown>;
      const headers =
        (obj['headers'] as Record<string, string> | undefined) ??
        ((obj['response'] as Record<string, unknown> | undefined)?.['headers'] as
          | Record<string, string>
          | undefined);
      if (headers) {
        const retryAfter = headers['retry-after'];
        if (retryAfter) {
          const seconds = parseFloat(retryAfter);
          if (!isNaN(seconds)) return seconds * 1000;
        }
      }
    }
    return undefined;
  }

  protected computeRetryDelay(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs && retryAfterMs > 0) {
      return Math.min(retryAfterMs, this.retryConfig.maxDelayMs);
    }
    const exponentialDelay =
      this.retryConfig.initialDelayMs *
      Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelayMs);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Extract text from message content, handling both string and block formats. */
  protected getTextContent(
    content: string | Array<{ type: string; text?: string }>,
  ): string {
    if (typeof content === 'string') return content;
    return content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('');
  }

  protected logRequest(_request: LLMRequest, _attempt: number): void {
    // Override in subclasses for custom logging
  }

  protected logResponse(_durationMs: number, _attempt: number): void {
    // Override in subclasses for custom logging
  }

  protected logRetry(_attempt: number, _delayMs: number, _error: ProviderError): void {
    // Override in subclasses for custom logging
  }
}
