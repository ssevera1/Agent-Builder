/**
 * Shared type definitions for the workflow package.
 */

import type { WorkflowExecutionState } from './state.js';

// ─── Workflow Definition Types ──────────────────────────────────────────────

/** Supported workflow node types. */
export type WorkflowNodeType =
  | 'agent'
  | 'transform'
  | 'condition'
  | 'parallel'
  | 'human'
  | 'custom';

/**
 * A node in a workflow definition.
 */
export interface WorkflowNode {
  /** Unique ID for this node within the workflow. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The type of node. */
  type: WorkflowNodeType;
  /** Node-specific configuration. */
  config: Record<string, unknown>;
  /** Optional description. */
  description?: string;
  /** Retry configuration. */
  retry?: {
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier?: number;
  };
  /** Timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * An edge connecting two nodes in the workflow.
 */
export interface WorkflowEdge {
  /** Source node ID. */
  from: string;
  /** Target node ID. */
  to: string;
  /** Optional condition for traversal (used with condition nodes). */
  condition?: string;
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Complete workflow definition.
 */
export interface WorkflowDefinition {
  /** Unique ID for this workflow. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Semantic version. */
  version: string;
  /** All nodes in the workflow. */
  nodes: WorkflowNode[];
  /** All edges connecting nodes. */
  edges: WorkflowEdge[];
  /** Input schema description. */
  inputs?: Record<string, { type: string; description?: string; required?: boolean }>;
  /** Output mapping from node outputs to workflow outputs. */
  outputs?: Record<string, string>;
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

// ─── Execution Types ────────────────────────────────────────────────────────

/**
 * Context provided to node handlers during execution.
 */
export interface WorkflowContext {
  /** The current execution ID. */
  executionId: string;
  /** The workflow definition. */
  workflow: WorkflowDefinition;
  /** Current execution state. */
  state: WorkflowExecutionState;
  /** Emit an event during execution. */
  emitEvent: (event: WorkflowEvent) => void;
  /** Signal to check if execution has been cancelled. */
  signal: AbortSignal;
  /** Request human input (pauses execution). */
  requestHumanInput: (prompt: string) => Promise<string>;
  /** Resolve outputs from a parent node. */
  getNodeOutputs: (nodeId: string) => Record<string, unknown> | undefined;
  /** Factory for creating agent orchestrators (for agent nodes). */
  createOrchestrator?: (agentConfigId: string) => AgentOrchestrator;
}

/**
 * Handler interface for executing a single workflow node type.
 */
export interface NodeHandler {
  /** Execute the node with given inputs and return outputs. */
  execute(
    node: WorkflowNode,
    inputs: Record<string, unknown>,
    context: WorkflowContext,
  ): Promise<Record<string, unknown>>;
}

/**
 * Minimal agent orchestrator interface for agent nodes.
 */
export interface AgentOrchestrator {
  run(message: string, sessionId?: string): Promise<{
    response: string;
    toolsUsed: string[];
    tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>;
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** Event types emitted during workflow execution. */
export type WorkflowEventType =
  | 'workflow_started'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'workflow_cancelled'
  | 'workflow_paused'
  | 'workflow_resumed'
  | 'layer_started'
  | 'layer_completed'
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'node_skipped'
  | 'node_retry'
  | 'human_input_required'
  | 'checkpoint_saved';

/**
 * An event emitted during workflow execution.
 */
export interface WorkflowEvent {
  /** Type of event. */
  type: WorkflowEventType;
  /** When the event occurred. */
  timestamp: Date;
  /** The execution ID. */
  executionId: string;
  /** Related node ID, if applicable. */
  nodeId?: string;
  /** Related layer index, if applicable. */
  layer?: number;
  /** Event-specific data. */
  data?: Record<string, unknown>;
  /** Error information, if applicable. */
  error?: string;
}

// ─── Executor Options ───────────────────────────────────────────────────────

/**
 * Interface for persisting workflow execution state.
 */
export interface CheckpointStore {
  save(executionId: string, state: WorkflowExecutionState): Promise<void>;
  load(executionId: string): Promise<WorkflowExecutionState | undefined>;
  list(): Promise<string[]>;
  delete(executionId: string): Promise<void>;
}

/**
 * Options for the WorkflowExecutor.
 */
export interface ExecutorOptions {
  /** Maximum number of nodes to execute concurrently within a layer. */
  maxConcurrency?: number;
  /** Optional checkpoint store for durability. */
  checkpointStore?: CheckpointStore;
  /** Event callback. */
  onEvent?: (event: WorkflowEvent) => void;
  /** Maximum retries for failed nodes (default: 0). */
  maxRetries?: number;
  /** Base delay between retries in ms (default: 1000). */
  retryDelayMs?: number;
}
