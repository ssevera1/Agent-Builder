/**
 * @agentbuilder/llm — Unified LLM provider interface.
 *
 * Supports Anthropic, OpenAI, Google Gemini, Mistral, Cohere,
 * and local models (Ollama, LM Studio, vLLM).
 */

// ── Core interface and base class ────────────────────────────────────────────
export type { LLMClient, LLMClientFactory } from './client.interface.js';
export {
  BaseClient,
  ProviderError,
  type ProviderErrorCode,
  type RetryConfig,
} from './base-client.js';

// ── Provider implementations ─────────────────────────────────────────────────
export { AnthropicClient } from './providers/anthropic.js';
export { OpenAIClient } from './providers/openai.js';
export { GeminiClient } from './providers/google.js';
export { MistralClient } from './providers/mistral.js';
export { CohereClient } from './providers/cohere.js';
export { LocalLLMClient } from './providers/local.js';

// ── Registry and catalog ─────────────────────────────────────────────────────
export {
  ProviderRegistry,
  providerRegistry,
  type ClientFactory,
} from './provider-registry.js';
export {
  ModelCatalog,
  modelCatalog,
  type ModelRequirements,
} from './model-catalog.js';

// ── Re-export core types for convenience ─────────────────────────────────────
export type {
  LLMRequest,
  LLMStreamChunk,
  ModelInfo,
  TokenUsage,
  Message,
  ContentBlock,
  LLMToolDefinition,
  ProviderInfo,
} from '@agentbuilder/core';
