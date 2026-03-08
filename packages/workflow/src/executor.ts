/**
 * WorkflowExecutor — the core orchestration engine for executing workflows.
 *
 * Execution process:
 * 1. Build a DAG from the WorkflowDefinition
 * 2. Validate the DAG (no cycles, all edges valid)
 * 3. Compute execution layers (groups of parallelizable nodes)
 * 4. Execute layer by layer, running nodes within each layer in parallel
 * 5. Pass outputs from parent nodes as inputs to child nodes
 * 6. Handle condition nodes (evaluate expression, choose branch)
 * 7. Handle parallel nodes (fan-out, fan-in)
 * 8. Handle human-in-the-loop nodes (pause execution, wait for resume)
 * 9. Emit WorkflowEvents throughout
 * 10. Support checkpointing after each layer
 */

import { DAG } from './dag.js';
import {
  createExecutionState,
  markNodeRunning,
  markNodeCompleted,
  markNodeFailed,
  markNodeSkipped,
  markWorkflowCompleted,
  markWorkflowFailed,
  markWorkflowPaused,
  markWorkflowResumed,
  markWorkflowCancelled,
  incrementRetry,
} from './state.js';
import type { WorkflowExecutionState } from './state.js';
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEvent,
  WorkflowContext,
  NodeHandler,
  ExecutorOptions,
  CheckpointStore,
} from './types.js';

// ─── Pending Human Input Tracking ───────────────────────────────────────────

interface PendingHumanInput {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  prompt: string;
}

// ─── Execution Run ──────────────────────────────────────────────────────────

interface ExecutionRun {
  state: WorkflowExecutionState;
  abortController: AbortController;
  pendingHumanInputs: Map<string, PendingHumanInput>;
  eventQueue: WorkflowEvent[];
  workflow: WorkflowDefinition;
  dag: DAG<WorkflowNode>;
  layers: string[][];
  /** Resolves when a paused workflow is resumed. */
  resumePromise?: Promise<void>;
  resumeResolve?: () => void;
}

// ─── WorkflowExecutor ──────────────────────────────────────────────────────

export class WorkflowExecutor {
  private readonly nodeHandlers: Map<string, NodeHandler>;
  private readonly options: ExecutorOptions;
  private readonly runs: Map<string, ExecutionRun> = new Map();
  private readonly checkpointStore?: CheckpointStore;

  constructor(
    nodeHandlers: Map<string, NodeHandler>,
    options?: ExecutorOptions,
  ) {
    this.nodeHandlers = nodeHandlers;
    this.options = options ?? {};
    this.checkpointStore = options?.checkpointStore;
  }

