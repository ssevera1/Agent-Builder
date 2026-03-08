/**
 * ToolPlugin interface — the contract that external tool plugins must
 * implement to integrate with the AgentBuilder tool system.
 */

import type { RegisteredTool } from '../registry.js';

/**
 * A plugin that provides one or more tools to the AgentBuilder platform.
 *
 * Lifecycle:
 * 1. The plugin is loaded (via dynamic import or npm package).
 * 2. `initialize(config)` is called with user-provided configuration.
 * 3. `getTools()` returns the tools the plugin provides.
 * 4. The tools are registered in the ToolRegistry and can be dispatched.
 * 5. `shutdown()` is called when the plugin is being unloaded.
 */
export interface ToolPlugin {
  /** Unique identifier for this plugin. */
  readonly pluginId: string;
  /** Semantic version of the plugin. */
  readonly version: string;
  /** Human-readable description of what this plugin provides. */
  readonly description: string;

  /**
   * Initialize the plugin with configuration values.
   * This is called once before `getTools()`.
   * Use this to set up connections, validate API keys, etc.
   */
  initialize(config: Record<string, unknown>): Promise<void>;

  /**
   * Return the tools provided by this plugin.
   * Called after `initialize()` has completed successfully.
   */
  getTools(): RegisteredTool[];

  /**
   * Clean up resources when the plugin is being unloaded.
   * Close connections, flush buffers, etc.
   */
  shutdown(): Promise<void>;
}
