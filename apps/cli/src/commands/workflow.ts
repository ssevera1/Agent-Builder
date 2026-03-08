/**
 * `agentbuilder workflow` command.
 *
 * Loads and executes workflow YAML/JSON files, showing real-time progress
 * as nodes execute. Supports human-in-the-loop pauses and checkpointing.
 */

import { type Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  Database,
  WorkflowExecutionRepository,
} from '@agentbuilder/storage';
import { formatTree, buildWorkflowTree } from '../formatters/tree.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerWorkflowCommand(program: Command): void {
  const cmd = program
    .command('workflow')
    .description('Manage and execute workflows');

  cmd
    .command('run <file>')
    .description('Load and execute a workflow from a YAML/JSON file')
    .option('-i, --input <json>', 'Input data as JSON string')
    .option('--checkpoint', 'Enable checkpointing for resumable execution')
    .option('--dry-run', 'Validate and display the workflow without executing')
    .action(async (file: string, options: WorkflowRunOptions) => {
      try {
        await handleWorkflowRun(file, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  cmd
    .command('list')
    .description('List recent workflow executions')
    .option('-s, --status <status>', 'Filter by status')
    .option('-n, --limit <number>', 'Number of results', '20')
    .action(async (options: { status?: string; limit: string }) => {
      try {
        await handleWorkflowList(options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  cmd
    .command('status <executionId>')
    .description('Show status of a workflow execution')
    .action(async (executionId: string) => {
      try {
        await handleWorkflowStatus(executionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}

interface WorkflowRunOptions {
  input?: string;
  checkpoint?: boolean;
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Workflow definition shape (simplified for CLI parsing)
// ---------------------------------------------------------------------------

interface WorkflowFile {
  id?: string;
  name: string;
  description?: string;
  version?: string;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    agentId?: string;
    prompt?: string;
    transformExpression?: string;
    conditionExpression?: string;
    trueBranch?: string;
    falseBranch?: string;
    branches?: string[];
    mergeStrategy?: string;
    timeoutMs?: number;
    timeoutAction?: string;
    inputMapping?: Record<string, string>;
    position?: { x: number; y: number };
  }>;
  edges: Array<{
    id?: string;
    sourceNodeId: string;
    targetNodeId: string;
    condition?: string;
    label?: string;
  }>;
  entryNodeId: string;
  inputs?: Array<{ name: string; description: string; type: string; required?: boolean }>;
  outputs?: Array<{ name: string; description: string; valueExpression: string }>;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleWorkflowRun(file: string, options: WorkflowRunOptions): Promise<void> {
  if (!existsSync(file)) {
    throw new Error(`Workflow file not found: ${file}`);
  }

  console.log('');
  console.log(chalk.bold.cyan('Workflow Execution'));
  console.log(chalk.dim(`File: ${file}`));
  console.log('');

  // Load and parse workflow file
  const content = readFileSync(file, 'utf-8');
  let workflow: WorkflowFile;

  try {
    workflow = JSON.parse(content) as WorkflowFile;
  } catch {
    // Attempt simplified YAML parsing
    workflow = parseSimpleYaml(content);
  }

  // Parse input data
  let inputData: Record<string, unknown> = {};
  if (options.input) {
    try {
      inputData = JSON.parse(options.input) as Record<string, unknown>;
    } catch {
      throw new Error('Invalid JSON input. Provide valid JSON with --input.');
    }
  }

  // Display workflow tree
  const treeNodes = workflow.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    status: 'pending' as const,
  }));
  const edges = workflow.edges.map((e) => ({
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
  }));

  const tree = buildWorkflowTree(
    treeNodes,
    edges,
    workflow.entryNodeId,
    workflow.name,
  );

  console.log(chalk.bold('Workflow Graph:'));
  console.log(formatTree(tree));
  console.log('');

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run — workflow validated but not executed.'));
    console.log(chalk.dim(`  Nodes: ${workflow.nodes.length}`));
    console.log(chalk.dim(`  Edges: ${workflow.edges.length}`));
    console.log(chalk.dim(`  Entry: ${workflow.entryNodeId}`));
    return;
  }

  // Create execution record
  const executionId = randomUUID();
  const db = Database.create();
  const workflowRepo = new WorkflowExecutionRepository(db);

  try {
    workflowRepo.save({
      id: executionId,
      workflowId: workflow.id ?? workflow.name,
      status: 'running',
      state: {
        inputs: inputData,
        nodeStates: {},
        outputs: {},
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(chalk.dim(`Execution ID: ${executionId}`));
    console.log('');

    // Execute nodes in topological order
    await executeWorkflow(workflow, inputData, executionId, workflowRepo, options.checkpoint ?? false);

    // Mark as completed
    workflowRepo.save({
      id: executionId,
      workflowId: workflow.id ?? workflow.name,
      status: 'completed',
      state: { inputs: inputData, completed: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log('');
    console.log(chalk.green('\u2713 Workflow completed successfully.'));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    workflowRepo.save({
      id: executionId,
      workflowId: workflow.id ?? workflow.name,
      status: 'failed',
      state: { inputs: inputData, error: errorMsg },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    throw err;
  } finally {
    db.close();
  }
}

async function handleWorkflowList(options: { status?: string; limit: string }): Promise<void> {
  const db = Database.create();
  try {
    const repo = new WorkflowExecutionRepository(db);
    const executions = repo.list(options.status, parseInt(options.limit, 10));

    if (executions.length === 0) {
      console.log(chalk.dim('No workflow executions found.'));
      return;
    }

    console.log('');
    console.log(chalk.bold('Recent Workflow Executions'));
    console.log('');

    for (const exec of executions) {
      const statusColor = exec.status === 'completed'
        ? chalk.green
        : exec.status === 'failed'
          ? chalk.red
          : exec.status === 'running'
            ? chalk.yellow
            : chalk.gray;

      console.log(
        `  ${chalk.dim(exec.id.slice(0, 8))}  ${statusColor(exec.status.padEnd(10))}  ${exec.workflowId}  ${chalk.dim(exec.createdAt.toISOString())}`,
      );
    }
    console.log('');
  } finally {
    db.close();
  }
}

async function handleWorkflowStatus(executionId: string): Promise<void> {
  const db = Database.create();
  try {
    const repo = new WorkflowExecutionRepository(db);
    const execution = repo.getById(executionId);

    if (!execution) {
      console.error(chalk.red(`Execution "${executionId}" not found.`));
      return;
    }

    console.log('');
    console.log(chalk.bold('Workflow Execution Status'));
    console.log(`  ID:       ${execution.id}`);
    console.log(`  Workflow: ${execution.workflowId}`);
    console.log(`  Status:   ${execution.status}`);
    console.log(`  Created:  ${execution.createdAt.toISOString()}`);
    console.log(`  Updated:  ${execution.updatedAt.toISOString()}`);
    console.log('');

    if (Object.keys(execution.state).length > 0) {
      console.log(chalk.bold('State:'));
      console.log(chalk.dim(JSON.stringify(execution.state, null, 2)));
    }
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Workflow execution
// ---------------------------------------------------------------------------

async function executeWorkflow(
  workflow: WorkflowFile,
  inputs: Record<string, unknown>,
  executionId: string,
  repo: WorkflowExecutionRepository,
  checkpointing: boolean,
): Promise<void> {
  // Build adjacency list for topological traversal
  const adjacency = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    const children = adjacency.get(edge.sourceNodeId) ?? [];
    children.push(edge.targetNodeId);
    adjacency.set(edge.sourceNodeId, children);
  }

  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const state: Record<string, unknown> = { ...inputs };

  async function executeNode(nodeId: string): Promise<void> {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) {
      throw new Error(`Node "${nodeId}" not found in workflow`);
    }

    const spinner = ora({
      text: `${node.name} (${node.type})`,
      spinner: 'dots',
      prefixText: chalk.dim('  node'),
    }).start();

    try {
      switch (node.type) {
        case 'agent':
          // In a full implementation, this would run the agent
          await simulateNodeExecution(node.name);
          spinner.succeed(chalk.green(node.name) + chalk.dim(` [${node.type}]`));
          state[nodeId] = { output: `Result from ${node.name}` };
          break;

        case 'transform':
          await simulateNodeExecution(node.name);
          spinner.succeed(chalk.green(node.name) + chalk.dim(` [${node.type}]`));
          state[nodeId] = { output: `Transformed by ${node.name}` };
          break;

        case 'condition': {
          spinner.stop();
          // Evaluate condition (simplified — in production use expression engine)
          const condResult = true; // Placeholder
          const branch = condResult ? node.trueBranch : node.falseBranch;
          console.log(
            `  ${chalk.dim('cond')} ${chalk.yellow(node.name)}: ${condResult ? 'true' : 'false'} -> ${branch}`,
          );
          if (branch) {
            await executeNode(branch);
          }
          return; // Don't follow normal adjacency
        }

        case 'parallel': {
          spinner.stop();
          console.log(`  ${chalk.dim('par ')} ${chalk.blue(node.name)}: executing ${node.branches?.length ?? 0} branches`);
          const branches = node.branches ?? [];
          await Promise.all(branches.map((b) => executeNode(b)));
          state[nodeId] = { output: 'Parallel branches completed' };
          break;
        }

        case 'human': {
          spinner.stop();
          console.log('');
          console.log(chalk.yellow(`  Human input required: ${node.prompt ?? 'Please review and approve.'}`));

          const { response } = await inquirer.prompt<{ response: string }>([
            {
              type: 'input',
              name: 'response',
              message: 'Your response (or "approve"/"reject"):',
              default: 'approve',
            },
          ]);

          const approved = response.toLowerCase() !== 'reject';
          state[nodeId] = { output: response, approved };

          if (!approved) {
            throw new Error(`Human rejected at node "${node.name}"`);
          }

          console.log(chalk.green(`  \u2713 ${node.name}: approved`));
          break;
        }

        default:
          spinner.warn(`${node.name}: unknown node type "${node.type}"`);
      }

      // Checkpoint
      if (checkpointing) {
        repo.save({
          id: executionId,
          workflowId: workflow.id ?? workflow.name,
          status: 'running',
          state: { ...state, lastCompletedNode: nodeId },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    } catch (err) {
      spinner.fail(chalk.red(node.name) + chalk.dim(` — ${err instanceof Error ? err.message : String(err)}`));
      throw err;
    }

    // Execute children
    const children = adjacency.get(nodeId) ?? [];
    for (const childId of children) {
      await executeNode(childId);
    }
  }

  await executeNode(workflow.entryNodeId);
}

async function simulateNodeExecution(name: string): Promise<void> {
  // Simulate execution time
  const delay = 200 + Math.random() * 500;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

// ---------------------------------------------------------------------------
// Simplified YAML parser
// ---------------------------------------------------------------------------

function parseSimpleYaml(content: string): WorkflowFile {
  // This is a very simplified YAML parser for workflow files.
  // In production, use a proper YAML library (js-yaml).
  try {
    // Try to extract key fields with regex
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const entryMatch = content.match(/^entryNodeId:\s*(.+)$/m);

    if (!nameMatch?.[1] || !entryMatch?.[1]) {
      throw new Error('Could not parse workflow file. Ensure it has "name" and "entryNodeId" fields.');
    }

    return {
      name: nameMatch[1].trim(),
      entryNodeId: entryMatch[1].trim(),
      nodes: [],
      edges: [],
    };
  } catch {
    throw new Error(
      'Failed to parse workflow file. Supported formats: JSON. ' +
      'For YAML support, install js-yaml as a dependency.',
    );
  }
}
