/**
 * Initial database schema migration.
 *
 * Creates the core tables for agent configs, sessions, memory entries,
 * episodes, workflow executions, provider configs, and evaluation runs.
 */

import type { Migration } from './runner.js';

const migration: Migration = {
  id: '001-initial',
  description: 'Create initial schema',

  up(db) {
    db.exec(`
      -- Agent configurations
      CREATE TABLE IF NOT EXISTS agent_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        version TEXT NOT NULL DEFAULT '0.1.0',
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_agent_configs_name ON agent_configs(name);
      CREATE INDEX IF NOT EXISTS idx_agent_configs_updated ON agent_configs(updated_at);

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        messages_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (agent_id) REFERENCES agent_configs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent_state ON sessions(agent_id, state);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

      -- Memory entries (long-term memory)
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        content TEXT NOT NULL,
        embedding BLOB,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_entries_agent_id ON memory_entries(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memory_entries_created ON memory_entries(created_at);

      -- Episodes (episodic memory)
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        outcome TEXT NOT NULL,
        tools_used_json TEXT NOT NULL DEFAULT '[]',
        embedding BLOB,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_agent_id ON episodes(agent_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_outcome ON episodes(outcome);
      CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at);

      -- Workflow executions
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);

      -- Provider configurations
      CREATE TABLE IF NOT EXISTS provider_configs (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        config_json TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_provider_configs_provider_id ON provider_configs(provider_id);
      CREATE INDEX IF NOT EXISTS idx_provider_configs_default ON provider_configs(is_default);

      -- Evaluation runs
      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        results_json TEXT NOT NULL DEFAULT '[]',
        passed INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_eval_runs_agent_id ON eval_runs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_eval_runs_created ON eval_runs(created_at);
    `);
  },
};

export default migration;
