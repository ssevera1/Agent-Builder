/**
 * Repository for persisting and querying evaluation (test) run results.
 *
 * Stores complete EvalResult arrays keyed by run ID, with summary
 * statistics indexed for fast listing.
 */

import type { Database } from '../database.js';

// ---------------------------------------------------------------------------
// Local types — mirrors the core EvalResult shape for storage independence
// ---------------------------------------------------------------------------

export interface StoredEvalResult {
  testCaseId: string;
  testCaseName: string;
  passed: boolean;
  score: number;
  actualOutput: string;
  assertionResults: unknown[];
  metrics: unknown[];
  latencyMs: number;
  totalTokens: number;
  error?: string;
  timestamp: string;
}

export interface EvalRunSummary {
  runId: string;
  agentId: string;
  timestamp: string;
  passed: number;
  failed: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

interface EvalRunRow {
  id: string;
  agent_id: string;
  results_json: string;
  passed: number;
  failed: number;
  total: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class EvaluationRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Save a complete evaluation run.
   *
   * @param runId - Unique run identifier.
   * @param agentId - The agent that was evaluated.
   * @param results - Array of individual test case results.
   */
  saveRun(runId: string, agentId: string, results: StoredEvalResult[]): void {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    const stmt = this.db.raw.prepare(`
      INSERT INTO eval_runs (id, agent_id, results_json, passed, failed, total, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        results_json = excluded.results_json,
        passed = excluded.passed,
        failed = excluded.failed,
        total = excluded.total
    `);

    stmt.run(
      runId,
      agentId,
      JSON.stringify(results),
      passed,
      failed,
      results.length,
    );
  }

  /**
   * Retrieve all results for a specific run.
   */
  getRun(runId: string): StoredEvalResult[] {
    const stmt = this.db.raw.prepare('SELECT results_json FROM eval_runs WHERE id = ?');
    const row = stmt.get(runId) as { results_json: string } | undefined;
    if (!row) return [];
    return JSON.parse(row.results_json) as StoredEvalResult[];
  }

  /**
   * List all evaluation runs with summary statistics.
   */
  listRuns(limit = 100): EvalRunSummary[] {
    const stmt = this.db.raw.prepare(`
      SELECT id, agent_id, passed, failed, total, created_at
      FROM eval_runs
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as EvalRunRow[];

    return rows.map((row) => ({
      runId: row.id,
      agentId: row.agent_id,
      timestamp: row.created_at,
      passed: row.passed,
      failed: row.failed,
      total: row.total,
    }));
  }

  /**
   * List evaluation runs for a specific agent.
   */
  listRunsByAgent(agentId: string, limit = 50): EvalRunSummary[] {
    const stmt = this.db.raw.prepare(`
      SELECT id, agent_id, passed, failed, total, created_at
      FROM eval_runs
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(agentId, limit) as EvalRunRow[];

    return rows.map((row) => ({
      runId: row.id,
      agentId: row.agent_id,
      timestamp: row.created_at,
      passed: row.passed,
      failed: row.failed,
      total: row.total,
    }));
  }

  /**
   * Delete an evaluation run by ID.
   */
  deleteRun(runId: string): void {
    const stmt = this.db.raw.prepare('DELETE FROM eval_runs WHERE id = ?');
    stmt.run(runId);
  }

  /**
   * Count total evaluation runs, optionally for a specific agent.
   */
  count(agentId?: string): number {
    if (agentId) {
      const stmt = this.db.raw.prepare(
        'SELECT COUNT(*) as count FROM eval_runs WHERE agent_id = ?',
      );
      const row = stmt.get(agentId) as { count: number };
      return row.count;
    }
    const stmt = this.db.raw.prepare('SELECT COUNT(*) as count FROM eval_runs');
    const row = stmt.get() as { count: number };
    return row.count;
  }
}
