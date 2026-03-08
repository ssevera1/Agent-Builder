import type { ModelInfo } from '@agentbuilder/core';

/**
 * Comprehensive catalog of known models and their capabilities.
 * Used as fallback when provider API listing is unavailable,
 * and for model selection based on requirements.
 */

// ─── Model Data ──────────────────────────────────────────────────────────────

const CATALOG: ModelInfo[] = [
  // ── Anthropic ────────────────────────────────────────────────────────────
  {
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    displayName: 'Claude Opus 4 (June)',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 15,
    outputCostPerMillion: 75,
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4 (June)',
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5 (Oct 2025)',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 0.8,
    outputCostPerMillion: 4,
  },

  // ── OpenAI ───────────────────────────────────────────────────────────────
  {
    providerId: 'openai',
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
  },
  {
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
  },
  {
    providerId: 'openai',
    modelId: 'o1',
    displayName: 'o1',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 15,
    outputCostPerMillion: 60,
  },
  {
    providerId: 'openai',
    modelId: 'o3',
    displayName: 'o3',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 10,
    outputCostPerMillion: 40,
  },
  {
    providerId: 'openai',
    modelId: 'o4-mini',
    displayName: 'o4-mini',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 1.1,
    outputCostPerMillion: 4.4,
  },

  // ── Google ───────────────────────────────────────────────────────────────
  {
    providerId: 'google',
    modelId: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
  },
  {
    providerId: 'google',
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsToolUse: true,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
  },

  // ── Mistral ──────────────────────────────────────────────────────────────
  {
    providerId: 'mistral',
    modelId: 'mistral-large-latest',
    displayName: 'Mistral Large',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsToolUse: true,
    supportsVision: false,
    supportsStreaming: true,
    inputCostPerMillion: 2,
    outputCostPerMillion: 6,
  },
  {
    providerId: 'mistral',
    modelId: 'codestral',
    displayName: 'Codestral',
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
    supportsToolUse: true,
    supportsVision: false,
    supportsStreaming: true,
    inputCostPerMillion: 0.3,
    outputCostPerMillion: 0.9,
  },
  {
    providerId: 'mistral',
    modelId: 'open-mistral-nemo',
    displayName: 'Mistral Nemo',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsToolUse: true,
    supportsVision: false,
    supportsStreaming: true,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.15,
  },

  // ── Cohere ───────────────────────────────────────────────────────────────
  {
    providerId: 'cohere',
    modelId: 'command-r-plus',
    displayName: 'Command R+',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsToolUse: true,
    supportsVision: false,
    supportsStreaming: true,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
  },
  {
    providerId: 'cohere',
    modelId: 'command-r',
    displayName: 'Command R',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsToolUse: true,
    supportsVision: false,
    supportsStreaming: true,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
  },
  {
    providerId: 'cohere',
    modelId: 'command-light',
    displayName: 'Command Light',
    contextWindow: 4_096,
    maxOutputTokens: 4_096,
    supportsToolUse: false,
    supportsVision: false,
    supportsStreaming: true,
    inputCostPerMillion: 0.08,
    outputCostPerMillion: 0.08,
  },

  // ── Local (Ollama placeholders) ──────────────────────────────────────────
  {
    providerId: 'local',
    modelId: 'llama3',
    displayName: 'Llama 3 (8B)',
    contextWindow: 8_192,
    maxOutputTokens: 4_096,
    supportsToolUse: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    providerId: 'local',
    modelId: 'mistral',
    displayName: 'Mistral 7B (Local)',
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    supportsToolUse: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    providerId: 'local',
    modelId: 'codellama',
    displayName: 'Code Llama (7B)',
    contextWindow: 16_384,
    maxOutputTokens: 4_096,
    supportsToolUse: false,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    providerId: 'local',
    modelId: 'phi3',
    displayName: 'Phi-3 Mini',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsToolUse: false,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    providerId: 'local',
    modelId: 'qwen2',
    displayName: 'Qwen 2 (7B)',
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    supportsToolUse: true,
    supportsVision: false,
    supportsStreaming: true,
  },
];

// ─── Model Requirements for findBestModel ────────────────────────────────────

export interface ModelRequirements {
  /** Minimum context window size. */
  minContextWindow?: number;
  /** Minimum max output tokens. */
  minMaxOutputTokens?: number;
  /** Must support tool use. */
  requireToolUse?: boolean;
  /** Must support vision. */
  requireVision?: boolean;
  /** Must support streaming. */
  requireStreaming?: boolean;
  /** Restrict to specific provider(s). */
  providers?: string[];
}

// ─── ModelCatalog ────────────────────────────────────────────────────────────

/**
 * Provides static model information and capability-based model selection.
 */
export class ModelCatalog {
  private readonly models: Map<string, ModelInfo>;

  constructor() {
    this.models = new Map<string, ModelInfo>();
    for (const model of CATALOG) {
      this.models.set(this.key(model.providerId, model.modelId), model);
    }
  }

  /**
   * Look up a specific model by provider and model ID.
   * Returns undefined if not found.
   */
  getModel(providerId: string, modelId: string): ModelInfo | undefined {
    return this.models.get(this.key(providerId, modelId));
  }

  /**
   * List all models, optionally filtered by provider.
   */
  listModels(providerId?: string): ModelInfo[] {
    if (!providerId) return [...this.models.values()];
    return [...this.models.values()].filter(
      (m) => m.providerId === providerId,
    );
  }

  /**
   * Find the cheapest model meeting the given requirements.
   * Sorts eligible models by total cost (input + output per million tokens).
   * Returns undefined if no model meets the requirements.
   */
  findBestModel(requirements: ModelRequirements): ModelInfo | undefined {
    let candidates = [...this.models.values()];

    if (requirements.providers && requirements.providers.length > 0) {
      candidates = candidates.filter((m) =>
        requirements.providers!.includes(m.providerId),
      );
    }
    if (requirements.minContextWindow) {
      candidates = candidates.filter(
        (m) => m.contextWindow >= requirements.minContextWindow!,
      );
    }
    if (requirements.minMaxOutputTokens) {
      candidates = candidates.filter(
        (m) => m.maxOutputTokens >= requirements.minMaxOutputTokens!,
      );
    }
    if (requirements.requireToolUse) {
      candidates = candidates.filter((m) => m.supportsToolUse);
    }
    if (requirements.requireVision) {
      candidates = candidates.filter((m) => m.supportsVision);
    }
    if (requirements.requireStreaming) {
      candidates = candidates.filter((m) => m.supportsStreaming);
    }

    if (candidates.length === 0) return undefined;

    // Sort by total cost (cheapest first). Models without cost go last.
    candidates.sort((a, b) => {
      const costA =
        (a.inputCostPerMillion ?? Infinity) +
        (a.outputCostPerMillion ?? Infinity);
      const costB =
        (b.inputCostPerMillion ?? Infinity) +
        (b.outputCostPerMillion ?? Infinity);
      return costA - costB;
    });

    return candidates[0];
  }

  /**
   * Register a custom model in the catalog (e.g., for newly released models
   * or local models discovered at runtime).
   */
  registerModel(model: ModelInfo): void {
    this.models.set(this.key(model.providerId, model.modelId), model);
  }

  private key(providerId: string, modelId: string): string {
    return `${providerId}::${modelId}`;
  }
}

/** Singleton instance of the model catalog. */
export const modelCatalog = new ModelCatalog();
