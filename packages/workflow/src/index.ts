/**
 * @agentbuilder/workflow — DAG-based workflow orchestration engine.
 *
 * Provides a complete workflow execution system with:
 * - Directed Acyclic Graph (DAG) for execution ordering
 * - Parallel layer-based execution
 * - Condition-based branching
 * - Human-in-the-loop support
 * - Checkpoint/restore for durability
 * - YAML/JSON serialization
 */

// DAG
export { DAG } from './dag.js';
export type { DAGNode, DAGValidationResult, EdgeMetadata } from './dag.js';

// State management
export {
  createExecutionState,
  markNodeRunning,
  markNodeCompleted,
  markNodeFailed,
  markNodeSkipped,
  incrementRetry,
  markWorkflowCompleted,
  markWorkflowFailed,
  markWorkflowPaused,
  markWorkflowResumed,
  markWorkflowCancelled,
  serializeState,
  deserializeState,
} from './state.js';
export type {
  WorkflowStatus,
  NodeStatus,
  NodeExecutionState,
  WorkflowExecutionState,
  SerializedExecutionState,
} from './state.js';

// Types
export type {
  WorkflowNodeType,
  WorkflowNode,
  WorkflowEdge,
  WorkflowDefinition,
  WorkflowContext,
  NodeHandler,
  AgentOrchestrator,
  WorkflowEventType,
  WorkflowEvent,
  CheckpointStore,
  ExecutorOptions,
} from './types.js';

// Executor
export { WorkflowExecutor } from './executor.js';

// Node handlers
export { AgentNodeHandler } from './nodes/agent-node.js';
export { TransformNodeHandler } from './nodes/transform-node.js';
export { ConditionNodeHandler } from './nodes/condition-node.js';
export { ParallelNodeHandler } from './nodes/parallel-node.js';
export { HumanNodeHandler } from './nodes/human-node.js';

// Checkpoint stores
export {
  InMemoryCheckpointStore,
  SQLiteCheckpointStore,
  FileCheckpointStore,
} from './checkpoint.js';
export type { SQLiteConnection, SQLiteStatement } from './checkpoint.js';

// Serialization
export {
  parseWorkflowYAML,
  tryParseWorkflowYAML,
  serializeWorkflowYAML,
  parseWorkflowJSON,
  tryParseWorkflowJSON,
  serializeWorkflowJSON,
  WorkflowDefinitionSchema,
} from './serialization.js';
export type { SerializationError, SerializationResult } from './serialization.js';
