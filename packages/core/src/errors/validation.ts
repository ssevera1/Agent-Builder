/**
 * Configuration / schema validation error.
 * Wraps Zod validation errors with structured path information.
 */

import type { ZodError, ZodIssue } from 'zod';
import { AgentBuilderError } from './base.js';

/**
 * Structured representation of a single validation issue.
 */
export interface ValidationIssue {
  /** Dot-separated path to the invalid field (e.g., 'provider.modelId'). */
  path: string;
  /** Human-readable error message. */
  message: string;
  /** Zod issue code (e.g., 'invalid_type', 'too_small'). */
  code: string;
  /** Expected value or type. */
  expected?: string;
  /** Received value or type. */
  received?: string;
}

/**
 * Thrown when configuration or input fails Zod schema validation.
 */
export class ConfigValidationError extends AgentBuilderError {
  /** Structured validation issues. */
  readonly issues: ValidationIssue[];

  constructor(
    message: string,
    options: {
      issues: ValidationIssue[];
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, {
      code: 'CONFIG_VALIDATION_ERROR',
      statusCode: 400,
      details: {
        ...options.details,
        issues: options.issues,
      },
      cause: options.cause,
    });
    this.issues = options.issues;
  }

  /**
   * Create a ConfigValidationError from a ZodError.
   */
  static fromZodError(zodError: ZodError, contextMessage?: string): ConfigValidationError {
    const issues: ValidationIssue[] = zodError.issues.map((issue: ZodIssue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
      expected: 'expected' in issue ? String(issue.expected) : undefined,
      received: 'received' in issue ? String(issue.received) : undefined,
    }));

    const fieldList = issues.map((i) => i.path || '(root)').join(', ');
    const msg = contextMessage
      ? `${contextMessage}: validation failed for fields [${fieldList}]`
      : `Validation failed for fields [${fieldList}]`;

    return new ConfigValidationError(msg, {
      issues,
      cause: zodError,
    });
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      issues: this.issues,
    };
  }
}