  /**
   * Execute a workflow and yield events as they occur.
   */
  async *execute(
    workflow: WorkflowDefinition,
    inputs: Record<string, unknown>,
  ): AsyncIterable<WorkflowEvent> {
    // Build the DAG from the workflow definition
    const dag = this.buildDAG(workflow);

    // Validate the DAG
    const validation = dag.validate();
    if (!validation.valid) {
      throw new Error(
        `Invalid workflow DAG:\n  - ${validation.errors.join('\n  - ')}`
      );
    }

    // Compute execution layers
    const layers = dag.getExecutionLayers();

    // Generate execution ID
    const executionId = generateId();

    // Create initial execution state
    const nodeIds = workflow.nodes.map((n) => n.id);
    const state = createExecutionState(executionId, workflow.id, inputs, nodeIds);

    // Create abort controller for cancellation
    const abortController = new AbortController();

    // Create the run context
    const run: ExecutionRun = {
      state,
      abortController,
      pendingHumanInputs: new Map(),
      eventQueue: [],
      workflow,
      dag,
      layers,
    };

    this.runs.set(executionId, run);

    // Emit workflow started event
    const startEvent = this.createEvent('workflow_started', executionId, {
      data: {
        workflowId: workflow.id,
        workflowName: workflow.name,
        totalLayers: layers.length,
        totalNodes: workflow.nodes.length,
      },
    });
    run.eventQueue.push(startEvent);
    this.options.onEvent?.(startEvent);

    try {
      // Execute layer by layer
      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        // Yield any queued events
        while (run.eventQueue.length > 0) {
          yield run.eventQueue.shift()!;
        }

        // Check for cancellation
        if (abortController.signal.aborted) {
          markWorkflowCancelled(state);
          const cancelEvent = this.createEvent('workflow_cancelled', executionId);
          run.eventQueue.push(cancelEvent);
          this.options.onEvent?.(cancelEvent);
          break;
        }

        // Check for pause
        if (state.status === 'paused') {
          // Yield any queued events before waiting
          while (run.eventQueue.length > 0) {
            yield run.eventQueue.shift()!;
          }

          // Wait for resume
          await this.waitForResume(run);

          // After resume, re-check cancellation
          if (abortController.signal.aborted) {
            markWorkflowCancelled(state);
            const cancelEvent = this.createEvent('workflow_cancelled', executionId);
            run.eventQueue.push(cancelEvent);
            this.options.onEvent?.(cancelEvent);
            break;
          }
        }

        state.currentLayer = layerIndex;
        const layer = layers[layerIndex]!;

        // Filter out nodes that should be skipped (e.g., wrong condition branch)
        const activeNodes = layer.filter((nodeId) => {
          const nodeState = state.nodeStates.get(nodeId);
          return nodeState?.status === 'pending';
        });

        // Emit layer started event
        const layerStartEvent = this.createEvent('layer_started', executionId, {
          layer: layerIndex,
          data: { nodes: activeNodes, totalInLayer: layer.length },
        });
        run.eventQueue.push(layerStartEvent);
        this.options.onEvent?.(layerStartEvent);

        // Execute nodes in this layer concurrently (with concurrency limit)
        await this.executeLayer(run, activeNodes, layerIndex);

        // Yield events generated during layer execution
        while (run.eventQueue.length > 0) {
          yield run.eventQueue.shift()!;
        }

        // Emit layer completed event
        const layerCompleteEvent = this.createEvent('layer_completed', executionId, {
          layer: layerIndex,
        });
        run.eventQueue.push(layerCompleteEvent);
        this.options.onEvent?.(layerCompleteEvent);

        // Checkpoint after each layer
        if (this.checkpointStore) {
          await this.checkpointStore.save(executionId, state);
          const checkpointEvent = this.createEvent('checkpoint_saved', executionId, {
            layer: layerIndex,
          });
          run.eventQueue.push(checkpointEvent);
          this.options.onEvent?.(checkpointEvent);
        }

        // Check if any node failed and the workflow should stop
        if (state.status === 'failed') {
          break;
        }
      }

      // Finalize workflow
      if (state.status === 'running') {
        markWorkflowCompleted(state);
        const completeEvent = this.createEvent('workflow_completed', executionId, {
          data: { outputs: state.outputs },
        });
        run.eventQueue.push(completeEvent);
        this.options.onEvent?.(completeEvent);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      markWorkflowFailed(state, errorMessage);
      const failEvent = this.createEvent('workflow_failed', executionId, {
        error: errorMessage,
      });
      run.eventQueue.push(failEvent);
      this.options.onEvent?.(failEvent);
    } finally {
      // Yield remaining events
      while (run.eventQueue.length > 0) {
        yield run.eventQueue.shift()!;
      }

      // Final checkpoint
      if (this.checkpointStore) {
        await this.checkpointStore.save(executionId, state);
      }
    }
  }

  /**
   * Pause a running workflow execution.
   */
  pause(executionId: string): void {
    const run = this.runs.get(executionId);
    if (!run) throw new Error(`No execution found with ID '${executionId}'`);
    if (run.state.status !== 'running') {
      throw new Error(`Cannot pause execution in status '${run.state.status}'`);
    }

    markWorkflowPaused(run.state);
    const event = this.createEvent('workflow_paused', executionId);
    run.eventQueue.push(event);
    this.options.onEvent?.(event);
  }

