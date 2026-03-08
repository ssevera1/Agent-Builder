/**
 * Zod schemas for tool types.
 */

import { z } from 'zod';
import { ToolCategory } from '../types/tool.js';
import type { ToolDefinition, ToolCall, ToolResult } from '../types/tool.js';

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const toolCategorySchema = z.nativeEnum(ToolCategory);

export const toolDefinitionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/, 'Tool name must be a valid identifier'),
  description: z.string().min(1).max(4096),
  inputSchema: z.record(z.unknown()),
  category: toolCategorySchema.default(ToolCategory.Custom),
  timeoutMs: z.number().int().min(100).max(600_000).default(30_000),
  requiresApproval: z.boolean().default(false),
  hasSideEffects: z.boolean().default(false),
  outputSchema: z.record(z.unknown()).optional(),
  version: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Tool Call
// ---------------------------------------------------------------------------

export const toolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parameters: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// Tool Result
// ---------------------------------------------------------------------------

export const toolResultSchema = z.object({
  toolCallId: z.string().min(1),
  output: z.string(),
  error: z.string().optional(),
  success: z.boolean(),
  durationMs: z.number().min(0),
  metadata: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

export function parseToolDefinition(data: unknown): ToolDefinition {
  return toolDefinitionSchema.parse(data) as ToolDefinition;
}

export function parseToolCall(data: unknown): ToolCall {
  return toolCallSchema.parse(data) as ToolCall;
}

export function parseToolResult(data: unknown): ToolResult {
  return toolResultSchema.parse(data) as ToolResult;
}
