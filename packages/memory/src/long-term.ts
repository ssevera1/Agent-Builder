/**
 * LongTermMemory — persistent vector-based memory backed by SQLite.
 *
 * Each entry stores its text content, an embedding vector (BLOB), JSON
 * metadata, and an agent ID. Similarity search is cosine-based, computed
 * in JavaScript over all candidate rows.
 */

import Database from 'better-sqlite3';
import type { MemoryEntry, MemoryMetadata, MemorySearchResult } from '@agentbuilder/core';
import type { EmbeddingProvider } from './embedding/embedding.interface.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LongTermMemoryOptions {
  /** Path to the SQLite database file. Use ":memory:" for in-process only. */
  dbPath: string;
  /** Embedding provider for generating and querying vectors. */
  embedder: EmbeddingProvider;
  /** Table name (default: "long_term_memory"). */
  tableName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function embedToBlob(embedding: number[]): Buffer {
  const f32 = new Float32Array(embedding);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function blobToEmbed(blob: Buffer): number[] {
  const f32 = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(f32);
}

function cosineSimilarity(a: number[], b: number[]): number {
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
  return mag === 0 ? 0 : dot / mag;
}

// ---------------------------------------------------------------------------
// LongTermMemory
// ---------------------------------------------------------------------------

export class LongTermMemory {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly embedder: EmbeddingProvider;
  private readonly tableName: string;

  constructor(options: LongTermMemoryOptions) {
    this.dbPath = options.dbPath;
    this.embedder = options.embedder;
    this.tableName = options.tableName ?? 'long_term_memory';
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id              TEXT PRIMARY KEY,
        content         TEXT NOT NULL,
        embedding       BLOB NOT NULL,
        metadata        TEXT NOT NULL DEFAULT '{}',
        agent_id        TEXT NOT NULL,
        access_count    INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_agent"
        ON "${this.tableName}" (agent_id);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_created"
        ON "${this.tableName}" (created_at);
    `);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ── Store ───────────────────────────────────────────────────────────────

  async store(entry: MemoryEntry): Promise<void> {
    this.ensureDb();

    // Generate embedding if not already provided.
    const embedding = entry.embedding ?? (await this.embedder.embed(entry.content));

    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO "${this.tableName}"
        (id, content, embedding, metadata, agent_id, access_count, last_accessed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.content,
      embedToBlob(embedding),
      JSON.stringify(entry.metadata),
      entry.agentId,
      entry.accessCount,
      entry.lastAccessedAt ? entry.lastAccessedAt.toISOString() : null,
      entry.timestamp.toISOString(),
    );
  }

  // ── Search ──────────────────────────────────────────────────────────────

  async search(query: string, topK = 5, agentId?: string): Promise<MemorySearchResult[]> {
    this.ensureDb();

    const queryEmbedding = await this.embedder.embed(query);

    let sql = `SELECT id, content, embedding, metadata, agent_id, access_count, last_accessed_at, created_at FROM "${this.tableName}"`;
    const params: unknown[] = [];

    if (agentId) {
      sql += ' WHERE agent_id = ?';
      params.push(agentId);
    }

    const rows = this.db!.prepare(sql).all(...params) as Array<{
      id: string;
      content: string;
      embedding: Buffer;
      metadata: string;
      agent_id: string;
      access_count: number;
      last_accessed_at: string | null;
      created_at: string;
    }>;

    const scored: MemorySearchResult[] = [];
    for (const row of rows) {
      const storedEmbed = blobToEmbed(row.embedding);
      const score = cosineSimilarity(queryEmbedding, storedEmbed);
      const metadata = JSON.parse(row.metadata) as MemoryMetadata;

      scored.push({
        score,
        entry: {
          id: row.id,
          content: row.content,
          embedding: storedEmbed,
          agentId: row.agent_id,
          metadata,
          accessCount: row.access_count,
          lastAccessedAt: row.last_accessed_at
            ? new Date(row.last_accessed_at)
            : undefined,
          timestamp: new Date(row.created_at),
        },
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK);

    // Update access counts and last_accessed_at for returned results.
    const updateStmt = this.db!.prepare(`
      UPDATE "${this.tableName}"
      SET access_count = access_count + 1,
          last_accessed_at = datetime('now')
      WHERE id = ?
    `);
    const updateMany = this.db!.transaction((ids: string[]) => {
      for (const id of ids) {
        updateStmt.run(id);
      }
    });
    updateMany(topResults.map((r) => r.entry.id));

    return topResults;
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  async delete(id: string): Promise<void> {
    this.ensureDb();
    this.db!.prepare(`DELETE FROM "${this.tableName}" WHERE id = ?`).run(id);
  }

  // ── Get by ID ───────────────────────────────────────────────────────────

  async getById(id: string): Promise<MemoryEntry | undefined> {
    this.ensureDb();

    const row = this.db!
      .prepare(
        `SELECT id, content, embedding, metadata, agent_id, access_count, last_accessed_at, created_at FROM "${this.tableName}" WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          content: string;
          embedding: Buffer;
          metadata: string;
          agent_id: string;
          access_count: number;
          last_accessed_at: string | null;
          created_at: string;
        }
      | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      content: row.content,
      embedding: blobToEmbed(row.embedding),
      agentId: row.agent_id,
      metadata: JSON.parse(row.metadata) as MemoryMetadata,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at
        ? new Date(row.last_accessed_at)
        : undefined,
      timestamp: new Date(row.created_at),
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private ensureDb(): void {
    if (!this.db) {
      throw new Error(
        'LongTermMemory has not been initialised. Call initialize() first.',
      );
    }
  }
}
