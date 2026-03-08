/**
 * Repository for persisting and querying AgentConfig records.
 *
 * Serializes the full AgentConfig to JSON for storage and
 * deserializes on retrieval, coercing date strings back to Date objects.
 */

import type { AgentConfig } from '@agentbuilder/core';
import type { Database } from '../database.js';

// ---------------------------------------------------------------------------
// Row shape coming out of SQLite
// ---------------------------------------------------------------------------

interface AgentConfigRow {
  id: string;
  name: string;
  description: string | null;
  version: string;
  config_json: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// List options
// ---------------------------------------------------------------------------

export interface ListAgentConfigOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class AgentConfigRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Create a new agent configuration.
   *
   * @param config - The full AgentConfig object.
   * @returns The ID of the created configuration.
   */
  create(config: AgentConfig): string {
    const stmt = this.db.raw.prepare(`
      INSERT INTO agent_configs (id, name, description, version, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    const configWithDates = {
      ...config,
      createdAt: config.createdAt ?? new Date(),
      updatedAt: config.updatedAt ?? new Date(),
    };

    stmt.run(
      config.id,
      config.name,
      config.description ?? null,
      config.version,
      JSON.stringify(configWithDates),
      configWithDates.createdAt instanceof Date
        ? configWithDates.createdAt.toISOString()
        : now,
      configWithDates.updatedAt instanceof Date
        ? configWithDates.updatedAt.toISOString()
        : now,
    );

    return config.id;
  }

  /**
   * Retrieve an agent configuration by ID.
   *
   * @returns The AgentConfig or null if not found.
   */
  getById(id: string): AgentConfig | null {
    const stmt = this.db.raw.prepare('SELECT * FROM agent_configs WHERE id = ?');
    const row = stmt.get(id) as AgentConfigRow | undefined;
    if (!row) return null;
    return this.deserialize(row);
  }

  /**
   * Retrieve an agent configuration by name.
   *
   * @returns The AgentConfig or null if not found.
   */
  getByName(name: string): AgentConfig | null {
    const stmt = this.db.raw.prepare('SELECT * FROM agent_configs WHERE name = ?');
    const row = stmt.get(name) as AgentConfigRow | undefined;
    if (!row) return null;
    return this.deserialize(row);
  }

  /**
   * List agent configurations with optional pagination and search.
   */
  list(options?: ListAgentConfigOptions): AgentConfig[] {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const search = options?.search;

    let query: string;
    let params: unknown[];

    if (search) {
      query = `
        SELECT * FROM agent_configs
        WHERE name LIKE ? OR description LIKE ?
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `;
      const pattern = `%${search}%`;
      params = [pattern, pattern, limit, offset];
    } else {
      query = `
        SELECT * FROM agent_configs
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [limit, offset];
    }

    const stmt = this.db.raw.prepare(query);
    const rows = stmt.all(...params) as AgentConfigRow[];
    return rows.map((row) => this.deserialize(row));
  }

  /**
   * Update an existing agent configuration.
   *
   * Merges the provided partial updates into the existing config,
   * updates the `updatedAt` timestamp, and persists the changes.
   */
  update(id: string, updates: Partial<AgentConfig>): void {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`AgentConfig with id "${id}" not found`);
    }

    const merged: AgentConfig = {
      ...existing,
      ...updates,
      id, // ID cannot be changed
      updatedAt: new Date(),
    };

    const stmt = this.db.raw.prepare(`
      UPDATE agent_configs
      SET name = ?, description = ?, version = ?, config_json = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      merged.name,
      merged.description ?? null,
      merged.version,
      JSON.stringify(merged),
      merged.updatedAt.toISOString(),
      id,
    );
  }

  /**
   * Delete an agent configuration by ID.
   */
  delete(id: string): void {
    const stmt = this.db.raw.prepare('DELETE FROM agent_configs WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Count total agent configurations.
   */
  count(): number {
    const stmt = this.db.raw.prepare('SELECT COUNT(*) as count FROM agent_configs');
    const row = stmt.get() as { count: number };
    return row.count;
  }

  // -----------------------------------------------------------------------
  // Serialization helpers
  // -----------------------------------------------------------------------

  private deserialize(row: AgentConfigRow): AgentConfig {
    const parsed = JSON.parse(row.config_json) as Record<string, unknown>;

    // Ensure dates are proper Date objects
    return {
      ...parsed,
      createdAt: new Date(parsed['createdAt'] as string),
      updatedAt: new Date(parsed['updatedAt'] as string),
    } as AgentConfig;
  }
}
