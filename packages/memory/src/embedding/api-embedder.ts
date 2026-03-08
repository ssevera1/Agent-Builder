/**
 * APIEmbedder — generates embeddings via the OpenAI Embeddings API.
 *
 * Supports:
 *   - text-embedding-3-small  (1 536 dimensions, configurable)
 *   - text-embedding-3-large  (3 072 dimensions, configurable)
 *   - text-embedding-ada-002  (1 536 dimensions, fixed)
 */

import type { EmbeddingProvider } from './embedding.interface.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface APIEmbedderOptions {
  /** OpenAI API key. If omitted, reads from `OPENAI_API_KEY` env var. */
  apiKey?: string;
  /** Model ID (default: "text-embedding-3-small"). */
  model?: string;
  /**
   * Output dimensionality. Only supported by text-embedding-3-* models.
   * Leave undefined to use the model's default dimensions.
   */
  dimensions?: number;
  /** Base URL for the embeddings API (default: "https://api.openai.com/v1"). */
  baseUrl?: string;
  /** Maximum number of texts in a single batch request (default: 100). */
  maxBatchSize?: number;
}

// ---------------------------------------------------------------------------
// Default dimensions per model
// ---------------------------------------------------------------------------

const DEFAULT_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1_536,
  'text-embedding-3-large': 3_072,
  'text-embedding-ada-002': 1_536,
};

// ---------------------------------------------------------------------------
// APIEmbedder
// ---------------------------------------------------------------------------

export class APIEmbedder implements EmbeddingProvider {
  readonly providerId = 'openai';
  readonly dimensions: number;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxBatchSize: number;
  private readonly requestedDimensions: number | undefined;

  constructor(options?: APIEmbedderOptions) {
    this.model = options?.model ?? 'text-embedding-3-small';
    this.baseUrl = (options?.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.maxBatchSize = options?.maxBatchSize ?? 100;
    this.requestedDimensions = options?.dimensions;

    const key = options?.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!key) {
      throw new Error(
        'APIEmbedder requires an API key. Provide it via options.apiKey or the OPENAI_API_KEY environment variable.',
      );
    }
    this.apiKey = key;

    this.dimensions =
      options?.dimensions ??
      DEFAULT_DIMENSIONS[this.model] ??
      1_536;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    const [result] = await this.callAPI([text]);
    if (!result) {
      throw new Error('Empty response from embeddings API.');
    }
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Split into batches respecting the max batch size.
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);
      const batchResults = await this.callAPI(batch);
      results.push(...batchResults);
    }

    return results;
  }

  // ── API call ────────────────────────────────────────────────────────────

  private async callAPI(inputs: string[]): Promise<number[][]> {
    const body: Record<string, unknown> = {
      model: this.model,
      input: inputs,
    };

    // Only include dimensions for models that support it.
    if (
      this.requestedDimensions !== undefined &&
      this.model.startsWith('text-embedding-3')
    ) {
      body['dimensions'] = this.requestedDimensions;
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `OpenAI Embeddings API error (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
    };

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Unexpected response shape from OpenAI Embeddings API.');
    }

    // The API may return items out of order; sort by index.
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  }
}
