/**
 * Tool system type definitions.
 */

/**
 * Categories for organizing tools.
 */
export enum ToolCategory {
  /** File system operations (read, write, list). */
  FileSystem = 'filesystem',
  /** Web and HTTP operations (fetch, scrape, API calls). */
  Web = 'web',
  /** Code execution and analysis. */
  Code = 'code',
  /** Data processing and transformation. */
  Data = 'data',
  /** Database operations. */
  Database = 'database',
  /** Communication (email, chat, notifications). */
  Communication = 'communication',
  /** Search (web search, vector search). */
  Search = 'search',
  /** Math and computation. */
  Math = 'math',
  /** Image and media processing. */
  Media = 'media',
  /** System and environment utilities. */
  System = 'system',
  /** Custom / user-defined tools. */
  Custom = 'custom',
}

/**
 * Definition of a tool that an agent can invoke.
 */
export interface ToolDefinition {
  /** Unique tool identifier. */
  name: string;
  /** Human-readable description shown to the model. */
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** Category for UI grouping and discovery. */
  category: ToolCategory;
  /** Maximum execution time in milliseconds before the tool is killed. */
  timeoutMs: number;
  /** Whether the tool requires explicit user approval before execution. */
  requiresApproval: boolean;
  /** Whether the tool performs side-effects (writes, sends, etc.). */
  hasSideEffects: boolean;
  /** Optional JSON Schema for the tool's output. */
  outputSchema?: Record<string, unknown>;
  /** Semantic version of the tool. */
  version?: string;
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * A request from the model to invoke a tool.
 */
export interface ToolCall {
  /** Unique ID assigned by the model for correlating results. */
  id: string;
  /** Name of the tool to invoke. */
  name: string;
  /** Parameters to pass to the tool (matches inputSchema). */
  parameters: Record<string, unknown>;
}

/**
 * The result of executing a tool call.
 */
export interface ToolResult {
  /** The tool call ID this result corresponds to. */
  toolCallId: string;
  /** The output produced by the tool (stringified for the model). */
  output: string;
  /** Error message if the tool failed. Mutually exclusive with output in practice. */
  error?: string;
  /** Whether the execution was successful. */
  success: boolean;
  /** Wall-clock execution time in milliseconds. */
  durationMs: number;
  /** Arbitrary metadata about the execution (e.g., HTTP status code). */
  metadata?: Record<string, unknown>;
}

/**
 * Interface that tool implementations must satisfy.
 * A ToolPlugin bundles a definition with its execution logic.
 */
export interface ToolPlugin {
  /** The tool's definition (schema, metadata). */
  definition: ToolDefinition;

  /**
   * Execute the tool with the given parameters.
   * @param parameters - Validated parameters matching inputSchema.
   * @param context - Optional execution context (agent ID, session ID, etc.).
   * @returns The tool output as a string.
   * @throws ToolExecutionError on failure.
   */
  execute(
    parameters: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string>;

  /**
   * Optional: validate parameters before execution.
   * Return an array of validation error messages; empty means valid.
   */
  validate?(parameters: Record<string, unknown>): string[];

  /**
   * Optional: clean up resources when the tool is unloaded.
   */
  dispose?(): Promise<void>;
}

/**
 * Context passed to tool execution for accessing runtime information.
 */
export interface ToolExecutionContext {
  /** ID of the agent invoking the tool. */
  agentId?: string;
  /** ID of the current session. */
  sessionId?: string;
  /** ID of the current workflow execution, if any. */
  workflowExecutionId?: string;
  /** Signal for cooperative cancellation. */
  abortSignal?: AbortSignal;
  /** Arbitrary context values. */
  extra?: Record<string, unknown>;
}
