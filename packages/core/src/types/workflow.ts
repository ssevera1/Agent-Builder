/**
 * Workflow orchestration type definitions.
 * Workflows are directed graphs of nodes that chain agents, transforms,
 * conditions, parallel branches, and human-in-the-loop steps.
 */

// ---------------------------------------------------------------------------
// Node Types
// ---------------------------------------------------------------------------

/** Discriminated union of workflow node types. */
export type WorkflowNodeType = 'agent' | 'transform' | 'condition' | 'parallel' | 'human';

/** Base properties shared by all node types. */
interface WorkflowNodeBase {
  /** Unique node ID within the workflow. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Node type discriminator. */
  type: WorkflowNodeType;
  /** Position for visual layout (x, y). */
  position: { x: number; y: number };
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

/** A node that delegates to an agent. */
export interface AgentNode extends WorkflowNodeBase {
  type: 'agent';
  /** ID of the agent configuration to use. */
  agentId: string;
  /** Optional prompt override. */
  promptOverride?: string;
  /** Input mapping: keys are agent input names, values are expressions referencing prior outputs. */
  inputMapping?: Record<string, string>;
}

/** A node that transforms data without calling an LLM. */
export interface TransformNode extends WorkflowNodeBase {
  type: 'transform';
  /** JavaScript expression or function body that transforms input to output. */
  transformExpression: string;
  /** Input mapping. */
  inputMapping?: Record<string, string>;
}

/** A conditional branch node. */
export interface ConditionNode extends WorkflowNodeBase {
  type: 'condition';
  /** Condition expression evaluated against the workflow state. */
  conditionExpression: string;
  /** Edge ID to follow when condition is true. */
  trueBranch: string;
  /** Edge ID to follow when condition is false. */
  falseBranch: string;
}

/** A node that executes multiple branches in parallel. */
export interface ParallelNode extends WorkflowNodeBase {
  type: 'parallel';
  /** Node IDs to execute concurrently. */
  branches: string[];
  /** How to merge branch results: 'all' waits for all, 'race' takes first. */
  mergeStrategy: 'all' | 'race';
}

/** A human-in-the-loop node that pauses for user input. */
export interface HumanNode extends WorkflowNodeBase {
  type: 'human';
  /** Prompt shown to the human reviewer. */
  prompt: string;
  /** Maximum time to wait for human input (ms). 0 means indefinite. */
  timeoutMs: number;
  /** Action to take if the human doesn't respond in time. */
  timeoutAction: 'approve' | 'reject' | 'skip';
}

/** Union of all node types. */
export type WorkflowNode = AgentNode | TransformNode | ConditionNode | ParallelNode | HumanNode;

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/** A directed edge connecting two nodes. */
export interface WorkflowEdge {
  /** Unique edge ID. */
  id: string;
  /** Source node ID. */
  sourceNodeId: string;
  /** Target node ID. */
  targetNodeId: string;
  /** Optional condition expression; edge is followed only when truthy. */
  condition?: string;
  /** Optional label for display. */
  label?: string;
}

// ---------------------------------------------------------------------------
// Workflow Definition
// ---------------------------------------------------------------------------

/** Input parameter definition for a workflow. */
export interface WorkflowInput {
  /** Parameter name. */
  name: string;
  /** Description of the input. */
  description: string;
  /** JSON Schema type. */
  type: string;
  /** Whether the input is required. */
  required: boolean;
  /** Default value if not provided. */
  defaultValue?: unknown;
}

/** Output definition for a workflow. */
export interface WorkflowOutput {
  /** Output name. */
  name: string;
  /** Description of the output. */
  description: string;
  /** Expression to extract the output from workflow state. */
  valueExpression: string;
}

/** A complete workflow definition (the static blueprint). */
export interface WorkflowDefinition {
  /** Unique workflow ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description. */
  description: string;
  /** Semantic version. */
  version: string;
  /** All nodes in the workflow graph. */
  nodes: WorkflowNode[];
  /** All edges in the workflow graph. */
  edges: WorkflowEdge[];
  /** Input parameters the workflow accepts. */
  inputs: WorkflowInput[];
  /** Output definitions. */
  outputs: WorkflowOutput[];
  /** ID of the entry node (where execution begins). */
  entryNodeId: string;
  /** Maximum total execution time (ms). */
  timeoutMs: number;
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
  /** Created timestamp. */
  createdAt: Date;
  /** Updated timestamp. */
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Execution State
// ---------------------------------------------------------------------------

/** Overall status of a workflow execution. */
export type WorkflowExecutionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Status of an individual node execution. */
export type NodeExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'waiting_for_human';

/** Execution state for a single node. */
export interface NodeExecutionState {
  /** The node ID. */
  nodeId: string;
  /** Current status. */
  status: NodeExecutionStatus;
  /** Input data provided to the node. */
  input?: unknown;
  /** Output data produced by the node. */
  output?: unknown;
  /** Error message if failed. */
  error?: string;
  /** When execution started. */
  startedAt?: Date;
  /** When execution completed. */
  completedAt?: Date;
  /** Duration in milliseconds. */
  durationMs?: number;
  /** Number of retry attempts. */
  retryCount: number;
}

/** The complete runtime state of a workflow execution. */
export interface WorkflowExecution {
  /** Unique execution ID. */
  id: string;
  /** ID of the workflow definition being executed. */
  workflowId: string;
  /** Overall execution status. */
  status: WorkflowExecutionStatus;
  /** Per-node execution states. */
  nodeStates: Record<string, NodeExecutionState>;
  /** Global workflow state / variables (accumulated outputs). */
  state: Record<string, unknown>;
  /** Input values provided when the execution was started. */
  inputs: Record<string, unknown>;
  /** Final output values (populated on completion). */
  outputs?: Record<string, unknown>;
  /** Error if the workflow failed. */
  error?: string;
  /** When the execution was created. */
  createdAt: Date;
  /** When the execution started running. */
  startedAt?: Date;
  /** When the execution finished (completed, failed, or cancelled). */
  completedAt?: Date;
  /** Total execution duration in milliseconds. */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Types of events emitted during workflow execution. */
export type WorkflowEventType =
  | 'workflow:started'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'workflow:cancelled'
  | 'workflow:paused'
  | 'workflow:resumed'
  | 'node:started'
  | 'node:completed'
  | 'node:failed'
  | 'node:skipped'
  | 'node:waiting_for_human'
  | 'node:human_responded'
  | 'edge:traversed';

/** An event emitted during workflow execution. */
export interface WorkflowEvent {
  /** Event type. */
  type: WorkflowEventType;
  /** Workflow execution ID. */
  executionId: string;
  /** Workflow definition ID. */
  workflowId: string;
  /** Relevant node ID (if node-scoped). */
  nodeId?: string;
  /** Relevant edge ID (if edge-scoped). */
  edgeId?: string;
  /** Event-specific data. */
  data?: unknown;
  /** When the event occurred. */
  timestamp: Date;
}
