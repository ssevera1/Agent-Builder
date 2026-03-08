/**
 * PluginLoader — dynamically loads tool plugins from file paths or npm
 * packages, validates them, and aggregates their tools.
 */

import type { ToolPlugin } from './plugin.interface.js';
import type { RegisteredTool } from '../registry.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an object satisfies the ToolPlugin interface.
 * Returns an array of validation error messages (empty = valid).
 */
export function validatePlugin(candidate: unknown): string[] {
  const errors: string[] = [];

  if (candidate === null || typeof candidate !== 'object') {
    return ['Plugin must be a non-null object.'];
  }

  const obj = candidate as Record<string, unknown>;

  if (typeof obj['pluginId'] !== 'string' || obj['pluginId'] === '') {
    errors.push('Plugin must have a non-empty string "pluginId" property.');
  }
  if (typeof obj['version'] !== 'string' || obj['version'] === '') {
    errors.push('Plugin must have a non-empty string "version" property.');
  }
  if (typeof obj['description'] !== 'string') {
    errors.push('Plugin must have a string "description" property.');
  }
  if (typeof obj['initialize'] !== 'function') {
    errors.push('Plugin must have an "initialize" method.');
  }
  if (typeof obj['getTools'] !== 'function') {
    errors.push('Plugin must have a "getTools" method.');
  }
  if (typeof obj['shutdown'] !== 'function') {
    errors.push('Plugin must have a "shutdown" method.');
  }

  return errors;
}

// ---------------------------------------------------------------------------
// PluginLoader
// ---------------------------------------------------------------------------

export class PluginLoader {
  private readonly plugins = new Map<string, ToolPlugin>();

  /**
   * Dynamically import a plugin from a file path.
   *
   * The module must export either a default export or a named `plugin`
   * export that implements the ToolPlugin interface.
   *
   * @param modulePath — Absolute or relative path (or file:// URL) to the
   *   plugin module. Must be resolvable by dynamic `import()`.
   * @param config — Configuration to pass to `plugin.initialize()`.
   */
  async loadFromPath(
    modulePath: string,
    config: Record<string, unknown> = {},
  ): Promise<ToolPlugin> {
    // Normalise to a file URL on Windows / POSIX.
    const importPath = modulePath.startsWith('file://')
      ? modulePath
      : modulePath;

    const mod = (await import(importPath)) as Record<string, unknown>;
    const plugin = extractPlugin(mod);

    const validationErrors = validatePlugin(plugin);
    if (validationErrors.length > 0) {
      throw new Error(
        `Invalid plugin at "${modulePath}":\n  - ${validationErrors.join('\n  - ')}`,
      );
    }

    const typedPlugin = plugin as ToolPlugin;
    await typedPlugin.initialize(config);
    this.plugins.set(typedPlugin.pluginId, typedPlugin);
    return typedPlugin;
  }

  /**
   * Load a plugin from an installed npm package.
   *
   * The package must export a default export or a named `plugin` export
   * that implements the ToolPlugin interface.
   *
   * @param packageName — The npm package name (e.g., "@myorg/my-tool-plugin").
   * @param config — Configuration to pass to `plugin.initialize()`.
   */
  async loadFromNpm(
    packageName: string,
    config: Record<string, unknown> = {},
  ): Promise<ToolPlugin> {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(packageName)) as Record<string, unknown>;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to import npm package "${packageName}": ${message}. ` +
          'Make sure it is installed.',
      );
    }

    const plugin = extractPlugin(mod);
    const validationErrors = validatePlugin(plugin);
    if (validationErrors.length > 0) {
      throw new Error(
        `Invalid plugin in package "${packageName}":\n  - ${validationErrors.join('\n  - ')}`,
      );
    }

    const typedPlugin = plugin as ToolPlugin;
    await typedPlugin.initialize(config);
    this.plugins.set(typedPlugin.pluginId, typedPlugin);
    return typedPlugin;
  }

  /**
   * Return all tools from all loaded plugins, aggregated into a flat list.
   */
  getAllPluginTools(): RegisteredTool[] {
    const tools: RegisteredTool[] = [];
    for (const plugin of this.plugins.values()) {
      tools.push(...plugin.getTools());
    }
    return tools;
  }

  /**
   * Get a loaded plugin by its ID.
   */
  getPlugin(pluginId: string): ToolPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * List all loaded plugins.
   */
  listPlugins(): ToolPlugin[] {
    return [...this.plugins.values()];
  }

  /**
   * Shut down and remove a plugin by ID.
   */
  async unloadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    await plugin.shutdown();
    this.plugins.delete(pluginId);
    return true;
  }

  /**
   * Shut down all loaded plugins.
   */
  async shutdownAll(): Promise<void> {
    const shutdowns = [...this.plugins.values()].map((p) =>
      p.shutdown().catch(() => {
        // Swallow individual shutdown errors to ensure all plugins are attempted.
      }),
    );
    await Promise.all(shutdowns);
    this.plugins.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the plugin object from a dynamically imported module.
 * Looks for `default` export first, then `plugin` named export.
 */
function extractPlugin(mod: Record<string, unknown>): unknown {
  if (mod['default'] !== undefined) {
    return mod['default'];
  }
  if (mod['plugin'] !== undefined) {
    return mod['plugin'];
  }
  throw new Error(
    'Plugin module must export a default export or a named "plugin" export.',
  );
}
