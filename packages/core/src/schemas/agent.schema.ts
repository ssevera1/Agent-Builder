/**
 * Zod schemas for agent configuration types.
 * Includes sensible defaults for all optional-with-default fields.
 */

import { z } from 'zod';
import type {
  AgentConfig,
  ProviderConfig,
  MemoryConfig,
  AgentBlueprint,
} from '../types/agent.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const agentPatternTypeSchema = z.enum([
  'react',
  'plan-and-execute',
  'multi-agent',
  'rag',
  'tool-augmented',
]);

// ---------------------------------------------------------------------------
// Provider Config
// ---------------------------------------------------------------------------

export const providerConfigSchema = z.object({
  providerId: z.string().min(1, 'Provider ID is required'),
  modelId: z.string().min(1, 'Model ID is required'),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  options: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Memory Config
// ---------------------------------------------------------------------------

export const memoryConfigSchema = z.object({
  shortTermMaxMessages: z.number().int().min(1).max(1000).default(50),
  longTermEnabled: z.boolean().default(false),
  longTermTopK: z.number().int().min(1).max(100).default(5),
  episodicEnabled: z.boolean().default(false),
  episodicTopK: z.number().int().min(1).max(50).default(3),
  embeddingProvider: z.string().optional(),
  embeddingModel: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Guardrail Rule
// ---------------------------------------------------------------------------

export const guardrailRuleSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['input', 'output', 'both']),
  name: z.string().min(1),
  description: z.string(),
  check: z.string().min(1),
  action: z.enum(['block', 'warn', 'redact']),
  priority: z.number().int().min(0).default(100),
});

// ---------------------------------------------------------------------------
// Test Case Definition
// ---------------------------------------------------------------------------

export const testCaseDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.string().min(1),
  expectedOutput: z.string().optional(),
  expectedToolCalls: z.array(z.string()).optional(),
  maxLatencyMs: z.number().positive().optional(),
});

// ---------------------------------------------------------------------------
// Agent Config
// ---------------------------------------------------------------------------

export const agentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  description: z.string().max(2048).default(''),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, 'Must be a valid semver string')
    .default('0.1.0'),
  provider: providerConfigSchema,
  pattern: agentPatternTypeSchema.default('react'),
  systemPrompt: z.string().default('You are a helpful assistant.'),
  tools: z.array(z.string()).default([]),
  memoryConfig: memoryConfigSchema.default({
    shortTermMaxMessages: 50,
    longTermEnabled: false,
    longTermTopK: 5,
    episodicEnabled: false,
    episodicTopK: 3,
  }),
  guardrailRules: z.array(guardrailRuleSchema).default([]),
  maxTurns: z.number().int().min(1).max(100).default(25),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(1_000_000).default(4096),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.coerce.date().default(() => new Date()),
  updatedAt: z.coerce.date().default(() => new Date()),
});

// ---------------------------------------------------------------------------
// Agent Blueprint
// ---------------------------------------------------------------------------

export const agentBlueprintSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  description: z.string().max(2048),
  category: z.string().min(1),
  pattern: agentPatternTypeSchema,
  defaultConfig: agentConfigSchema.partial(),
  requiredTools: z.array(z.string()).default([]),
  optionalTools: z.array(z.string()).default([]),
  memoryConfig: memoryConfigSchema,
  samplePrompts: z.array(z.string()).default([]),
  testCases: z.array(testCaseDefinitionSchema).default([]),
});

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/** Parse and validate an AgentConfig, throwing ConfigValidationError on failure. */
export function parseAgentConfig(data: unknown): AgentConfig {
  return agentConfigSchema.parse(data) as AgentConfig;
}

/** Safe parse — returns { success, data?, error? }. */
export function safeParseAgentConfig(data: unknown) {
  return agentConfigSchema.safeParse(data);
}

/** Parse and validate a ProviderConfig. */
export function parseProviderConfig(data: unknown): ProviderConfig {
  return providerConfigSchema.parse(data) as ProviderConfig;
}

/** Parse and validate a MemoryConfig. */
export function parseMemoryConfig(data: unknown): MemoryConfig {
  return memoryConfigSchema.parse(data) as MemoryConfig;
}

/** Parse and validate an AgentBlueprint. */
export function parseAgentBlueprint(data: unknown): AgentBlueprint {
  return agentBlueprintSchema.parse(data) as unknown as AgentBlueprint;
}
