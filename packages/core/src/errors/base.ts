/**
 * Base error class for the AgentBuilder platform.
 * All custom errors extend this class, providing structured error codes,
 * HTTP-compatible status codes, and cause chaining.
 */

/**
 * Base error for all AgentBuilder errors.
 */
export class AgentBuilderError extends Error {
  /** Machine-readable error code (e.g., 'RATE_LIMIT_EXCEEDED'). */
  readonly code: string;

  /** HTTP-compatible status code for API surfaces. */
  readonly statusCode: number;

  /** Structured details for debugging. */
  readonly details: Record<string, unknown>;

  /** Original error that caused this one, if any. */
  override readonly cause?: Error;

  constructor(
    message: string,
    options: {
      code?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code ?? 'AGENT_BUILDER_ERROR';
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details ?? {};
    this.cause = options.cause;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize the error to a plain object for logging / API responses.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
          }
        : undefined,
      stack: this.stack,
    };
  }
}

/**
 * Type guard to check if an unknown value is an AgentBuilderError.
 */
export function isAgentBuilderError(error: unknown): error is AgentBuilderError {
  return error instanceof AgentBuilderError;
}
