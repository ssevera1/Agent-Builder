/**
 * Parallel node handler — fan-out / fan-in execution pattern.
 *
 * Splits input into multiple parallel branches, executes a handler for
 * each item concurrently, and aggregates the results back together.
 */

import type { NodeHandler, WorkflowNode, WorkflowContext } from '../types.js';

/**
 * Configuration expected in the parallel node's `config` field.
 */
interface ParallelNodeConfig {
  /**
   * The input field name containing the array to fan out over.
   * Defaults to 'items'.
   */
  itemsField?: string;

  /**
   * Maximum concurrency for parallel execution.
   * Defaults to Infinity (all items at once).
   */
  maxConcurrency?: number;

  /**
   * Whether to continue processing remaining items if one fails.
   * Defaults to false (fail fast).
   */
  continueOnError?: boolean;

  /**
   * Optional expression to apply to each item before aggregation.
   * If not set, raw handler results are used.
   */
  mapExpression?: string;
}

/**
 * Handles execution of parallel fan-out / fan-in nodes.
 *
 * Input: `{ items: any[], ... }` — the items to process in parallel.
 * Output: `{ results: any[], errors: any[], successCount: number, errorCount: number }`
 */
export class ParallelNodeHandler implements NodeHandler {
  async execute(
    node: WorkflowNode,
    inputs: Record<string, unknown>,
    context: WorkflowContext,
  ): Promise<Record<string, unknown>> {
    const config = node.config as unknown as ParallelNodeConfig;
    const itemsField = config.itemsField ?? 'items';
    const maxConcurrency = config.maxConcurrency ?? Infinity;
    const continueOnError = config.continueOnError ?? false;

    const items = inputs[itemsField];
    if (!Array.isArray(items)) {
      throw new Error(
        `Parallel node '${node.id}': expected '${itemsField}' to be an array, got ${typeof items}`
      );
    }

    if (items.length === 0) {
      return { results: [], errors: [], successCount: 0, errorCount: 0 };
    }

    context.emitEvent({
      type: 'node_started',
      timestamp: new Date(),
      executionId: context.executionId,
      nodeId: node.id,
      data: { totalItems: items.length, maxConcurrency },
    });

    const results: Array<{ index: number; value: unknown; error?: string }> = [];
    let errorCount = 0;

    // Process items with concurrency limiting
    const itemEntries = items.map((item, index) => ({ item, index }));
    const batches = createBatches(itemEntries, maxConcurrency);

    for (const batch of batches) {
      if (context.signal.aborted) {
        throw new Error('Workflow execution was cancelled');
      }

      const batchPromises = batch.map(async ({ item, index }) => {
        try {
          const itemResult = await processItem(
            item,
            index,
            node,
            inputs,
            config,
          );
          results.push({ index, value: itemResult });
        } catch (err) {
          errorCount++;
          const errorMessage = err instanceof Error ? err.message : String(err);
          results.push({ index, value: undefined, error: errorMessage });

          if (!continueOnError) {
            throw new Error(
              `Parallel node '${node.id}': item at index ${index} failed: ${errorMessage}`
            );
          }
        }
      });

      await Promise.all(batchPromises);
    }

    // Sort results by original index
    results.sort((a, b) => a.index - b.index);

    const successResults = results
      .filter((r) => r.error === undefined)
      .map((r) => r.value);
    const errorResults = results
      .filter((r) => r.error !== undefined)
      .map((r) => ({ index: r.index, error: r.error }));

    return {
      results: successResults,
      errors: errorResults,
      successCount: successResults.length,
      errorCount,
    };
  }
}

/**
 * Process a single item in the parallel fan-out.
 */
async function processItem(
  item: unknown,
  index: number,
  node: WorkflowNode,
  allInputs: Record<string, unknown>,
  config: ParallelNodeConfig,
): Promise<unknown> {
  // Apply map expression if provided
  if (config.mapExpression) {
    return evaluateMapExpression(config.mapExpression, item, index, allInputs, node.id);
  }

  // Default: return the item as-is (useful when parallel node is purely
  // a fan-out/fan-in wrapper around child nodes)
  return item;
}

/**
 * Evaluate a map expression for a single item.
 */
function evaluateMapExpression(
  expression: string,
  item: unknown,
  index: number,
  allInputs: Record<string, unknown>,
  nodeId: string,
): unknown {
  const BLOCKED_PATTERNS = [
    /\bprocess\b/,
    /\brequire\b/,
    /\bimport\b/,
    /\beval\b/,
    /\bFunction\b/,
    /\bglobalThis\b/,
    /\bglobal\b/,
    /\bwindow\b/,
    /\b__proto__\b/,
    /\bconstructor\b/,
    /\bprototype\b/,
  ];

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(expression)) {
      throw new Error(
        `Parallel node '${nodeId}': map expression contains blocked identifier matching ${pattern}`
      );
    }
  }

  // Object proxy exposing only safe enumeration methods — prevents prototype chain escapes.
  const safeObject = {
    keys: Object.keys.bind(Object),
    values: Object.values.bind(Object),
    entries: Object.entries.bind(Object),
    assign: Object.assign.bind(Object),
    fromEntries: Object.fromEntries.bind(Object),
  };

  const scope: Record<string, unknown> = {
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object: safeObject,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    item,
    index,
    input: allInputs,
  };

  const scopeKeys = Object.keys(scope);
  const scopeValues = scopeKeys.map((k) => scope[k]);

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...scopeKeys, `"use strict"; return (${expression});`);
    return fn(...scopeValues);
  } catch (err) {
    throw new Error(
      `Parallel node '${nodeId}': map expression evaluation failed at index ${index}: ${(err as Error).message}`
    );
  }
}

/**
 * Split an array into batches of at most `batchSize` items.
 */
function createBatches<T>(items: T[], batchSize: number): T[][] {
  if (!isFinite(batchSize) || batchSize <= 0) {
    return [items]; // Run everything at once
  }

  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
