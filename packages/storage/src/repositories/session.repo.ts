/**
 * Repository for persisting and querying Session records.
 *
 * Sessions are stored with messages and metadata serialized as JSON.
 */

import type { Database } from '../database.js';

// ---------------------------------------------------------------------------
// Local types — kept decoupled from engine-specific Session types so the
// storage layer is importable without building the engine first.
// ---------------------------------------------------------------------------

export type SessionState = 'active' | 'paused' | 'completed' | 'expired' | 'error';

export interface SessionRecord {
  id: string;
  agentId: string;
  state: SessionState;
  messages: unknown[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  agent_id: string;
  state: string;
  messages_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class SessionRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Create a new session.
   *
   * @returns The session ID.
   */
  create(session: SessionRecord): string {
    const stmt = this.db.raw.prepare(`
      INSERT INTO sessions (id, agent_id, state, messages_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = session.createdAt?.toISOString() ?? new Date().toISOString();
    stmt.run(
      session.id,
      session.agentId,
      session.state,
      JSON.stringify(session.messages),
      JSON.stringify(session.metadata),
      now,
      session.updatedAt?.toISOString() ?? now,
    );

    return session.id;
  }

  /**
   * Retrieve a session by ID.
   */
  getById(id: string): SessionRecord | null {
    const stmt = this.db.raw.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as SessionRow | undefined;
    if (!row) return null;
    return this.deserialize(row);
  }

  /**
   * List sessions for a given agent, ordered by most recently updated first.
   */
  listByAgent(agentId: string, limit = 50): SessionRecord[] {
    const stmt = this.db.raw.prepare(`
      SELECT * FROM sessions
      WHERE agent_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(agentId, limit) as SessionRow[];
    return rows.map((r) => this.deserialize(r));
  }

  /**
   * Update the messages for a session. Also bumps `updated_at`.
   */
  updateMessages(id: string, messages: unknown[]): void {
    const stmt = this.db.raw.prepare(`
      UPDATE sessions
      SET messages_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(messages), id);
  }

  /**
   * Update the state of a session. Also bumps `updated_at`.
   */
  updateState(id: string, state: SessionState): void {
    const stmt = this.db.raw.prepare(`
      UPDATE sessions
      SET state = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(state, id);
  }

  /**
   * Delete a session by ID.
   */
  delete(id: string): void {
    const stmt = this.db.raw.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Get the currently active session for an agent, if any.
   */
  getActive(agentId: string): SessionRecord | null {
    const stmt = this.db.raw.prepare(`
      SELECT * FROM sessions
      WHERE agent_id = ? AND state = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const row = stmt.get(agentId) as SessionRow | undefined;
    if (!row) return null;
    return this.deserialize(row);
  }

  /**
   * Count sessions, optionally filtered by agent ID.
   */
  count(agentId?: string): number {
    if (agentId) {
      const stmt = this.db.raw.prepare(
        'SELECT COUNT(*) as count FROM sessions WHERE agent_id = ?',
      );
      const row = stmt.get(agentId) as { count: number };
      return row.count;
    }
    const stmt = this.db.raw.prepare('SELECT COUNT(*) as count FROM sessions');
    const row = stmt.get() as { count: number };
    return row.count;
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  private deserialize(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      agentId: row.agent_id,
      state: row.state as SessionState,
      messages: JSON.parse(row.messages_json) as unknown[],
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
