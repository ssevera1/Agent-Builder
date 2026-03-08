/**
 * Workflow serialization and deserialization.
 *
 * Supports YAML and JSON workflow definition files with Zod-based validation.
 *
 * Example YAML workflow format:
 * ```yaml
 * id: customer-support-workflow
 * name: Customer Support Pipeline
 * description: Routes and handles customer support requests
 * version: "1.0.0"
 *
 * inputs:
 *   message:
 *     type: string
 *     description: The customer's message
 *     required: true
 *   customerId:
 *     type: string
 *     description: The customer's identifier
 *     required: false
 *
 * nodes:
 *   - id: classify
 *     name: Classify Request
 *     type: agent
 *     config:
 *       agentConfigId: classifier-agent
 *       message: "Classify this request: {{message}}"
 *     description: Classifies the customer request type
 *
 *   - id: check_urgency
 *     name: Check Urgency
 *     type: condition
 *     config:
 *       expression: "classify.category === 'urgent'"
 *     description: Routes based on urgency
 *
 *   - id: urgent_handler
 *     name: Urgent Handler
 *     type: agent
 *     config:
 *       agentConfigId: urgent-support-agent
 *       message: "Handle urgent request: {{message}}"
 *     retry:
 *       maxAttempts: 3
 *       delayMs: 1000
 *
 *   - id: normal_handler
 *     name: Normal Handler
 *     type: agent
 *     config:
 *       agentConfigId: support-agent
 *       message: "Handle request: {{message}}"
 *
 *   - id: format_response
 *     name: Format Response
 *     type: transform
 *     config:
 *       expression: "{ response: input.response, ticket: input.ticketId }"
 *
 *   - id: review
 *     name: Human Review
 *     type: human
 *     config:
 *       prompt: "Please review this response before sending"
 *
 * edges:
 *   - from: classify
 *     to: check_urgency
 *   - from: check_urgency
 *     to: urgent_handler
 *     condition: "true"
 *   - from: check_urgency
 *     to: normal_handler
 *     condition: "false"
 *   - from: urgent_handler
 *     to: format_response
 *   - from: normal_handler
 *     to: format_response
 *   - from: format_response
 *     to: review
 *
 * outputs:
 *   response: review.humanInput
 *   approved: review.approved
 *
 * metadata:
 *   author: support-team
 *   tags:
 *     - customer-support
 *     - production
 * ```
 */

import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from './types.js';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const RetryConfigSchema = z.object({
  maxAttempts: z.number().int().positive(),
  delayMs: z.number().int().nonnegative(),
  backoffMultiplier: z.number().positive().optional(),
});

