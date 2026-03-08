/**
 * SQLiteVectorStore — a persistent vector store backed by better-sqlite3.
 *
 * Vectors are stored as BLOBs (Float32Array serialisation). Similarity
 * search is brute-force cosine similarity computed in JS — performant
 * enough for datasets up to ~100 k vectors.
 */

import Database from 'better-sqlite3';
import type { VectorStore, VectorSearchResult } from './store.interface.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SQLiteVectorStoreOptions {
  /** Path to the SQLite database file (use ":memory:" for in-memory). */
  dbPath: string;
  /** Name of the table to store vectors in (default: "vectors"). */
  tableName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialise a number[] to a Buffer containing Float32 values.
 */
function embedToBlob(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

/**
 * Deserialise a Buffer back into a number[].
 */
function blobToEmbed(blob: Buffer): number[] {
  const float32 = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(float32);
}

/**
 * Compute cosine similarity between two number arrays.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const mag = Math.sqrt(normA) * Math.sqrt(normB);
  if (mag === 0) return 0;
  return dot / mag;
}

// ---------------------------------------------------------------------------
// SQLiteVectorStore
// ---------------------------------------------------------------------------

export class SQLiteVectorStore implements VectorStore {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly tableName: string;

  constructor(options: SQLiteVectorStoreOptions) {
    this.dbPath = options.dbPath;
    this.tableName = options.tableName ?? 'vectors';
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id         TEXT PRIMARY KEY,
        embedding  BLOB NOT NULL,
        metadata   TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Create an index on created_at for efficient ordering.
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_created_at"
        ON "${this.tableName}" (created_at);
    `);
  }

  // ── CRUD ────────────────────────────────────────────────────────────────

  async insert(
    id: string,
    embedding: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.ensureDb();

    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO "${this.tableName}" (id, embedding, metadata)
      VALUES (?, ?, ?)
    `);
    stmt.run(id, embedToBlob(embedding), JSON.stringify(metadata));
  }

  async search(
    queryEmbedding: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]> {
    this.ensureDb();

    // Fetch all rows (brute-force). For large stores a more sophisticated
    // approach (e.g., IVF index) would be warranted.
    let query = `SELECT id, embedding, metadata FROM "${this.tableName}"`;
    const params: unknown[] = [];

    // Apply simple metadata filters via JSON_EXTRACT.
    if (filter && Object.keys(filter).length > 0) {
      const conditions: string[] = [];
      for (const [key, value] of Object.entries(filter)) {
        conditions.push(`JSON_EXTRACT(metadata, ?) = ?`);
        params.push(`$.${key}`, value as string | number);
      }
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const rows = this.db!.prepare(query).all(...params) as Array<{
      id: string;
      embedding: Buffer;
      metadata: string;
    }>;

    // Score and rank
    const scored: VectorSearchResult[] = [];
    for (const row of rows) {
      const storedEmbedding = blobToEmbed(row.embedding);
      const score = cosineSimilarity(queryEmbedding, storedEmbedding);
      scored.push({
        id: row.id,
        score,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async delete(id: string): Promise<void> {
    this.ensureDb();
    this.db!.prepare(`DELETE FROM "${this.tableName}" WHERE id = ?`).run(id);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ── Utilities ───────────────────────────────────────────────────────────

  /** Return total number of stored vectors. */
  count(): number {
    this.ensureDb();
    const row = this.db!
      .prepare(`SELECT COUNT(*) as cnt FROM "${this.tableName}"`)
      .get() as { cnt: number };
    return row.cnt;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private ensureDb(): void {
    if (!this.db) {
      throw new Error(
        'SQLiteVectorStore has not been initialised. Call initialize() first.',
      );
    }
  }
}
