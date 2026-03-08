/**
 * JSON reporter — outputs evaluation results as structured JSON
 * for machine consumption and CI integration.
 */

import type { EvalResult, ComparisonReport } from '../types.js';
import { computeLatencyStats } from '../metrics/latency.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Options for the JSON reporter.
 */
export interface JSONReporterOptions {
  /** Whether to pretty-print the JSON output. Defaults to true. */
  pretty?: boolean;
  /** Include full conversation transcripts. Defaults to true. */
  includeTranscripts?: boolean;
  /** Include raw assertion details. Defaults to true. */
  includeAssertions?: boolean;
}

/**
 * The structured JSON output format.
 */
export interface JSONReport {
  /** Report metadata. */
  metadata: {
    generatedAt: string;
    totalTests: number;
    duration: string;
  };
  /** Summary statistics. */
  summary: {
    passed: number;
    failed: number;
    passRate: number;
    averageScore: number;
    latency: {
      mean: number;
      median: number;
      p90: number;
      p95: number;
      p99: number;
      min: number;
      max: number;
      stdDev: number;
    };
    cost: {
      total: number;
      average: number;
      min: number;
      max: number;
    };
    tokens: {
      totalInput: number;
      totalOutput: number;
      total: number;
    };
  };
  /** Per-test results. */
  results: JSONTestResult[];
}

interface JSONTestResult {
  id: string;
  name: string;
  passed: boolean;
  score: number;
  durationMs: number;
  firstTokenMs?: number;
  costUsd?: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  output: string;
  toolCalls: string[];
  error?: string;
  assertions?: Array<{
    type: string;
    description?: string;
    passed: boolean;
    score: number;
    message: string;
    expected?: unknown;
    actual?: unknown;
  }>;
  transcript?: Array<{
    role: string;
    content: string;
    toolName?: string;
    timestamp: string;
  }>;
  tags?: string[];
  evaluatedAt: string;
}

// ─── JSON Reporter ─────────────────────────────────────────────────────────

export class JSONReporter {
  private readonly opts: JSONReporterOptions;

  constructor(options?: JSONReporterOptions) {
    this.opts = {
      pretty: true,
      includeTranscripts: true,
      includeAssertions: true,
      ...options,
    };
  }

  /**
   * Format evaluation results as a JSON string.
   */
  report(results: EvalResult[]): string {
    const jsonReport = this.buildReport(results);
    return this.opts.pretty
      ? JSON.stringify(jsonReport, null, 2)
      : JSON.stringify(jsonReport);
  }

  /**
   * Build the structured report object.
   */
  buildReport(results: EvalResult[]): JSONReport {
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? passed / total : 0;
    const avgScore = total > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / total
      : 0;

    // Latency stats
    const latencies = results.map((r) => r.durationMs);
    const latencyStats = computeLatencyStats(latencies);

    // Cost stats
    const costs = results.map((r) => r.costUsd ?? 0);
    const totalCost = costs.reduce((sum, c) => sum + c, 0);
    const avgCost = total > 0 ? totalCost / total : 0;
    const minCost = costs.length > 0 ? Math.min(...costs) : 0;
    const maxCost = costs.length > 0 ? Math.max(...costs) : 0;

    // Token stats
    let totalInput = 0;
    let totalOutput = 0;
    for (const r of results) {
      if (r.tokenUsage) {
        totalInput += r.tokenUsage.inputTokens;
        totalOutput += r.tokenUsage.outputTokens;
      }
    }

    // Duration
    const earliest = results.length > 0
      ? Math.min(...results.map((r) => r.evaluatedAt.getTime()))
      : Date.now();
    const latest = results.length > 0
      ? Math.max(...results.map((r) => r.evaluatedAt.getTime() + r.durationMs))
      : Date.now();

    return {
      metadata: {
        generatedAt: new Date().toISOString(),
        totalTests: total,
        duration: `${((latest - earliest) / 1000).toFixed(1)}s`,
      },
      summary: {
        passed,
        failed,
        passRate,
        averageScore: avgScore,
        latency: {
          mean: latencyStats.mean,
          median: latencyStats.median,
          p90: latencyStats.p90,
          p95: latencyStats.p95,
          p99: latencyStats.p99,
          min: latencyStats.min,
          max: latencyStats.max,
          stdDev: latencyStats.stdDev,
        },
        cost: {
          total: totalCost,
          average: avgCost,
          min: minCost,
          max: maxCost,
        },
        tokens: {
          totalInput,
          totalOutput,
          total: totalInput + totalOutput,
        },
      },
      results: results.map((r) => this.formatResult(r)),
    };
  }

  /**
   * Format a comparison report as JSON.
   */
  reportComparison(report: ComparisonReport): string {
    const output = {
      ...report,
      generatedAt: report.generatedAt.toISOString(),
      testCases: report.testCases.map((tc) => ({
        testCaseId: tc.testCase.id,
        testCaseName: tc.testCase.name,
        winner: tc.winner,
        improvements: tc.improvements,
        regressions: tc.regressions,
        resultA: this.formatResult(tc.resultA),
        resultB: this.formatResult(tc.resultB),
      })),
    };

    return this.opts.pretty
      ? JSON.stringify(output, null, 2)
      : JSON.stringify(output);
  }

  private formatResult(result: EvalResult): JSONTestResult {
    const out: JSONTestResult = {
      id: result.testCase.id,
      name: result.testCase.name,
      passed: result.passed,
      score: result.score,
      durationMs: result.durationMs,
      firstTokenMs: result.firstTokenMs,
      costUsd: result.costUsd,
      tokenUsage: result.tokenUsage
        ? {
            inputTokens: result.tokenUsage.inputTokens,
            outputTokens: result.tokenUsage.outputTokens,
            totalTokens: result.tokenUsage.totalTokens,
          }
        : undefined,
      output: result.output,
      toolCalls: result.toolCalls,
      error: result.error,
      tags: result.testCase.tags,
      evaluatedAt: result.evaluatedAt.toISOString(),
    };

    if (this.opts.includeAssertions) {
      out.assertions = result.assertionResults.map((ar) => ({
        type: ar.assertion.type,
        description: ar.assertion.description,
        passed: ar.passed,
        score: ar.score,
        message: ar.message,
        expected: ar.assertion.expected,
        actual: ar.actual,
      }));
    }

    if (this.opts.includeTranscripts) {
      out.transcript = result.transcript.map((entry) => ({
        role: entry.role,
        content: entry.content,
        toolName: entry.toolName,
        timestamp: entry.timestamp.toISOString(),
      }));
    }

    return out;
  }
}
