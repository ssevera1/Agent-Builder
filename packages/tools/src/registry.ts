/**
 * ToolRegistry — a centralized registry for tool definitions with Zod-based
 * validation and JSON Schema conversion for LLM providers.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinition, ToolCategory } from '@agentbuilder/core';

// ---------------------------------------------------------------------------
// Extended tool definition that carries a Zod schema alongside the raw
// JSON Schema already present on the core ToolDefinition.
// ---------------------------------------------------------------------------

/**
 * A tool definition enriched with a Zod schema for runtime validation.
 * The `inputSchema` field from the core ToolDefinition is still present for
 * serialization, but `zodSchema` is the authoritative source for validation.
 */
export interface RegisteredTool extends ToolDefinition {
  /** Zod schema for validating tool inputs at runtime. */
  zodSchema: z.ZodType;
  /**
   * The handler that executes the tool.
   * Receives validated input and returns the serialised output string.
   */
  handler: (input: unknown, signal?: AbortSignal) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  success: boolean;
  data?: unknown;
  errors?: Array<{ path: string; message: string }>;
}

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  // ── Registration ────────────────────────────────────────────────────────

  /**
   * Register a single tool. Throws if a tool with the same name already
   * exists (use `unregister` first to replace).
   */
  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Register many tools at once. Stops on the first duplicate.
   */
  registerMany(tools: RegisteredTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  // ── Removal ─────────────────────────────────────────────────────────────

  /**
   * Remove a tool by name. Returns `true` if the tool was found and removed.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  // ── Lookup ──────────────────────────────────────────────────────────────

  /**
   * Retrieve a registered tool by name, or `undefined` if not found.
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check whether a tool with the given name is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Return a snapshot array of all registered tools.
   */
  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  // ── Validation ──────────────────────────────────────────────────────────

  /**
   * Validate an input payload against the Zod schema of the named tool.
   */
  validate(name: string, input: unknown): ValidationResult {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        errors: [{ path: '', message: `Tool "${name}" is not registered.` }],
      };
    }

    const result = tool.zodSchema.safeParse(input);
    if (result.success) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  // ── JSON Schema ─────────────────────────────────────────────────────────

  /**
   * Convert the named tool's Zod schema to a JSON Schema object suitable
   * for sending to an LLM provider.
   */
  toJSONSchema(name: string): Record<string, unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered.`);
    }
    return zodToJsonSchema(tool.zodSchema, { target: 'openApi3' }) as Record<string, unknown>;
  }

  /**
   * Return the core `ToolDefinition` representation (without handler / Zod
   * schema) for every registered tool. Useful for sending tool lists to LLM
   * providers.
   */
  toToolDefinitions(): ToolDefinition[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: this.toJSONSchema(t.name),
      category: t.category,
      timeoutMs: t.timeoutMs,
      requiresApproval: t.requiresApproval,
      hasSideEffects: t.hasSideEffects,
      outputSchema: t.outputSchema,
      version: t.version,
      metadata: t.metadata,
    }));
  }
}
