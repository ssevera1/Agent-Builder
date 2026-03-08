/**
 * Checkpoint store implementations for persisting workflow execution state.
 *
 * Provides an in-memory store and a SQLite-compatible store interface
 * for durable workflow state persistence.
 */

import type { CheckpointStore } from './types.js';
import type { WorkflowExecutionState } from './state.js';
import {
  serializeState,
  deserializeState,
  type SerializedExecutionState,
} from './state.js';

// ─── In-Memory Store ────────────────────────────────────────────────────────

/**
 * In-memory checkpoint store for development and testing.
 * State is lost when the process exits.
 */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly store = new Map<string, string>();

  async save(executionId: string, state: WorkflowExecutionState): Promise<void> {
    const serialized = serializeState(state);
    this.store.set(executionId, JSON.stringify(serialized));
  }

  async load(executionId: string): Promise<WorkflowExecutionState | undefined> {
    const data = this.store.get(executionId);
    if (!data) return undefined;

    const parsed = JSON.parse(data) as SerializedExecutionState;
    return deserializeState(parsed);
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async delete(executionId: string): Promise<void> {
    this.store.delete(executionId);
  }

  /** Clear all checkpoints (useful for testing). */
  clear(): void {
    this.store.clear();
  }
}

// ─── SQLite Store ───────────────────────────────────────────────────────────

/**
 * Interface for a generic SQL database connection.
 * This abstracts over better-sqlite3 or any other SQLite driver so that
 * the checkpoint store does not carry a hard dependency on a specific driver.
 */
export interface SQLiteConnection {
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatement;
}

export interface SQLiteStatement {
  run(...params: unknown[]): void;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

/**
 * SQLite-based checkpoint store for durable workflow state persistence.
 *
 * Usage:
 * ```ts
 * import Database from 'better-sqlite3';
 * const db = new Database('workflows.db');
 * const store = new SQLiteCheckpointStore(db as unknown as SQLiteConnection);
 * ```
 */
export class SQLiteCheckpointStore implements CheckpointStore {
  private readonly db: SQLiteConnection;
  private readonly tableName: string;

  constructor(db: SQLiteConnection, tableName = 'workflow_checkpoints') {
    this.db = db;
    this.tableName = tableName;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        execution_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_workflow_id
        ON ${this.tableName} (workflow_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_status
        ON ${this.tableName} (status)
    `);
  }

  async save(executionId: string, state: WorkflowExecutionState): Promise<void> {
    const serialized = serializeState(state);
    const json = JSON.stringify(serialized);

    const stmt = this.db.prepare(`
      INSERT INTO ${this.tableName} (execution_id, state_json, workflow_id, status, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(execution_id) DO UPDATE SET
        state_json = excluded.state_json,
        status = excluded.status,
        updated_at = datetime('now')
    `);

    stmt.run(executionId, json, state.workflowId, state.status);
  }

  async load(executionId: string): Promise<WorkflowExecutionState | undefined> {
    const stmt = this.db.prepare(
      `SELECT state_json FROM ${this.tableName} WHERE execution_id = ?`
    );
    const row = stmt.get(executionId);
    if (!row || typeof row['state_json'] !== 'string') return undefined;

    const parsed = JSON.parse(row['state_json'] as string) as SerializedExecutionState;
    return deserializeState(parsed);
  }

  async list(): Promise<string[]> {
    const stmt = this.db.prepare(
      `SELECT execution_id FROM ${this.tableName} ORDER BY updated_at DESC`
    );
    const rows = stmt.all();
    return rows.map((r) => r['execution_id'] as string);
  }

  async delete(executionId: string): Promise<void> {
    const stmt = this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE execution_id = ?`
    );
    stmt.run(executionId);
  }

  /**
   * List checkpoints filtered by status.
   */
  async listByStatus(status: string): Promise<string[]> {
    const stmt = this.db.prepare(
      `SELECT execution_id FROM ${this.tableName} WHERE status = ? ORDER BY updated_at DESC`
    );
    const rows = stmt.all(status);
    return rows.map((r) => r['execution_id'] as string);
  }

  /**
   * List checkpoints for a specific workflow.
   */
  async listByWorkflow(workflowId: string): Promise<string[]> {
    const stmt = this.db.prepare(
      `SELECT execution_id FROM ${this.tableName} WHERE workflow_id = ? ORDER BY updated_at DESC`
    );
    const rows = stmt.all(workflowId);
    return rows.map((r) => r['execution_id'] as string);
  }

  /**
   * Delete all checkpoints older than the given date.
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const stmt = this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE updated_at < ?`
    );
    const rows = this.db.prepare(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE updated_at < ?`
    );
    const result = rows.get(date.toISOString());
    const count = (result as Record<string, unknown> | undefined)?.['count'] as number ?? 0;
    stmt.run(date.toISOString());
    return count;
  }
}

// ─── File-System Store ──────────────────────────────────────────────────────

/**
 * File-system-based checkpoint store using JSON files.
 * Requires Node.js fs/promises module.
 */
export class FileCheckpointStore implements CheckpointStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  private filePath(executionId: string): string {
    // Sanitize the execution ID for use as a filename
    const safe = executionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${this.directory}/${safe}.json`;
  }

  async save(executionId: string, state: WorkflowExecutionState): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(this.directory, { recursive: true });
    const serialized = serializeState(state);
    await writeFile(this.filePath(executionId), JSON.stringify(serialized, null, 2), 'utf-8');
  }

  async load(executionId: string): Promise<WorkflowExecutionState | undefined> {
    const { readFile } = await import('node:fs/promises');
    try {
      const content = await readFile(this.filePath(executionId), 'utf-8');
      const parsed = JSON.parse(content) as SerializedExecutionState;
      return deserializeState(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async list(): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    try {
      const files = await readdir(this.directory);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async delete(executionId: string): Promise<void> {
    const { unlink } = await import('node:fs/promises');
    try {
      await unlink(this.filePath(executionId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
