/**
 * HTML reporter — generates a self-contained HTML file with evaluation results.
 *
 * Features:
 * - Summary dashboard (pass rate, avg latency, total cost)
 * - Per-test expandable details
 * - SVG-based bar charts for latency and cost
 * - Full conversation transcripts
 * - Single file, no external dependencies (CSS and JS inline)
 */

import type { EvalResult, ComparisonReport } from '../types.js';
import { computeLatencyStats } from '../metrics/latency.js';
import { formatCost } from '../metrics/cost.js';

// ─── Options ────────────────────────────────────────────────────────────────

export interface HTMLReporterOptions {
  /** Title for the report. */
  title?: string;
  /** Whether to include conversation transcripts. Defaults to true. */
  includeTranscripts?: boolean;
}

// ─── HTML Reporter ──────────────────────────────────────────────────────────

export class HTMLReporter {
  private readonly opts: HTMLReporterOptions;

  constructor(options?: HTMLReporterOptions) {
    this.opts = {
      includeTranscripts: true,
      ...options,
    };
  }

  /**
   * Generate a complete, self-contained HTML report.
   */
  report(results: EvalResult[]): string {
    const title = this.opts.title ?? 'Agent Evaluation Report';
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? (passed / total) * 100 : 0;
    const avgScore = total > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / total
      : 0;

    const latencies = results.map((r) => r.durationMs);
    const latencyStats = computeLatencyStats(latencies);

    const costs = results.map((r) => r.costUsd ?? 0);
    const totalCost = costs.reduce((sum, c) => sum + c, 0);
    const avgCost = total > 0 ? totalCost / total : 0;

    let totalInput = 0;
    let totalOutput = 0;
    for (const r of results) {
      if (r.tokenUsage) {
        totalInput += r.tokenUsage.inputTokens;
        totalOutput += r.tokenUsage.outputTokens;
      }
    }

    const generatedAt = new Date().toISOString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${CSS_STYLES}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="timestamp">Generated: ${generatedAt}</p>
  </header>

  <!-- Summary Dashboard -->
  <section class="dashboard">
    <div class="metric-cards">
      <div class="metric-card ${passRate === 100 ? 'success' : passRate >= 80 ? 'warning' : 'danger'}">
        <div class="metric-value">${passRate.toFixed(1)}%</div>
        <div class="metric-label">Pass Rate</div>
        <div class="metric-detail">${passed}/${total} tests</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${avgScore.toFixed(2)}</div>
        <div class="metric-label">Avg Score</div>
        <div class="metric-detail">0-1 scale</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${latencyStats.mean.toFixed(0)}ms</div>
        <div class="metric-label">Avg Latency</div>
        <div class="metric-detail">P90: ${latencyStats.p90.toFixed(0)}ms</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${formatCost(totalCost)}</div>
        <div class="metric-label">Total Cost</div>
        <div class="metric-detail">Avg: ${formatCost(avgCost)}/test</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${formatTokenCount(totalInput + totalOutput)}</div>
        <div class="metric-label">Total Tokens</div>
        <div class="metric-detail">In: ${formatTokenCount(totalInput)} / Out: ${formatTokenCount(totalOutput)}</div>
      </div>
    </div>
  </section>

  <!-- Charts -->
  <section class="charts">
    <div class="chart-row">
      <div class="chart-container">
        <h3>Latency per Test (ms)</h3>
        ${this.generateBarChart(results.map((r) => ({
          label: truncate(r.testCase.name, 15),
          value: r.durationMs,
          color: r.passed ? '#22c55e' : '#ef4444',
        })), 'ms')}
      </div>
      <div class="chart-container">
        <h3>Score per Test</h3>
        ${this.generateBarChart(results.map((r) => ({
          label: truncate(r.testCase.name, 15),
          value: r.score,
          color: r.score >= 0.8 ? '#22c55e' : r.score >= 0.5 ? '#eab308' : '#ef4444',
        })), '', 1)}
      </div>
    </div>
  </section>

  <!-- Results Table -->
  <section class="results">
    <h2>Test Results</h2>
    <table class="results-table">
      <thead>
        <tr>
          <th>Status</th>
          <th>Name</th>
          <th>Score</th>
          <th>Latency</th>
          <th>Cost</th>
          <th>Tools</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${results.map((r, i) => this.generateResultRow(r, i)).join('\n')}
      </tbody>
    </table>
  </section>

  <!-- Expandable Details -->
  ${results.map((r, i) => this.generateDetailPanel(r, i)).join('\n')}
</div>

<script>
${JS_SCRIPT}
</script>
</body>
</html>`;
  }

  /**
   * Generate a comparison report HTML.
   */
  reportComparison(report: ComparisonReport): string {
    const title = this.opts.title ?? 'A/B Comparison Report';
    const { summary } = report;

    const winnerLabel = summary.overallWinner === 'tie'
      ? 'Tie'
      : `Config ${summary.overallWinner}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${CSS_STYLES}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="timestamp">Generated: ${report.generatedAt.toISOString()}</p>
  </header>

  <section class="dashboard">
    <div class="metric-cards">
      <div class="metric-card ${summary.overallWinner === 'A' ? 'success' : summary.overallWinner === 'B' ? 'danger' : 'warning'}">
        <div class="metric-value">${winnerLabel}</div>
        <div class="metric-label">Overall Winner</div>
        <div class="metric-detail">Confidence: ${(summary.confidence * 100).toFixed(1)}%</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${summary.totalTests}</div>
        <div class="metric-label">Total Tests</div>
        <div class="metric-detail">A: ${summary.winsA} / B: ${summary.winsB} / Tie: ${summary.ties}</div>
      </div>
    </div>
  </section>

  <section class="results">
    <h2>Metrics Comparison</h2>
    <table class="results-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Config A</th>
          <th>Config B</th>
          <th>Difference</th>
          <th>Winner</th>
          <th>Significant</th>
        </tr>
      </thead>
      <tbody>
        ${report.metrics.map((m) => `
        <tr>
          <td>${escapeHtml(m.metric)}</td>
          <td>${formatMetricValue(m.valueA)}</td>
          <td>${formatMetricValue(m.valueB)}</td>
          <td class="${m.percentChange > 0 ? 'text-green' : m.percentChange < 0 ? 'text-red' : ''}">${m.percentChange > 0 ? '+' : ''}${m.percentChange.toFixed(1)}%</td>
          <td><span class="badge ${m.winner === 'A' ? 'badge-success' : m.winner === 'B' ? 'badge-danger' : 'badge-neutral'}">${m.winner}</span></td>
          <td>${m.significant ? '<span class="badge badge-warning">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>
  </section>

  <section class="results">
    <h2>Per-Test Comparison</h2>
    <table class="results-table">
      <thead>
        <tr>
          <th>Test Case</th>
          <th>Score A</th>
          <th>Score B</th>
          <th>Latency A</th>
          <th>Latency B</th>
          <th>Winner</th>
        </tr>
      </thead>
      <tbody>
        ${report.testCases.map((tc) => `
        <tr>
          <td>${escapeHtml(tc.testCase.name)}</td>
          <td>${tc.resultA.score.toFixed(2)}</td>
          <td>${tc.resultB.score.toFixed(2)}</td>
          <td>${tc.resultA.durationMs.toFixed(0)}ms</td>
          <td>${tc.resultB.durationMs.toFixed(0)}ms</td>
          <td><span class="badge ${tc.winner === 'A' ? 'badge-success' : tc.winner === 'B' ? 'badge-danger' : 'badge-neutral'}">${tc.winner}</span></td>
        </tr>`).join('\n')}
      </tbody>
    </table>
  </section>
</div>
</body>
</html>`;
  }

  // ─── Chart Generation ─────────────────────────────────────────────

  private generateBarChart(
    data: Array<{ label: string; value: number; color: string }>,
    unit: string,
    maxScale?: number,
  ): string {
    if (data.length === 0) return '<p class="no-data">No data</p>';

    const chartWidth = 500;
    const chartHeight = Math.max(150, data.length * 28 + 20);
    const barHeight = 20;
    const labelWidth = 110;
    const valueWidth = 60;
    const barAreaWidth = chartWidth - labelWidth - valueWidth - 20;

    const maxValue = maxScale ?? Math.max(...data.map((d) => d.value), 1);

    const bars = data.map((d, i) => {
      const y = i * 28 + 10;
      const barWidth = Math.max(2, (d.value / maxValue) * barAreaWidth);
      const displayValue = d.value < 1 && d.value > 0
        ? d.value.toFixed(2)
        : d.value.toFixed(0);

      return `
        <text x="${labelWidth - 5}" y="${y + barHeight / 2 + 4}" text-anchor="end" class="chart-label">${escapeHtml(d.label)}</text>
        <rect x="${labelWidth}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" fill="${d.color}" opacity="0.85"/>
        <text x="${labelWidth + barWidth + 5}" y="${y + barHeight / 2 + 4}" class="chart-value">${displayValue}${unit}</text>`;
    }).join('\n');

    return `
      <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="bar-chart">
        ${bars}
      </svg>`;
  }

  // ─── Result Row ───────────────────────────────────────────────────

  private generateResultRow(result: EvalResult, index: number): string {
    const statusClass = result.passed ? 'status-pass' : 'status-fail';
    const statusText = result.passed ? 'PASS' : 'FAIL';

    return `
        <tr class="result-row" onclick="toggleDetail(${index})">
          <td><span class="badge ${statusClass}">${statusText}</span></td>
          <td>${escapeHtml(result.testCase.name)}</td>
          <td>${result.score.toFixed(2)}</td>
          <td>${result.durationMs.toFixed(0)}ms</td>
          <td>${result.costUsd !== undefined ? formatCost(result.costUsd) : '-'}</td>
          <td>${result.toolCalls.length > 0 ? result.toolCalls.map((t) => `<span class="tool-badge">${escapeHtml(t)}</span>`).join(' ') : '-'}</td>
          <td class="expand-icon">&#x25BC;</td>
        </tr>`;
  }

  // ─── Detail Panel ─────────────────────────────────────────────────

  private generateDetailPanel(result: EvalResult, index: number): string {
    const assertionsHtml = result.assertionResults.length > 0
      ? `
        <h4>Assertions</h4>
        <table class="assertions-table">
          <thead>
            <tr><th>Type</th><th>Status</th><th>Score</th><th>Message</th></tr>
          </thead>
          <tbody>
            ${result.assertionResults.map((ar) => `
            <tr>
              <td>${escapeHtml(ar.assertion.description ?? ar.assertion.type)}</td>
              <td><span class="badge ${ar.passed ? 'status-pass' : 'status-fail'}">${ar.passed ? 'PASS' : 'FAIL'}</span></td>
              <td>${ar.score.toFixed(2)}</td>
              <td>${escapeHtml(ar.message)}</td>
            </tr>`).join('\n')}
          </tbody>
        </table>`
      : '';

    const transcriptHtml = (this.opts.includeTranscripts && result.transcript.length > 0)
      ? `
        <h4>Conversation Transcript</h4>
        <div class="transcript">
          ${result.transcript.map((entry) => `
          <div class="transcript-entry transcript-${entry.role}">
            <span class="transcript-role">${entry.role}</span>
            <span class="transcript-content">${escapeHtml(entry.content)}</span>
          </div>`).join('\n')}
        </div>`
      : '';

    const errorHtml = result.error
      ? `<div class="error-box"><strong>Error:</strong> ${escapeHtml(result.error)}</div>`
      : '';

    const tokenHtml = result.tokenUsage
      ? `<p><strong>Tokens:</strong> Input: ${result.tokenUsage.inputTokens.toLocaleString()} / Output: ${result.tokenUsage.outputTokens.toLocaleString()} / Total: ${result.tokenUsage.totalTokens.toLocaleString()}</p>`
      : '';

    return `
  <div class="detail-panel" id="detail-${index}" style="display:none;">
    <div class="detail-content">
      <h3>${escapeHtml(result.testCase.name)}</h3>
      ${errorHtml}
      <div class="detail-meta">
        <p><strong>Output:</strong></p>
        <pre class="output-text">${escapeHtml(result.output || '(empty)')}</pre>
        <p><strong>Duration:</strong> ${result.durationMs.toFixed(0)}ms${result.firstTokenMs !== undefined ? ` (first token: ${result.firstTokenMs.toFixed(0)}ms)` : ''}</p>
        ${tokenHtml}
        ${result.costUsd !== undefined ? `<p><strong>Cost:</strong> ${formatCost(result.costUsd)}</p>` : ''}
      </div>
      ${assertionsHtml}
      ${transcriptHtml}
    </div>
  </div>`;
  }
}

// ─── CSS ────────────────────────────────────────────────────────────────────

const CSS_STYLES = `
  :root {
    --color-bg: #0f172a;
    --color-surface: #1e293b;
    --color-surface-hover: #334155;
    --color-border: #334155;
    --color-text: #e2e8f0;
    --color-text-dim: #94a3b8;
    --color-green: #22c55e;
    --color-green-bg: rgba(34, 197, 94, 0.1);
    --color-red: #ef4444;
    --color-red-bg: rgba(239, 68, 68, 0.1);
    --color-yellow: #eab308;
    --color-yellow-bg: rgba(234, 179, 8, 0.1);
    --color-blue: #3b82f6;
    --color-blue-bg: rgba(59, 130, 246, 0.1);
    --color-purple: #a855f7;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--color-bg);
    color: var(--color-text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    line-height: 1.6;
    padding: 2rem;
  }

  .container { max-width: 1200px; margin: 0 auto; }

  header {
    margin-bottom: 2rem;
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 1rem;
  }

  header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .timestamp {
    color: var(--color-text-dim);
    font-size: 0.875rem;
    margin-top: 0.25rem;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--color-text);
  }

  h3 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  h4 {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 1rem 0 0.5rem;
    color: var(--color-text-dim);
  }

  /* Dashboard */
  .dashboard { margin-bottom: 2rem; }

  .metric-cards {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .metric-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.75rem;
    padding: 1.25rem;
    flex: 1;
    min-width: 160px;
    text-align: center;
  }

  .metric-card.success { border-color: var(--color-green); }
  .metric-card.warning { border-color: var(--color-yellow); }
  .metric-card.danger { border-color: var(--color-red); }

  .metric-value {
    font-size: 1.75rem;
    font-weight: 700;
    line-height: 1.2;
  }

  .metric-card.success .metric-value { color: var(--color-green); }
  .metric-card.warning .metric-value { color: var(--color-yellow); }
  .metric-card.danger .metric-value { color: var(--color-red); }

  .metric-label {
    font-size: 0.875rem;
    color: var(--color-text-dim);
    margin-top: 0.25rem;
  }

  .metric-detail {
    font-size: 0.75rem;
    color: var(--color-text-dim);
    margin-top: 0.25rem;
    opacity: 0.8;
  }

  /* Charts */
  .charts { margin-bottom: 2rem; }

  .chart-row {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .chart-container {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.75rem;
    padding: 1.25rem;
    flex: 1;
    min-width: 300px;
    overflow-x: auto;
  }

  .bar-chart {
    width: 100%;
    max-width: 500px;
  }

  .chart-label {
    font-size: 11px;
    fill: var(--color-text-dim);
  }

  .chart-value {
    font-size: 11px;
    fill: var(--color-text);
    font-weight: 500;
  }

  .no-data {
    color: var(--color-text-dim);
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }

  /* Results Table */
  .results { margin-bottom: 2rem; }

  .results-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--color-surface);
    border-radius: 0.75rem;
    overflow: hidden;
  }

  .results-table th {
    background: var(--color-surface-hover);
    padding: 0.75rem 1rem;
    text-align: left;
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-dim);
    border-bottom: 1px solid var(--color-border);
  }

  .results-table td {
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.875rem;
  }

  .result-row {
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .result-row:hover { background: var(--color-surface-hover); }

  .expand-icon {
    font-size: 0.7rem;
    color: var(--color-text-dim);
    transition: transform 0.2s;
  }

  /* Badges */
  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .status-pass, .badge-success {
    background: var(--color-green-bg);
    color: var(--color-green);
    border: 1px solid var(--color-green);
  }

  .status-fail, .badge-danger {
    background: var(--color-red-bg);
    color: var(--color-red);
    border: 1px solid var(--color-red);
  }

  .badge-warning {
    background: var(--color-yellow-bg);
    color: var(--color-yellow);
    border: 1px solid var(--color-yellow);
  }

  .badge-neutral {
    background: rgba(148, 163, 184, 0.1);
    color: var(--color-text-dim);
    border: 1px solid var(--color-border);
  }

  .tool-badge {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.7rem;
    background: var(--color-blue-bg);
    color: var(--color-blue);
    border: 1px solid rgba(59, 130, 246, 0.3);
    margin: 0.1rem;
  }

  .text-green { color: var(--color-green); }
  .text-red { color: var(--color-red); }

  /* Detail Panel */
  .detail-panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.75rem;
    margin-bottom: 0.5rem;
    overflow: hidden;
  }

  .detail-content { padding: 1.25rem; }

  .detail-meta { margin: 0.75rem 0; }
  .detail-meta p { margin-bottom: 0.3rem; font-size: 0.875rem; }

  .output-text {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    padding: 0.75rem;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 300px;
    overflow-y: auto;
    margin: 0.5rem 0;
  }

  .error-box {
    background: var(--color-red-bg);
    border: 1px solid var(--color-red);
    border-radius: 0.5rem;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
  }

  /* Assertions */
  .assertions-table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5rem 0;
  }

  .assertions-table th {
    padding: 0.4rem 0.6rem;
    text-align: left;
    font-size: 0.75rem;
    color: var(--color-text-dim);
    border-bottom: 1px solid var(--color-border);
  }

  .assertions-table td {
    padding: 0.4rem 0.6rem;
    font-size: 0.8rem;
    border-bottom: 1px solid var(--color-border);
  }

  /* Transcript */
  .transcript {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    padding: 0.75rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .transcript-entry {
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.8rem;
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .transcript-entry:last-child { border-bottom: none; }

  .transcript-role {
    font-weight: 600;
    min-width: 70px;
    flex-shrink: 0;
    text-transform: uppercase;
    font-size: 0.7rem;
    padding-top: 0.15rem;
  }

  .transcript-user .transcript-role { color: var(--color-blue); }
  .transcript-assistant .transcript-role { color: var(--color-green); }
  .transcript-tool .transcript-role { color: var(--color-yellow); }

  .transcript-content {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  @media (max-width: 768px) {
    body { padding: 1rem; }
    .metric-cards { flex-direction: column; }
    .chart-row { flex-direction: column; }
    .results-table { font-size: 0.75rem; }
    .results-table th, .results-table td { padding: 0.4rem 0.5rem; }
  }
`;

// ─── JavaScript ─────────────────────────────────────────────────────────────

const JS_SCRIPT = `
function toggleDetail(index) {
  var panel = document.getElementById('detail-' + index);
  if (!panel) return;
  var isVisible = panel.style.display !== 'none';
  // Hide all panels
  var allPanels = document.querySelectorAll('.detail-panel');
  for (var i = 0; i < allPanels.length; i++) {
    allPanels[i].style.display = 'none';
  }
  // Toggle the clicked one
  if (!isVisible) {
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
`;

// ─── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function formatMetricValue(value: number): string {
  if (value === 0) return '0';
  if (value < 0.01) return value.toFixed(4);
  if (value < 1) return value.toFixed(3);
  if (value < 100) return value.toFixed(2);
  return value.toFixed(0);
}