const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['agent', 'transform', 'condition', 'parallel', 'human', 'custom']),
  config: z.record(z.unknown()),
  description: z.string().optional(),
  retry: RetryConfigSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const WorkflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const InputSchemaEntry = z.object({
  type: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

const WorkflowDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().min(1),
  nodes: z.array(WorkflowNodeSchema).min(1),
  edges: z.array(WorkflowEdgeSchema),
  inputs: z.record(InputSchemaEntry).optional(),
  outputs: z.record(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export { WorkflowDefinitionSchema };

// ─── Validation Result ──────────────────────────────────────────────────────

export interface SerializationError {
  path: string;
  message: string;
}

export interface SerializationResult {
  success: boolean;
  workflow?: WorkflowDefinition;
  errors?: SerializationError[];
}

// ─── YAML Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a YAML string into a validated WorkflowDefinition.
 *
 * @throws Error if the YAML is invalid or does not conform to the schema.
 */
export function parseWorkflowYAML(yamlString: string): WorkflowDefinition {
  let raw: unknown;
  try {
    raw = yaml.load(yamlString);
  } catch (err) {
    throw new Error(`Invalid YAML: ${(err as Error).message}`);
  }

  return validateAndParse(raw);
}

/**
 * Parse a YAML string with detailed error reporting instead of throwing.
 */
export function tryParseWorkflowYAML(yamlString: string): SerializationResult {
  let raw: unknown;
  try {
    raw = yaml.load(yamlString);
  } catch (err) {
    return {
      success: false,
      errors: [{ path: '', message: `Invalid YAML: ${(err as Error).message}` }],
    };
  }

  return tryValidateAndParse(raw);
}

/**
 * Serialize a WorkflowDefinition to a YAML string.
 */
export function serializeWorkflowYAML(workflow: WorkflowDefinition): string {
  // Validate before serializing
  WorkflowDefinitionSchema.parse(workflow);
  return yaml.dump(workflow, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

// ─── JSON Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a JSON string into a validated WorkflowDefinition.
 *
 * @throws Error if the JSON is invalid or does not conform to the schema.
 */
export function parseWorkflowJSON(jsonString: string): WorkflowDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  return validateAndParse(raw);
}

/**
 * Parse a JSON string with detailed error reporting instead of throwing.
 */
export function tryParseWorkflowJSON(jsonString: string): SerializationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    return {
      success: false,
      errors: [{ path: '', message: `Invalid JSON: ${(err as Error).message}` }],
    };
  }

  return tryValidateAndParse(raw);
}

/**
 * Serialize a WorkflowDefinition to a JSON string.
 */
export function serializeWorkflowJSON(workflow: WorkflowDefinition, pretty = true): string {
  // Validate before serializing
  WorkflowDefinitionSchema.parse(workflow);
  return pretty ? JSON.stringify(workflow, null, 2) : JSON.stringify(workflow);
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

function validateAndParse(raw: unknown): WorkflowDefinition {
  const result = WorkflowDefinitionSchema.safeParse(raw);
  if (!result.success) {
    const errorMessages = result.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw new Error(`Invalid workflow definition: ${errorMessages}`);
  }

  const workflow = result.data as WorkflowDefinition;
  validateSemantics(workflow);
  return workflow;
}

function tryValidateAndParse(raw: unknown): SerializationResult {
  const result = WorkflowDefinitionSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));
    return { success: false, errors };
  }

  const workflow = result.data as WorkflowDefinition;

  try {
    validateSemantics(workflow);
  } catch (err) {
    return {
      success: false,
      errors: [{ path: '', message: (err as Error).message }],
    };
  }

  return { success: true, workflow };
}

/**
 * Validate semantic constraints beyond what Zod can check:
 * - All edge source/target node IDs must reference existing nodes
 * - Node IDs must be unique
 * - Condition edges must have a condition string
 */
function validateSemantics(workflow: WorkflowDefinition): void {
  const errors: string[] = [];
  const nodeIds = new Set<string>();

  // Check for duplicate node IDs
  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node ID: '${node.id}'`);
    }
    nodeIds.add(node.id);
  }

  // Check edges reference valid nodes
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references non-existent source node: '${edge.from}'`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references non-existent target node: '${edge.to}'`);
    }
  }

  // Check condition nodes have condition-labeled edges
  const conditionNodeIds = new Set(
    workflow.nodes.filter((n) => n.type === 'condition').map((n) => n.id)
  );
  for (const nodeId of conditionNodeIds) {
    const outEdges = workflow.edges.filter((e) => e.from === nodeId);
    const hasConditionEdges = outEdges.some((e) => e.condition !== undefined);
    if (outEdges.length > 0 && !hasConditionEdges) {
      errors.push(
        `Condition node '${nodeId}' has outgoing edges but none have condition labels`
      );
    }
  }

  // Check output references
  if (workflow.outputs) {
    for (const [key, ref] of Object.entries(workflow.outputs)) {
      const dotIndex = ref.indexOf('.');
      const refNodeId = dotIndex >= 0 ? ref.substring(0, dotIndex) : ref;
      if (!nodeIds.has(refNodeId)) {
        errors.push(
          `Output '${key}' references non-existent node: '${refNodeId}'`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Workflow semantic validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}
