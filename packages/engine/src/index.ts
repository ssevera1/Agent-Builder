/**
 * @agentbuilder/engine — the core agent orchestration engine.
 *
 * This package provides:
 * - The Orchestrator class that drives agent execution
 * - Five execution patterns (ReAct, Plan-and-Execute, Multi-Agent, RAG, Tool-Augmented)
 * - Prompt building with Handlebars template support
 * - Context assembly with sliding window and memory retrieval
 * - Response parsing for streaming LLM outputs
 * - Input/output guardrails
 * - Pattern and template registries
 * - Four pre-built agent blueprints
 */

// ---------------------------------------------------------------------------
// Core orchestrator
// ---------------------------------------------------------------------------
export { Orchestrator } from './orchestrator.js';
export type { OrchestratorOptions } from './orchestrator.js';

// ---------------------------------------------------------------------------
// Pattern interface and types
// ---------------------------------------------------------------------------
export type {
  // Pattern contract
  AgentPattern,
  AgentContext,
  AgentServices,

  // Event types
  AgentEvent,
  AgentEventType,
  AgentEventData,
  RunStartData,
  ThinkingData,
  TextDeltaData,
  TextDoneData,
  ToolCallStartData,
  ToolCallDoneData,
  ToolResultData,
  MemoryRetrievedData,
  GuardrailTriggeredData,
  PlanCreatedData,
  PlanStep,
  PlanStepStartData,
  PlanStepDoneData,
  HandoffData,
  ErrorData,
  UsageUpdateData,
  RunDoneData,

  // Service interfaces
  LLMClient,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamEventType,
  LLMToolDefinition,
  StopReason,
  ToolDispatcher,
  ToolCall,
  ToolResult,
  ToolDefinition,
  ToolExecutionContext,
  MemoryManager,
  MemoryEntry,
  MemoryMetadata,
  MemorySearchResult,
  MemorySearchOptions,
  Episode,
  Logger,

  // Prompt & guardrail interfaces
  PromptBuilder as IPromptBuilder,
  BuiltPrompt,
  GuardrailsEngine,
  ValidationResult,
  ValidationViolation,

  // Message types
  Message,
  MessageRole,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  TokenUsage,
  Session,
} from './patterns/pattern.interface.js';

// ---------------------------------------------------------------------------
// Built-in patterns
// ---------------------------------------------------------------------------
export { ReActPattern } from './patterns/react.js';
export { PlanAndExecutePattern } from './patterns/plan-and-execute.js';
export { MultiAgentPattern } from './patterns/multi-agent.js';
export { RAGPattern } from './patterns/rag.js';
export { ToolAugmentedPattern } from './patterns/tool-augmented.js';

// ---------------------------------------------------------------------------
// Pattern registry
// ---------------------------------------------------------------------------
export { PatternRegistry } from './pattern-registry.js';

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------
export { PromptBuilder } from './prompt-builder.js';

// ---------------------------------------------------------------------------
// Context assembler
// ---------------------------------------------------------------------------
export { ContextAssembler } from './context-assembler.js';

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------
export { ResponseParser } from './response-parser.js';
export type {
  ParsedResponse,
  StreamParseEvent,
} from './response-parser.js';

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------
export { Guardrails } from './guardrails.js';
export type { GuardrailsOptions } from './guardrails.js';

// ---------------------------------------------------------------------------
// Template registry and blueprints
// ---------------------------------------------------------------------------
export { TemplateRegistry } from './templates/template-registry.js';
export { RESEARCH_AGENT_BLUEPRINT } from './templates/research-agent.js';
export { CODING_AGENT_BLUEPRINT } from './templates/coding-agent.js';
export { DATA_ANALYST_BLUEPRINT } from './templates/data-analyst.js';
export { CUSTOMER_SUPPORT_BLUEPRINT } from './templates/customer-support.js';

// ---------------------------------------------------------------------------
// Convenience: pre-populated template registry
// ---------------------------------------------------------------------------
import { TemplateRegistry } from './templates/template-registry.js';
import { RESEARCH_AGENT_BLUEPRINT } from './templates/research-agent.js';
import { CODING_AGENT_BLUEPRINT } from './templates/coding-agent.js';
import { DATA_ANALYST_BLUEPRINT } from './templates/data-analyst.js';
import { CUSTOMER_SUPPORT_BLUEPRINT } from './templates/customer-support.js';

/**
 * Create a TemplateRegistry pre-populated with all built-in agent blueprints.
 */
export function createDefaultTemplateRegistry(): TemplateRegistry {
  const registry = new TemplateRegistry();
  registry.register(RESEARCH_AGENT_BLUEPRINT);
  registry.register(CODING_AGENT_BLUEPRINT);
  registry.register(DATA_ANALYST_BLUEPRINT);
  registry.register(CUSTOMER_SUPPORT_BLUEPRINT);
  return registry;
}
