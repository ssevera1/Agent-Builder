/**
 * Core interfaces for agent execution patterns.
 *
 * These types define the contracts between the orchestrator, patterns, and
 * the external service adapters (LLM, tools, memory). The actual
 * implementations of LLMClient, ToolDispatcher, and MemoryManager live in
 * their respective workspace packages; here we define the minimal
 * interfaces the engine needs so it can remain decoupled.
 */

import type {
  AgentConfig,
  GuardrailRule,
} from '@agentbuilder/core';

// Re-export core types the engine uses everywhere so consumers only need
// to import from the engine package.
export type { AgentConfig, GuardrailRule };

// ---------------------------------------------------------------------------
// Message & Content types (mirrors @agentbuilder/core but kept local so the
// engine compiles without requiring a build of core first during dev)
// ---------------------------------------------------------------------------

/** Roles that can author a message. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** A block of text content. */
export interface TextBlock {
  type: 'text';
  text: string;
}

/** A tool-use content block. */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A tool-result content block. */
export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Union of content block types used in the engine. */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/** A single message in a conversation. */
export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
  name?: string;
  toolCallId?: string;
}

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Represents a conversation session between a user and an agent. */
export interface Session {
  /** Unique identifier for the session. */
  id: string;
  /** The agent configuration driving this session. */
  agentId: string;
  /** Ordered conversation messages. */
  messages: Message[];
  /** When the session was created. */
  createdAt: Date;
  /** When the session was last updated. */
  updatedAt: Date;
  /** Arbitrary session-level metadata. */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// LLM Client interface (implemented by @agentbuilder/llm)
// ---------------------------------------------------------------------------

export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  tools?: LLMToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  stream?: boolean;
  extra?: Record<string, unknown>;
}

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'content_filter'
  | 'error';

export interface LLMResponse {
  id: string;
  model: string;
  content: ContentBlock[];
  stopReason: StopReason;
  usage: TokenUsage;
  latencyMs: number;
  raw?: unknown;
}

export type LLMStreamEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'error';

export interface LLMStreamChunk {
  type: LLMStreamEventType;
  index?: number;
  textDelta?: string;
  toolUseDelta?: string;
  toolUse?: { id: string; name: string };
  usage?: Partial<TokenUsage>;
  stopReason?: StopReason;
  error?: { type: string; message: string };
}

/** Minimal LLM client contract the engine requires. */
export interface LLMClient {
  /** Send a request and get a complete response. */
  complete(request: LLMRequest): Promise<LLMResponse>;
  /** Send a request and stream back chunks. */
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}

// ---------------------------------------------------------------------------
// Tool Dispatcher interface (implemented by @agentbuilder/tools)
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  error?: string;
  success: boolean;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category?: string;
  timeoutMs?: number;
  requiresApproval?: boolean;
  hasSideEffects?: boolean;
}

/** Minimal tool dispatcher contract the engine requires. */
export interface ToolDispatcher {
  /** Execute a single tool call. */
  dispatch(call: ToolCall, context?: ToolExecutionContext): Promise<ToolResult>;
  /** Get definitions of registered tools, optionally filtered by names. */
  getDefinitions(names?: string[]): ToolDefinition[];
  /** Check if a tool is registered. */
  has(name: string): boolean;
}

export interface ToolExecutionContext {
  agentId?: string;
  sessionId?: string;
  workflowExecutionId?: string;
  abortSignal?: AbortSignal;
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Memory Manager interface (implemented by @agentbuilder/memory)
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  agentId: string;
  metadata: MemoryMetadata;
  timestamp: Date;
  lastAccessedAt?: Date;
  accessCount: number;
}

