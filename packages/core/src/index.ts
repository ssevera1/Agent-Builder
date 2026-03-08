/**
 * @agentbuilder/core — Foundation package for the AgentBuilder platform.
 *
 * This barrel re-exports all types, errors, schemas, and utilities
 * so consumers can import everything from '@agentbuilder/core'.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

// Agent types
export type {
  AgentConfig,
  AgentPatternType,
  ProviderConfig,
  MemoryConfig,
  GuardrailRule,
  AgentBlueprint,
  TestCaseDefinition,
} from './types/agent.js';

// LLM types
export type {
  MessageRole,
  TextContent,
  ImageContent,
  ImageUrlContent,
  ToolCallContent,
  ToolResultContent,
  ContentBlock,
  Message,
  ToolParameterSchema,
  LLMRequest,
  TokenUsage,
  LLMStreamChunk,
  ModelInfo,
  ProviderInfo,
} from './types/llm.js';

// Also export ToolDefinition from llm.ts under a distinct alias to avoid
// collision with the richer ToolDefinition from tool.ts.
export type { ToolDefinition as LLMToolDefinition } from './types/llm.js';

// Tool types
export {
  ToolCategory,
} from './types/tool.js';

export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolPlugin,
  ToolExecutionContext,
} from './types/tool.js';

// Memory types
export type {
  MemoryEntry,
  MemoryMetadata,
  Episode,
  EpisodeOutcome,
  MemorySearchResult,
  MemorySearchOptions,
} from './types/memory.js';

// Message types & helpers
export type {
  Role,
  StructuredMessage,
} from './types/message.js';

export {
  extractText,
  extractToolCallBlocks,
  extractToolResultBlocks,
  createTextMessage,
  createToolResultMessage,
} from './types/message.js';

// Workflow types
export type {
  WorkflowNodeType,
  AgentNode,
  TransformNode,
  ConditionNode,
  ParallelNode,
  HumanNode,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInput,
  WorkflowOutput,
  WorkflowDefinition,
  WorkflowExecutionStatus,
  NodeExecutionStatus,
  NodeExecutionState,
  WorkflowExecution,
  WorkflowEventType,
  WorkflowEvent,
} from './types/workflow.js';

// Evaluation types
export type {
  TestCase,
  AssertionType,
  Assertion,
  AssertionResult,
  EvalMetric,
  EvalResult,
  EvalRunSummary,
  ComparisonReport,
  MetricComparison,
  TestCaseComparison,
  ComparisonSummary,
} from './types/evaluation.js';

// Session types
export type {
  SessionState,
  SessionMetadata,
  Session,
  CreateSessionOptions,
  ListSessionsOptions,
} from './types/session.js';

// ─── Errors ─────────────────────────────────────────────────────────────────

export { AgentBuilderError, isAgentBuilderError } from './errors/base.js';
export {
  LLMError,
  RateLimitError,
  AuthenticationError,
  ModelNotFoundError,
  ContextLengthError,
  ContentFilterError,
} from './errors/llm.js';
export {
  ToolExecutionError,
  ToolTimeoutError,
  ToolNotFoundError,
  ToolValidationError,
} from './errors/tool.js';
export { ConfigValidationError } from './errors/validation.js';
export type { ValidationIssue } from './errors/validation.js';

// ─── Schemas ────────────────────────────────────────────────────────────────

export {
  agentPatternTypeSchema,
  providerConfigSchema,
  memoryConfigSchema,
  guardrailRuleSchema,
  testCaseDefinitionSchema,
  agentConfigSchema,
  agentBlueprintSchema,
  parseAgentConfig,
  safeParseAgentConfig,
  parseProviderConfig,
  parseMemoryConfig,
  parseAgentBlueprint,
} from './schemas/agent.schema.js';

export {
  toolCategorySchema,
  toolDefinitionSchema,
  toolCallSchema,
  toolResultSchema,
  parseToolDefinition,
  parseToolCall,
  parseToolResult,
} from './schemas/tool.schema.js';

export {
  workflowNodeSchema,
  workflowEdgeSchema,
  workflowInputSchema,
  workflowOutputSchema,
  workflowDefinitionSchema,
  parseWorkflowDefinition,
  parseWorkflowNode,
  parseWorkflowEdge,
} from './schemas/workflow.schema.js';

export {
  memoryMetadataSchema,
  memoryEntrySchema,
  episodeOutcomeSchema,
  episodeSchema,
  parseMemoryEntry,
  parseEpisode,
} from './schemas/memory.schema.js';

// ─── Utilities ──────────────────────────────────────────────────────────────

export {
  estimateTokens,
  estimateMessagesTokens,
  fitsInContext,
} from './utils/token-counter.js';

export { withRetry } from './utils/retry.js';
export type { RetryOptions } from './utils/retry.js';

export {
  mapStream,
  filterStream,
  mergeStreams,
  collectStream,
  takeStream,
  streamToCallback,
  createPushStream,
} from './utils/stream.js';
export type { StreamCallbacks } from './utils/stream.js';

export {
  createLogger,
  createSilentLogger,
  createChildLogger,
} from './utils/logger.js';
export type { LogLevel, LoggerOptions, Logger } from './utils/logger.js';

export {
  generateId,
  generatePrefixedId,
  isValidId,
  generateSortableId,
} from './utils/id.js';

export {
  getDataDir,
  getConfigDir,
  getCacheDir,
  ensureDir,
  ensureDirSync,
} from './utils/paths.js';
