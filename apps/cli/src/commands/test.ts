/**
 * `agentbuilder test <agent-name>` command.
 *
 * Runs an evaluation suite against a specified agent, displaying
 * progress and results in real time. Supports custom datasets and
 * multiple output formats.
 */

import { type Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AgentConfig } from '@agentbuilder/core';
import {
  Database,
  AgentConfigRepository,
  EvaluationRepository,
  type StoredEvalResult,
} from '@agentbuilder/storage';
import { formatTable } from '../formatters/table.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerTestCommand(program: Command): void {
  program
    .command('test <agent-name>')
    .description('Run evaluation tests against an agent')
    .option('-d, --dataset <file>', 'Path to a test dataset YAML/JSON file')
    .option('-r, --report <format>', 'Output format: console, json, html', 'console')
    .option('--compare <agent>', 'Compare results with another agent')
    .option('--save', 'Save test results to the database')
    .action(async (agentName: string, options: TestOptions) => {
      try {
        await handleTest(agentName, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}

interface TestOptions {
  dataset?: string;
  report: string;
  compare?: string;
  save?: boolean;
}

// ---------------------------------------------------------------------------
// Test case definition
// ---------------------------------------------------------------------------

interface TestCase {
  name: string;
  input: string;
  expectedOutput?: string;
  expectedToolCalls?: string[];
  maxLatencyMs?: number;
  assertions?: Array<{
    type: string;
    value: string;
    description?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleTest(agentName: string, options: TestOptions): Promise<void> {
  const db = Database.create();

  try {
    // Load agent
    const agentRepo = new AgentConfigRepository(db);
    const config = agentRepo.getByName(agentName) ?? agentRepo.getById(agentName);

    if (!config) {
      console.error(chalk.red(`Agent "${agentName}" not found.`));
      const agents = agentRepo.list({ limit: 10 });
      if (agents.length > 0) {
        console.log(chalk.dim('\nAvailable agents:'));
        for (const a of agents) {
          console.log(`  ${chalk.cyan(a.name)}`);
        }
      }
      return;
    }

    console.log('');
    console.log(chalk.bold.cyan('Agent Evaluation'));
    console.log(chalk.dim(`Testing: ${config.name} (${config.pattern})`));
    console.log(chalk.dim(`Provider: ${config.provider.providerId}/${config.provider.modelId}`));
    console.log('');

    // Load test cases
    const testCases = loadTestCases(options.dataset, config);
    if (testCases.length === 0) {
      console.log(chalk.yellow('No test cases found.'));
      console.log(chalk.dim('Provide a test file with --dataset or create tests in your tests/ directory.'));
      return;
    }

    console.log(chalk.dim(`Running ${testCases.length} test case${testCases.length !== 1 ? 's' : ''}...`));
    console.log('');

    // Run tests
    const results: StoredEvalResult[] = [];
    let passed = 0;
    let failed = 0;

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i]!;
      const spinner = ora({
        text: `[${i + 1}/${testCases.length}] ${tc.name}`,
        spinner: 'dots',
      }).start();

      const startTime = performance.now();

      try {
        const result = await runTestCase(config, tc);
        const latencyMs = performance.now() - startTime;

        const evalResult: StoredEvalResult = {
          testCaseId: tc.name.replace(/\s+/g, '-').toLowerCase(),
          testCaseName: tc.name,
          passed: result.passed,
          score: result.passed ? 1.0 : 0.0,
          actualOutput: result.output,
          assertionResults: result.assertions,
          metrics: [
            { name: 'latency', value: latencyMs, unit: 'ms' },
          ],
          latencyMs,
          totalTokens: result.estimatedTokens,
          error: result.error,
          timestamp: new Date().toISOString(),
        };

        results.push(evalResult);

        if (result.passed) {
          passed++;
          spinner.succeed(
            chalk.green(`[${i + 1}/${testCases.length}] ${tc.name}`) +
            chalk.dim(` (${latencyMs.toFixed(0)}ms)`),
          );
        } else {
          failed++;
          spinner.fail(
            chalk.red(`[${i + 1}/${testCases.length}] ${tc.name}`) +
            chalk.dim(` — ${result.failReason}`),
          );
        }
      } catch (err) {
        failed++;
        const latencyMs = performance.now() - startTime;
        const errorMsg = err instanceof Error ? err.message : String(err);

        spinner.fail(
          chalk.red(`[${i + 1}/${testCases.length}] ${tc.name}`) +
          chalk.dim(` — Error: ${errorMsg.slice(0, 100)}`),
        );

        results.push({
          testCaseId: tc.name.replace(/\s+/g, '-').toLowerCase(),
          testCaseName: tc.name,
          passed: false,
          score: 0,
          actualOutput: '',
          assertionResults: [],
          metrics: [],
          latencyMs,
          totalTokens: 0,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Display summary
    console.log('');
    console.log(chalk.bold('Results Summary'));
    console.log(chalk.dim('─'.repeat(50)));

    const passRate = testCases.length > 0 ? (passed / testCases.length) * 100 : 0;
    const avgLatency = results.length > 0
      ? results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length
      : 0;

    const passRateColor = passRate === 100 ? chalk.green : passRate >= 50 ? chalk.yellow : chalk.red;

    console.log(`  Total:     ${testCases.length}`);
    console.log(`  Passed:    ${chalk.green(passed.toString())}`);
    console.log(`  Failed:    ${failed > 0 ? chalk.red(failed.toString()) : '0'}`);
    console.log(`  Pass Rate: ${passRateColor(`${passRate.toFixed(1)}%`)}`);
    console.log(`  Avg Latency: ${avgLatency.toFixed(0)}ms`);
    console.log('');

    // Generate report
    if (options.report === 'json') {
      const reportPath = `test-report-${config.name}-${Date.now()}.json`;
      const report = {
        agent: config.name,
        timestamp: new Date().toISOString(),
        summary: { total: testCases.length, passed, failed, passRate },
        results,
      };
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(chalk.dim(`Report saved to: ${reportPath}`));
    } else if (options.report === 'html') {
      const reportPath = `test-report-${config.name}-${Date.now()}.html`;
      writeFileSync(reportPath, generateHtmlReport(config, results, { passed, failed, passRate }));
      console.log(chalk.dim(`Report saved to: ${reportPath}`));
    }

    // Save to database
    if (options.save) {
      const evalRepo = new EvaluationRepository(db);
      const runId = randomUUID();
      evalRepo.saveRun(runId, config.id, results);
      console.log(chalk.dim(`Results saved with run ID: ${runId}`));
    }

    // Compare with another agent
    if (options.compare) {
      await showComparison(db, config, options.compare, results);
    }

    // Exit with appropriate code
    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Test case loading
// ---------------------------------------------------------------------------

function loadTestCases(datasetPath: string | undefined, config: AgentConfig): TestCase[] {
  if (datasetPath) {
    if (!existsSync(datasetPath)) {
      throw new Error(`Test dataset file not found: ${datasetPath}`);
    }
    return parseTestFile(readFileSync(datasetPath, 'utf-8'));
  }

  // Try to find test files in the tests/ directory
  const testPaths = [
    `tests/${config.name}.test.yaml`,
    `tests/${config.name}.test.json`,
    `tests/${config.name}.yaml`,
    `tests/${config.name}.json`,
  ];

  for (const path of testPaths) {
    if (existsSync(path)) {
      return parseTestFile(readFileSync(path, 'utf-8'));
    }
  }

  // Generate basic test cases from the agent's description
  return generateDefaultTestCases(config);
}

function parseTestFile(content: string): TestCase[] {
  // Try JSON first
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    const testCases = (data['testCases'] ?? data['tests'] ?? data) as TestCase[];
    if (Array.isArray(testCases)) {
      return testCases;
    }
  } catch {
    // Not JSON, try YAML-like parsing (simplified)
  }

  // Simple YAML-like parsing for test cases
  const cases: TestCase[] = [];
  const blocks = content.split(/^  - /m).slice(1);

  for (const block of blocks) {
    const nameMatch = block.match(/name:\s*(.+)/);
    const inputMatch = block.match(/input:\s*"(.+?)"/);
    const expectedMatch = block.match(/expectedOutput:\s*"(.+?)"/);

    if (nameMatch?.[1] && inputMatch?.[1]) {
      cases.push({
        name: nameMatch[1].trim(),
        input: inputMatch[1].trim(),
        expectedOutput: expectedMatch?.[1]?.trim(),
      });
    }
  }

  return cases;
}

function generateDefaultTestCases(config: AgentConfig): TestCase[] {
  // Generate basic smoke tests
  return [
    {
      name: 'basic_response',
      input: 'Hello, who are you?',
      assertions: [
        { type: 'not_empty', value: '', description: 'Agent should respond' },
      ],
    },
    {
      name: 'task_understanding',
      input: `What can you help me with?`,
      assertions: [
        { type: 'not_empty', value: '', description: 'Agent should explain capabilities' },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Test case execution
// ---------------------------------------------------------------------------

interface TestResult {
  passed: boolean;
  output: string;
  failReason?: string;
  assertions: Array<{ type: string; passed: boolean; message: string }>;
  estimatedTokens: number;
  error?: string;
}

async function runTestCase(config: AgentConfig, testCase: TestCase): Promise<TestResult> {
  const apiKey = config.provider.apiKey ?? getApiKeyFromEnv(config.provider.providerId);

  if (!apiKey) {
    return {
      passed: false,
      output: '',
      failReason: `No API key for ${config.provider.providerId}`,
      assertions: [],
      estimatedTokens: 0,
      error: `No API key configured for ${config.provider.providerId}`,
    };
  }

  // Call the LLM
  const messages = [
    { role: 'system', content: config.systemPrompt },
    { role: 'user', content: testCase.input },
  ];

  const response = await callLLMForTest(
    config.provider.providerId,
    config.provider.modelId,
    apiKey,
    messages,
    config.temperature,
    config.maxTokens,
  );

  // Run assertions
  const assertions: Array<{ type: string; passed: boolean; message: string }> = [];
  let allPassed = true;

  // Check expected output
  if (testCase.expectedOutput) {
    const contains = response.toLowerCase().includes(testCase.expectedOutput.toLowerCase());
    assertions.push({
      type: 'contains',
      passed: contains,
      message: contains
        ? `Output contains "${testCase.expectedOutput}"`
        : `Output does not contain "${testCase.expectedOutput}"`,
    });
    if (!contains) allPassed = false;
  }

  // Check custom assertions
  if (testCase.assertions) {
    for (const assertion of testCase.assertions) {
      const result = evaluateAssertion(assertion, response);
      assertions.push(result);
      if (!result.passed) allPassed = false;
    }
  }

  // If no assertions were defined, just check that we got a non-empty response
  if (assertions.length === 0) {
    const nonEmpty = response.trim().length > 0;
    assertions.push({
      type: 'not_empty',
      passed: nonEmpty,
      message: nonEmpty ? 'Got a response' : 'Empty response',
    });
    if (!nonEmpty) allPassed = false;
  }

  const failReasons = assertions
    .filter((a) => !a.passed)
    .map((a) => a.message);

  return {
    passed: allPassed,
    output: response,
    failReason: failReasons.join('; '),
    assertions,
    estimatedTokens: Math.ceil(
      (config.systemPrompt.length + testCase.input.length + response.length) / 4,
    ),
  };
}

function evaluateAssertion(
  assertion: { type: string; value: string; description?: string },
  output: string,
): { type: string; passed: boolean; message: string } {
  const desc = assertion.description ?? assertion.type;

  switch (assertion.type) {
    case 'contains':
      return {
        type: 'contains',
        passed: output.toLowerCase().includes(assertion.value.toLowerCase()),
        message: `${desc}: ${output.toLowerCase().includes(assertion.value.toLowerCase()) ? 'pass' : 'fail'}`,
      };

    case 'not_contains':
      return {
        type: 'not_contains',
        passed: !output.toLowerCase().includes(assertion.value.toLowerCase()),
        message: `${desc}: ${!output.toLowerCase().includes(assertion.value.toLowerCase()) ? 'pass' : 'fail'}`,
      };

    case 'regex': {
      try {
        const regex = new RegExp(assertion.value, 'i');
        const matches = regex.test(output);
        return { type: 'regex', passed: matches, message: `${desc}: ${matches ? 'pass' : 'fail'}` };
      } catch {
        return { type: 'regex', passed: false, message: `${desc}: invalid regex` };
      }
    }

    case 'exact':
      return {
        type: 'exact',
        passed: output.trim() === assertion.value.trim(),
        message: `${desc}: ${output.trim() === assertion.value.trim() ? 'pass' : 'fail'}`,
      };

    case 'not_empty':
      return {
        type: 'not_empty',
        passed: output.trim().length > 0,
        message: `${desc}: ${output.trim().length > 0 ? 'pass' : 'fail'}`,
      };

    default:
      return { type: assertion.type, passed: true, message: `${desc}: skipped (unknown type)` };
  }
}

// ---------------------------------------------------------------------------
// LLM helper (minimal implementation)
// ---------------------------------------------------------------------------

async function callLLMForTest(
  providerId: string,
  modelId: string,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;

  switch (providerId) {
    case 'anthropic': {
      const systemMsg = messages.find((m) => m.role === 'system');
      const chatMessages = messages.filter((m) => m.role !== 'system');
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = {
        model: modelId,
        max_tokens: Math.min(maxTokens, 1024), // Limit for tests
        temperature,
        system: systemMsg?.content ?? '',
        messages: chatMessages,
      };
      break;
    }
    case 'openai':
    default:
      url = 'https://api.openai.com/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
      body = { model: modelId, max_tokens: Math.min(maxTokens, 1024), temperature, messages };
      break;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json() as Record<string, unknown>;

  switch (providerId) {
    case 'anthropic': {
      const content = data['content'] as Array<{ type: string; text?: string }> | undefined;
      return content?.find((b) => b.type === 'text')?.text ?? '';
    }
    case 'openai':
    default: {
      const choices = data['choices'] as Array<{ message?: { content?: string } }> | undefined;
      return choices?.[0]?.message?.content ?? '';
    }
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

async function showComparison(
  db: Database,
  currentConfig: AgentConfig,
  otherAgentName: string,
  currentResults: StoredEvalResult[],
): Promise<void> {
  const evalRepo = new EvaluationRepository(db);
  const agentRepo = new AgentConfigRepository(db);

  const otherConfig = agentRepo.getByName(otherAgentName);
  if (!otherConfig) {
    console.log(chalk.yellow(`Cannot compare: agent "${otherAgentName}" not found.`));
    return;
  }

  const otherRuns = evalRepo.listRunsByAgent(otherConfig.id, 1);
  if (otherRuns.length === 0) {
    console.log(chalk.yellow(`No test results found for "${otherAgentName}". Run tests first.`));
    return;
  }

  const otherResults = evalRepo.getRun(otherRuns[0]!.runId);
  const currentPassed = currentResults.filter((r) => r.passed).length;
  const otherPassed = otherResults.filter((r) => r.passed).length;

  console.log('');
  console.log(chalk.bold('Comparison'));
  console.log(
    formatTable(
      ['Metric', currentConfig.name, otherConfig.name],
      [
        ['Pass Rate', `${((currentPassed / currentResults.length) * 100).toFixed(1)}%`, `${((otherPassed / otherResults.length) * 100).toFixed(1)}%`],
        ['Passed', currentPassed.toString(), otherPassed.toString()],
        ['Failed', (currentResults.length - currentPassed).toString(), (otherResults.length - otherPassed).toString()],
        ['Total', currentResults.length.toString(), otherResults.length.toString()],
      ],
    ),
  );
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

function generateHtmlReport(
  config: AgentConfig,
  results: StoredEvalResult[],
  summary: { passed: number; failed: number; passRate: number },
): string {
  const rows = results
    .map((r) => {
      const status = r.passed ? '<span style="color: green">PASS</span>' : '<span style="color: red">FAIL</span>';
      return `<tr><td>${r.testCaseName}</td><td>${status}</td><td>${r.latencyMs.toFixed(0)}ms</td><td>${r.error ?? '-'}</td></tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html><head><title>Test Report: ${config.name}</title>
<style>
body { font-family: system-ui; margin: 2rem; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
th { background: #f4f4f4; }
.summary { display: flex; gap: 2rem; margin: 1rem 0; }
.stat { padding: 1rem; background: #f9f9f9; border-radius: 8px; }
</style></head>
<body>
<h1>Test Report: ${config.name}</h1>
<p>Generated: ${new Date().toISOString()} | Pattern: ${config.pattern} | Provider: ${config.provider.providerId}/${config.provider.modelId}</p>
<div class="summary">
  <div class="stat"><strong>${results.length}</strong><br>Total</div>
  <div class="stat" style="color:green"><strong>${summary.passed}</strong><br>Passed</div>
  <div class="stat" style="color:red"><strong>${summary.failed}</strong><br>Failed</div>
  <div class="stat"><strong>${summary.passRate.toFixed(1)}%</strong><br>Pass Rate</div>
</div>
<table><thead><tr><th>Test Case</th><th>Status</th><th>Latency</th><th>Error</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKeyFromEnv(providerId: string): string | undefined {
  const envVars: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
    mistral: 'MISTRAL_API_KEY',
  };
  return process.env[envVars[providerId] ?? `${providerId.toUpperCase()}_API_KEY`];
}
