/**
 * A/B Comparator — compares evaluation results from two agent configurations.
 *
 * Produces a ComparisonReport with:
 * - Summary with overall winner determination
 * - Per-test side-by-side comparison
 * - Metrics comparison (accuracy, latency, cost)
 * - Statistical significance via paired t-test
 */

import type {
  EvalResult,
  ComparisonReport,
  TestCaseComparison,
  MetricsComparison,
} from './types.js';

// ─── Main Comparison Function ───────────────────────────────────────────────

/**
 * Compare evaluation results from two agent configurations.
 *
 * Results are matched by test case ID. Test cases present in one set
 * but not the other are excluded from the comparison.
 *
 * @param resultsA - Results from configuration A.
 * @param resultsB - Results from configuration B.
 * @returns A detailed comparison report.
 */
export function compareResults(
  resultsA: EvalResult[],
  resultsB: EvalResult[],
): ComparisonReport {
  // Match results by test case ID
  const mapA = new Map(resultsA.map((r) => [r.testCase.id, r]));
  const mapB = new Map(resultsB.map((r) => [r.testCase.id, r]));

  const commonIds = [...mapA.keys()].filter((id) => mapB.has(id));

  if (commonIds.length === 0) {
    return {
      summary: {
        overallWinner: 'tie',
        confidence: 0,
        totalTests: 0,
        winsA: 0,
        winsB: 0,
        ties: 0,
      },
      metrics: [],
      testCases: [],
      generatedAt: new Date(),
    };
  }

  // Build per-test comparisons
  const testCaseComparisons: TestCaseComparison[] = [];
  let winsA = 0;
  let winsB = 0;
  let ties = 0;

  for (const id of commonIds) {
    const resultA = mapA.get(id)!;
    const resultB = mapB.get(id)!;
    const comparison = compareTestCase(resultA, resultB);
    testCaseComparisons.push(comparison);

    switch (comparison.winner) {
      case 'A': winsA++; break;
      case 'B': winsB++; break;
      case 'tie': ties++; break;
    }
  }

  // Compute metrics comparisons
  const pairedA = commonIds.map((id) => mapA.get(id)!);
  const pairedB = commonIds.map((id) => mapB.get(id)!);
  const metrics = computeMetricsComparison(pairedA, pairedB);

  // Determine overall winner
  const { winner, confidence } = determineOverallWinner(
    winsA,
    winsB,
    ties,
    metrics,
  );

  return {
    summary: {
      overallWinner: winner,
      confidence,
      totalTests: commonIds.length,
      winsA,
      winsB,
      ties,
    },
    metrics,
    testCases: testCaseComparisons,
    generatedAt: new Date(),
  };
}

// ─── Per-Test Comparison ────────────────────────────────────────────────────

function compareTestCase(
  resultA: EvalResult,
  resultB: EvalResult,
): TestCaseComparison {
  const improvements: string[] = [];
  const regressions: string[] = [];

  // Compare pass/fail
  if (resultA.passed && !resultB.passed) {
    improvements.push('A passed, B failed');
  } else if (!resultA.passed && resultB.passed) {
    regressions.push('A failed, B passed');
  }

  // Compare score
  const scoreDiff = resultA.score - resultB.score;
  if (Math.abs(scoreDiff) > 0.01) {
    if (scoreDiff > 0) {
      improvements.push(`A scored higher (${resultA.score.toFixed(2)} vs ${resultB.score.toFixed(2)})`);
    } else {
      regressions.push(`B scored higher (${resultB.score.toFixed(2)} vs ${resultA.score.toFixed(2)})`);
    }
  }

  // Compare latency
  const latencyDiff = resultA.durationMs - resultB.durationMs;
  const latencyThreshold = Math.max(resultA.durationMs, resultB.durationMs) * 0.1; // 10% threshold
  if (Math.abs(latencyDiff) > latencyThreshold) {
    if (latencyDiff < 0) {
      improvements.push(`A is ${Math.abs(latencyDiff).toFixed(0)}ms faster`);
    } else {
      regressions.push(`B is ${Math.abs(latencyDiff).toFixed(0)}ms faster`);
    }
  }

  // Compare cost
  if (resultA.costUsd !== undefined && resultB.costUsd !== undefined) {
    const costDiff = resultA.costUsd - resultB.costUsd;
    if (Math.abs(costDiff) > 0.0001) {
      if (costDiff < 0) {
        improvements.push(`A is $${Math.abs(costDiff).toFixed(4)} cheaper`);
      } else {
        regressions.push(`B is $${Math.abs(costDiff).toFixed(4)} cheaper`);
      }
    }
  }

  // Compare tool usage
  const toolsA = resultA.toolCalls.length;
  const toolsB = resultB.toolCalls.length;
  if (toolsA !== toolsB) {
    if (toolsA < toolsB) {
      improvements.push(`A used fewer tools (${toolsA} vs ${toolsB})`);
    } else {
      regressions.push(`B used fewer tools (${toolsB} vs ${toolsA})`);
    }
  }

  // Determine winner for this test case
  let winner: 'A' | 'B' | 'tie';
  if (resultA.passed && !resultB.passed) {
    winner = 'A';
  } else if (!resultA.passed && resultB.passed) {
    winner = 'B';
  } else if (improvements.length > regressions.length) {
    winner = 'A';
  } else if (regressions.length > improvements.length) {
    winner = 'B';
  } else {
    // Tiebreak by score
    if (scoreDiff > 0.01) winner = 'A';
    else if (scoreDiff < -0.01) winner = 'B';
    else winner = 'tie';
  }

  return {
    testCase: resultA.testCase,
    resultA,
    resultB,
    winner,
    improvements,
    regressions,
  };
}

