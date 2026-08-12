import type { ProviderInfo } from '@agentbuilder/core';
import type { LLMClient } from './client.interface.js';
import { AnthropicClient } from './providers/anthropic.js';
import { OpenAIClient } from './providers/openai.js';
import { GeminiClient } from './providers/google.js';
import { MistralClient } from './providers/mistral.js';
import { CohereClient } from './providers/cohere.js';
import { LocalLLMClient } from './providers/local.js';

/**
 * Factory function type for creating LLM clients.
 */
export type ClientFactory = (
  modelId: string,
  options?: Record<string, unknown>,
) => LLMClient;

/**
 * Registration entry for a provider.
 */
interface ProviderEntry {
  info: ProviderInfo;
  factory: ClientFactory;
}

/**
 * Singleton registry of all available LLM providers.
 * Auto-registers built-in providers on first access.
 * Supports custom provider registration for extensibility.
 */
export class ProviderRegistry {
  private static _instance: ProviderRegistry | undefined;
  private readonly providers = new Map<string, ProviderEntry>();
  private builtinsRegistered = false;

  private constructor() {}

  /** Get the singleton instance. */
  static get instance(): ProviderRegistry {
    if (!ProviderRegistry._instance) {
      ProviderRegistry._instance = new ProviderRegistry();
    }
    return ProviderRegistry._instance;
  }

  /** Reset the singleton (for testing). */
  static resetInstance(): void {
    ProviderRegistry._instance = undefined;
  }

  /**
   * Register a provider with its factory function and metadata.
   */
  register(info: ProviderInfo, factory: ClientFactory): void {
    this.providers.set(info.id, { info, factory });
  }

  /**
   * Create an LLMClient for the given provider and model.
   */
  create(
    providerId: string,
    modelId: string,
    options?: Record<string, unknown>,
  ): LLMClient {
    this.ensureBuiltins();

    const entry = this.providers.get(providerId);
    if (!entry) {
      const available = [...this.providers.keys()].join(', ');
      throw new Error(
        `Unknown provider "${providerId}". Available providers: ${available}`,
      );
    }

    if (entry.info.requiresApiKey) {
      const apiKey = process.env[entry.info.apiKeyEnvVar || ''];
      if (!apiKey) {
        throw new Error(
          `Provider "${providerId}" requires API key. Set environment variable: ${entry.info.apiKeyEnvVar}`,
        );
      }
    }

    return entry.factory(modelId, options);
  }

  /**
   * List all registered providers.
   */
  listProviders(): ProviderInfo[] {
    this.ensureBuiltins();
    return [...this.providers.values()].map((e) => e.info);
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(providerId: string): boolean {
    this.ensureBuiltins();
    return this.providers.has(providerId);
  }

  /**
   * Get the default provider ID from environment variables.
   * Falls back to 'anthropic' if not set.
   */
  getDefaultProvider(): string {
    return process.env['AGENTBUILDER_DEFAULT_PROVIDER'] ?? 'anthropic';
  }

  /**
   * Auto-register all built-in providers on first access.
   */
  private ensureBuiltins(): void {
    if (this.builtinsRegistered) return;
    this.builtinsRegistered = true;

    // Anthropic
    this.register(
      {
        id: 'anthropic',
        name: 'Anthropic',
        description: 'Claude models via the Anthropic API',
        requiresApiKey: true,
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        supportsCustomBaseUrl: true,
      },
      (modelId, options) => new AnthropicClient(modelId, options),
    );

    // OpenAI
    this.register(
      {
        id: 'openai',
        name: 'OpenAI',
        description: 'GPT and o-series models via the OpenAI API',
        requiresApiKey: true,
        apiKeyEnvVar: 'OPENAI_API_KEY',
        supportsCustomBaseUrl: true,
      },
      (modelId, options) => new OpenAIClient(modelId, options),
    );

    // Google Gemini
    this.register(
      {
        id: 'google',
        name: 'Google',
        description: 'Gemini models via the Google Generative AI API',
        requiresApiKey: true,
        apiKeyEnvVar: 'GOOGLE_API_KEY',
        supportsCustomBaseUrl: false,
      },
      (modelId, options) => new GeminiClient(modelId, options),
    );

    // Mistral
    this.register(
      {
        id: 'mistral',
        name: 'Mistral',
        description: 'Mistral AI models via the Mistral API',
        requiresApiKey: true,
        apiKeyEnvVar: 'MISTRAL_API_KEY',
        supportsCustomBaseUrl: false,
      },
      (modelId, options) => new MistralClient(modelId, options),
    );

    // Cohere
    this.register(
      {
        id: 'cohere',
        name: 'Cohere',
        description: 'Command models via the Cohere API',
        requiresApiKey: true,
        apiKeyEnvVar: 'COHERE_API_KEY',
        supportsCustomBaseUrl: false,
      },
      (modelId, options) => new CohereClient(modelId, options),
    );

    // Local (Ollama / LM Studio / vLLM)
    this.register(
      {
        id: 'local',
        name: 'Local',
        description:
          'Local models via Ollama, LM Studio, or vLLM (OpenAI-compatible)',
        requiresApiKey: false,
        supportsCustomBaseUrl: true,
      },
      (modelId, options) => new LocalLLMClient(modelId, options),
    );
  }
}

/** Convenience accessor for the singleton registry. */
export const providerRegistry = ProviderRegistry.instance;
