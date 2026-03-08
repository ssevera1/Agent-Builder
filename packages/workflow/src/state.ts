/**
 * Workflow execution state management.
 *
 * Defines the state structures tracked during workflow execution and provides
 * utilities for creating, updating, and querying execution state.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Overall status of a workflow execution. */
export type WorkflowStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Status of a single node's execution within a workflow. */
export type NodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * Execution state of a single workflow node.
 */
export interface NodeExecutionState {
  /** The node's unique ID within the workflow. */
  nodeId: string;
  /** Current execution status. */
  status: NodeStatus;
  /** Inputs provided to this node. */
  inputs?: Record<string, unknown>;
  /** Outputs produced by this node. */
  outputs?: Record<string, unknown>;
  /** When execution of this node started. */
  startedAt?: Date;
  /** When execution of this node completed (successfully or with error). */
  completedAt?: Date;
  /** Error message if the node failed. */
  error?: string;
  /** Number of times this node has been retried. */
  retryCount: number;
}

/**
 * Complete execution state of a workflow run.
 */
export interface WorkflowExecutionState {
  /** Unique identifier for this execution run. */
  executionId: string;
  /** Identifier of the workflow being executed. */
  workflowId: string;
  /** Current overall status. */
  status: WorkflowStatus;
  /** Index of the current execution layer (0-based). */
  currentLayer: number;
  /** Per-node execution states, keyed by node ID. */
  nodeStates: Map<string, NodeExecutionState>;
  /** Inputs provided to the workflow. */
  inputs: Record<string, unknown>;
  /** Accumulated outputs from all completed nodes. */
  outputs: Record<string, unknown>;
  /** When the workflow execution started. */
  startedAt: Date;
  /** When the workflow execution completed. */
  completedAt?: Date;
  /** Error message if the workflow failed. */
  error?: string;
}

// ─── Factory Functions ──────────────────────────────────────────────────────

/**
 * Create an initial workflow execution state.
 */
export function createExecutionState(
  executionId: string,
  workflowId: string,
  inputs: Record<string, unknown>,
  nodeIds: string[],
): WorkflowExecutionState {
  const nodeStates = new Map<string, NodeExecutionState>();
  for (const nodeId of nodeIds) {
    nodeStates.set(nodeId, {
      nodeId,
      status: 'pending',
      retryCount: 0,
    });
  }

  return {
    executionId,
    workflowId,
    status: 'running',
    currentLayer: 0,
    nodeStates,
    inputs,
    outputs: {},
    startedAt: new Date(),
  };
}

/**
 * Mark a node as running.
 */
export function markNodeRunning(
  state: WorkflowExecutionState,
  nodeId: string,
  inputs: Record<string, unknown>,
): void {
  const nodeState = state.nodeStates.get(nodeId);
  if (!nodeState) return;
  nodeState.status = 'running';
  nodeState.inputs = inputs;
  nodeState.startedAt = new Date();
}

/**
 * Mark a node as completed with outputs.
 */
export function markNodeCompleted(
  state: WorkflowExecutionState,
  nodeId: string,
  outputs: Record<string, unknown>,
): void {
  const nodeState = state.nodeStates.get(nodeId);
  if (!nodeState) return;
  nodeState.status = 'completed';
  nodeState.outputs = outputs;
  nodeState.completedAt = new Date();

  // Merge outputs into global workflow outputs under the node's ID
  state.outputs[nodeId] = outputs;
}

/**
 * Mark a node as failed with an error.
 */
export function markNodeFailed(
  state: WorkflowExecutionState,
  nodeId: string,
  error: string,
): void {
  const nodeState = state.nodeStates.get(nodeId);
  if (!nodeState) return;
  nodeState.status = 'failed';
  nodeState.error = error;
  nodeState.completedAt = new Date();
}

/**
 * Mark a node as skipped.
 */
export function markNodeSkipped(
  state: WorkflowExecutionState,
  nodeId: string,
): void {
  const nodeState = state.nodeStates.get(nodeId);
  if (!nodeState) return;
  nodeState.status = 'skipped';
  nodeState.completedAt = new Date();
}

/**
 * Increment a node's retry counter.
 */
export function incrementRetry(
  state: WorkflowExecutionState,
  nodeId: string,
): number {
  const nodeState = state.nodeStates.get(nodeId);
  if (!nodeState) return 0;
  nodeState.retryCount += 1;
  return nodeState.retryCount;
}

/**
 * Finalize the workflow execution as completed.
 */
export function markWorkflowCompleted(state: WorkflowExecutionState): void {
  state.status = 'completed';
  state.completedAt = new Date();
}

/**
 * Finalize the workflow execution as failed.
 */
export function markWorkflowFailed(
  state: WorkflowExecutionState,
  error: string,
): void {
  state.status = 'failed';
  state.error = error;
  state.completedAt = new Date();
}

/**
 * Pause the workflow execution.
 */
export function markWorkflowPaused(state: WorkflowExecutionState): void {
  state.status = 'paused';
}

/**
 * Resume the workflow execution.
 */
export function markWorkflowResumed(state: WorkflowExecutionState): void {
  state.status = 'running';
}

/**
 * Cancel the workflow execution.
 */
export function markWorkflowCancelled(state: WorkflowExecutionState): void {
  state.status = 'cancelled';
  state.completedAt = new Date();
}

// ─── Serialization Helpers ──────────────────────────────────────────────────

/** Serialized representation of a single node's execution state. */
export interface SerializedNodeExecutionState {
  nodeId: string;
  status: NodeStatus;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  retryCount: number;
}

/** Plain-object representation of WorkflowExecutionState for serialization. */
export interface SerializedExecutionState {
  executionId: string;
  workflowId: string;
  status: WorkflowStatus;
  currentLayer: number;
  nodeStates: Array<[string, SerializedNodeExecutionState]>;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

/**
 * Serialize execution state to a plain object suitable for JSON.
 */
export function serializeState(state: WorkflowExecutionState): SerializedExecutionState {
  const nodeEntries: Array<[string, SerializedNodeExecutionState]> = [];
  for (const [key, value] of state.nodeStates) {
    nodeEntries.push([
      key,
      {
        nodeId: value.nodeId,
        status: value.status,
        inputs: value.inputs,
        outputs: value.outputs,
        startedAt: value.startedAt?.toISOString(),
        completedAt: value.completedAt?.toISOString(),
        error: value.error,
        retryCount: value.retryCount,
      },
    ]);
  }

  return {
    executionId: state.executionId,
    workflowId: state.workflowId,
    status: state.status,
    currentLayer: state.currentLayer,
    nodeStates: nodeEntries,
    inputs: state.inputs,
    outputs: state.outputs,
    startedAt: state.startedAt.toISOString(),
    completedAt: state.completedAt?.toISOString(),
    error: state.error,
  };
}

/**
 * Deserialize a plain object back into WorkflowExecutionState.
 */
export function deserializeState(data: SerializedExecutionState): WorkflowExecutionState {
  const nodeStates = new Map<string, NodeExecutionState>();
  for (const [key, value] of data.nodeStates) {
    nodeStates.set(key, {
      ...value,
      startedAt: value.startedAt ? new Date(value.startedAt) : undefined,
      completedAt: value.completedAt ? new Date(value.completedAt) : undefined,
    });
  }

  return {
    executionId: data.executionId,
    workflowId: data.workflowId,
    status: data.status,
    currentLayer: data.currentLayer,
    nodeStates,
    inputs: data.inputs,
    outputs: data.outputs,
    startedAt: new Date(data.startedAt),
    completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
    error: data.error,
  };
}
