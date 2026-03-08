/**
 * Human-in-the-loop node handler — pauses workflow execution to collect
 * human input or approval before continuing.
 *
 * When this node executes, it:
 * 1. Emits a 'human_input_required' event with a prompt
 * 2. Pauses the workflow execution
 * 3. Waits for resume() to be called with user input
 * 4. Outputs the human's response and approval status
 */

import type { NodeHandler, WorkflowNode, WorkflowContext } from '../types.js';

/**
 * Configuration expected in the human node's `config` field.
 */
interface HumanNodeConfig {
  /** The prompt/question to display to the human reviewer. */
  prompt: string;

  /**
   * Whether the node requires explicit approval (true/false response)
   * rather than free-form text input.
   * Defaults to false.
   */
  requireApproval?: boolean;

  /**
   * Timeout in milliseconds for the human response.
   * If not set, waits indefinitely until resume() is called.
   */
  timeoutMs?: number;

  /**
   * Default action to take if the human does not respond within the timeout.
   * - 'approve': auto-approve
   * - 'reject': auto-reject
   * - 'fail': fail the node
   * Defaults to 'fail'.
   */
  timeoutAction?: 'approve' | 'reject' | 'fail';
}

/**
 * Handles execution of human-in-the-loop nodes.
 *
 * Output:
 * - `humanInput`: The text response from the human
 * - `approved`: Whether the human approved (boolean)
 * - `timedOut`: Whether the response was auto-generated due to timeout
 */
export class HumanNodeHandler implements NodeHandler {
  async execute(
    node: WorkflowNode,
    inputs: Record<string, unknown>,
    context: WorkflowContext,
  ): Promise<Record<string, unknown>> {
    const config = node.config as unknown as HumanNodeConfig;

    if (!config.prompt) {
      throw new Error(
        `Human node '${node.id}' is missing required config field 'prompt'`
      );
    }

    // Resolve template variables in the prompt
    const resolvedPrompt = resolveTemplate(config.prompt, inputs);

    // Emit event requesting human input
    context.emitEvent({
      type: 'human_input_required',
      timestamp: new Date(),
      executionId: context.executionId,
      nodeId: node.id,
      data: {
        prompt: resolvedPrompt,
        requireApproval: config.requireApproval ?? false,
        inputData: inputs,
        timeoutMs: config.timeoutMs,
      },
    });

    // Use context's requestHumanInput to pause and wait for response
    try {
      let humanInput: string;

      if (config.timeoutMs && config.timeoutMs > 0) {
        // Race between human input and timeout
        humanInput = await Promise.race([
          context.requestHumanInput(resolvedPrompt),
          createTimeout(config.timeoutMs, node.id, config.timeoutAction ?? 'fail'),
        ]);
      } else {
        humanInput = await context.requestHumanInput(resolvedPrompt);
      }

      // Parse approval from the response
      const approved = parseApproval(humanInput, config.requireApproval ?? false);

      return {
        humanInput,
        approved,
        timedOut: false,
        prompt: resolvedPrompt,
      };
    } catch (err) {
      // Handle timeout default actions
      if (err instanceof TimeoutError) {
        const action = config.timeoutAction ?? 'fail';

        if (action === 'fail') {
          throw new Error(
            `Human node '${node.id}' timed out after ${config.timeoutMs}ms`
          );
        }

        return {
          humanInput: action === 'approve' ? 'approved (auto)' : 'rejected (auto)',
          approved: action === 'approve',
          timedOut: true,
          prompt: resolvedPrompt,
        };
      }

      throw err;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function createTimeout(
  timeoutMs: number,
  nodeId: string,
  action: string,
): Promise<string> {
  return new Promise<string>((_resolve, reject) => {
    setTimeout(() => {
      if (action === 'fail') {
        reject(new TimeoutError(`Human node '${nodeId}' timed out`));
      } else {
        // For approve/reject, we still want to return through the normal path
        reject(new TimeoutError(`timeout:${action}`));
      }
    }, timeoutMs);
  });
}

/**
 * Parse a human response to determine approval status.
 */
function parseApproval(input: string, requireApproval: boolean): boolean {
  if (!requireApproval) {
    // If approval is not required, any response counts as approval
    return true;
  }

  const normalized = input.trim().toLowerCase();
  const approvalWords = ['yes', 'approve', 'approved', 'ok', 'okay', 'confirm', 'confirmed', 'accept', 'accepted', 'true', 'y', 'lgtm'];
  const rejectionWords = ['no', 'reject', 'rejected', 'deny', 'denied', 'decline', 'declined', 'false', 'n', 'nope'];

  if (approvalWords.includes(normalized)) return true;
  if (rejectionWords.includes(normalized)) return false;

  // Default: if explicit approval is required and we cannot parse the response,
  // treat it as not approved
  return false;
}

/**
 * Resolve `{{variable}}` template placeholders.
 */
function resolveTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const trimmedKey = key.trim();
    const value = getNestedValue(data, trimmedKey);
    if (value === undefined) return `{{${trimmedKey}}}`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

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
