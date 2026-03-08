/**
 * Console reporter — formats evaluation results as a CLI table with
 * ANSI color support.
 */

import type { EvalResult, ComparisonReport } from '../types.js';
import { formatCost } from '../metrics/cost.js';
import { computeLatencyStats } from '../metrics/latency.js';

// ─── ANSI Color Codes ──────────────────────────────────────────────────────

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',

  // Foreground
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function color(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${ANSI.reset}`;
}

// ─── Console Reporter ──────────────────────────────────────────────────────

/**
 * Options for the console reporter.
 */
export interface ConsoleReporterOptions {
  /** Disable ANSI color codes. */
  noColor?: boolean;
  /** Show full assertion details. */
  verbose?: boolean;
  /** Show conversation transcripts. */
  showTranscripts?: boolean;
}

/**
 * Format evaluation results for console output.
 */
export class ConsoleReporter {
  private readonly opts: ConsoleReporterOptions;

  constructor(options?: ConsoleReporterOptions) {
    this.opts = options ?? {};
  }

  /**
   * Format a set of evaluation results as a console-friendly string.
   */
  report(results: EvalResult[]): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(this.c(`${'='.repeat(70)}`, ANSI.cyan));
    lines.push(this.c('  EVALUATION RESULTS', ANSI.bold, ANSI.cyan));
    lines.push(this.c(`${'='.repeat(70)}`, ANSI.cyan));
    lines.push('');

    // Summary
    lines.push(this.formatSummary(results));
    lines.push('');

    // Results table
    lines.push(this.formatTable(results));

    // Verbose: assertion details
    if (this.opts.verbose) {
      lines.push('');
      lines.push(this.formatAssertionDetails(results));
    }

    // Transcripts
    if (this.opts.showTranscripts) {
      lines.push('');
      lines.push(this.formatTranscripts(results));
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Format a comparison report for console output.
   */
  reportComparison(report: ComparisonReport): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(this.c(`${'='.repeat(70)}`, ANSI.magenta));
    lines.push(this.c('  A/B COMPARISON REPORT', ANSI.bold, ANSI.magenta));
    lines.push(this.c(`${'='.repeat(70)}`, ANSI.magenta));
    lines.push('');

    // Summary
    const { summary } = report;
    const winnerLabel = summary.overallWinner === 'tie'
      ? this.c('TIE', ANSI.yellow)
      : this.c(`Config ${summary.overallWinner} wins`, ANSI.green, ANSI.bold);

    lines.push(this.c('  Summary:', ANSI.bold));
    lines.push(`    Overall Winner: ${winnerLabel}`);
    lines.push(`    Confidence:     ${(summary.confidence * 100).toFixed(1)}%`);
    lines.push(`    Total Tests:    ${summary.totalTests}`);
    lines.push(`    Wins A:         ${summary.winsA}`);
    lines.push(`    Wins B:         ${summary.winsB}`);
    lines.push(`    Ties:           ${summary.ties}`);
    lines.push('');

    // Metrics table
    lines.push(this.c('  Metrics Comparison:', ANSI.bold));
    lines.push('');

    const metricHeader = this.padRow([
      'Metric', 'Config A', 'Config B', 'Diff %', 'Winner', 'Sig.',
    ], [25, 12, 12, 10, 8, 5]);
    lines.push(`    ${this.c(metricHeader, ANSI.underline)}`);

    for (const metric of report.metrics) {
      const winner = metric.winner === 'tie'
        ? this.c('-', ANSI.gray)
        : this.c(metric.winner, metric.winner === 'A' ? ANSI.green : ANSI.blue);

      const sig = metric.significant ? this.c('*', ANSI.yellow) : ' ';
      const pctChange = metric.percentChange === 0
        ? this.c('0%', ANSI.gray)
        : metric.percentChange > 0
          ? this.c(`+${metric.percentChange.toFixed(1)}%`, ANSI.green)
          : this.c(`${metric.percentChange.toFixed(1)}%`, ANSI.red);

      const row = this.padRow([
        metric.metric,
        formatValue(metric.valueA),
        formatValue(metric.valueB),
        stripAnsi(pctChange).padStart(10),
        stripAnsi(winner).padStart(8),
        stripAnsi(sig).padStart(5),
      ], [25, 12, 12, 10, 8, 5]);
      lines.push(`    ${row}`);
    }

    lines.push('');
    lines.push(this.c('  * = statistically significant (p < 0.05)', ANSI.dim));
    lines.push('');

    return lines.join('\n');
  }

  // ─── Internal Formatting ──────────────────────────────────────────

  private formatSummary(results: EvalResult[]): string {
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? (passed / total) * 100 : 0;

    const latencies = results.map((r) => r.durationMs);
    const latencyStats = computeLatencyStats(latencies);

    const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    const avgScore = total > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / total
      : 0;

    const passedStr = this.c(`${passed}`, ANSI.green, ANSI.bold);
    const failedStr = failed > 0
      ? this.c(`${failed}`, ANSI.red, ANSI.bold)
      : this.c(`${failed}`, ANSI.green);

    const lines: string[] = [];
    lines.push(this.c('  Summary:', ANSI.bold));
    lines.push(`    Total Tests:    ${total}`);
    lines.push(`    Passed:         ${passedStr}`);
    lines.push(`    Failed:         ${failedStr}`);
    lines.push(`    Pass Rate:      ${passRate.toFixed(1)}%`);
    lines.push(`    Avg Score:      ${avgScore.toFixed(2)}`);
    lines.push(`    Avg Latency:    ${latencyStats.mean.toFixed(0)}ms`);
    lines.push(`    P90 Latency:    ${latencyStats.p90.toFixed(0)}ms`);
    lines.push(`    Total Cost:     ${formatCost(totalCost)}`);

    return lines.join('\n');
  }

  private formatTable(results: EvalResult[]): string {
    const lines: string[] = [];

    lines.push(this.c('  Test Results:', ANSI.bold));
    lines.push('');

    // Header
    const header = this.padRow(
      ['Status', 'Name', 'Score', 'Latency', 'Cost', 'Error'],
      [8, 30, 7, 10, 10, 30],
    );
    lines.push(`    ${this.c(header, ANSI.underline)}`);

    for (const result of results) {
      const status = result.passed
        ? this.c('PASS', ANSI.green, ANSI.bold)
        : this.c('FAIL', ANSI.red, ANSI.bold);

      const name = truncate(result.testCase.name, 30);
      const score = result.score.toFixed(2);
      const latency = `${result.durationMs.toFixed(0)}ms`;
      const cost = result.costUsd !== undefined ? formatCost(result.costUsd) : '-';
      const error = result.error ? truncate(result.error, 30) : '';

      const row = this.padRow(
        [
          padWithAnsi(status, 8),
          name.padEnd(30),
          score.padStart(7),
          latency.padStart(10),
          cost.padStart(10),
          error,
        ],
        [8, 30, 7, 10, 10, 30],
      );
      lines.push(`    ${row}`);
    }

    return lines.join('\n');
  }

  private formatAssertionDetails(results: EvalResult[]): string {
    const lines: string[] = [];

    lines.push(this.c('  Assertion Details:', ANSI.bold));

    for (const result of results) {
      if (result.assertionResults.length === 0) continue;

      lines.push('');
      lines.push(
        `    ${this.c(result.testCase.name, ANSI.bold)} ${result.passed ? this.c('[PASS]', ANSI.green) : this.c('[FAIL]', ANSI.red)}`
      );

      for (const ar of result.assertionResults) {
        const icon = ar.passed ? this.c('  +', ANSI.green) : this.c('  -', ANSI.red);
        const desc = ar.assertion.description ?? ar.assertion.type;
        lines.push(`      ${icon} ${desc}: ${ar.message}`);
      }
    }

    return lines.join('\n');
  }

  private formatTranscripts(results: EvalResult[]): string {
    const lines: string[] = [];

    lines.push(this.c('  Transcripts:', ANSI.bold));

    for (const result of results) {
      lines.push('');
      lines.push(this.c(`    --- ${result.testCase.name} ---`, ANSI.dim));

      for (const entry of result.transcript) {
        const roleColor =
          entry.role === 'user' ? ANSI.blue
            : entry.role === 'assistant' ? ANSI.green
              : ANSI.yellow;

        const roleLabel = this.c(`[${entry.role}]`, roleColor, ANSI.bold);
        const content = truncate(entry.content, 100);
        lines.push(`      ${roleLabel} ${content}`);
      }
    }

    return lines.join('\n');
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Apply color codes if color is enabled.
   */
  private c(text: string, ...codes: string[]): string {
    if (this.opts.noColor) return text;
    return color(text, ...codes);
  }

  private padRow(cells: string[], widths: number[]): string {
    return cells
      .map((cell, i) => {
        const width = widths[i] ?? 10;
        const visibleLength = stripAnsi(cell).length;
        if (visibleLength >= width) return cell;
        return cell + ' '.repeat(width - visibleLength);
      })
      .join('  ');
  }
}

// ─── Utility Functions ──────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function padWithAnsi(str: string, width: number): string {
  const visible = stripAnsi(str).length;
  if (visible >= width) return str;
  return str + ' '.repeat(width - visible);
}

function formatValue(value: number): string {
  if (value === 0) return '0';
  if (value < 0.01) return value.toFixed(4);
  if (value < 1) return value.toFixed(3);
  if (value < 100) return value.toFixed(2);
  return value.toFixed(0);
}
