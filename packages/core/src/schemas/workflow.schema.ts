/**
 * Zod schemas for workflow types.
 */

import { z } from 'zod';
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
} from '../types/workflow.js';

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

const workflowNodeBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  position: positionSchema,
  metadata: z.record(z.unknown()).optional(),
});

const agentNodeSchema = workflowNodeBaseSchema.extend({
  type: z.literal('agent'),
  agentId: z.string().min(1),
  promptOverride: z.string().optional(),
  inputMapping: z.record(z.string()).optional(),
});

const transformNodeSchema = workflowNodeBaseSchema.extend({
  type: z.literal('transform'),
  transformExpression: z.string().min(1),
  inputMapping: z.record(z.string()).optional(),
});

const conditionNodeSchema = workflowNodeBaseSchema.extend({
  type: z.literal('condition'),
  conditionExpression: z.string().min(1),
  trueBranch: z.string().min(1),
  falseBranch: z.string().min(1),
});

const parallelNodeSchema = workflowNodeBaseSchema.extend({
  type: z.literal('parallel'),
  branches: z.array(z.string().min(1)).min(2),
  mergeStrategy: z.enum(['all', 'race']).default('all'),
});

const humanNodeSchema = workflowNodeBaseSchema.extend({
  type: z.literal('human'),
  prompt: z.string().min(1),
  timeoutMs: z.number().int().min(0).default(0),
  timeoutAction: z.enum(['approve', 'reject', 'skip']).default('skip'),
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  agentNodeSchema,
  transformNodeSchema,
  conditionNodeSchema,
  parallelNodeSchema,
  humanNodeSchema,
]);

// ---------------------------------------------------------------------------
// Edge
// ---------------------------------------------------------------------------

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  condition: z.string().optional(),
  label: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export const workflowInputSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: z.string().min(1),
  required: z.boolean().default(true),
  defaultValue: z.unknown().optional(),
});

export const workflowOutputSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  valueExpression: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Workflow Definition
// ---------------------------------------------------------------------------

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  description: z.string().max(4096).default(''),
  version: z.string().default('0.1.0'),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema),
  inputs: z.array(workflowInputSchema).default([]),
  outputs: z.array(workflowOutputSchema).default([]),
  entryNodeId: z.string().min(1),
  timeoutMs: z.number().int().min(0).default(300_000),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.coerce.date().default(() => new Date()),
  updatedAt: z.coerce.date().default(() => new Date()),
});

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

export function parseWorkflowDefinition(data: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(data) as unknown as WorkflowDefinition;
}

export function parseWorkflowNode(data: unknown): WorkflowNode {
  return workflowNodeSchema.parse(data) as unknown as WorkflowNode;
}

export function parseWorkflowEdge(data: unknown): WorkflowEdge {
  return workflowEdgeSchema.parse(data) as WorkflowEdge;
}
