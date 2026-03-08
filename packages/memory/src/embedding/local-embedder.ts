/**
 * LocalEmbedder — generates embeddings locally.
 *
 * Primary backend: Ollama API (POST /api/embeddings).
 * Fallback: a simple TF-IDF / bag-of-words hasher that projects text into
 *   a fixed-dimensional vector space. Not remotely as good as a real model,
 *   but allows the system to function without external services.
 */

import type { EmbeddingProvider } from './embedding.interface.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LocalEmbedderOptions {
  /** Ollama base URL (default: "http://localhost:11434"). */
  baseUrl?: string;
  /** Model to use for embeddings (default: "nomic-embed-text"). */
  model?: string;
  /** Dimensionality for the fallback hasher (default: 384). */
  fallbackDimensions?: number;
  /**
   * If true, the embedder will not attempt Ollama and will always use the
   * TF-IDF fallback. Useful for testing. (default: false)
   */
  forceFallback?: boolean;
}

// ---------------------------------------------------------------------------
// LocalEmbedder
// ---------------------------------------------------------------------------

export class LocalEmbedder implements EmbeddingProvider {
  readonly providerId = 'local';
  readonly dimensions: number;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fallbackDimensions: number;
  private readonly forceFallback: boolean;
  private ollamaAvailable: boolean | null = null; // null = not checked yet

  constructor(options?: LocalEmbedderOptions) {
    this.baseUrl = (options?.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.model = options?.model ?? 'nomic-embed-text';
    this.fallbackDimensions = options?.fallbackDimensions ?? 384;
    this.forceFallback = options?.forceFallback ?? false;

    // We won't know the true dimensions until we call Ollama for the first
    // time, but the fallback dimensions are known statically.
    this.dimensions = this.fallbackDimensions;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    if (!this.forceFallback && (await this.isOllamaAvailable())) {
      return this.embedViaOllama(text);
    }
    return this.hashEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't expose a native batch endpoint, so we parallelise.
    if (!this.forceFallback && (await this.isOllamaAvailable())) {
      return Promise.all(texts.map((t) => this.embedViaOllama(t)));
    }
    return texts.map((t) => this.hashEmbed(t));
  }

  // ── Ollama backend ─────────────────────────────────────────────────────

  private async isOllamaAvailable(): Promise<boolean> {
    if (this.ollamaAvailable !== null) return this.ollamaAvailable;

    try {
      const res = await fetch(`${this.baseUrl}/api/version`, {
        signal: AbortSignal.timeout(2_000),
      });
      this.ollamaAvailable = res.ok;
    } catch {
      this.ollamaAvailable = false;
    }
    return this.ollamaAvailable;
  }

  private async embedViaOllama(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Ollama embedding request failed (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as { embedding?: number[] };
    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error('Ollama response did not contain an embedding array.');
    }

    return data.embedding;
  }

  // ── Fallback: hash-based embedding ─────────────────────────────────────
  //
  // A deterministic bag-of-words approach that uses the hashing trick to
  // project token counts into a fixed-dimension vector. Each token is
  // hashed to a bucket, and the vector element at that bucket is
  // incremented. The resulting vector is L2-normalised so that cosine
  // similarity works correctly.
  //
  // This is *far* inferior to a real embedding model but it is:
  //   - Zero-dependency
  //   - Deterministic
  //   - Runs entirely in-process
  //   - Good enough for smoke-testing the memory pipeline

  private hashEmbed(text: string): number[] {
    const dims = this.fallbackDimensions;
    const vec = new Float64Array(dims);

    // Tokenise: lowercase, split on non-alphanumeric.
    const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);

    // IDF approximation: longer documents get dampened.
    const idfDampening = 1 / Math.sqrt(Math.max(tokens.length, 1));

    for (const token of tokens) {
      const hash = fnv1a(token);
      // Pick two buckets (simulating signed random projections).
      const bucket1 = ((hash >>> 0) % dims);
      const bucket2 = (((hash >>> 16) ^ (hash & 0xffff)) >>> 0) % dims;
      // The sign of the contribution is derived from another bit.
      const sign = (hash & 0x8000) ? -1 : 1;
      vec[bucket1] = (vec[bucket1] ?? 0) + sign * idfDampening;
      vec[bucket2] = (vec[bucket2] ?? 0) + idfDampening;
    }

    // L2-normalise
    let norm = 0;
    for (let i = 0; i < dims; i++) {
      const v = vec[i] ?? 0;
      norm += v * v;
    }
    norm = Math.sqrt(norm);

    const result = new Array<number>(dims);
    if (norm === 0) {
      for (let i = 0; i < dims; i++) result[i] = 0;
    } else {
      for (let i = 0; i < dims; i++) result[i] = (vec[i] ?? 0) / norm;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// FNV-1a hash (32-bit)
// ---------------------------------------------------------------------------

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // ensure unsigned
}
