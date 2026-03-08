/**
 * Tool-specific error classes.
 */

import { AgentBuilderError } from './base.js';

/**
 * A tool failed during execution.
 */
export class ToolExecutionError extends AgentBuilderError {
  /** Name of the tool that failed. */
  readonly toolName: string;

  /** The tool call ID, if available. */
  readonly toolCallId?: string;

  constructor(
    message: string,
    options: {
      toolName: string;
      toolCallId?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, {
      code: 'TOOL_EXECUTION_ERROR',
      statusCode: 500,
      details: options.details,
      cause: options.cause,
    });
    this.toolName = options.toolName;
    this.toolCallId = options.toolCallId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      toolName: this.toolName,
      toolCallId: this.toolCallId,
    };
  }
}

/**
 * A tool execution exceeded its timeout.
 */
export class ToolTimeoutError extends AgentBuilderError {
  /** Name of the tool that timed out. */
  readonly toolName: string;

  /** The tool call ID, if available. */
  readonly toolCallId?: string;

  /** The timeout that was exceeded (ms). */
  readonly timeoutMs: number;

  constructor(
    message: string,
    options: {
      toolName: string;
      toolCallId?: string;
      timeoutMs: number;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, {
      code: 'TOOL_TIMEOUT',
      statusCode: 504,
      details: options.details,
      cause: options.cause,
    });
    this.toolName = options.toolName;
    this.toolCallId = options.toolCallId;
    this.timeoutMs = options.timeoutMs;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      toolName: this.toolName,
      toolCallId: this.toolCallId,
      timeoutMs: this.timeoutMs,
    };
  }
}

/**
 * A requested tool was not found in the registry.
 */
export class ToolNotFoundError extends AgentBuilderError {
  /** Name of the tool that was not found. */
  readonly toolName: string;

  constructor(
    message: string,
    options: {
      toolName: string;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: 'TOOL_NOT_FOUND',
      statusCode: 404,
      details: options.details,
    });
    this.toolName = options.toolName;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      toolName: this.toolName,
    };
  }
}

/**
 * Tool input parameters failed validation against the input schema.
 */
export class ToolValidationError extends AgentBuilderError {
  /** Name of the tool. */
  readonly toolName: string;

  /** Validation error messages. */
  readonly validationErrors: string[];

  constructor(
    message: string,
    options: {
      toolName: string;
      validationErrors: string[];
      details?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: 'TOOL_VALIDATION_ERROR',
      statusCode: 400,
      details: {
        ...options.details,
        validationErrors: options.validationErrors,
      },
    });
    this.toolName = options.toolName;
    this.validationErrors = options.validationErrors;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      toolName: this.toolName,
      validationErrors: this.validationErrors,
    };
  }
}
