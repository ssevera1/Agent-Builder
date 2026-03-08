/**
 * Core LLM type definitions shared across all providers.
 */

// ─── Message Types ───────────────────────────────────────────────────────────

/** Roles for conversation messages. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** A text content block within a message. */
export interface TextContent {
  type: 'text';
  text: string;
}

/** An image content block within a message. */
export interface ImageContent {
  type: 'image';
  /** Base64-encoded image data. */
  data: string;
  /** MIME type (e.g., 'image/png', 'image/jpeg'). */
  mimeType: string;
}

/** An image URL content block. */
export interface ImageUrlContent {
  type: 'image_url';
  url: string;
}

/** A tool-call content block (assistant requesting tool invocation). */
export interface ToolCallContent {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: string;
}

/** A tool-result content block (returning tool output). */
export interface ToolResultContent {
  type: 'tool_result';
  toolCallId: string;
  content: string;
  isError?: boolean;
}

/** Union of all possible content block types. */
export type ContentBlock =
  | TextContent
  | ImageContent
  | ImageUrlContent
  | ToolCallContent
  | ToolResultContent;

/** A single message in a conversation. */
export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

/** JSON Schema definition for a tool parameter. */
export interface ToolParameterSchema {
  type: string;
  description?: string;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
  enum?: string[];
  default?: unknown;
  [key: string]: unknown;
}

/** Definition of a tool that an LLM can invoke. */
export interface ToolDefinition {
  /** Unique name of the tool. */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  parameters: ToolParameterSchema;
}

// ─── LLM Request/Response ───────────────────────────────────────────────────

/** Configuration for an LLM completion request. */
export interface LLMRequest {
  /** Conversation messages. */
  messages: Message[];
  /** Optional system prompt (handled separately for some providers). */
  systemPrompt?: string;
  /** Sampling temperature (0.0 - 2.0). */
  temperature?: number;
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** Top-p nucleus sampling parameter. */
  topP?: number;
  /** Stop sequences that halt generation. */
  stopSequences?: string[];
  /** Available tools for the model to call. */
  tools?: ToolDefinition[];
  /** Tool choice strategy. */
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  /** Whether to enable streaming. Defaults to true. */
  stream?: boolean;
  /** Arbitrary provider-specific options. */
  providerOptions?: Record<string, unknown>;
}

/** Token usage statistics for a request. */
export interface TokenUsage {
  /** Number of input/prompt tokens consumed. */
  inputTokens: number;
  /** Number of output/completion tokens generated. */
  outputTokens: number;
  /** Total tokens (input + output). */
  totalTokens: number;
}

/** A single chunk emitted during streaming. */
export interface LLMStreamChunk {
  /** The type of this chunk. */
  type: 'text' | 'tool_call' | 'usage' | 'error' | 'done';
  /** Text delta (for type='text'). */
  text?: string;
  /** Tool call information (for type='tool_call'). */
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  /** Token usage (for type='usage'). */
  usage?: TokenUsage;
  /** Error information (for type='error'). */
  error?: {
    code: string;
    message: string;
  };
  /** Finish reason when stream completes (for type='done'). */
  finishReason?: 'stop' | 'tool_use' | 'max_tokens' | 'error';
}

// ─── Model Information ──────────────────────────────────────────────────────

/** Information about a specific model. */
export interface ModelInfo {
  /** Provider identifier. */
  providerId: string;
  /** Model identifier. */
  modelId: string;
  /** Human-readable display name. */
  displayName: string;
  /** Maximum context window size in tokens. */
  contextWindow: number;
  /** Maximum output tokens the model can generate. */
  maxOutputTokens: number;
  /** Whether the model supports tool/function calling. */
  supportsToolUse: boolean;
  /** Whether the model supports image/vision input. */
  supportsVision: boolean;
  /** Whether the model supports streaming responses. */
  supportsStreaming: boolean;
  /** Cost per million input tokens in USD. */
  inputCostPerMillion?: number;
  /** Cost per million output tokens in USD. */
  outputCostPerMillion?: number;
}

/** Information about a provider. */
export interface ProviderInfo {
  /** Provider identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of the provider. */
  description: string;
  /** Whether the provider requires an API key. */
  requiresApiKey: boolean;
  /** Environment variable name for the API key. */
  apiKeyEnvVar?: string;
  /** Whether the provider supports custom base URLs. */
  supportsCustomBaseUrl: boolean;
}
