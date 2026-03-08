/**
 * LLM-specific error classes.
 */

import { AgentBuilderError } from './base.js';

/**
 * General LLM error — base for all provider-related failures.
 */
export class LLMError extends AgentBuilderError {
  /** Provider that generated the error (e.g., 'anthropic', 'openai'). */
  readonly providerId: string;

  /** Model that was being called, if known. */
  readonly modelId?: string;

  constructor(
    message: string,
    options: {
      providerId: string;
      modelId?: string;
      code?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, {
      code: options.code ?? 'LLM_ERROR',
      statusCode: options.statusCode ?? 500,
      details: options.details,
      cause: options.cause,
    });
    this.providerId = options.providerId;
    this.modelId = options.modelId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      providerId: this.providerId,
      modelId: this.modelId,
    };
  }
}

/**
 * Rate limit exceeded. Includes retry-after information when available.
 */
export class RateLimitError extends LLMError {
  /** Milliseconds to wait before retrying, if the provider specified one. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      providerId: string;
      modelId?: string;
      retryAfterMs?: number;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, {
      ...options,
      code: 'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
    });
    this.retryAfterMs = options.retryAfterMs;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      retryAfterMs: this.retryAfterMs,
    };
  }
}

/**
 * Authentication or authorization failure with the LLM provider.
 */
export class AuthenticationError extends LLMError {
  constructor(
    message: string,
    options: {
      providerId: string;
      modelId?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, {
      ...options,
      code: 'AUTHENTICATION_ERROR',
      statusCode: 401,
    });
  }
}

/**
 * The requested model was not found or is not available.
 */
export class ModelNotFoundError extends LLMError {
  constructor(
    message: string,
    options: {
      providerId: string;
      modelId: string;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, {
      ...options,
      code: 'MODEL_NOT_FOUND',
      statusCode: 404,
    });
  }
}

/**
 * The request exceeded the model's context window.
 */
export class ContextLengthError extends LLMError {
  /** Number of tokens in the request. */
  readonly requestedTokens?: number;
  /** Maximum tokens the model supports. */
  readonly maxTokens?: number;

  constructor(
    message: string,
    options: {
      providerId: string;
      modelId?: string;
      requestedTokens?: number;
      maxTokens?: number;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, {
      ...options,
      code: 'CONTEXT_LENGTH_EXCEEDED',
      statusCode: 400,
    });
    this.requestedTokens = options.requestedTokens;
    this.maxTokens = options.maxTokens;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      requestedTokens: this.requestedTokens,
      maxTokens: this.maxTokens,
    };
  }
}

/**
 * Content was blocked by the provider's safety / content filter.
 */
export class ContentFilterError extends LLMError {
  /** Which filter triggered (e.g., 'safety', 'policy', 'pii'). */
  readonly filterType?: string;

  constructor(
    message: string,
    options: {
      providerId: string;
      modelId?: string;
      filterType?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, {
      ...options,
      code: 'CONTENT_FILTER',
      statusCode: 400,
    });
    this.filterType = options.filterType;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      filterType: this.filterType,
    };
  }
}
