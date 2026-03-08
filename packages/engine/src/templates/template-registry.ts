/**
 * TemplateRegistry — manages agent blueprint registrations.
 *
 * Agent blueprints are pre-configured agent archetypes (e.g., Research Agent,
 * Coding Agent) that provide sensible defaults for quick agent creation.
 */

import type { AgentBlueprint } from '@agentbuilder/core';

// ---------------------------------------------------------------------------
// TemplateRegistry
// ---------------------------------------------------------------------------

export class TemplateRegistry {
  private readonly templates = new Map<string, AgentBlueprint>();

  /**
   * Register an agent blueprint. Overwrites any existing blueprint with
   * the same ID.
   *
   * @param blueprint - The agent blueprint to register.
   */
  register(blueprint: AgentBlueprint): void {
    this.templates.set(blueprint.id, blueprint);
  }

  /**
   * Get a registered blueprint by ID.
   *
   * @param id - The blueprint identifier.
   * @returns The blueprint.
   * @throws Error if the blueprint is not registered.
   */
  get(id: string): AgentBlueprint {
    const blueprint = this.templates.get(id);
    if (!blueprint) {
      const available = this.list()
        .map((b) => b.id)
        .join(', ');
      throw new Error(
        `Unknown agent blueprint "${id}". Available blueprints: ${available || 'none'}`,
      );
    }
    return blueprint;
  }

  /**
   * Check if a blueprint is registered.
   *
   * @param id - The blueprint identifier.
   * @returns True if the blueprint exists.
   */
  has(id: string): boolean {
    return this.templates.has(id);
  }

  /**
   * List all registered blueprints.
   *
   * @returns An array of all registered blueprints.
   */
  list(): AgentBlueprint[] {
    return Array.from(this.templates.values());
  }

  /**
   * List blueprints filtered by category.
   *
   * @param category - The category to filter by.
   * @returns Blueprints in the given category.
   */
  listByCategory(category: string): AgentBlueprint[] {
    return this.list().filter((b) => b.category === category);
  }

  /**
   * Remove a registered blueprint.
   *
   * @param id - The blueprint identifier to remove.
   * @returns True if the blueprint was removed, false if not found.
   */
  remove(id: string): boolean {
    return this.templates.delete(id);
  }

  /**
   * Get the count of registered blueprints.
   */
  get size(): number {
    return this.templates.size;
  }
}
