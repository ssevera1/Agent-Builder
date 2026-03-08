/**
 * PatternRegistry — manages agent execution pattern registrations.
 *
 * Provides a central registry for all available AgentPattern implementations.
 * Built-in patterns (ReAct, Plan-and-Execute, Multi-Agent, RAG,
 * Tool-Augmented) are auto-registered on construction.
 */

import type { AgentPattern } from './patterns/pattern.interface.js';
import { ReActPattern } from './patterns/react.js';
import { PlanAndExecutePattern } from './patterns/plan-and-execute.js';
import { MultiAgentPattern } from './patterns/multi-agent.js';
import { RAGPattern } from './patterns/rag.js';
import { ToolAugmentedPattern } from './patterns/tool-augmented.js';

// ---------------------------------------------------------------------------
// PatternRegistry
// ---------------------------------------------------------------------------

export class PatternRegistry {
  private readonly patterns = new Map<string, AgentPattern>();

  constructor() {
    // Auto-register all built-in patterns
    this.registerBuiltins();
  }

  /**
   * Register a pattern. Overwrites any existing pattern with the same ID.
   *
   * @param pattern - The pattern to register.
   */
  register(pattern: AgentPattern): void {
    this.patterns.set(pattern.patternId, pattern);
  }

  /**
   * Get a registered pattern by ID.
   *
   * @param patternId - The pattern identifier (e.g., 'react').
   * @returns The pattern, or undefined if not found.
   * @throws Error if the pattern is not registered.
   */
  get(patternId: string): AgentPattern {
    const pattern = this.patterns.get(patternId);
    if (!pattern) {
      const available = this.list()
        .map((p) => p.patternId)
        .join(', ');
      throw new Error(
        `Unknown pattern "${patternId}". Available patterns: ${available}`,
      );
    }
    return pattern;
  }

  /**
   * Check if a pattern is registered.
   *
   * @param patternId - The pattern identifier.
   * @returns True if the pattern exists.
   */
  has(patternId: string): boolean {
    return this.patterns.has(patternId);
  }

  /**
   * List all registered patterns.
   *
   * @returns An array of all registered patterns.
   */
  list(): AgentPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Remove a registered pattern.
   *
   * @param patternId - The pattern identifier to remove.
   * @returns True if the pattern was removed, false if it was not found.
   */
  remove(patternId: string): boolean {
    return this.patterns.delete(patternId);
  }

  /**
   * Get the count of registered patterns.
   */
  get size(): number {
    return this.patterns.size;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Register all built-in patterns.
   */
  private registerBuiltins(): void {
    this.register(new ReActPattern());
    this.register(new PlanAndExecutePattern());
    this.register(new MultiAgentPattern());
    this.register(new RAGPattern());
    this.register(new ToolAugmentedPattern());
  }
}
