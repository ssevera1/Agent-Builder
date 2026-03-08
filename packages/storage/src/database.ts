/**
 * Database connection manager for AgentBuilder.
 *
 * Wraps better-sqlite3 with WAL mode, automatic migrations, and
 * convenient transaction helpers.
 */

import BetterSqlite3 from 'better-sqlite3';
import { MigrationRunner } from './migrations/runner.js';
import initialMigration from './migrations/001-initial.js';
import { getDatabasePath, ensureDataDir } from './config.js';

// Collect all migrations in order
const ALL_MIGRATIONS = [initialMigration];

// ---------------------------------------------------------------------------
// Database class
// ---------------------------------------------------------------------------

export class Database {
  private _db: BetterSqlite3.Database;
  private _closed = false;

  /**
   * Create a new Database instance.
   *
   * @param dbPath - Path to the SQLite database file.
   *                 Use ':memory:' for an in-memory database.
   */
  constructor(dbPath: string) {
    this._db = new BetterSqlite3(dbPath);

    // Enable WAL mode for better concurrency (read/write can happen simultaneously)
    this._db.pragma('journal_mode = WAL');

    // Reasonable default pragmas for performance and safety
    this._db.pragma('busy_timeout = 5000');
    this._db.pragma('synchronous = NORMAL');
    this._db.pragma('cache_size = -20000'); // 20MB cache
    this._db.pragma('foreign_keys = ON');
    this._db.pragma('temp_store = MEMORY');
  }

  /**
   * Create a Database instance using the default data directory path.
   * Ensures the data directory exists before opening the database.
   */
  static create(dbPath?: string): Database {
    const path = dbPath ?? getDatabasePath();
    if (path !== ':memory:') {
      ensureDataDir();
    }
    const db = new Database(path);
    db.migrate();
    return db;
  }

  /**
   * Create an in-memory Database instance.
   * Useful for testing and temporary operations.
   */
  static inMemory(): Database {
    const db = new Database(':memory:');
    db.migrate();
    return db;
  }

  /**
   * Get the underlying better-sqlite3 database instance.
   */
  get raw(): BetterSqlite3.Database {
    this.ensureOpen();
    return this._db;
  }

  /**
   * Run all pending migrations against this database.
   *
   * @returns The number of migrations applied.
   */
  migrate(): number {
    this.ensureOpen();
    const runner = new MigrationRunner(this._db, ALL_MIGRATIONS);
    return runner.run();
  }

  /**
   * Execute a function within a SQLite transaction.
   *
   * If the function throws, the transaction is rolled back.
   * If it returns successfully, the transaction is committed.
   *
   * @param fn - Function to execute within the transaction.
   * @returns The return value of the function.
   */
  transaction<T>(fn: (db: BetterSqlite3.Database) => T): T {
    this.ensureOpen();
    const wrapped = this._db.transaction(() => fn(this._db));
    return wrapped();
  }

  /**
   * Close the database connection.
   * After calling this, the database instance cannot be used.
   */
  close(): void {
    if (!this._closed) {
      this._db.close();
      this._closed = true;
    }
  }

  /**
   * Check if the database connection is still open.
   */
  get isOpen(): boolean {
    return !this._closed;
  }

  /**
   * Ensure the database is still open, throwing if it has been closed.
   */
  private ensureOpen(): void {
    if (this._closed) {
      throw new Error('Database connection has been closed');
    }
  }
}
