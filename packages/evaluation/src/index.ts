/**
 * @agentbuilder/evaluation — agent evaluation and benchmarking framework.
 *
 * Provides a complete evaluation system for testing agent behavior:
 * - Test case running with assertion evaluation
 * - Accuracy, latency, cost, and tool usage metrics
 * - Console, JSON, and HTML reporting
 * - A/B comparison between agent configurations
 * - Dataset loading from JSONL, JSON, and CSV files
 */

// Types
export type {
  AgentEvent,
  AgentRunFunction,
  Assertion,
  TestCase,
  AssertionResult,
  TranscriptEntry,
  EvalResult,
  EvalRunnerOptions,
  RunOptions,
  TestCaseComparison,
  MetricsComparison,
  ComparisonReport,
} from './types.js';

// Runner
export { EvalRunner } from './runner.js';

// Metrics — Accuracy
export {
  exactMatch,
  exactMatchIgnoreCase,
  containsMatch,
  containsMatchIgnoreCase,
  levenshteinDistance,
  levenshteinSimilarity,
  fuzzyMatch,
  semanticSimilarity,
  regexMatch,
} from './metrics/accuracy.js';

// Metrics — Latency
export {
  measureLatency,
  measureIterableLatency,
  computeLatencyStats,
  percentile,
  computeFirstTokenStats,
} from './metrics/latency.js';
export type {
  LatencyMeasurement,
  LatencyStats,
} from './metrics/latency.js';

// Metrics — Cost
export {
  estimateCost,
  getModelPricing,
  hasPricing,
  computeCostStats,
  formatCost,
} from './metrics/cost.js';
export type { CostStats } from './metrics/cost.js';

// Metrics — Tool Usage
export {
  toolCallAccuracy,
  toolCallPrecision,
  toolCallF1,
  toolCallOrder,
  toolCallOrderScore,
  unnecessaryToolCalls,
  missingToolCalls,
  toolCallCounts,
} from './metrics/tool-usage.js';

// Reporters
export { ConsoleReporter } from './reporters/console.js';
export type { ConsoleReporterOptions } from './reporters/console.js';

export { JSONReporter } from './reporters/json.js';
export type { JSONReporterOptions, JSONReport } from './reporters/json.js';

export { HTMLReporter } from './reporters/html.js';
export type { HTMLReporterOptions } from './reporters/html.js';

// Dataset
export {
  loadFromJSONL,
  loadFromJSON,
  loadFromCSV,
  validateTestCases,
} from './dataset.js';
export type { DatasetValidationResult } from './dataset.js';

// Comparator
export { compareResults, pairedTTest } from './comparator.js';
