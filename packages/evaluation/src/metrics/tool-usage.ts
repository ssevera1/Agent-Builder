/**
 * Tool usage metrics for evaluating agent tool-calling behavior.
 *
 * Assesses whether the agent called the right tools, in the right order,
 * and without unnecessary calls.
 */

// ─── Accuracy ───────────────────────────────────────────────────────────────

/**
 * Compute tool call accuracy: what fraction of expected tools were called?
 *
 * Uses set-based comparison (order doesn't matter).
 *
 * @param expected - Array of expected tool names.
 * @param actual - Array of tool names that were actually called.
 * @returns Accuracy score between 0 and 1.
 *
 * The score is calculated as:
 *   |intersection(expected, actual)| / |expected|
 *
 * Returns 1.0 if expected is empty (vacuously true).
 */
export function toolCallAccuracy(
  expected: string[],
  actual: string[],
): number {
  if (expected.length === 0) return 1.0;

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  let matches = 0;
  for (const tool of expectedSet) {
    if (actualSet.has(tool)) {
      matches++;
    }
  }

  return matches / expectedSet.size;
}

/**
 * Compute precision: what fraction of actual tool calls were expected?
 *
 * @param expected - Array of expected tool names.
 * @param actual - Array of tool names that were actually called.
 * @returns Precision score between 0 and 1.
 */
export function toolCallPrecision(
  expected: string[],
  actual: string[],
): number {
  if (actual.length === 0) return expected.length === 0 ? 1.0 : 0.0;

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  let matches = 0;
  for (const tool of actualSet) {
    if (expectedSet.has(tool)) {
      matches++;
    }
  }

  return matches / actualSet.size;
}

/**
 * Compute the F1 score for tool calls (harmonic mean of accuracy and precision).
 */
export function toolCallF1(
  expected: string[],
  actual: string[],
): number {
  const accuracy = toolCallAccuracy(expected, actual);
  const precision = toolCallPrecision(expected, actual);

  if (accuracy === 0 && precision === 0) return 0;
  return (2 * accuracy * precision) / (accuracy + precision);
}

// ─── Order Checking ─────────────────────────────────────────────────────────

/**
 * Check if the actual tool calls contain the expected tools in the expected
 * order (not necessarily contiguous).
 *
 * Uses the longest common subsequence approach to check if the expected
 * sequence is a subsequence of the actual sequence.
 *
 * @param expected - Array of expected tool names in the required order.
 * @param actual - Array of tool names that were actually called.
 * @returns True if the expected order is preserved in the actual calls.
 */
export function toolCallOrder(
  expected: string[],
  actual: string[],
): boolean {
  if (expected.length === 0) return true;
  if (actual.length === 0) return false;

  let expectedIdx = 0;

  for (const tool of actual) {
    if (tool === expected[expectedIdx]) {
      expectedIdx++;
      if (expectedIdx === expected.length) {
        return true;
      }
    }
  }

  return expectedIdx === expected.length;
}

/**
 * Compute the order score: what fraction of expected tool pairs maintain
 * their relative order in the actual calls?
 *
 * This is more nuanced than the binary toolCallOrder — it gives partial
 * credit for partially correct ordering.
 *
 * @returns Score between 0 and 1.
 */
export function toolCallOrderScore(
  expected: string[],
  actual: string[],
): number {
  if (expected.length <= 1) return 1.0;

  // Build position map for actual tools (first occurrence)
  const positionMap = new Map<string, number>();
  for (let i = 0; i < actual.length; i++) {
    const tool = actual[i]!;
    if (!positionMap.has(tool)) {
      positionMap.set(tool, i);
    }
  }

  // Count correctly ordered pairs
  let totalPairs = 0;
  let correctPairs = 0;

  for (let i = 0; i < expected.length; i++) {
    for (let j = i + 1; j < expected.length; j++) {
      totalPairs++;
      const posI = positionMap.get(expected[i]!);
      const posJ = positionMap.get(expected[j]!);

      if (posI !== undefined && posJ !== undefined && posI < posJ) {
        correctPairs++;
      }
    }
  }

  return totalPairs === 0 ? 1.0 : correctPairs / totalPairs;
}

// ─── Unnecessary Calls ──────────────────────────────────────────────────────

/**
 * Identify tool calls that were made but were not in the expected set.
 *
 * @param expected - Array of expected tool names.
 * @param actual - Array of tool names that were actually called.
 * @returns Array of tool names that were called unnecessarily.
 */
export function unnecessaryToolCalls(
  expected: string[],
  actual: string[],
): string[] {
  const expectedSet = new Set(expected);
  const unnecessary: string[] = [];
  const seen = new Set<string>();

  for (const tool of actual) {
    if (!expectedSet.has(tool) && !seen.has(tool)) {
      unnecessary.push(tool);
      seen.add(tool);
    }
  }

  return unnecessary;
}

/**
 * Identify expected tool calls that were missing from the actual calls.
 *
 * @param expected - Array of expected tool names.
 * @param actual - Array of tool names that were actually called.
 * @returns Array of tool names that were expected but not called.
 */
export function missingToolCalls(
  expected: string[],
  actual: string[],
): string[] {
  const actualSet = new Set(actual);
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const tool of expected) {
    if (!actualSet.has(tool) && !seen.has(tool)) {
      missing.push(tool);
      seen.add(tool);
    }
  }

  return missing;
}

/**
 * Count how many times each tool was called.
 *
 * @param toolCalls - Array of tool names called.
 * @returns Map of tool name to call count.
 */
export function toolCallCounts(
  toolCalls: string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tool of toolCalls) {
    counts.set(tool, (counts.get(tool) ?? 0) + 1);
  }
  return counts;
}
