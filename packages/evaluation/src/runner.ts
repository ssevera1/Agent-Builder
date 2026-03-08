/**
 * EvalRunner — the core evaluation engine for testing agent behavior.
 *
 * Runs test cases against agent functions, collects metrics, evaluates
 * assertions, and produces structured results.
 */

import type {
  AgentRunFunction,
  AgentEvent,
  TestCase,
  EvalResult,
  AssertionResult,
  Assertion,
  TranscriptEntry,
  EvalRunnerOptions,
  RunOptions,
  ComparisonReport,
} from './types.js';
import type { TokenUsage } from '@agentbuilder/core';
import {
  exactMatch,
  exactMatchIgnoreCase,
  containsMatch,
  containsMatchIgnoreCase,
  fuzzyMatch,
  regexMatch,
  semanticSimilarity,
} from './metrics/accuracy.js';
import { estimateCost } from './metrics/cost.js';
import {
  toolCallAccuracy,
  toolCallOrder,
  unnecessaryToolCalls,
} from './metrics/tool-usage.js';
import { compareResults } from './comparator.js';

// ─── EvalRunner ─────────────────────────────────────────────────────────────

export class EvalRunner {
  private readonly options: EvalRunnerOptions;

  constructor(options?: EvalRunnerOptions) {
    this.options = options ?? {};
  }

  /**
   * Run test cases against an agent and yield results as they complete.
   */
  async *run(
    runAgent: AgentRunFunction,
    testCases: TestCase[],
    options?: RunOptions,
  ): AsyncIterable<EvalResult> {
    let cases = [...testCases];

    // Filter by tags
    if (options?.tags && options.tags.length > 0) {
      const filterTags = new Set(options.tags);
      cases = cases.filter(
        (tc) => tc.tags?.some((t) => filterTags.has(t)) ?? false
      );
    }

    // Shuffle
    if (options?.shuffle) {
      cases = shuffleArray(cases);
    }

    // Limit
    if (options?.limit !== undefined && options.limit > 0) {
      cases = cases.slice(0, options.limit);
    }

    const modelId = options?.modelId ?? this.options.modelId;
    const maxConcurrency = this.options.maxConcurrency ?? 1;
    const continueOnError = this.options.continueOnError ?? true;
    const timeoutMs = this.options.timeoutMs;

    // Run test cases with concurrency control
    const batches = createBatches(cases, maxConcurrency);

    for (const batch of batches) {
      const promises = batch.map((testCase) =>
        this.runSingle(runAgent, testCase, modelId, timeoutMs)
      );

      const results = await Promise.allSettled(promises);

      for (const settled of results) {
        if (settled.status === 'fulfilled') {
          yield settled.value;
        } else {
          if (!continueOnError) {
            throw settled.reason;
          }
          // Create a failed result for the test case
          // We cannot determine which test case failed from Promise.allSettled,
          // so this path is for unexpected errors
        }
      }
    }
  }

  /**
   * Compare two agent configurations by running both on the same test cases.
   */
  async compare(
    runAgentA: AgentRunFunction,
    runAgentB: AgentRunFunction,
    testCases: TestCase[],
  ): Promise<ComparisonReport> {
    // Run both agents and collect all results
    const resultsA: EvalResult[] = [];
    const resultsB: EvalResult[] = [];

    for await (const result of this.run(runAgentA, testCases)) {
      resultsA.push(result);
    }

    for await (const result of this.run(runAgentB, testCases)) {
      resultsB.push(result);
    }

    return compareResults(resultsA, resultsB);
  }

  // ─── Internal Methods ─────────────────────────────────────────────