// ─── Metrics Comparison ────────────────────────────────────────────────────

function computeMetricsComparison(
  resultsA: EvalResult[],
  resultsB: EvalResult[],
): MetricsComparison[] {
  const metrics: MetricsComparison[] = [];
  const n = resultsA.length;

  // Accuracy (pass rate)
  const passRateA = resultsA.filter((r) => r.passed).length / n;
  const passRateB = resultsB.filter((r) => r.passed).length / n;
  metrics.push(
    createMetricComparison('Pass Rate', passRateA, passRateB, 'higher'),
  );

  // Average score
  const avgScoreA = resultsA.reduce((sum, r) => sum + r.score, 0) / n;
  const avgScoreB = resultsB.reduce((sum, r) => sum + r.score, 0) / n;
  metrics.push(
    createMetricComparison('Average Score', avgScoreA, avgScoreB, 'higher'),
  );

  // Latency (average)
  const avgLatencyA = resultsA.reduce((sum, r) => sum + r.durationMs, 0) / n;
  const avgLatencyB = resultsB.reduce((sum, r) => sum + r.durationMs, 0) / n;
  const latencyComparison = createMetricComparison(
    'Average Latency (ms)',
    avgLatencyA,
    avgLatencyB,
    'lower',
  );

  // Statistical significance for latency via paired t-test
  const latenciesA = resultsA.map((r) => r.durationMs);
  const latenciesB = resultsB.map((r) => r.durationMs);
  latencyComparison.significant = pairedTTest(latenciesA, latenciesB) < 0.05;
  metrics.push(latencyComparison);

  // P90 Latency
  const sortedLatA = [...latenciesA].sort((a, b) => a - b);
  const sortedLatB = [...latenciesB].sort((a, b) => a - b);
  const p90A = percentile(sortedLatA, 0.9);
  const p90B = percentile(sortedLatB, 0.9);
  metrics.push(
    createMetricComparison('P90 Latency (ms)', p90A, p90B, 'lower'),
  );

  // Cost (average)
  const costsA = resultsA.map((r) => r.costUsd ?? 0);
  const costsB = resultsB.map((r) => r.costUsd ?? 0);
  const avgCostA = costsA.reduce((sum, c) => sum + c, 0) / n;
  const avgCostB = costsB.reduce((sum, c) => sum + c, 0) / n;
  const costComparison = createMetricComparison(
    'Average Cost ($)',
    avgCostA,
    avgCostB,
    'lower',
  );
  if (avgCostA > 0 && avgCostB > 0) {
    costComparison.significant = pairedTTest(costsA, costsB) < 0.05;
  }
  metrics.push(costComparison);

  // Total Cost
  const totalCostA = costsA.reduce((sum, c) => sum + c, 0);
  const totalCostB = costsB.reduce((sum, c) => sum + c, 0);
  metrics.push(
    createMetricComparison('Total Cost ($)', totalCostA, totalCostB, 'lower'),
  );

  // Average tool calls
  const avgToolsA = resultsA.reduce((sum, r) => sum + r.toolCalls.length, 0) / n;
  const avgToolsB = resultsB.reduce((sum, r) => sum + r.toolCalls.length, 0) / n;
  metrics.push(
    createMetricComparison('Avg Tool Calls', avgToolsA, avgToolsB, 'neutral'),
  );

  return metrics;
}

function createMetricComparison(
  metric: string,
  valueA: number,
  valueB: number,
  betterDirection: 'higher' | 'lower' | 'neutral',
): MetricsComparison {
  const difference = valueA - valueB;
  const maxVal = Math.max(Math.abs(valueA), Math.abs(valueB));
  const percentChange = maxVal === 0 ? 0 : (difference / maxVal) * 100;

  let winner: 'A' | 'B' | 'tie';
  const threshold = maxVal * 0.01; // 1% threshold for significance

  if (Math.abs(difference) < threshold) {
    winner = 'tie';
  } else if (betterDirection === 'higher') {
    winner = difference > 0 ? 'A' : 'B';
  } else if (betterDirection === 'lower') {
    winner = difference < 0 ? 'A' : 'B';
  } else {
    winner = 'tie';
  }

  return {
    metric,
    valueA,
    valueB,
    difference,
    percentChange,
    winner,
    significant: false,
  };
}