  /**
   * Resume a paused workflow execution, optionally providing input for
   * a human-in-the-loop node.
   */
  resume(executionId: string, input?: unknown): void {
    const run = this.runs.get(executionId);
    if (!run) throw new Error(`No execution found with ID '${executionId}'`);

    // If there are pending human inputs, resolve the first one
    if (run.pendingHumanInputs.size > 0 && typeof input === 'string') {
      const [nodeId, pending] = run.pendingHumanInputs.entries().next().value as [string, PendingHumanInput];
      run.pendingHumanInputs.delete(nodeId);
      pending.resolve(input);
    }

    if (run.state.status === 'paused') {
      markWorkflowResumed(run.state);
      const event = this.createEvent('workflow_resumed', executionId, {
        data: { input },
      });
      run.eventQueue.push(event);
      this.options.onEvent?.(event);

      // Unblock the waiting loop
      if (run.resumeResolve) {
        run.resumeResolve();
        run.resumeResolve = undefined;
        run.resumePromise = undefined;
      }
    }
  }

  /**
   * Cancel a running or paused workflow execution.
   */
  cancel(executionId: string): void {
    const run = this.runs.get(executionId);
    if (!run) throw new Error(`No execution found with ID '${executionId}'`);

    run.abortController.abort();
    markWorkflowCancelled(run.state);

    // Reject any pending human inputs
    for (const [, pending] of run.pendingHumanInputs) {
      pending.reject(new Error('Workflow execution was cancelled'));
    }
    run.pendingHumanInputs.clear();

    // Unblock resume wait if paused
    if (run.resumeResolve) {
      run.resumeResolve();
    }

    const event = this.createEvent('workflow_cancelled', executionId);
    run.eventQueue.push(event);
    this.options.onEvent?.(event);
  }

  /**
   * Get the current state of a workflow execution.
   */
  getState(executionId: string): WorkflowExecutionState {
    const run = this.runs.get(executionId);
    if (!run) throw new Error(`No execution found with ID '${executionId}'`);
    return run.state;
  }

  // ─── Internal Methods ─────────────────────────────────────────────

  /**
   * Build a DAG from a workflow definition.
   */
  private buildDAG(workflow: WorkflowDefinition): DAG<WorkflowNode> {
    const dag = new DAG<WorkflowNode>();

    // Add all nodes
    for (const node of workflow.nodes) {
      dag.addNode(node.id, node);
    }

    // Add all edges
    for (const edge of workflow.edges) {
      const metadata: Record<string, unknown> = {};
      if (edge.condition !== undefined) {
        metadata['condition'] = edge.condition;
      }
      if (edge.metadata) {
        Object.assign(metadata, edge.metadata);
      }
      dag.addEdge(edge.from, edge.to, Object.keys(metadata).length > 0 ? metadata : undefined);
    }

    return dag;
  }

  /**
   * Execute all nodes in a layer concurrently.
   */
  private async executeLayer(
    run: ExecutionRun,
    nodeIds: string[],
    layerIndex: number,
  ): Promise<void> {
    const maxConcurrency = this.options.maxConcurrency ?? Infinity;

    if (nodeIds.length === 0) return;

    // Batch nodes for concurrency limiting
    const batches = createBatches(nodeIds, maxConcurrency);

    for (const batch of batches) {
      if (run.abortController.signal.aborted) break;
      if (run.state.status === 'failed') break;

      const promises = batch.map((nodeId) =>
        this.executeNode(run, nodeId, layerIndex)
      );

      await Promise.all(promises);
    }
  }

