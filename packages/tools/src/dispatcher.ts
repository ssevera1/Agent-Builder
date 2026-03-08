/**
 * ToolDispatcher — executes tool calls against a ToolRegistry with timeout
 * enforcement, input validation, error handling, and concurrency control.
 */

import type { ToolCall, ToolResult } from '@agentbuilder/core';
import type { ToolRegistry } from './registry.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DispatcherOptions {
  /** Default timeout in milliseconds for tool execution (default: 30 000). */
  defaultTimeout?: number;
  /** Maximum number of tools to execute concurrently in `dispatchMany` (default: 5). */
  maxConcurrent?: number;
  /** Optional callback invoked before a tool starts executing. */
  onToolCall?: (toolCall: ToolCall) => void;
  /** Optional callback invoked after a tool finishes executing. */
  onToolResult?: (result: ToolResult) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run an async function with an AbortController-backed timeout.
 * Resolves with the function result or rejects with a timeout error.
 */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await fn(controller.signal);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Simple concurrency limiter. Runs `tasks` with at most `limit` executing
 * at a time, preserving order of results.
 */
async function parallelLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      const task = tasks[idx];
      if (task) {
        results[idx] = await task();
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// ToolDispatcher
// ---------------------------------------------------------------------------

export class ToolDispatcher {
  private readonly registry: ToolRegistry;
  private readonly defaultTimeout: number;
  private readonly maxConcurrent: number;
  private readonly onToolCall?: (toolCall: ToolCall) => void;
  private readonly onToolResult?: (result: ToolResult) => void;

  constructor(registry: ToolRegistry, options?: DispatcherOptions) {
    this.registry = registry;
    this.defaultTimeout = options?.defaultTimeout ?? 30_000;
    this.maxConcurrent = options?.maxConcurrent ?? 5;
    this.onToolCall = options?.onToolCall;
    this.onToolResult = options?.onToolResult;
  }

  // ── Single dispatch ─────────────────────────────────────────────────────

  /**
   * Execute a single tool call:
   * 1. Look up the tool in the registry.
   * 2. Validate input against the Zod schema.
   * 3. Execute with timeout.
   * 4. Wrap errors into a `ToolResult`.
   */
  async dispatch(toolCall: ToolCall): Promise<ToolResult> {
    const start = performance.now();
    this.onToolCall?.(toolCall);

    const tool = this.registry.get(toolCall.name);
    if (!tool) {
      const result: ToolResult = {
        toolCallId: toolCall.id,
        output: '',
        error: `Tool "${toolCall.name}" is not registered.`,
        success: false,
        durationMs: performance.now() - start,
      };
      this.onToolResult?.(result);
      return result;
    }

    // Validate
    const validation = this.registry.validate(toolCall.name, toolCall.parameters);
    if (!validation.success) {
      const errorMessages = validation.errors
        ?.map((e) => `${e.path ? e.path + ': ' : ''}${e.message}`)
        .join('; ');
      const result: ToolResult = {
        toolCallId: toolCall.id,
        output: '',
        error: `Validation failed: ${errorMessages}`,
        success: false,
        durationMs: performance.now() - start,
      };
      this.onToolResult?.(result);
      return result;
    }

    // Execute with timeout
    const timeout = tool.timeoutMs > 0 ? tool.timeoutMs : this.defaultTimeout;
    try {
      const output = await withTimeout(
        (signal) => tool.handler(validation.data, signal),
        timeout,
      );

      const result: ToolResult = {
        toolCallId: toolCall.id,
        output,
        success: true,
        durationMs: performance.now() - start,
      };
      this.onToolResult?.(result);
      return result;
    } catch (err: unknown) {
      const isAbort =
        err instanceof DOMException && err.name === 'AbortError';
      const errorMessage = isAbort
        ? `Tool "${toolCall.name}" timed out after ${timeout}ms.`
        : err instanceof Error
          ? err.message
          : String(err);

      const result: ToolResult = {
        toolCallId: toolCall.id,
        output: '',
        error: errorMessage,
        success: false,
        durationMs: performance.now() - start,
      };
      this.onToolResult?.(result);
      return result;
    }
  }

  // ── Parallel dispatch ───────────────────────────────────────────────────

  /**
   * Execute multiple tool calls in parallel, respecting `maxConcurrent`.
   */
  async dispatchMany(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const tasks = toolCalls.map(
      (tc) => () => this.dispatch(tc),
    );
    return parallelLimit(tasks, this.maxConcurrent);
  }
}
