/**
 * Repository for persisting and querying WorkflowExecution records.
 *
 * Stores the full execution state as JSON alongside indexed status fields
 * for fast filtering.
 */

import type { Database } from '../database.js';

// ---------------------------------------------------------------------------
// Execution state — kept self-contained for storage independence
// ---------------------------------------------------------------------------

export interface WorkflowExecutionState {
  id: string;
  workflowId: string;
  status: string;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

interface WorkflowExecutionRow {
  id: string;
  workflow_id: string;
  state_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class WorkflowExecutionRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Save (upsert) a workflow execution. If the record already exists,
   * it is updated; otherwise a new row is inserted.
   */
  save(execution: WorkflowExecutionState): void {
    const stmt = this.db.raw.prepare(`
      INSERT INTO workflow_executions (id, workflow_id, state_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state_json = excluded.state_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    const now = new Date().toISOString();
    stmt.run(
      execution.id,
      execution.workflowId,
      JSON.stringify(execution.state),
      execution.status,
      execution.createdAt?.toISOString() ?? now,
      now,
    );
  }

  /**
   * Retrieve a workflow execution by ID.
   */
  getById(id: string): WorkflowExecutionState | null {
    const stmt = this.db.raw.prepare('SELECT * FROM workflow_executions WHERE id = ?');
    const row = stmt.get(id) as WorkflowExecutionRow | undefined;
    if (!row) return null;
    return this.deserialize(row);
  }

  /**
   * List workflow executions, optionally filtered by status.
   */
  list(status?: string, limit = 100): WorkflowExecutionState[] {
    let query: string;
    let params: unknown[];

    if (status) {
      query = `
        SELECT * FROM workflow_executions
        WHERE status = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `;
      params = [status, limit];
    } else {
      query = `
        SELECT * FROM workflow_executions
        ORDER BY updated_at DESC
        LIMIT ?
      `;
      params = [limit];
    }

    const stmt = this.db.raw.prepare(query);
    const rows = stmt.all(...params) as WorkflowExecutionRow[];
    return rows.map((r) => this.deserialize(r));
  }

  /**
   * Delete a workflow execution by ID.
   */
  delete(id: string): void {
    const stmt = this.db.raw.prepare('DELETE FROM workflow_executions WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Count executions, optionally by status.
   */
  count(status?: string): number {
    if (status) {
      const stmt = this.db.raw.prepare(
        'SELECT COUNT(*) as count FROM workflow_executions WHERE status = ?',
      );
      const row = stmt.get(status) as { count: number };
      return row.count;
    }
    const stmt = this.db.raw.prepare('SELECT COUNT(*) as count FROM workflow_executions');
    const row = stmt.get() as { count: number };
    return row.count;
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  private deserialize(row: WorkflowExecutionRow): WorkflowExecutionState {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status,
      state: JSON.parse(row.state_json) as Record<string, unknown>,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