  /**
   * Execute a single node.
   */
  private async executeNode(
    run: ExecutionRun,
    nodeId: string,
    layerIndex: number,
  ): Promise<void> {
    const { state, dag, workflow, abortController } = run;

    const dagNode = dag.getNode(nodeId);
    if (!dagNode) {
      markNodeFailed(state, nodeId, `Node '${nodeId}' not found in DAG`);
      return;
    }

    const workflowNode = dagNode.data;

    // Collect inputs from parent nodes
    const nodeInputs = this.collectNodeInputs(run, nodeId);

    // Check if this node should be skipped due to condition branching
    if (this.shouldSkipNode(run, nodeId)) {
      markNodeSkipped(state, nodeId);
      const skipEvent = this.createEvent('node_skipped', state.executionId, {
        nodeId,
        layer: layerIndex,
      });
      run.eventQueue.push(skipEvent);
      this.options.onEvent?.(skipEvent);
      return;
    }

    // Find the handler for this node type
    const handler = this.nodeHandlers.get(workflowNode.type);
    if (!handler) {
      markNodeFailed(
        state,
        nodeId,
        `No handler registered for node type '${workflowNode.type}'`
      );
      const failEvent = this.createEvent('node_failed', state.executionId, {
        nodeId,
        layer: layerIndex,
        error: `No handler for type '${workflowNode.type}'`,
      });
      run.eventQueue.push(failEvent);
      this.options.onEvent?.(failEvent);
      markWorkflowFailed(state, `Node '${nodeId}' has no handler`);
      return;
    }

    // Build the workflow context for this node
    const context = this.buildContext(run, nodeId);

    // Mark node as running
    markNodeRunning(state, nodeId, nodeInputs);
    const startEvent = this.createEvent('node_started', state.executionId, {
      nodeId,
      layer: layerIndex,
      data: { nodeType: workflowNode.type, nodeName: workflowNode.name },
    });
    run.eventQueue.push(startEvent);
    this.options.onEvent?.(startEvent);

    // Execute with retry support
    const maxRetries = workflowNode.retry?.maxAttempts ?? this.options.maxRetries ?? 0;
    const baseDelay = workflowNode.retry?.delayMs ?? this.options.retryDelayMs ?? 1000;
    const backoffMultiplier = workflowNode.retry?.backoffMultiplier ?? 2;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (abortController.signal.aborted) {
        markNodeFailed(state, nodeId, 'Execution cancelled');
        return;
      }

      try {
        // Execute the node with optional timeout
        let outputs: Record<string, unknown>;

        if (workflowNode.timeoutMs) {
          outputs = await withTimeout(
            handler.execute(workflowNode, nodeInputs, context),
            workflowNode.timeoutMs,
            `Node '${nodeId}' timed out after ${workflowNode.timeoutMs}ms`
          );
        } else {
          outputs = await handler.execute(workflowNode, nodeInputs, context);
        }

        // Success
        markNodeCompleted(state, nodeId, outputs);
        const completeEvent = this.createEvent('node_completed', state.executionId, {
          nodeId,
          layer: layerIndex,
          data: { outputs },
        });
        run.eventQueue.push(completeEvent);
        this.options.onEvent?.(completeEvent);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < maxRetries) {
          // Retry
          incrementRetry(state, nodeId);
          const retryEvent = this.createEvent('node_retry', state.executionId, {
            nodeId,
            layer: layerIndex,
            data: { attempt: attempt + 1, maxRetries, error: lastError.message },
          });
          run.eventQueue.push(retryEvent);
          this.options.onEvent?.(retryEvent);

          // Wait before retrying with exponential backoff
          const delay = baseDelay * Math.pow(backoffMultiplier, attempt);
          await sleep(delay);
        }
      }
    }

    // All retries exhausted
    const errorMessage = lastError?.message ?? 'Unknown error';
    markNodeFailed(state, nodeId, errorMessage);
    const failEvent = this.createEvent('node_failed', state.executionId, {
      nodeId,
      layer: layerIndex,
      error: errorMessage,
    });
    run.eventQueue.push(failEvent);
    this.options.onEvent?.(failEvent);

    // Fail the entire workflow
    markWorkflowFailed(state, `Node '${nodeId}' failed: ${errorMessage}`);
  }

  /**
   * Collect inputs for a node from its parent nodes' outputs.
   */
  private collectNodeInputs(
    run: ExecutionRun,
    nodeId: string,
  ): Record<string, unknown> {
    const { state, dag } = run;
    const inputs: Record<string, unknown> = { ...state.inputs };

    const parents = dag.getParents(nodeId);
    for (const parentId of parents) {
      const parentState = state.nodeStates.get(parentId);
      if (parentState?.outputs) {
        // Make parent outputs available under the parent's node ID
        inputs[parentId] = parentState.outputs;

        // Also spread parent outputs at the top level for convenience
        Object.assign(inputs, parentState.outputs);
      }
    }

    return inputs;
  }

  /**
   * Check if a node should be skipped due to condition-based routing.
   *
   * A node is skipped if ALL of its parent edges have condition labels
   * and none of the conditions match the parent's branch output.
   */
  private shouldSkipNode(run: ExecutionRun, nodeId: string): boolean {
    const { state, dag, workflow } = run;
    const parents = dag.getParents(nodeId);

    if (parents.length === 0) return false;

    // Check each parent edge
    for (const parentId of parents) {
      const edge = workflow.edges.find(
        (e) => e.from === parentId && e.to === nodeId
      );

      if (!edge || edge.condition === undefined) {
        // Edge has no condition — node is reachable unconditionally from this parent
        const parentState = state.nodeStates.get(parentId);
        if (parentState?.status === 'completed') {
          return false;
        }
        continue;
      }

      // Edge has a condition — check if the parent's branch output matches
      const parentState = state.nodeStates.get(parentId);
      if (parentState?.status === 'completed' && parentState.outputs) {
        const branch = parentState.outputs['branch'];
        if (String(branch) === edge.condition) {
          return false; // Condition matches — node should NOT be skipped
        }
      }
    }

    // If we reach here, all condition-bearing edges failed to match
    // or all parents are not completed
    const hasAnyConditionEdge = parents.some((parentId) => {
      const edge = workflow.edges.find(
        (e) => e.from === parentId && e.to === nodeId
      );
      return edge?.condition !== undefined;
    });

    return hasAnyConditionEdge;
  }

  /**
   * Build a WorkflowContext for executing a node.
   */
  private buildContext(run: ExecutionRun, nodeId: string): WorkflowContext {
    const { state, abortController, workflow } = run;

    return {
      executionId: state.executionId,
      workflow,
      state,
      signal: abortController.signal,

      emitEvent: (event: WorkflowEvent) => {
        run.eventQueue.push(event);
        this.options.onEvent?.(event);
      },

      requestHumanInput: (prompt: string) => {
        return new Promise<string>((resolve, reject) => {
          run.pendingHumanInputs.set(nodeId, { resolve, reject, prompt });
          markWorkflowPaused(state);

          const pauseEvent = this.createEvent('workflow_paused', state.executionId, {
            nodeId,
            data: { prompt, waitingForHumanInput: true },
          });
          run.eventQueue.push(pauseEvent);
          this.options.onEvent?.(pauseEvent);
        });
      },

      getNodeOutputs: (targetNodeId: string) => {
        const nodeState = state.nodeStates.get(targetNodeId);
        return nodeState?.outputs;
      },

      createOrchestrator: undefined, // Set by the user via options if needed
    };
  }

  /**
   * Wait for a paused workflow to be resumed.
   */
  private waitForResume(run: ExecutionRun): Promise<void> {
    if (run.state.status !== 'paused') return Promise.resolve();

    run.resumePromise = new Promise<void>((resolve) => {
      run.resumeResolve = resolve;
    });

    return run.resumePromise;
  }

  /**
   * Create a workflow event.
   */
  private createEvent(
    type: WorkflowEvent['type'],
    executionId: string,
    overrides?: Partial<WorkflowEvent>,
  ): WorkflowEvent {
    return {
      type,
      timestamp: new Date(),
      executionId,
      ...overrides,
    };
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `wf_${timestamp}_${random}`;
}

function createBatches<T>(items: T[], batchSize: number): T[][] {
  if (!isFinite(batchSize) || batchSize <= 0) {
    return [items];
  }
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
