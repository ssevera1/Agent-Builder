/**
 * Condition node handler — evaluates boolean expressions to determine
 * which branch of the workflow to follow.
 *
 * The handler evaluates the configured expression against the input data
 * and outputs a `branch` field of either 'true' or 'false'. The executor
 * uses this to select which downstream edges to activate.
 */

import type { NodeHandler, WorkflowNode, WorkflowContext } from '../types.js';

/**
 * Configuration expected in the condition node's `config` field.
 */
interface ConditionNodeConfig {
  /** Boolean expression to evaluate against the input data. */
  expression: string;
}

/**
 * Dangerous identifiers blocked from condition expressions.
 */
const BLOCKED_PATTERNS = [
  /\bprocess\b/,
  /\brequire\b/,
  /\bimport\b/,
  /\beval\b/,
  /\bFunction\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\b__proto__\b/,
  /\bconstructor\b/,
  /\bprototype\b/,
];

// Object proxy exposing only safe enumeration methods — prevents prototype chain escapes.
const SAFE_OBJECT = {
  keys: Object.keys.bind(Object),
  values: Object.values.bind(Object),
  entries: Object.entries.bind(Object),
  assign: Object.assign.bind(Object),
  fromEntries: Object.fromEntries.bind(Object),
};

/**
 * Safe globals accessible in condition expressions.
 */
const SAFE_GLOBALS: Record<string, unknown> = {
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object: SAFE_OBJECT,
  JSON,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  undefined,
  NaN,
  Infinity,
};

/**
 * Handles execution of condition nodes.
 *
 * Output:
 * - `branch`: 'true' or 'false' — the branch label for the executor
 * - `data`: passthrough of the input data
 */
export class ConditionNodeHandler implements NodeHandler {
  async execute(
    node: WorkflowNode,
    inputs: Record<string, unknown>,
    _context: WorkflowContext,
  ): Promise<Record<string, unknown>> {
    const config = node.config as unknown as ConditionNodeConfig;

    if (!config.expression) {
      throw new Error(
        `Condition node '${node.id}' is missing required config field 'expression'`
      );
    }

    const result = evaluateCondition(config.expression, inputs, node.id);

    return {
      branch: result ? 'true' : 'false',
      data: inputs,
    };
  }
}

/**
 * Evaluate a condition expression in a sandboxed scope.
 * Returns true or false.
 */
function evaluateCondition(
  expression: string,
  inputs: Record<string, unknown>,
  nodeId: string,
): boolean {
  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(expression)) {
      throw new Error(
        `Condition node '${nodeId}': expression contains blocked identifier matching ${pattern}`
      );
    }
  }

  // Build scope with inputs available both as 'input' and spread at top level
  const scope: Record<string, unknown> = {
    ...SAFE_GLOBALS,
    input: inputs,
    ...inputs,
  };

  const scopeKeys = Object.keys(scope);
  const scopeValues = scopeKeys.map((k) => scope[k]);

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(
      ...scopeKeys,
      `"use strict"; return Boolean(${expression});`,
    );
    return fn(...scopeValues) as boolean;
  } catch (err) {
    throw new Error(
      `Condition node '${nodeId}': expression evaluation failed: ${(err as Error).message}`
    );
  }
}
