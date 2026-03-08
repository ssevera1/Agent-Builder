import type { LLMRequest, LLMStreamChunk, ModelInfo } from '@agentbuilder/core';

/**
 * Unified interface for all LLM provider clients.
 * Every provider (Anthropic, OpenAI, Google, Mistral, Cohere, local)
 * must implement this interface.
 */
export interface LLMClient {
  /** Provider identifier (e.g., 'anthropic', 'openai'). */
  readonly providerId: string;
  /** Model identifier within the provider. */
  readonly modelId: string;

  /**
   * Send a completion request and receive a stream of response chunks.
   * Even for non-streaming providers, results are wrapped as an async iterable.
   */
  complete(request: LLMRequest): AsyncIterable<LLMStreamChunk>;

  /**
   * Estimate token count for the given text.
   * Providers that lack a native tokenizer fall back to heuristic counting.
   */
  countTokens(text: string): Promise<number>;

  /** List models available from this provider. */
  listModels(): Promise<ModelInfo[]>;

  /** Return static information about the currently configured model. */
  getModelInfo(): ModelInfo;

  /** Whether the current model supports tool/function calling. */
  supportsToolUse(): boolean;

  /** Whether the current model supports image/vision input. */
  supportsVision(): boolean;

  /** Whether the current model supports streaming responses. */
  supportsStreaming(): boolean;
}

/**
 * Factory interface for creating LLMClient instances.
 */
export interface LLMClientFactory {
  create(
    providerId: string,
    modelId: string,
    options?: Record<string, unknown>,
  ): LLMClient;
}
