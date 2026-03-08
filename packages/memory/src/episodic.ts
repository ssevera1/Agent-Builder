/**
 * EpisodicMemory — stores and retrieves full interaction episodes in SQLite.
 *
 * Each episode captures a complete interaction: its summary, the messages
 * exchanged, the tools used, the outcome, and an embedding for similarity
 * search.
 */

import Database from 'better-sqlite3';
import type { Episode, EpisodeOutcome } from '@agentbuilder/core';
import type { EmbeddingProvider } from './embedding/embedding.interface.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface EpisodicMemoryOptions {
  /** Path to the SQLite database file. Use ":memory:" for in-process only. */
  dbPath: string;
  /** Embedding provider for generating search vectors. */
  embedder: EmbeddingProvider;
  /** Table name (default: "episodic_memory"). */
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
// EpisodicMemory
// ---------------------------------------------------------------------------

export class EpisodicMemory {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly embedder: EmbeddingProvider;
  private readonly tableName: string;

  constructor(options: EpisodicMemoryOptions) {
    this.dbPath = options.dbPath;
    this.embedder = options.embedder;
    this.tableName = options.tableName ?? 'episodic_memory';
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id           TEXT PRIMARY KEY,
        agent_id     TEXT NOT NULL,
        session_id   TEXT NOT NULL,
        summary      TEXT NOT NULL,
        messages     TEXT NOT NULL DEFAULT '[]',
        outcome      TEXT NOT NULL,
        tools_used   TEXT NOT NULL DEFAULT '[]',
        embedding    BLOB NOT NULL,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms  INTEGER NOT NULL DEFAULT 0,
        started_at   TEXT NOT NULL,
        ended_at     TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        metadata     TEXT NOT NULL DEFAULT '{}'
      );
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_agent"
        ON "${this.tableName}" (agent_id);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_outcome"
        ON "${this.tableName}" (outcome);
    `);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ── Record ──────────────────────────────────────────────────────────────

  /**
   * Store an episode. The summary is embedded for later similarity search.
   */
  async record(episode: Episode): Promise<void> {
    this.ensureDb();

    const embedding = await this.embedder.embed(episode.summary);

    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO "${this.tableName}"
        (id, agent_id, session_id, summary, messages, outcome, tools_used,
         embedding, total_tokens, duration_ms, started_at, ended_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      episode.id,
      episode.agentId,
      episode.sessionId,
      episode.summary,
      JSON.stringify(episode.messages),
      episode.outcome,
      JSON.stringify(episode.toolsUsed),
      embedToBlob(embedding),
      episode.totalTokens,
      episode.durationMs,
      episode.startedAt.toISOString(),
      episode.endedAt.toISOString(),
      JSON.stringify(episode.metadata ?? {}),
    );
  }

  // ── Recall ──────────────────────────────────────────────────────────────

  /**
   * Find episodes most similar to a query string.
   * Optionally filter by agentId and/or outcome.
   */
  async recall(
    query: string,
    topK = 5,
    filters?: { agentId?: string; outcome?: EpisodeOutcome },
  ): Promise<Episode[]> {
    this.ensureDb();

    const queryEmbedding = await this.embedder.embed(query);

    let sql = `SELECT * FROM "${this.tableName}"`;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.agentId) {
      conditions.push('agent_id = ?');
      params.push(filters.agentId);
    }
    if (filters?.outcome) {
      conditions.push('outcome = ?');
      params.push(filters.outcome);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const rows = this.db!.prepare(sql).all(...params) as RawEpisodeRow[];

    const scored: Array<{ episode: Episode; score: number }> = [];
    for (const row of rows) {
      const storedEmbed = blobToEmbed(row.embedding);
      const score = cosineSimilarity(queryEmbedding, storedEmbed);
      scored.push({ episode: rowToEpisode(row), score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.episode);
  }

  // ── List ────────────────────────────────────────────────────────────────

  /**
   * List episodes for an agent, ordered by start time descending.
   */
  async list(agentId: string, limit = 20, offset = 0): Promise<Episode[]> {
    this.ensureDb();

    const rows = this.db!
      .prepare(
        `SELECT * FROM "${this.tableName}"
         WHERE agent_id = ?
         ORDER BY started_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(agentId, limit, offset) as RawEpisodeRow[];

    return rows.map(rowToEpisode);
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  async delete(id: string): Promise<void> {
    this.ensureDb();
    this.db!.prepare(`DELETE FROM "${this.tableName}" WHERE id = ?`).run(id);
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private ensureDb(): void {
    if (!this.db) {
      throw new Error(
        'EpisodicMemory has not been initialised. Call initialize() first.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Raw row type
// ---------------------------------------------------------------------------

interface RawEpisodeRow {
  id: string;
  agent_id: string;
  session_id: string;
  summary: string;
  messages: string;
  outcome: string;
  tools_used: string;
  embedding: Buffer;
  total_tokens: number;
  duration_ms: number;
  started_at: string;
  ended_at: string;
  metadata: string;
}

function rowToEpisode(row: RawEpisodeRow): Episode {
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    summary: row.summary,
    messages: JSON.parse(row.messages),
    outcome: row.outcome as EpisodeOutcome,
    toolsUsed: JSON.parse(row.tools_used),
    startedAt: new Date(row.started_at),
    endedAt: new Date(row.ended_at),
    durationMs: row.duration_ms,
    totalTokens: row.total_tokens,
    metadata: JSON.parse(row.metadata),
  };
}
