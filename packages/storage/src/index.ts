/**
 * @agentbuilder/storage — SQLite-backed persistence for agents, sessions,
 * workflows, evaluations, and configuration.
 */

// Database
export { Database } from './database.js';

// Repositories
export { AgentConfigRepository } from './repositories/agent-config.repo.js';
export type { ListAgentConfigOptions } from './repositories/agent-config.repo.js';

export { SessionRepository } from './repositories/session.repo.js';
export type { SessionRecord, SessionState } from './repositories/session.repo.js';

export { WorkflowExecutionRepository } from './repositories/workflow.repo.js';
export type { WorkflowExecutionState } from './repositories/workflow.repo.js';

export { EvaluationRepository } from './repositories/evaluation.repo.js';
export type { StoredEvalResult, EvalRunSummary } from './repositories/evaluation.repo.js';

// Configuration
export {
  getDataDir,
  getDatabasePath,
  ensureDataDir,
  getProviderConfig,
  setProviderConfig,
  getSetting,
  setSetting,
  getAllConfig,
  setConfigByKey,
  getConfigByKey,
  getProvidersList,
  getProviderApiKey,
  getDefaults,
} from './config.js';

// Migrations
export { MigrationRunner } from './migrations/runner.js';
export type { Migration } from './migrations/runner.js';
