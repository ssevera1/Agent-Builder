/**
 * Transform node handler — applies data transformations.
 *
 * Supports:
 * - JSONPath-like property extraction (e.g., "data.users[0].name")
 * - String template interpolation (e.g., "Hello, {{name}}!")
 * - Safe JavaScript expressions via Function constructor with restricted scope
 * - Object literal construction (e.g., "{ name: input.name, count: input.items.length }")
 */

import type { NodeHandler, WorkflowNode, WorkflowContext } from '../types.js';

/**
 * Configuration expected in the transform node's `config` field.
 */
interface TransformNodeConfig {
  /** The transform expression to evaluate. */
  expression: string;
  /**
   * Type of transformation to perform.
   * - 'extract': JSONPath-like property extraction
   * - 'template': String template with {{variable}} substitution
   * - 'expression': Safe JavaScript expression
   * Defaults to 'expression' if not specified.
   */
  mode?: 'extract' | 'template' | 'expression';
}

/**
 * Handles execution of transform nodes by evaluating expressions against
 * input data in a restricted scope.
 */
export class TransformNodeHandler implements NodeHandler {
  async execute(
    node: WorkflowNode,
    inputs: Record<string, unknown>,
    context: WorkflowContext,
  ): Promise<Record<string, unknown>> {
    const config = node.config as unknown as TransformNodeConfig;

    if (!config.expression) {
      throw new Error(
        `Transform node '${node.id}' is missing required config field 'expression'`
      );
    }

    const mode = config.mode ?? detectMode(config.expression);

    let result: unknown;

    switch (mode) {
      case 'extract':
        result = extractPath(inputs, config.expression);
        break;
      case 'template':
        result = resolveTemplate(config.expression, inputs);
        break;
      case 'expression':
        result = evaluateExpression(config.expression, inputs, node.id);
        break;
      default:
        throw new Error(`Unknown transform mode: '${mode}' in node '${node.id}'`);
    }

    // Normalize the result to always be a Record
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }

    return { result };
  }
}

// ─── Expression Mode Detection ──────────────────────────────────────────────

/**
 * Auto-detect the appropriate transform mode based on the expression syntax.
 */
function detectMode(expression: string): 'extract' | 'template' | 'expression' {
  const trimmed = expression.trim();

  // Template: contains {{...}} placeholders
  if (/\{\{[^}]+\}\}/.test(trimmed)) {
    return 'template';
  }

  // Extract: simple dotted path, optionally with array indices
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.[\]]*$/.test(trimmed)) {
    return 'extract';
  }

  // Default: treat as expression
  return 'expression';
}

// ─── JSONPath-like Extraction ───────────────────────────────────────────────

/**
 * Extract a value from an object using a dotted path with optional array
 * index notation (e.g., "users[0].name", "data.items[2].value").
 */
function extractPath(data: Record<string, unknown>, path: string): unknown {
  // Parse the path into segments
  const segments = parsePath(path);
  let current: unknown = data;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (segment.type === 'property') {
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment.key];
    } else if (segment.type === 'index') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment.index];
    }
  }

  return current;
}

interface PropertySegment {
  type: 'property';
  key: string;
}

interface IndexSegment {
  type: 'index';
  index: number;
}

type PathSegment = PropertySegment | IndexSegment;

function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const regex = /([a-zA-Z_$][a-zA-Z0-9_$]*)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push({ type: 'property', key: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ type: 'index', index: parseInt(match[2], 10) });
    }
  }

  return segments;
}

// ─── Template Interpolation ─────────────────────────────────────────────────

/**
 * Resolve `{{variable}}` template placeholders using the input data.
 */
function resolveTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const trimmedKey = key.trim();
    const value = extractPath(data, trimmedKey);
    if (value === undefined) return `{{${trimmedKey}}}`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

// ─── Safe Expression Evaluation ─────────────────────────────────────────────

// Object proxy exposing only safe enumeration methods — prevents prototype chain escapes.
const SAFE_OBJECT = {
  keys: Object.keys.bind(Object),
  values: Object.values.bind(Object),
  entries: Object.entries.bind(Object),
  assign: Object.assign.bind(Object),
  fromEntries: Object.fromEntries.bind(Object),
};

/**
 * Allowlist of safe global names accessible within expressions.
 * No access to `process`, `require`, `import`, `eval`, `Function`, etc.
 */
const SAFE_GLOBALS: Record<string, unknown> = {
  // Math
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object: SAFE_OBJECT,
  JSON,
  Date,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  // String operations
  encodeURIComponent,
  decodeURIComponent,
  // Constants
  undefined,
  null: null,
  NaN,
  Infinity,
  true: true,
  false: false,
};

/**
 * Dangerous identifiers that must never appear in user expressions.
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
  /\bProxy\b/,
  /\bReflect\b/,
];

/**
 * Evaluate a JavaScript expression in a sandboxed scope with only the input
 * data and safe globals available.
 */
function evaluateExpression(
  expression: string,
  inputs: Record<string, unknown>,
  nodeId: string,
): unknown {
  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(expression)) {
      throw new Error(
        `Transform node '${nodeId}': expression contains blocked identifier matching ${pattern}`
      );
    }
  }

  // Build the scope: input data is available as 'input' and also spread at top level
  const scope: Record<string, unknown> = {
    ...SAFE_GLOBALS,
    input: inputs,
    ...inputs,
  };

  const scopeKeys = Object.keys(scope);
  const scopeValues = scopeKeys.map((k) => scope[k]);

  try {
    // Use Function constructor to create a sandboxed evaluation context.
    // The function receives named parameters matching the scope keys.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...scopeKeys, `"use strict"; return (${expression});`);
    return fn(...scopeValues);
  } catch (err) {
    throw new Error(
      `Transform node '${nodeId}': expression evaluation failed: ${(err as Error).message}`
    );
  }
}