  /**
   * Run a single test case against the agent.
   */
  private async runSingle(
    runAgent: AgentRunFunction,
    testCase: TestCase,
    modelId?: string,
    timeoutMs?: number,
  ): Promise<EvalResult> {
    const startTime = performance.now();
    let firstTokenMs: number | undefined;
    const transcript: TranscriptEntry[] = [];
    const toolCalls: string[] = [];
    let outputText = '';
    let tokenUsage: TokenUsage | undefined;
    let error: string | undefined;

    // Add the user input to the transcript
    const inputContent =
      typeof testCase.input.content === 'string'
        ? testCase.input.content
        : JSON.stringify(testCase.input.content);

    transcript.push({
      role: 'user',
      content: inputContent,
      timestamp: new Date(),
    });

    try {
      const agentIterable = runAgent(testCase.input);

      // Wrap with timeout if specified
      const events = timeoutMs
        ? withTimeout(agentIterable, timeoutMs)
        : agentIterable;

      for await (const event of events) {
        // Track time to first token
        if (firstTokenMs === undefined && event.type === 'text') {
          firstTokenMs = performance.now() - startTime;
        }

        switch (event.type) {
          case 'text':
            if (event.text) {
              outputText += event.text;
            }
            break;

          case 'tool_call':
            if (event.toolCall) {
              toolCalls.push(event.toolCall.name);
              transcript.push({
                role: 'assistant',
                content: `Tool call: ${event.toolCall.name}(${event.toolCall.arguments})`,
                toolName: event.toolCall.name,
                timestamp: new Date(),
              });
            }
            break;

          case 'tool_result':
            if (event.toolResult) {
              transcript.push({
                role: 'tool',
                content: event.toolResult.content,
                timestamp: new Date(),
              });
            }
            break;

          case 'usage':
            if (event.usage) {
              tokenUsage = event.usage;
            }
            break;

          case 'error':
            if (event.error) {
              error = event.error.message;
            }
            break;
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const durationMs = performance.now() - startTime;

    // Add assistant response to transcript
    if (outputText) {
      transcript.push({
        role: 'assistant',
        content: outputText,
        timestamp: new Date(),
      });
    }

    // Estimate cost
    let costUsd: number | undefined;
    if (tokenUsage && modelId) {
      costUsd = estimateCost(tokenUsage, modelId);
    }

    // Evaluate assertions
    const assertionResults = this.evaluateAssertions(
      testCase,
      outputText,
      toolCalls,
      durationMs,
      costUsd,
    );

    // Compute overall pass/fail and score
    const passed =
      assertionResults.length === 0
        ? error === undefined
        : assertionResults.every((r) => r.passed);

    const score = computeScore(assertionResults);

    return {
      testCase,
      passed: passed && error === undefined,
      score,
      assertionResults,
      output: outputText,
      toolCalls,
      durationMs,
      firstTokenMs,
      tokenUsage,
      costUsd,
      transcript,
      error,
      evaluatedAt: new Date(),
    };
  }

  /**
   * Evaluate all assertions for a test case.
   */
  private evaluateAssertions(
    testCase: TestCase,
    output: string,
    toolCalls: string[],
    durationMs: number,
    costUsd?: number,
  ): AssertionResult[] {
    const results: AssertionResult[] = [];

    // Add implicit assertions from test case fields
    if (testCase.expectedOutput !== undefined) {
      results.push(
        evaluateAssertion(
          {
            type: 'contains',
            expected: testCase.expectedOutput,
            description: 'Output contains expected text',
          },
          output,
          toolCalls,
          durationMs,
          costUsd,
        ),
      );
    }

    if (testCase.expectedToolCalls !== undefined) {
      results.push(
        evaluateAssertion(
          {
            type: 'tool_called',
            expected: testCase.expectedToolCalls,
            description: 'Expected tools were called',
          },
          output,
          toolCalls,
          durationMs,
          costUsd,
        ),
      );
    }

    if (testCase.maxLatencyMs !== undefined) {
      results.push(
        evaluateAssertion(
          {
            type: 'max_latency',
            expected: testCase.maxLatencyMs,
            description: `Latency under ${testCase.maxLatencyMs}ms`,
          },
          output,
          toolCalls,
          durationMs,
          costUsd,
        ),
      );
    }

    if (testCase.maxCost !== undefined) {
      results.push(
        evaluateAssertion(
          {
            type: 'max_cost',
            expected: testCase.maxCost,
            description: `Cost under $${testCase.maxCost}`,
          },
          output,
          toolCalls,
          durationMs,
          costUsd,
        ),
      );
    }

    // Evaluate explicit assertions
    if (testCase.assertions) {
      for (const assertion of testCase.assertions) {
        results.push(
          evaluateAssertion(assertion, output, toolCalls, durationMs, costUsd),
        );
      }
    }

    return results;
  }
}

// ─── Assertion Evaluation ───────────────────────────────────────────────────

function evaluateAssertion(
  assertion: Assertion,
  output: string,
  toolCalls: string[],
  durationMs: number,
  costUsd?: number,
): AssertionResult {
  switch (assertion.type) {
    case 'exact_match': {
      const expected = String(assertion.expected);
      const passed = exactMatch(expected, output) || exactMatchIgnoreCase(expected, output);
      return {
        assertion,
        passed,
        actual: output,
        score: passed ? 1 : 0,
        message: passed
          ? 'Exact match passed'
          : `Expected "${truncate(expected, 100)}", got "${truncate(output, 100)}"`,
      };
    }

    case 'contains': {
      const expected = String(assertion.expected);
      const passed = containsMatch(expected, output) || containsMatchIgnoreCase(expected, output);
      return {
        assertion,
        passed,
        actual: output,
        score: passed ? 1 : 0,
        message: passed
          ? 'Contains match passed'
          : `Output does not contain "${truncate(expected, 100)}"`,
      };
    }

    case 'fuzzy_match': {
      const expected = String(assertion.expected);
      const threshold = assertion.threshold ?? 0.8;
      const passed = fuzzyMatch(expected, output, threshold);
      const similarity = passed ? 1 : 0;
      return {
        assertion,
        passed,
        actual: output,
        score: similarity,
        message: passed
          ? `Fuzzy match passed (threshold: ${threshold})`
          : `Fuzzy match failed (threshold: ${threshold})`,
      };
    }

    case 'regex': {
      const pattern = String(assertion.expected);
      const passed = regexMatch(pattern, output);
      return {
        assertion,
        passed,
        actual: output,
        score: passed ? 1 : 0,
        message: passed
          ? `Regex /${pattern}/ matched`
          : `Regex /${pattern}/ did not match`,
      };
    }

    case 'tool_called': {
      const expected = assertion.expected as string[];
      const accuracy = toolCallAccuracy(expected, toolCalls);
      const passed = accuracy === 1.0;
      const missing = expected.filter((t) => !toolCalls.includes(t));
      return {
        assertion,
        passed,
        actual: toolCalls,
        score: accuracy,
        message: passed
          ? `All expected tools were called: ${expected.join(', ')}`
          : `Missing tool calls: ${missing.join(', ')}`,
      };
    }

    case 'tool_order': {
      const expected = assertion.expected as string[];
      const passed = toolCallOrder(expected, toolCalls);
      return {
        assertion,
        passed,
        actual: toolCalls,
        score: passed ? 1 : 0,
        message: passed
          ? 'Tool call order is correct'
          : `Expected order: ${expected.join(' -> ')}, got: ${toolCalls.join(' -> ')}`,
      };
    }

    case 'max_latency': {
      const maxLatency = assertion.expected as number;
      const passed = durationMs <= maxLatency;
      return {
        assertion,
        passed,
        actual: durationMs,
        score: passed ? 1 : Math.max(0, 1 - (durationMs - maxLatency) / maxLatency),
        message: passed
          ? `Latency ${durationMs.toFixed(0)}ms <= ${maxLatency}ms`
          : `Latency ${durationMs.toFixed(0)}ms exceeded max ${maxLatency}ms`,
      };
    }

    case 'max_cost': {
      const maxCost = assertion.expected as number;
      const actualCost = costUsd ?? 0;
      const passed = actualCost <= maxCost;
      return {
        assertion,
        passed,
        actual: actualCost,
        score: passed ? 1 : Math.max(0, 1 - (actualCost - maxCost) / maxCost),
        message: passed
          ? `Cost $${actualCost.toFixed(4)} <= $${maxCost.toFixed(4)}`
          : `Cost $${actualCost.toFixed(4)} exceeded max $${maxCost.toFixed(4)}`,
      };
    }

    case 'custom': {
      // Custom assertions are evaluated externally; we just pass through
      return {
        assertion,
        passed: false,
        actual: output,
        score: 0,
        message: 'Custom assertions must be evaluated externally',
      };
    }

    default: {
      return {
        assertion,
        passed: false,
        actual: output,
        score: 0,
        message: `Unknown assertion type: ${assertion.type}`,
      };
    }
  }
}

// ─── Scoring ────────────────────────────────────────────────────────────────

function computeScore(results: AssertionResult[]): number {
  if (results.length === 0) return 1;

  let totalWeight = 0;
  let weightedScore = 0;

  for (const result of results) {
    const weight = result.assertion.weight ?? 1;
    totalWeight += weight;
    weightedScore += result.score * weight;
  }

  return totalWeight > 0 ? weightedScore / totalWeight : 0;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function createBatches<T>(items: T[], batchSize: number): T[][] {
  if (!isFinite(batchSize) || batchSize <= 0) return [items];
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

async function* withTimeout<T>(
  iterable: AsyncIterable<T>,
  timeoutMs: number,
): AsyncIterable<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  const timeoutError = new Error(`Test case timed out after ${timeoutMs}ms`);

  while (true) {
    const result = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(timeoutError), timeoutMs)
      ),
    ]);

    if (result.done) break;
    yield result.value;
  }
}
