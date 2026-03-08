/**
 * @agentbuilder/tools — tool registry, dispatcher, built-in tools, MCP
 * adapter, and plugin system.
 */

// ── Registry ──────────────────────────────────────────────────────────────
export { ToolRegistry } from './registry.js';
export type { RegisteredTool, ValidationResult } from './registry.js';

// ── Dispatcher ────────────────────────────────────────────────────────────
export { ToolDispatcher } from './dispatcher.js';
export type { DispatcherOptions } from './dispatcher.js';

// ── Built-in tools ────────────────────────────────────────────────────────
export {
  createCalculatorTool,
  evaluateExpression,
  calculatorInputSchema,
} from './builtin/calculator.js';
export type { CalculatorInput } from './builtin/calculator.js';

export {
  createFileSystemTool,
  fileSystemInputSchema,
} from './builtin/file-system.js';
export type { FileSystemInput, FileSystemToolOptions } from './builtin/file-system.js';

export {
  createHttpRequestTool,
  httpRequestInputSchema,
} from './builtin/http-request.js';
export type { HttpRequestInput, HttpRequestToolOptions } from './builtin/http-request.js';

export {
  createWebSearchTool,
  DuckDuckGoProvider,
  webSearchInputSchema,
} from './builtin/web-search.js';
export type {
  WebSearchInput,
  WebSearchToolOptions,
  SearchResult,
  SearchProvider,
} from './builtin/web-search.js';

export {
  createCodeExecutorTool,
  codeExecutorInputSchema,
} from './builtin/code-executor.js';
export type {
  CodeExecutorInput,
  CodeExecutorToolOptions,
} from './builtin/code-executor.js';

// ── MCP adapter ───────────────────────────────────────────────────────────
export {
  convertToMCPTool,
  convertFromMCPTool,
  convertAllToMCP,
  toMCPResult,
  fromMCPResult,
} from './mcp/mcp-adapter.js';
export type {
  MCPToolDefinition,
  MCPToolCall,
  MCPToolResult,
} from './mcp/mcp-adapter.js';

// ── Plugin system ─────────────────────────────────────────────────────────
export type { ToolPlugin } from './plugin/plugin.interface.js';
export { PluginLoader, validatePlugin } from './plugin/plugin-loader.js';
