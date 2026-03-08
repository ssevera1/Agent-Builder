/**
 * Evaluation and testing type definitions.
 * Used for benchmarking agent quality, comparing configurations, and
 * running automated test suites.
 */

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

/** A single test case for evaluating an agent. */
export interface TestCase {
  /** Unique identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this test validates. */
  description?: string;
  /** The user input / prompt. */
  input: string;
  /** Expected output for comparison (substring, regex, or exact). */
  expectedOutput?: string;
  /** Expected tool calls the agent should make (by tool name). */
  expectedToolCalls?: string[];
  /** Maximum acceptable latency in milliseconds. */
  maxLatencyMs?: number;
  /** Maximum acceptable token usage. */
  maxTokens?: number;
  /** Tags for filtering and categorization. */
  tags?: string[];
  /** Assertions to evaluate against the response. */
  assertions?: Assertion[];
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** Types of assertions that can be applied to agent output. */
export type AssertionType =
  | 'contains'
  | 'not_contains'
  | 'regex'
  | 'exact'
  | 'json_path'
  | 'semantic_similarity'
  | 'tool_called'
  | 'tool_not_called'
  | 'latency_under'
  | 'token_usage_under'
  | 'custom';

/** An assertion to evaluate against an agent's response. */
export interface Assertion {
  /** Type of assertion. */
  type: AssertionType;
  /** The value to check against (interpretation depends on type). */
  value: string;
  /** Weight of this assertion in overall scoring (0.0 - 1.0). Default 1.0. */
  weight?: number;
  /** Optional description for reporting. */
  description?: string;
}

/** Result of evaluating a single assertion. */
export interface AssertionResult {
  /** The assertion that was evaluated. */
  assertion: Assertion;
  /** Whether the assertion passed. */
  passed: boolean;
  /** Actual value observed. */
  actualValue?: string;
  /** Score for graded assertions (0.0 - 1.0). */
  score: number;
  /** Human-readable explanation of the result. */
  message: string;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** A named evaluation metric. */
export interface EvalMetric {
  /** Metric name (e.g., 'accuracy', 'latency_p50', 'tool_accuracy'). */
  name: string;
  /** Metric value. */
  value: number;
  /** Unit of measurement (e.g., 'ms', 'tokens', 'ratio'). */
  unit: string;
  /** Whether higher is better. */
  higherIsBetter: boolean;
}

// ---------------------------------------------------------------------------
// Evaluation Results
// ---------------------------------------------------------------------------

/** Result of running a single test case. */
export interface EvalResult {
  /** Test case ID. */
  testCaseId: string;
  /** Test case name. */
  testCaseName: string;
  /** Whether all required assertions passed. */
  passed: boolean;
  /** Overall score (0.0 - 1.0). */
  score: number;
  /** The agent's actual output. */
  actualOutput: string;
  /** Individual assertion results. */
  assertionResults: AssertionResult[];
  /** Metrics collected during the run. */
  metrics: EvalMetric[];
  /** Latency in milliseconds. */
  latencyMs: number;
  /** Total tokens consumed. */
  totalTokens: number;
  /** Error if the test case execution itself failed. */
  error?: string;
  /** When this evaluation was run. */
  timestamp: Date;
}

/** Summary of a full evaluation run (multiple test cases). */
export interface EvalRunSummary {
  /** Unique run ID. */
  id: string;
  /** Agent configuration ID that was evaluated. */
  agentConfigId: string;
  /** Total number of test cases executed. */
  totalTestCases: number;
  /** Number that passed. */
  passedCount: number;
  /** Number that failed. */
  failedCount: number;
  /** Number that errored (execution failure, not assertion failure). */
  errorCount: number;
  /** Overall pass rate (0.0 - 1.0). */
  passRate: number;
  /** Average score across all test cases. */
  averageScore: number;
  /** Aggregated metrics. */
  metrics: EvalMetric[];
  /** Individual results. */
  results: EvalResult[];
  /** When the run started. */
  startedAt: Date;
  /** When the run finished. */
  completedAt: Date;
  /** Total duration in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Comparison of two evaluation runs (e.g., before and after a change). */
export interface ComparisonReport {
  /** Unique report ID. */
  id: string;
  /** The baseline run. */
  baselineRunId: string;
  /** The candidate run being compared. */
  candidateRunId: string;
  /** Per-metric comparison. */
  metricComparisons: MetricComparison[];
  /** Per-test-case comparison. */
  testCaseComparisons: TestCaseComparison[];
  /** Overall summary / verdict. */
  summary: ComparisonSummary;
  /** When this report was generated. */
  generatedAt: Date;
}

/** Comparison of a single metric between two runs. */
export interface MetricComparison {
  /** Metric name. */
  metricName: string;
  /** Baseline value. */
  baselineValue: number;
  /** Candidate value. */
  candidateValue: number;
  /** Absolute change (candidate - baseline). */
  absoluteChange: number;
  /** Relative change as a ratio. */
  relativeChange: number;
  /** Whether the change is an improvement. */
  improved: boolean;
  /** Whether the change is statistically significant (if applicable). */
  significant?: boolean;
}

/** Comparison of a single test case between two runs. */
export interface TestCaseComparison {
  /** Test case ID. */
  testCaseId: string;
  /** Test case name. */
  testCaseName: string;
  /** Whether the baseline passed. */
  baselinePassed: boolean;
  /** Whether the candidate passed. */
  candidatePassed: boolean;
  /** Baseline score. */
  baselineScore: number;
  /** Candidate score. */
  candidateScore: number;
  /** Classification of the change. */
  change: 'improved' | 'regressed' | 'unchanged' | 'new' | 'removed';
}

/** High-level summary of a comparison. */
export interface ComparisonSummary {
  /** Overall verdict. */
  verdict: 'better' | 'worse' | 'neutral';
  /** Human-readable summary. */
  description: string;
  /** Number of improved test cases. */
  improvedCount: number;
  /** Number of regressed test cases. */
  regressedCount: number;
  /** Number of unchanged test cases. */
  unchangedCount: number;
}
