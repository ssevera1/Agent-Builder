/**
 * InMemoryVectorStore — a Map-backed vector store useful for tests and
 * small datasets. No persistence across restarts.
 */

import type { VectorStore, VectorSearchResult } from './store.interface.js';

// ---------------------------------------------------------------------------
// Internal entry type
// ---------------------------------------------------------------------------

interface VectorEntry {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two vectors.
 * Returns a value in [-1, 1]. Higher means more similar.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

// ---------------------------------------------------------------------------
// InMemoryVectorStore
// ---------------------------------------------------------------------------

export class InMemoryVectorStore implements VectorStore {
  private readonly entries = new Map<string, VectorEntry>();

  async initialize(): Promise<void> {
    // Nothing to initialise for in-memory storage.
  }

  async insert(
    id: string,
    embedding: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.entries.set(id, { id, embedding, metadata });
  }

  async search(
    queryEmbedding: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]> {
    const scored: VectorSearchResult[] = [];

    for (const entry of this.entries.values()) {
      // Apply metadata filter (all specified keys must match exactly).
      if (filter && !matchesFilter(entry.metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      scored.push({ id: entry.id, score, metadata: entry.metadata });
    }

    // Sort by score descending and take top-K.
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async close(): Promise<void> {
    this.entries.clear();
  }

  // ── Helpers (testing) ───────────────────────────────────────────────────

  /** Return the number of stored vectors. */
  get size(): number {
    return this.entries.size;
  }

  /** Check if a vector with the given id exists. */
  has(id: string): boolean {
    return this.entries.has(id);
  }
}

// ---------------------------------------------------------------------------
// Filter helper
// ---------------------------------------------------------------------------

function matchesFilter(
  metadata: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}
