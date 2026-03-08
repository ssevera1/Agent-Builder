/**
 * `agentbuilder init` command.
 *
 * Initializes a new AgentBuilder project in the current directory by
 * creating the directory structure, configuration file, and optionally
 * setting up a provider.
 */

import { type Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ensureDataDir } from '@agentbuilder/storage';
import { runProviderSetup } from '../prompts/provider-setup.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new AgentBuilder project in the current directory')
    .option('-n, --name <name>', 'Project name')
    .option('-y, --yes', 'Skip interactive prompts and use defaults')
    .action(async (options: { name?: string; yes?: boolean }) => {
      try {
        await handleInit(options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleInit(options: { name?: string; yes?: boolean }): Promise<void> {
  const cwd = process.cwd();

  console.log('');
  console.log(chalk.bold.cyan('AgentBuilder Project Initialization'));
  console.log(chalk.dim(`Directory: ${cwd}`));
  console.log('');

  // Check if already initialized
  const configPath = join(cwd, 'agentbuilder.config.yaml');
  if (existsSync(configPath)) {
    const { overwrite } = options.yes
      ? { overwrite: true }
      : await inquirer.prompt<{ overwrite: boolean }>([
          {
            type: 'confirm',
            name: 'overwrite',
            message: 'An agentbuilder.config.yaml already exists. Overwrite?',
            default: false,
          },
        ]);

    if (!overwrite) {
      console.log(chalk.yellow('Initialization cancelled.'));
      return;
    }
  }

  // Gather project info
  let projectName = options.name ?? basename(cwd);
  let setupProvider = false;

  if (!options.yes) {
    const answers = await inquirer.prompt<{
      projectName: string;
      setupProvider: boolean;
    }>([
      {
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: projectName,
      },
      {
        type: 'confirm',
        name: 'setupProvider',
        message: 'Set up an LLM provider now?',
        default: true,
      },
    ]);

    projectName = answers.projectName;
    setupProvider = answers.setupProvider;
  }

  // Run provider setup if requested
  let providerConfig = { providerId: 'anthropic', modelId: 'claude-sonnet-4-20250514' };
  if (setupProvider) {
    providerConfig = await runProviderSetup();
  }

  // Create directory structure
  const spinner = ora('Creating project structure...').start();

  const dirs = [
    join(cwd, 'agents'),
    join(cwd, 'workflows'),
    join(cwd, 'tests'),
    join(cwd, 'tools'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Ensure global data directory exists
  ensureDataDir();

  // Write config file
  const configContent = buildConfigYaml(projectName, providerConfig);
  writeFileSync(configPath, configContent, 'utf-8');

  // Write example agent
  const exampleAgentPath = join(cwd, 'agents', 'hello-world.yaml');
  if (!existsSync(exampleAgentPath)) {
    writeFileSync(exampleAgentPath, buildExampleAgent(), 'utf-8');
  }

  // Write example test
  const exampleTestPath = join(cwd, 'tests', 'hello-world.test.yaml');
  if (!existsSync(exampleTestPath)) {
    writeFileSync(exampleTestPath, buildExampleTest(), 'utf-8');
  }

  // Write .gitignore additions
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, buildGitignore(), 'utf-8');
  }

  spinner.succeed('Project structure created.');

  // Print getting started instructions
  console.log('');
  console.log(chalk.bold.green('Project initialized successfully!'));
  console.log('');
  console.log(chalk.bold('Project structure:'));
  console.log(chalk.dim('  agentbuilder.config.yaml  — project configuration'));
  console.log(chalk.dim('  agents/                   — agent definitions'));
  console.log(chalk.dim('  workflows/                — workflow definitions'));
  console.log(chalk.dim('  tests/                    — evaluation test suites'));
  console.log(chalk.dim('  tools/                    — custom tool plugins'));
  console.log('');
  console.log(chalk.bold('Getting started:'));
  console.log('');
  console.log(`  ${chalk.cyan('agentbuilder create')} ${chalk.dim('"a helpful research assistant"')}  — create an agent with AI`);
  console.log(`  ${chalk.cyan('agentbuilder create --interactive')}                    ${chalk.dim('— use the step-by-step wizard')}`);
  console.log(`  ${chalk.cyan('agentbuilder run')} ${chalk.dim('hello-world')}                        ${chalk.dim('— run the example agent')}`);
  console.log(`  ${chalk.cyan('agentbuilder test')} ${chalk.dim('hello-world')}                       ${chalk.dim('— test the example agent')}`);
  console.log('');
  console.log(chalk.dim('For more commands, run: agentbuilder --help'));
  console.log('');
}

// ---------------------------------------------------------------------------
// File generators
// ---------------------------------------------------------------------------

function buildConfigYaml(
  projectName: string,
  provider: { providerId: string; modelId: string },
): string {
  return `# AgentBuilder Project Configuration
# Generated by \`agentbuilder init\`

project:
  name: ${projectName}
  version: 0.1.0

defaults:
  provider: ${provider.providerId}
  model: ${provider.modelId}
  temperature: 0.7
  maxTokens: 4096
  maxTurns: 25

paths:
  agents: ./agents
  workflows: ./workflows
  tests: ./tests
  tools: ./tools

guardrails:
  enablePromptInjectionDetection: true
  enablePiiDetection: true
  maxInputLength: 100000
  maxOutputLength: 100000
`;
}

function buildExampleAgent(): string {
  return `# Example Agent: Hello World
# Run with: agentbuilder run hello-world

name: hello-world
description: A friendly greeting agent that demonstrates basic AgentBuilder capabilities
version: 0.1.0

pattern: react

systemPrompt: |
  You are a friendly assistant that greets users and answers basic questions.
  You have access to a calculator tool for math questions.
  Be warm, helpful, and concise in your responses.

tools:
  - calculator

memory:
  shortTermMaxMessages: 20
  longTermEnabled: false
  episodicEnabled: false

maxTurns: 10
temperature: 0.7
maxTokens: 2048
`;
}

function buildExampleTest(): string {
  return `# Example Test Suite for the Hello World agent
# Run with: agentbuilder test hello-world

agent: hello-world

testCases:
  - name: basic_greeting
    input: "Hello!"
    assertions:
      - type: contains
        value: "hello"
        description: Agent should greet the user

  - name: math_question
    input: "What is 42 * 17?"
    expectedToolCalls:
      - calculator
    assertions:
      - type: contains
        value: "714"
        description: Agent should calculate correctly

  - name: identity_question
    input: "What are you?"
    assertions:
      - type: contains
        value: "assistant"
        description: Agent should describe itself
`;
}

function buildGitignore(): string {
  return `# AgentBuilder
.env
.env.local
*.db
*.db-wal
*.db-shm

# Node
node_modules/
dist/

# OS
.DS_Store
Thumbs.db
`;
}
