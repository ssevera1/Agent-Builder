/**
 * Migration runner for the AgentBuilder SQLite database.
 *
 * Tracks applied migrations in a `_migrations` meta-table and runs
 * pending migrations in order. The process is idempotent: already-applied
 * migrations are skipped.
 */

import type BetterSqlite3 from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Migration interface
// ---------------------------------------------------------------------------

/**
 * A single database migration.
 */
export interface Migration {
  /** Unique, sortable migration identifier (e.g., '001-initial'). */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Apply the migration to the database. */
  up(db: BetterSqlite3.Database): void;
}

// ---------------------------------------------------------------------------
// MigrationRunner
// ---------------------------------------------------------------------------

export class MigrationRunner {
  private readonly db: BetterSqlite3.Database;
  private readonly migrations: Migration[];

  constructor(db: BetterSqlite3.Database, migrations: Migration[]) {
    this.db = db;
    this.migrations = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Ensure the _migrations tracking table exists.
   */
  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /**
   * Get the set of migration IDs that have already been applied.
   */
  private getAppliedMigrations(): Set<string> {
    const stmt = this.db.prepare('SELECT id FROM _migrations');
    const rows = stmt.all() as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Record that a migration has been applied.
   */
  private recordMigration(migration: Migration): void {
    const stmt = this.db.prepare(
      'INSERT INTO _migrations (id, description) VALUES (?, ?)',
    );
    stmt.run(migration.id, migration.description);
  }

  /**
   * Run all pending migrations in order.
   *
   * Each migration runs in its own transaction. If a migration fails,
   * its transaction is rolled back and the error is propagated, but
   * previously successful migrations remain applied.
   *
   * @returns The number of newly applied migrations.
   */
  run(): number {
    this.ensureMigrationsTable();
    const applied = this.getAppliedMigrations();
    let count = 0;

    for (const migration of this.migrations) {
      if (applied.has(migration.id)) {
        continue;
      }

      const runMigration = this.db.transaction(() => {
        migration.up(this.db);
        this.recordMigration(migration);
      });

      try {
        runMigration();
        count++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Migration "${migration.id}" failed: ${message}`,
        );
      }
    }

    return count;
  }

  /**
   * Get the status of all known migrations.
   */
  status(): Array<{ id: string; description: string; applied: boolean; appliedAt?: string }> {
    this.ensureMigrationsTable();
    const applied = this.getAppliedMigrations();

    // Also get timestamps for applied migrations
    const stmt = this.db.prepare('SELECT id, applied_at FROM _migrations');
    const rows = stmt.all() as Array<{ id: string; applied_at: string }>;
    const appliedMap = new Map(rows.map((r) => [r.id, r.applied_at]));

    return this.migrations.map((m) => ({
      id: m.id,
      description: m.description,
      applied: applied.has(m.id),
      appliedAt: appliedMap.get(m.id),
    }));
  }
}
