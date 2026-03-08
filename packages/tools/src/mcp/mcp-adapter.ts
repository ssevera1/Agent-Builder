/**
 * MCP (Model Context Protocol) adapter — bidirectional conversion between
 * the AgentBuilder `RegisteredTool` format and the MCP tool format.
 *
 * MCP tools use JSON Schema for their `inputSchema`, which aligns well
 * with the core ToolDefinition. The adapter handles the subtle shape
 * differences and adds Zod schema reconstruction where possible.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolCategory } from '@agentbuilder/core';
import type { RegisteredTool } from '../registry.js';

// ---------------------------------------------------------------------------
// MCP types (subset that the adapter works with)
// ---------------------------------------------------------------------------

/**
 * An MCP-compatible tool definition, matching the Model Context Protocol
 * specification for tool listing.
 */
export interface MCPToolDefinition {
  /** The name of the tool. */
  name: string;
  /** A human-readable description. */
  description?: string;
  /** JSON Schema describing the tool's expected input. */
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/**
 * An MCP tool call request.
 */
export interface MCPToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * An MCP tool call result.
 */
export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Conversion: AgentBuilder → MCP
// ---------------------------------------------------------------------------

/**
 * Convert an AgentBuilder RegisteredTool into the MCP tool definition format.
 */
export function convertToMCPTool(tool: RegisteredTool): MCPToolDefinition {
  // Derive a clean JSON Schema from the Zod schema.
  const jsonSchema = zodToJsonSchema(tool.zodSchema, {
    target: 'openApi3',
  }) as Record<string, unknown>;

  // Ensure the top-level type is 'object' as required by MCP.
  const inputSchema: MCPToolDefinition['inputSchema'] = {
    type: 'object',
    ...jsonSchema,
  };

  // Remove $schema and other meta-properties that MCP doesn't need.
  delete inputSchema['$schema'];
  delete inputSchema['$ref'];
  delete inputSchema['definitions'];

  return {
    name: tool.name,
    description: tool.description,
    inputSchema,
  };
}

/**
 * Convert all registered tools from a registry to MCP format.
 */
export function convertAllToMCP(tools: RegisteredTool[]): MCPToolDefinition[] {
  return tools.map(convertToMCPTool);
}

// ---------------------------------------------------------------------------
// Conversion: MCP → AgentBuilder
// ---------------------------------------------------------------------------

/**
 * Convert an MCP tool definition into an AgentBuilder RegisteredTool.
 *
 * Because we cannot reconstruct a precise Zod schema from arbitrary JSON
 * Schema, the Zod schema is set to `z.record(z.unknown())` (accepts any
 * object). The original JSON Schema is preserved in `inputSchema` for
 * reference.
 *
 * A custom handler must be provided since the MCP definition does not
 * include execution logic.
 */
export function convertFromMCPTool(
  mcpTool: MCPToolDefinition,
  handler: (input: unknown, signal?: AbortSignal) => Promise<string>,
  options?: {
    category?: ToolCategory;
    timeoutMs?: number;
    requiresApproval?: boolean;
    hasSideEffects?: boolean;
  },
): RegisteredTool {
  // Attempt to build a Zod schema from the JSON Schema properties.
  const zodSchema = buildZodSchemaFromJsonSchema(mcpTool.inputSchema);

  return {
    name: mcpTool.name,
    description: mcpTool.description ?? '',
    inputSchema: mcpTool.inputSchema as Record<string, unknown>,
    category: options?.category ?? ('custom' as ToolCategory),
    timeoutMs: options?.timeoutMs ?? 30_000,
    requiresApproval: options?.requiresApproval ?? false,
    hasSideEffects: options?.hasSideEffects ?? true,
    zodSchema,
    handler,
  };
}

// ---------------------------------------------------------------------------
// MCP result helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a plain string output into an MCP tool result.
 */
export function toMCPResult(output: string, isError = false): MCPToolResult {
  return {
    content: [{ type: 'text', text: output }],
    isError,
  };
}

/**
 * Extract the text content from an MCP tool result.
 */
export function fromMCPResult(result: MCPToolResult): {
  output: string;
  isError: boolean;
} {
  const text = result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return { output: text, isError: result.isError ?? false };
}

// ---------------------------------------------------------------------------
// JSON Schema → Zod (best-effort)
// ---------------------------------------------------------------------------

/**
 * Build a Zod object schema from a JSON Schema `inputSchema`. This handles
 * the common property types (string, number, boolean, array, object) and
 * falls back to `z.unknown()` for anything exotic.
 */
function buildZodSchemaFromJsonSchema(
  schema: MCPToolDefinition['inputSchema'],
): z.ZodType {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, rawProp] of Object.entries(properties)) {
    const prop = rawProp as Record<string, unknown>;
    let fieldSchema = jsonSchemaPropertyToZod(prop);

    if (!required.has(key)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

function jsonSchemaPropertyToZod(
  prop: Record<string, unknown>,
): z.ZodTypeAny {
  const type = prop['type'] as string | undefined;

  switch (type) {
    case 'string': {
      let s = z.string();
      if (typeof prop['minLength'] === 'number') {
        s = s.min(prop['minLength']);
      }
      if (typeof prop['maxLength'] === 'number') {
        s = s.max(prop['maxLength']);
      }
      if (prop['enum'] && Array.isArray(prop['enum'])) {
        const values = prop['enum'] as [string, ...string[]];
        return z.enum(values);
      }
      return s;
    }
    case 'number':
    case 'integer': {
      let n = type === 'integer' ? z.number().int() : z.number();
      if (typeof prop['minimum'] === 'number') {
        n = n.min(prop['minimum']);
      }
      if (typeof prop['maximum'] === 'number') {
        n = n.max(prop['maximum']);
      }
      return n;
    }
    case 'boolean':
      return z.boolean();
    case 'array':
      if (prop['items'] && typeof prop['items'] === 'object') {
        return z.array(jsonSchemaPropertyToZod(prop['items'] as Record<string, unknown>));
      }
      return z.array(z.unknown());
    case 'object':
      if (prop['properties'] && typeof prop['properties'] === 'object') {
        return buildZodSchemaFromJsonSchema({
          type: 'object',
          properties: prop['properties'] as Record<string, unknown>,
          required: prop['required'] as string[] | undefined,
        });
      }
      return z.record(z.unknown());
    default:
      return z.unknown();
  }
}
