/**
 * Structured logger built on pino.
 * Reads log level from the LOG_LEVEL or NODE_ENV environment variables.
 */

import pino from 'pino';
import type { Logger as PinoLogger, LoggerOptions as PinoLoggerOptions } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported log levels. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/** Options for creating a logger. */
export interface LoggerOptions {
  /** Log level. Defaults to LOG_LEVEL env var, or 'info'. */
  level?: LogLevel;
  /** Whether to enable pretty-printing (for local dev). Defaults to NODE_ENV !== 'production'. */
  pretty?: boolean;
  /** Additional pino options to merge. */
  pinoOptions?: PinoLoggerOptions;
}

/** Re-export pino's Logger type for consumers. */
export type Logger = PinoLogger;

// ---------------------------------------------------------------------------
// Context stack for call hierarchy tracking
// ---------------------------------------------------------------------------

const contextStack: string[] = [];

/**
 * Push a context onto the stack.
 * Used internally by withContext to track call hierarchies.
 */
function pushContext(context: string): void {
  if (!context || typeof context !== 'string' || context.trim().length === 0) {
    throw new Error('Context must be a non-empty string');
  }
  contextStack.push(context);
}

/**
 * Pop a context from the stack.
 * Used internally by withContext.
 * Throws an error if the stack is empty to prevent underflow.
 */
function popContext(): void {
  if (contextStack.length === 0) {
    throw new Error('Context stack underflow: attempted to pop without matching push()');
  }
  contextStack.pop();
}

/**
 * Get the current context path as a formatted string.
 */
function getContextPath(): string {
  return contextStack.length > 0 ? contextStack.join(' > ') : '';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_CONTEXT_VALUE_SIZE = 1_048_576;

/**
 * Estimate the serialized size (in bytes) of a value without fully
 * materializing it, so the check can bail out early on oversized input
 * instead of allocating the thing it's trying to reject. Tracks visited
 * objects to stay safe on circular references (common in logged Errors,
 * req/res pairs, etc.), which `JSON.stringify` cannot handle.
 */
function estimateByteSize(value: unknown, limit: number): number {
  const seen = new WeakSet<object>();
  let size = 0;

  function walk(v: unknown): void {
    if (size > limit) return;
    if (v === null || v === undefined) return;

    switch (typeof v) {
      case 'string':
        size += Buffer.byteLength(v);
        return;
      case 'number':
      case 'boolean':
        size += 8;
        return;
      case 'bigint':
        size += v.toString().length;
        return;
      case 'object': {
        if (seen.has(v)) return;
        seen.add(v);
        if (Array.isArray(v)) {
          for (const item of v) {
            walk(item);
            if (size > limit) return;
          }
        } else {
          for (const key of Object.keys(v)) {
            walk((v as Record<string, unknown>)[key]);
            if (size > limit) return;
          }
        }
        return;
      }
      default:
        return;
    }
  }

  walk(value);
  return size;
}

/**
 * Validate context values to prevent memory issues from extremely large objects.
 */
function validateContextValue(value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === 'string' || typeof value === 'object') {
    const size = estimateByteSize(value, MAX_CONTEXT_VALUE_SIZE);
    if (size > MAX_CONTEXT_VALUE_SIZE) {
      throw new Error(`Context value too large: exceeds ${MAX_CONTEXT_VALUE_SIZE} bytes`);
    }
  }
}

/**
 * Validate context keys in a record to ensure none are empty or invalid.
 */
function validateContextKeys(bindings: Record<string, unknown>): void {
  for (const key of Object.keys(bindings)) {
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      throw new Error(`Invalid context key: keys must be non-empty strings`);
    }
    validateContextValue(bindings[key]);
  }
}

/**
 * Determine the default log level from environment variables.
 */
function resolveLevel(explicit?: LogLevel): string {
  if (explicit) return explicit;

  const envLevel = process.env['LOG_LEVEL'];
  if (envLevel) return envLevel;

  const nodeEnv = process.env['NODE_ENV'];
  if (nodeEnv === 'test') return 'silent';
  if (nodeEnv === 'production') return 'info';

  return 'debug';
}

/**
 * Determine whether to pretty-print from environment.
 */
function resolvePretty(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  return process.env['NODE_ENV'] !== 'production';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a structured logger.
 *
 * @param name - Logger name (appears in every log line as `name`).
 * @param options - Configuration options.
 * @returns A pino Logger instance.
 *
 * @example
 * ```ts
 * const log = createLogger('agent-runtime');
 * log.info({ agentId: 'abc' }, 'Agent started');
 *
 * const child = log.child({ sessionId: 'xyz' });
 * child.debug('Processing turn');
 * ```
 */
export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  const level = resolveLevel(options.level);
  const pretty = resolvePretty(options.pretty);

  const pinoOptions: PinoLoggerOptions = {
    name,
    level,
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => bindings,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...options.pinoOptions,
  };

  if (pretty) {
    pinoOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        singleLine: false,
      },
    };
  } else {
    pinoOptions.transport = {
      target: 'pino/file',
      options: { destination: 1 },
    };
  }

  return pino(pinoOptions);
}

/**
 * A no-op logger that silences all output.
 * Useful for testing or when logging is explicitly disabled.
 */
export function createSilentLogger(name = 'silent'): Logger {
  return pino({ name, level: 'silent' });
}

/**
 * Create a child logger with additional context bindings.
 *
 * @param parent - Parent logger instance.
 * @param bindings - Key-value pairs to include in every log line.
 * @returns A child Logger.
 */
export function createChildLogger(
  parent: Logger,
  bindings: Record<string, unknown>,
): Logger {
  validateContextKeys(bindings);
  return parent.child(bindings);
}

/**
 * Execute a function within a named context, automatically tracking
 * the call hierarchy for structured logging.
 *
 * @param context - Context name to push onto the stack.
 * @param fn - Function to execute.
 * @returns The result of executing fn.
 *
 * @example
 * ```ts
 * const result = await withContext('processAgent', async () => {
 *   return await withContext('loadState', async () => {
 *     // logs will include 'processAgent > loadState' in context
 *   });
 * });
 * ```
 */
export async function withContext<T>(
  context: string,
  fn: () => Promise<T>,
): Promise<T> {
  pushContext(context);
  try {
    return await fn();
  } finally {
    popContext();
  }
}

/**
 * Synchronous variant of withContext.
 *
 * @param context - Context name to push onto the stack.
 * @param fn - Function to execute.
 * @returns The result of executing fn.
 */
export function withContextSync<T>(
  context: string,
  fn: () => T,
): T {
  pushContext(context);
  try {
    return fn();
  } finally {
    popContext();
  }
}

/**
 * Get the current context path.
 * Intended for use within log bindings to include hierarchy information.
 *
 * @returns Formatted context path, or empty string if no context.
 *
 * @example
 * ```ts
 * log.info({ context: getContext() }, 'message');
 * ```
 */
export function getContext(): string {
  return getContextPath();
}
