/**
 * Core agent type definitions for the AgentBuilder platform.
 */

/**
 * Supported agent execution patterns.
 * - react: ReAct (Reason + Act) loop pattern
 * - plan-and-execute: Plan first, then execute steps
 * - multi-agent: Orchestrate multiple sub-agents
 * - rag: Retrieval-Augmented Generation
 * - tool-augmented: Simple tool-calling agent
 */
export type AgentPatternType =
  | 'react'
  | 'plan-and-execute'
  | 'multi-agent'
  | 'rag'
  | 'tool-augmented';

/**
 * Configuration for the LLM provider backing an agent.
 */
export interface ProviderConfig {
  /** Identifier of the provider (e.g., 'anthropic', 'openai', 'ollama') */
  providerId: string;
  /** Model identifier within the provider (e.g., 'claude-sonnet-4-20250514', 'gpt-4o') */
  modelId: string;
  /** API key for authentication. If omitted, read from environment. */
  apiKey?: string;
  /** Custom base URL for self-hosted or proxy endpoints. */
  baseUrl?: string;
  /** Provider-specific options (headers, org IDs, etc.) */
  options?: Record<string, unknown>;
}

/**
 * Memory subsystem configuration for an agent.
 */
export interface MemoryConfig {
  /** Maximum number of messages to retain in short-term (conversation) memory. */
  shortTermMaxMessages: number;
  /** Whether long-term vector memory is enabled. */
  longTermEnabled: boolean;
  /** Number of top-K results to retrieve from long-term memory. */
  longTermTopK: number;
  /** Whether episodic memory (full episode summaries) is enabled. */
  episodicEnabled: boolean;
  /** Number of top-K episodes to retrieve. */
  episodicTopK: number;
  /** Provider for generating embeddings (e.g., 'openai', 'local'). */
  embeddingProvider?: string;
  /** Model used for embedding generation. */
  embeddingModel?: string;
}

/**
 * A guardrail rule that validates agent input and/or output.
 */
export interface GuardrailRule {
  /** Unique identifier for this rule. */
  id: string;
  /** Whether the rule applies to input, output, or both. */
  type: 'input' | 'output' | 'both';
  /** Human-readable name. */
  name: string;
  /** Description of what this rule checks. */
  description: string;
  /** The check expression or regex pattern to evaluate. */
  check: string;
  /** Action to take when the rule triggers. */
  action: 'block' | 'warn' | 'redact';
  /** Priority for rule ordering (lower = higher priority). */
  priority: number;
}

/**
 * Complete configuration for an agent instance.
 */
export interface AgentConfig {
  /** Unique identifier for this agent. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of the agent's purpose and capabilities. */
  description: string;
  /** Semantic version string. */
  version: string;
  /** LLM provider configuration. */
  provider: ProviderConfig;
  /** Execution pattern. */
  pattern: AgentPatternType;
  /** System prompt that defines the agent's behavior. */
  systemPrompt: string;
  /** List of tool IDs available to the agent. */
  tools: string[];
  /** Memory subsystem configuration. */
  memoryConfig: MemoryConfig;
  /** Guardrail rules for input/output validation. */
  guardrailRules: GuardrailRule[];
  /** Maximum number of reasoning turns before stopping. */
  maxTurns: number;
  /** Sampling temperature (0.0 - 2.0). */
  temperature: number;
  /** Maximum tokens to generate per response. */
  maxTokens: number;
  /** Arbitrary metadata attached to the agent. */
  metadata: Record<string, unknown>;
  /** When this configuration was created. */
  createdAt: Date;
  /** When this configuration was last modified. */
  updatedAt: Date;
}

/**
 * A test case definition used for evaluating agent behavior.
 */
export interface TestCaseDefinition {
  /** Unique identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The user input to send to the agent. */
  input: string;
  /** Expected output string for comparison (substring or regex). */
  expectedOutput?: string;
  /** Expected tool calls the agent should make. */
  expectedToolCalls?: string[];
  /** Maximum acceptable latency in milliseconds. */
  maxLatencyMs?: number;
}

/**
 * A reusable blueprint for creating agents of a particular archetype.
 */
export interface AgentBlueprint {
  /** Unique identifier for this blueprint. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what agents from this blueprint do. */
  description: string;
  /** Category for organization (e.g., 'customer-support', 'coding', 'research'). */
  category: string;
  /** Recommended execution pattern. */
  pattern: AgentPatternType;
  /** Default configuration values. */
  defaultConfig: Partial<AgentConfig>;
  /** Tools that must be available. */
  requiredTools: string[];
  /** Tools that can optionally be enabled. */
  optionalTools: string[];
  /** Recommended memory configuration. */
  memoryConfig: MemoryConfig;
  /** Example prompts to demonstrate the agent. */
  samplePrompts: string[];
  /** Test cases for validating agents built from this blueprint. */
  testCases: TestCaseDefinition[];
}