// ─── Overall Winner Determination ───────────────────────────────────────────

function determineOverallWinner(
  winsA: number,
  winsB: number,
  ties: number,
  metrics: MetricsComparison[],
): { winner: 'A' | 'B' | 'tie'; confidence: number } {
  const total = winsA + winsB + ties;
  if (total === 0) return { winner: 'tie', confidence: 0 };

  // Score-based approach: each metric win adds weight
  let scoreA = winsA;
  let scoreB = winsB;

  // Add metric-level wins
  for (const metric of metrics) {
    if (metric.winner === 'A') scoreA += (metric.significant ? 2 : 1);
    if (metric.winner === 'B') scoreB += (metric.significant ? 2 : 1);
  }

  const totalScore = scoreA + scoreB;
  if (totalScore === 0) return { winner: 'tie', confidence: 0 };

  const confidence = Math.abs(scoreA - scoreB) / totalScore;

  if (scoreA > scoreB) {
    return { winner: 'A', confidence };
  } else if (scoreB > scoreA) {
    return { winner: 'B', confidence };
  } else {
    return { winner: 'tie', confidence: 0 };
  }
}

// ─── Statistical Tests ──────────────────────────────────────────────────────

/**
 * Paired two-tailed t-test for comparing two sets of paired measurements.
 *
 * Tests the null hypothesis that the mean difference between paired
 * observations is zero.
 *
 * @param samplesA - First set of measurements.
 * @param samplesB - Second set of measurements (same length as samplesA).
 * @returns The p-value for the test. Values < 0.05 indicate statistical
 *          significance at the 95% confidence level.
 */
export function pairedTTest(
  samplesA: number[],
  samplesB: number[],
): number {
  const n = Math.min(samplesA.length, samplesB.length);
  if (n < 2) return 1.0; // Not enough data

  // Compute differences
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) {
    diffs.push((samplesA[i] ?? 0) - (samplesB[i] ?? 0));
  }

  // Mean of differences
  const meanDiff = diffs.reduce((sum, d) => sum + d, 0) / n;

  // Standard deviation of differences
  const variance =
    diffs.reduce((sum, d) => sum + (d - meanDiff) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    // All differences are identical
    return meanDiff === 0 ? 1.0 : 0.0;
  }

  // t-statistic
  const tStat = meanDiff / (stdDev / Math.sqrt(n));

  // Degrees of freedom
  const df = n - 1;

  // Compute two-tailed p-value using the t-distribution
  // We use an approximation of the t-distribution CDF
  return tDistributionPValue(Math.abs(tStat), df);
}

/**
 * Approximate the two-tailed p-value of the t-distribution.
 *
 * Uses the regularized incomplete beta function approximation.
 * This is accurate enough for practical significance testing.
 */
function tDistributionPValue(tAbs: number, df: number): number {
  // Convert to beta distribution: F(t) = 1 - I(df/(df+t^2), df/2, 1/2)
  const x = df / (df + tAbs * tAbs);
  const a = df / 2;
  const b = 0.5;

  // Regularized incomplete beta function approximation
  const betaValue = regularizedIncompleteBeta(x, a, b);

  // Two-tailed p-value
  return betaValue;
}

/**
 * Approximation of the regularized incomplete beta function I(x, a, b).
 *
 * Uses a continued fraction expansion that converges well for typical
 * statistical test parameters.
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use the continued fraction expansion (Lentz's method)
  // For better convergence when x > (a+1)/(a+b+2), use the identity:
  // I(x,a,b) = 1 - I(1-x,b,a)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const lnBeta = logBeta(a, b);
  const front = Math.exp(
    Math.log(x) * a + Math.log(1 - x) * b - lnBeta
  ) / a;

  // Continued fraction expansion
  let f = 1;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;

  const maxIter = 200;
  const epsilon = 1e-10;

  for (let m = 1; m <= maxIter; m++) {
    // Even step
    let numerator =
      (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= d * c;

    // Odd step
    numerator =
      -((a + m) * (a + b + m) * x) /
      ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;

    if (Math.abs(delta - 1) < epsilon) break;
  }

  return front * f;
}

/**
 * Natural logarithm of the Beta function B(a, b) using the log-gamma
 * approximation (Stirling's approximation via Lanczos).
 */
function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/**
 * Lanczos approximation of the log-gamma function.
 */
function logGamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula: Gamma(z) = pi / (sin(pi*z) * Gamma(1-z))
    return (
      Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  }

  z -= 1;
  const g = 7;
  const coef = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  let x = coef[0]!;
  for (let i = 1; i < g + 2; i++) {
    x += coef[i]! / (z + i);
  }

  const t = z + g + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (z + 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
}

/**
 * Compute a percentile value from a sorted array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;

  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower]!;
  const fraction = index - lower;
  return (sorted[lower]!) * (1 - fraction) + (sorted[upper]!) * fraction;
}
