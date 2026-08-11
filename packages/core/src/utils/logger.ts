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
  contextStack.push(context);
}

/**
 * Pop a context from the stack.
 * Used internally by withContext.
 */
function popContext(): void {
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
