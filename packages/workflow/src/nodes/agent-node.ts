/**
 * Agent node handler — executes an AI agent within a workflow.
 *
 * Delegates to an Orchestrator factory provided via the workflow context
 * to run agents identified by their config IDs.
 */

import type { NodeHandler, WorkflowNode, WorkflowContext } from '../types.js';

/**
 * Configuration expected in the agent node's `config` field.
 */
interface AgentNodeConfig {
  /** ID of the agent configuration to use. */
  agentConfigId: string;
  /** The message/prompt to send to the agent. Supports {{variable}} template substitution. */
  message: string;
  /** Optional session ID for conversation continuity. */
  sessionId?: string;
}

/**
 * Handles execution of agent nodes by delegating to an orchestrator.
 *
 * The orchestrator factory must be provided via `context.createOrchestrator`.
 * If not provided, the handler throws an error.
 */
export class AgentNodeHandler implements NodeHandler {
  async execute(
    node: WorkflowNode,
    inputs: Record<string, unknown>,
    context: WorkflowContext,
  ): Promise<Record<string, unknown>> {
    const config = node.config as unknown as AgentNodeConfig;

    if (!config.agentConfigId) {
      throw new Error(
        `Agent node '${node.id}' is missing required config field 'agentConfigId'`
      );
    }

    if (!context.createOrchestrator) {
      throw new Error(
        `Agent node '${node.id}' requires a createOrchestrator function in the workflow context`
      );
    }

    // Resolve template variables in the message
    const message = resolveTemplate(config.message ?? '', inputs);

    context.emitEvent({
      type: 'node_started',
      timestamp: new Date(),
      executionId: context.executionId,
      nodeId: node.id,
      data: {
        agentConfigId: config.agentConfigId,
        message,
        sessionId: config.sessionId,
      },
    });

    // Check for cancellation before starting
    if (context.signal.aborted) {
      throw new Error('Workflow execution was cancelled');
    }

    const orchestrator = context.createOrchestrator(config.agentConfigId);
    const result = await orchestrator.run(message, config.sessionId);

    return {
      response: result.response,
      toolsUsed: result.toolsUsed,
      tokenUsage: result.tokenUsage,
    };
  }
}

/**
 * Resolve `{{variable}}` template placeholders in a string using input data.
 *
 * Supports dotted paths like `{{parentNode.field}}`.
 */
function resolveTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const trimmedKey = key.trim();
    const value = getNestedValue(data, trimmedKey);
    if (value === undefined) return `{{${trimmedKey}}}`;
    return String(value);
  });
}

/**
 * Get a nested value from an object using a dotted path.
 */
function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
