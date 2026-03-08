/**
 * Cost metrics for evaluating agent expense.
 *
 * Provides cost estimation based on token usage and model pricing,
 * plus aggregation utilities for test suites.
 */

import type { TokenUsage } from '@agentbuilder/core';

// ─── Model Pricing ──────────────────────────────────────────────────────────

/**
 * Pricing information for a model (per million tokens, in USD).
 */
interface ModelPricing {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

/**
 * Known model pricing catalog. Prices are in USD per million tokens.
 * This catalog serves as a fallback when no pricing is provided.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-sonnet-4-20250514': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  'claude-opus-4-20250514': { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
  'claude-haiku-35-20241022': { inputCostPerMillion: 0.80, outputCostPerMillion: 4.0 },
  'claude-3-5-sonnet-20241022': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  'claude-3-haiku-20240307': { inputCostPerMillion: 0.25, outputCostPerMillion: 1.25 },
  'claude-3-opus-20240229': { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },

  // OpenAI
  'gpt-4o': { inputCostPerMillion: 2.5, outputCostPerMillion: 10.0 },
  'gpt-4o-mini': { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
  'gpt-4-turbo': { inputCostPerMillion: 10.0, outputCostPerMillion: 30.0 },
  'gpt-4': { inputCostPerMillion: 30.0, outputCostPerMillion: 60.0 },
  'gpt-3.5-turbo': { inputCostPerMillion: 0.5, outputCostPerMillion: 1.5 },
  'o1': { inputCostPerMillion: 15.0, outputCostPerMillion: 60.0 },
  'o1-mini': { inputCostPerMillion: 3.0, outputCostPerMillion: 12.0 },
  'o3-mini': { inputCostPerMillion: 1.1, outputCostPerMillion: 4.4 },

  // Google
  'gemini-2.0-flash': { inputCostPerMillion: 0.10, outputCostPerMillion: 0.40 },
  'gemini-1.5-pro': { inputCostPerMillion: 1.25, outputCostPerMillion: 5.0 },
  'gemini-1.5-flash': { inputCostPerMillion: 0.075, outputCostPerMillion: 0.30 },
};

// ─── Cost Estimation ────────────────────────────────────────────────────────

/**
 * Estimate the cost of an API call based on token usage and model ID.
 *
 * @param usage - Token usage statistics from the API call.
 * @param modelId - The model identifier for pricing lookup.
 * @param customPricing - Optional custom pricing override.
 * @returns Estimated cost in USD.
 */
export function estimateCost(
  usage: TokenUsage,
  modelId: string,
  customPricing?: ModelPricing,
): number {
  const pricing = customPricing ?? MODEL_PRICING[modelId];

  if (!pricing) {
    // Return 0 if pricing is unknown — caller can handle this
    return 0;
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputCostPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputCostPerMillion;

  return inputCost + outputCost;
}

/**
 * Get the known pricing for a model.
 *
 * @returns Pricing info, or undefined if the model is not in the catalog.
 */
export function getModelPricing(modelId: string): ModelPricing | undefined {
  return MODEL_PRICING[modelId];
}

/**
 * Check if pricing is available for a model.
 */
export function hasPricing(modelId: string): boolean {
  return modelId in MODEL_PRICING;
}

// ─── Cost Aggregation ───────────────────────────────────────────────────────

/**
 * Aggregated cost statistics for a test suite.
 */
export interface CostStats {
  /** Total cost in USD across all test cases. */
  totalCost: number;
  /** Average cost per test case in USD. */
  averageCost: number;
  /** Minimum cost of any single test case. */
  minCost: number;
  /** Maximum cost of any single test case. */
  maxCost: number;
  /** Total input tokens consumed. */
  totalInputTokens: number;
  /** Total output tokens consumed. */
  totalOutputTokens: number;
  /** Total tokens (input + output). */
  totalTokens: number;
  /** Average input tokens per test case. */
  averageInputTokens: number;
  /** Average output tokens per test case. */
  averageOutputTokens: number;
  /** Number of test cases included. */
  count: number;
}

/**
 * Compute aggregated cost statistics from individual test case costs
 * and token usage.
 *
 * @param entries - Array of { cost, usage } pairs for each test case.
 * @returns Aggregated cost statistics.
 */
export function computeCostStats(
  entries: Array<{ cost: number; usage: TokenUsage }>,
): CostStats {
  if (entries.length === 0) {
    return {
      totalCost: 0,
      averageCost: 0,
      minCost: 0,
      maxCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      averageInputTokens: 0,
      averageOutputTokens: 0,
      count: 0,
    };
  }

  let totalCost = 0;
  let minCost = Infinity;
  let maxCost = -Infinity;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const entry of entries) {
    totalCost += entry.cost;
    minCost = Math.min(minCost, entry.cost);
    maxCost = Math.max(maxCost, entry.cost);
    totalInputTokens += entry.usage.inputTokens;
    totalOutputTokens += entry.usage.outputTokens;
  }

  const count = entries.length;

  return {
    totalCost,
    averageCost: totalCost / count,
    minCost,
    maxCost,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    averageInputTokens: totalInputTokens / count,
    averageOutputTokens: totalOutputTokens / count,
    count,
  };
}

/**
 * Format a USD cost value for display.
 *
 * @param cost - Cost in USD.
 * @returns Formatted string (e.g., "$0.0023", "$1.50").
 */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