export interface MemoryMetadata {
  source: string;
  sessionId?: string;
  tags: string[];
  importance: number;
  extra?: Record<string, unknown>;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

export interface MemorySearchOptions {
  topK: number;
  minScore?: number;
  agentId?: string;
  source?: string;
  tags?: string[];
  after?: Date;
  before?: Date;
}

export interface Episode {
  id: string;
  agentId: string;
  sessionId: string;
  summary: string;
  messages: Message[];
  outcome: 'success' | 'failure' | 'partial' | 'abandoned' | 'error';
  toolsUsed: string[];
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  totalTokens: number;
  metadata?: Record<string, unknown>;
}

/** Minimal memory manager contract the engine requires. */
export interface MemoryManager {
  /** Search long-term memory by text query. */
  search(query: string, options: MemorySearchOptions): Promise<MemorySearchResult[]>;
  /** Store a new memory entry. */
  store(entry: Omit<MemoryEntry, 'id' | 'timestamp' | 'accessCount'>): Promise<MemoryEntry>;
  /** Retrieve recent episodes for an agent. */
  getRecentEpisodes(agentId: string, limit: number): Promise<Episode[]>;
  /** Save an episode. */
  saveEpisode(episode: Omit<Episode, 'id'>): Promise<Episode>;
  /** Get conversation history for a session. */
  getConversationHistory(sessionId: string, limit?: number): Promise<Message[]>;
  /** Store a conversation message. */
  storeMessage(sessionId: string, message: Message): Promise<void>;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/** Minimal structured logger interface. */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Agent Events — the primary output stream of the orchestration engine
// ---------------------------------------------------------------------------

/** All event types emitted by the agent during execution. */
export type AgentEventType =
  | 'run_start'
  | 'thinking'
  | 'text_delta'
  | 'text_done'
  | 'tool_call_start'
  | 'tool_call_done'
  | 'tool_result'
  | 'memory_retrieved'
  | 'guardrail_triggered'
  | 'plan_created'
  | 'plan_step_start'
  | 'plan_step_done'
  | 'handoff'
  | 'error'
  | 'usage_update'
  | 'run_done';

/** An event emitted during agent execution. */
export interface AgentEvent {
  /** Type discriminator. */
  type: AgentEventType;
  /** ISO timestamp of the event. */
  timestamp: string;
  /** Event payload — structure depends on type. */
  data: AgentEventData;
}

/** Union of all possible event data payloads. */
export type AgentEventData =
  | RunStartData
  | ThinkingData
  | TextDeltaData
  | TextDoneData
  | ToolCallStartData
  | ToolCallDoneData
  | ToolResultData
  | MemoryRetrievedData
  | GuardrailTriggeredData
  | PlanCreatedData
  | PlanStepStartData
  | PlanStepDoneData
  | HandoffData
  | ErrorData
  | UsageUpdateData
  | RunDoneData;

export interface RunStartData {
  sessionId: string;
  agentId: string;
  pattern: string;
}

export interface ThinkingData {
  thought: string;
  turnNumber: number;
}

export interface TextDeltaData {
  delta: string;
}

export interface TextDoneData {
  fullText: string;
}

export interface ToolCallStartData {
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallDoneData {
  toolCallId: string;
  toolName: string;
  durationMs: number;
}

export interface ToolResultData {
  toolCallId: string;
  toolName: string;
  output: string;
  error?: string;
  success: boolean;
  durationMs: number;
}

export interface MemoryRetrievedData {
  entries: Array<{ id: string; content: string; score: number }>;
  query: string;
}

export interface GuardrailTriggeredData {
  ruleId: string;
  ruleName: string;
  action: 'block' | 'warn' | 'redact';
  detail: string;
  direction: 'input' | 'output';
}

export interface PlanCreatedData {
  steps: PlanStep[];
}

export interface PlanStep {
  index: number;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: string;
}

export interface PlanStepStartData {
  stepIndex: number;
  description: string;
}

export interface PlanStepDoneData {
  stepIndex: number;
  description: string;
  result: string;
  status: 'done' | 'failed';
}

export interface HandoffData {
  fromAgentId: string;
  toAgentId: string;
  reason: string;
}

export interface ErrorData {
  code: string;
  message: string;
  recoverable: boolean;
  detail?: unknown;
}

export interface UsageUpdateData {
  usage: TokenUsage;
  cumulativeUsage: TokenUsage;
}

export interface RunDoneData {
  finalResponse: string;
  totalTokens: TokenUsage;
  totalDurationMs: number;
  turnsUsed: number;
  toolCallsCount: number;
}

// ---------------------------------------------------------------------------
// Agent Pattern interface
// ---------------------------------------------------------------------------

/** Context provided to a pattern during execution. */
export interface AgentContext {
  config: AgentConfig;
  session: Session;
  conversationHistory: Message[];
  relevantMemory: MemoryEntry[];
  tokenBudget: number;
}

/** Bundled service dependencies injected into patterns. */
export interface AgentServices {
  llm: LLMClient;
  tools: ToolDispatcher;
  memory: MemoryManager;
  promptBuilder: PromptBuilder;
  guardrails: GuardrailsEngine;
  logger: Logger;
}

/** Forward declaration — the full implementation is in prompt-builder.ts */
export interface PromptBuilder {
  build(
    config: AgentConfig,
    context: AgentContext,
    tools: ToolDefinition[],
  ): BuiltPrompt;
}

export interface BuiltPrompt {
  systemMessage: Message;
  messages: Message[];
  tools: LLMToolDefinition[];
  tokenEstimate: number;
}

/** Forward declaration — the full implementation is in guardrails.ts */
export interface GuardrailsEngine {
  validateInput(message: Message, rules: GuardrailRule[]): ValidationResult;
  validateOutput(response: string, rules: GuardrailRule[]): ValidationResult;
}

export interface ValidationResult {
  passed: boolean;
  violations: ValidationViolation[];
}

export interface ValidationViolation {
  ruleId: string;
  ruleName: string;
  action: 'block' | 'warn' | 'redact';
  detail: string;
}

/**
 * The contract every agent execution pattern must implement.
 *
 * Patterns encapsulate a specific agent architecture (ReAct, Plan-and-Execute,
 * Multi-Agent, RAG, Tool-Augmented). The orchestrator selects the correct
 * pattern based on AgentConfig.pattern and delegates execution to it.
 */
export interface AgentPattern {
  /** Unique identifier matching AgentPatternType from core. */
  readonly patternId: string;
  /** Human-readable name for display. */
  readonly displayName: string;
  /** Description of what this pattern does and when to use it. */
  readonly description: string;

  /**
   * Execute the pattern for a user message.
   *
   * @param input - The user message to process.
   * @param context - Assembled agent context (history, memory, budget).
   * @param services - Injected service dependencies.
   * @yields AgentEvent — a stream of events for real-time UI updates.
   */
  execute(
    input: Message,
    context: AgentContext,
    services: AgentServices,
  ): AsyncIterable<AgentEvent>;
}
