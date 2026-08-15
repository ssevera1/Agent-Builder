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
// Validation Errors
// ---------------------------------------------------------------------------

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class MalformedArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedArgumentError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that toolCall has required fields and proper structure.
 */
function validateToolCall(toolCall: unknown): toolCall is ToolCall {
  if (typeof toolCall !== 'object' || toolCall === null) {
    return false;
  }
  const call = toolCall as Record<string, unknown>;
  return (
    typeof call.id === 'string' &&
    call.id.length > 0 &&
    typeof call.name === 'string' &&
    call.name.length > 0 &&
    (call.parameters === undefined ||
      call.parameters === null ||
      typeof call.parameters === 'object')
  );
}

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
 *
 * If any task throws, all tasks are still allowed to complete (no holes in
 * results). The first error is re-thrown after all workers finish.
 */
async function parallelLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  type Slot = { ok: true; value: T } | { ok: false; error: unknown };
  const slots: Slot[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      const task = tasks[idx];
      if (task) {
        try {
          slots[idx] = { ok: true, value: await task() };
        } catch (err) {
          slots[idx] = { ok: false, error: err };
        }
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  const firstError = slots.find((s) => !s.ok);
  if (firstError) throw (firstError as { ok: false; error: unknown }).error;
  return slots.map((s) => (s as { ok: true; value: T }).value);
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
   * 1. Validate tool call structure.
   * 2. Look up the tool in the registry.
   * 3. Validate input against the Zod schema.
   * 4. Execute with timeout.
   * 5. Wrap errors into a `ToolResult`.
   */
  async dispatch(toolCall: unknown): Promise<ToolResult> {
    const start = performance.now();

    // Validate tool call structure
    if (!validateToolCall(toolCall)) {
      return {
        toolCallId: typeof toolCall === 'object' && toolCall !== null && 'id' in toolCall ? (toolCall as any).id : 'unknown',
        output: '',
        error: 'Invalid tool call structure: missing or invalid id, name, or parameters.',
        success: false,
        durationMs: performance.now() - start,
      };
    }

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

    // Validate parameters
    if (toolCall.parameters === undefined || toolCall.parameters === null) {
      const emptyParams = {};
      const validation = this.registry.validate(toolCall.name, emptyParams);
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
    } else if (typeof toolCall.parameters !== 'object' || Array.isArray(toolCall.parameters)) {
      const result: ToolResult = {
        toolCallId: toolCall.id,
        output: '',
        error: 'Tool parameters must be an object, not an array or primitive value.',
        success: false,
        durationMs: performance.now() - start,
      };
      this.onToolResult?.(result);
      return result;
    } else {
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
    }

    const validation = this.registry.validate(toolCall.name, toolCall.parameters || {});
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
  async dispatchMany(toolCalls: unknown[]): Promise<ToolResult[]> {
    const tasks = toolCalls.map(
      (tc) => () => this.dispatch(tc),
    );
    return parallelLimit(tasks, this.maxConcurrent);
  }
}
