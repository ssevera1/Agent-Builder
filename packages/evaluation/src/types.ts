/**
 * Shared type definitions for the evaluation package.
 */

import type { Message, TokenUsage } from '@agentbuilder/core';

// ─── Agent Function ─────────────────────────────────────────────────────────

/**
 * Events emitted by an agent during execution.
 */
export interface AgentEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done';
  text?: string;
  toolCall?: { id: string; name: string; arguments: string };
  toolResult?: { toolCallId: string; content: string; isError?: boolean };
  usage?: TokenUsage;
  error?: { code: string; message: string };
}

/**
 * A function that runs an agent on a single input and returns an async
 * iterable of events.
 */
export type AgentRunFunction = (input: Message) => AsyncIterable<AgentEvent>;

// ─── Test Cases ─────────────────────────────────────────────────────────────

/**
 * An assertion to check against the agent's output.
 */
export interface Assertion {
  /** Type of assertion. */
  type: 'exact_match' | 'contains' | 'fuzzy_match' | 'regex' | 'tool_called' | 'tool_order' | 'max_latency' | 'max_cost' | 'custom';
  /** Expected value for the assertion. */
  expected: unknown;
  /** Optional threshold for fuzzy matching (0-1). */
  threshold?: number;
  /** Optional weight for scoring (default 1). */
  weight?: number;
  /** Human-readable description. */
  description?: string;
}

/**
 * A single test case for evaluation.
 */
export interface TestCase {
  /** Unique identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The input message to send to the agent. */
  input: Message;
  /** Expected output text for comparison. */
  expectedOutput?: string;
  /** Expected tool calls. */
  expectedToolCalls?: string[];
  /** Assertions to evaluate. */
  assertions?: Assertion[];
  /** Maximum acceptable latency in ms. */
  maxLatencyMs?: number;
  /** Maximum acceptable cost in USD. */
  maxCost?: number;
  /** Tags for filtering/grouping. */
  tags?: string[];
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

// ─── Results ────────────────────────────────────────────────────────────────

/**
 * Result of a single assertion evaluation.
 */
export interface AssertionResult {
  /** The original assertion. */
  assertion: Assertion;
  /** Whether the assertion passed. */
  passed: boolean;
  /** Actual value observed. */
  actual?: unknown;
  /** Score between 0 and 1. */
  score: number;
  /** Human-readable explanation. */
  message: string;
}

/**
 * Transcript entry recording a step in the agent's execution.
 */
export interface TranscriptEntry {
  /** Role in the conversation. */
  role: 'user' | 'assistant' | 'tool';
  /** Content of the message. */
  content: string;
  /** Tool call name if this is a tool call step. */
  toolName?: string;
  /** Timestamp of this entry. */
  timestamp: Date;
}

/**
 * Result of running a single test case.
 */
export interface EvalResult {
  /** The test case that was evaluated. */
  testCase: TestCase;
  /** Whether all assertions passed. */
  passed: boolean;
  /** Overall score (0-1). */
  score: number;
  /** Individual assertion results. */
  assertionResults: AssertionResult[];
  /** The agent's output text. */
  output: string;
  /** Tool calls made by the agent. */
  toolCalls: string[];
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Time to first token in milliseconds. */
  firstTokenMs?: number;
  /** Token usage statistics. */
  tokenUsage?: TokenUsage;
  /** Estimated cost in USD. */
  costUsd?: number;
  /** Full conversation transcript. */
  transcript: TranscriptEntry[];
  /** Error if the test case failed to execute. */
  error?: string;
  /** When this evaluation was run. */
  evaluatedAt: Date;
}

// ─── Runner Options ─────────────────────────────────────────────────────────

/**
 * Options for the EvalRunner.
 */
export interface EvalRunnerOptions {
  /** Maximum concurrency for running test cases. */
  maxConcurrency?: number;
  /** Whether to continue running after a test case fails. */
  continueOnError?: boolean;
  /** Model ID for cost estimation. */
  modelId?: string;
  /** Timeout per test case in ms. */
  timeoutMs?: number;
}

/**
 * Options for a single evaluation run.
 */
export interface RunOptions {
  /** Filter test cases by tags. */
  tags?: string[];
  /** Maximum number of test cases to run. */
  limit?: number;
  /** Shuffle test case order. */
  shuffle?: boolean;
  /** Override model ID for cost estimation. */
  modelId?: string;
}

// ─── Comparison ─────────────────────────────────────────────────────────────

/**
 * Side-by-side comparison of a single test case between two configs.
 */
export interface TestCaseComparison {
  testCase: TestCase;
  resultA: EvalResult;
  resultB: EvalResult;
  winner: 'A' | 'B' | 'tie';
  improvements: string[];
  regressions: string[];
}

/**
 * Comparison of overall metrics between two configs.
 */
export interface MetricsComparison {
  metric: string;
  valueA: number;
  valueB: number;
  difference: number;
  percentChange: number;
  winner: 'A' | 'B' | 'tie';
  significant: boolean;
}

/**
 * Complete comparison report between two agent configurations.
 */
export interface ComparisonReport {
  /** Summary of which config is better overall. */
  summary: {
    overallWinner: 'A' | 'B' | 'tie';
    confidence: number;
    totalTests: number;
    winsA: number;
    winsB: number;
    ties: number;
  };
  /** Metrics comparison (accuracy, latency, cost). */
  metrics: MetricsComparison[];
  /** Per-test-case comparisons. */
  testCases: TestCaseComparison[];
  /** When the comparison was generated. */
  generatedAt: Date;
}
