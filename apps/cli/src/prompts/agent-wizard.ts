/**
 * Interactive agent creation wizard.
 *
 * Walks the user through a step-by-step process to build a complete
 * AgentConfig, including pattern selection, provider setup, tool
 * selection, and memory configuration.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import type { AgentConfig, AgentPatternType, MemoryConfig } from '@agentbuilder/core';
import { getKnownProviders } from './provider-setup.js';
import { getDefaults, getProviderApiKey } from '@agentbuilder/storage';

// ---------------------------------------------------------------------------
// Pattern descriptions
// ---------------------------------------------------------------------------

interface PatternInfo {
  type: AgentPatternType;
  name: string;
  description: string;
  bestFor: string;
}

const PATTERNS: PatternInfo[] = [
  {
    type: 'react',
    name: 'ReAct (Reason + Act)',
    description: 'Interleaves reasoning with tool use in an iterative loop',
    bestFor: 'General-purpose agents, Q&A with tool use',
  },
  {
    type: 'plan-and-execute',
    name: 'Plan and Execute',
    description: 'Creates a plan first, then executes each step sequentially',
    bestFor: 'Complex multi-step tasks, research, analysis',
  },
  {
    type: 'tool-augmented',
    name: 'Tool-Augmented',
    description: 'Simple tool-calling agent without explicit reasoning steps',
    bestFor: 'Straightforward tool interactions, API wrappers',
  },
  {
    type: 'rag',
    name: 'RAG (Retrieval-Augmented Generation)',
    description: 'Retrieves context from a knowledge base before generating',
    bestFor: 'Knowledge-base Q&A, documentation assistants',
  },
  {
    type: 'multi-agent',
    name: 'Multi-Agent Orchestration',
    description: 'Coordinates multiple specialized sub-agents',
    bestFor: 'Complex workflows, specialized task delegation',
  },
];

// ---------------------------------------------------------------------------
// Available tools for selection
// ---------------------------------------------------------------------------

interface ToolChoice {
  name: string;
  description: string;
  category: string;
}

const AVAILABLE_TOOLS: ToolChoice[] = [
  { name: 'calculator', description: 'Safe mathematical expression evaluator', category: 'Math' },
  { name: 'web_search', description: 'Search the web for information', category: 'Search' },
  { name: 'web_fetch', description: 'Fetch content from URLs', category: 'Web' },
  { name: 'file_read', description: 'Read file contents', category: 'Filesystem' },
  { name: 'file_write', description: 'Write content to files', category: 'Filesystem' },
  { name: 'file_list', description: 'List directory contents', category: 'Filesystem' },
  { name: 'shell_exec', description: 'Execute shell commands', category: 'System' },
  { name: 'json_parse', description: 'Parse and query JSON data', category: 'Data' },
  { name: 'http_request', description: 'Make HTTP API requests', category: 'Web' },
  { name: 'code_execute', description: 'Execute code snippets safely', category: 'Code' },
];

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

/**
 * Run the interactive agent creation wizard.
 *
 * @returns A complete AgentConfig object.
 */
export async function runAgentWizard(): Promise<AgentConfig> {
  console.log('');
  console.log(chalk.bold.cyan('Agent Creation Wizard'));
  console.log(chalk.dim('Answer a few questions to configure your agent.'));
  console.log('');

  // ── Step 1: Basic info ──────────────────────────────────────────────────

  console.log(chalk.bold('Step 1/6: ') + 'Basic Information');
  const basicInfo = await inquirer.prompt<{
    description: string;
    name: string;
  }>([
    {
      type: 'input',
      name: 'description',
      message: 'What should this agent do?',
      validate: (input: string) =>
        input.length > 0 ? true : 'Please describe what the agent should do',
    },
    {
      type: 'input',
      name: 'name',
      message: 'Agent name:',
      default: (answers: { description: string }) => {
        // Generate a name from the description
        return answers.description
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)
          .slice(0, 3)
          .join('-');
      },
      validate: (input: string) =>
        /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(input) || input.length === 1
          ? true
          : 'Name must be lowercase alphanumeric with hyphens (e.g., my-agent)',
    },
  ]);

  // ── Step 2: Pattern selection ───────────────────────────────────────────

  console.log('');
  console.log(chalk.bold('Step 2/6: ') + 'Execution Pattern');
  const { pattern } = await inquirer.prompt<{ pattern: AgentPatternType }>([
    {
      type: 'list',
      name: 'pattern',
      message: 'Choose an execution pattern:',
      choices: PATTERNS.map((p) => ({
        name: `${chalk.bold(p.name)}\n    ${chalk.dim(p.description)}\n    ${chalk.dim.italic(`Best for: ${p.bestFor}`)}`,
        value: p.type,
        short: p.name,
      })),
      default: 'react',
    },
  ]);

  // ── Step 3: Provider and model ──────────────────────────────────────────

  console.log('');
  console.log(chalk.bold('Step 3/6: ') + 'LLM Provider');

  const defaults = getDefaults();
  const providers = getKnownProviders();

  const { providerId } = await inquirer.prompt<{ providerId: string }>([
    {
      type: 'list',
      name: 'providerId',
      message: 'Choose a provider:',
      choices: providers.map((p) => ({
        name: `${p.name} — ${chalk.dim(p.description)}`,
        value: p.id,
        short: p.name,
      })),
      default: defaults.providerId ?? 'anthropic',
    },
  ]);

  const selectedProvider = providers.find((p) => p.id === providerId)!;
  const { modelId } = await inquirer.prompt<{ modelId: string }>([
    {
      type: 'list',
      name: 'modelId',
      message: 'Choose a model:',
      choices: selectedProvider.models.map((m) => ({
        name: m,
        value: m,
      })),
      default: selectedProvider.defaultModel,
    },
  ]);

  // ── Step 4: Tool selection ──────────────────────────────────────────────

  console.log('');
  console.log(chalk.bold('Step 4/6: ') + 'Tools');
  const { selectedTools } = await inquirer.prompt<{ selectedTools: string[] }>([
    {
      type: 'checkbox',
      name: 'selectedTools',
      message: 'Select tools to enable:',
      choices: AVAILABLE_TOOLS.map((t) => ({
        name: `${t.name} — ${chalk.dim(t.description)} ${chalk.dim.italic(`[${t.category}]`)}`,
        value: t.name,
        short: t.name,
        checked: t.name === 'calculator', // calculator is selected by default
      })),
    },
  ]);

  // ── Step 5: Memory configuration ────────────────────────────────────────

  console.log('');
  console.log(chalk.bold('Step 5/6: ') + 'Memory');
  const memoryAnswers = await inquirer.prompt<{
    enableLongTerm: boolean;
    enableEpisodic: boolean;
    shortTermMax: number;
  }>([
    {
      type: 'confirm',
      name: 'enableLongTerm',
      message: 'Enable long-term memory (vector-based recall)?',
      default: pattern === 'rag',
    },
    {
      type: 'confirm',
      name: 'enableEpisodic',
      message: 'Enable episodic memory (learn from past interactions)?',
      default: false,
    },
    {
      type: 'number',
      name: 'shortTermMax',
      message: 'Maximum short-term messages to retain:',
      default: 50,
      validate: (input: number) =>
        input >= 1 && input <= 1000 ? true : 'Must be between 1 and 1000',
    },
  ]);

  const memoryConfig: MemoryConfig = {
    shortTermMaxMessages: memoryAnswers.shortTermMax,
    longTermEnabled: memoryAnswers.enableLongTerm,
    longTermTopK: 5,
    episodicEnabled: memoryAnswers.enableEpisodic,
    episodicTopK: 3,
  };

  // ── Step 6: Review and confirm ──────────────────────────────────────────

  console.log('');
  console.log(chalk.bold('Step 6/6: ') + 'Review');
  console.log('');
  console.log(chalk.bold('  Name:        ') + basicInfo.name);
  console.log(chalk.bold('  Description: ') + basicInfo.description);
  console.log(chalk.bold('  Pattern:     ') + pattern);
  console.log(chalk.bold('  Provider:    ') + `${providerId} / ${modelId}`);
  console.log(chalk.bold('  Tools:       ') + (selectedTools.length > 0 ? selectedTools.join(', ') : 'none'));
  console.log(chalk.bold('  Memory:      ') + `short-term=${memoryConfig.shortTermMaxMessages}, long-term=${memoryConfig.longTermEnabled ? 'on' : 'off'}, episodic=${memoryConfig.episodicEnabled ? 'on' : 'off'}`);
  console.log('');

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Create this agent?',
      default: true,
    },
  ]);

  if (!confirmed) {
    throw new Error('Agent creation cancelled by user');
  }

  // Build a system prompt based on the description
  const systemPrompt = buildSystemPrompt(basicInfo.description, pattern, selectedTools);

  // Resolve API key
  const apiKey = getProviderApiKey(providerId) ?? process.env[selectedProvider.apiKeyEnvVar] ?? undefined;

  const config: AgentConfig = {
    id: randomUUID(),
    name: basicInfo.name,
    description: basicInfo.description,
    version: '0.1.0',
    provider: {
      providerId,
      modelId,
      apiKey,
    },
    pattern,
    systemPrompt,
    tools: selectedTools,
    memoryConfig,
    guardrailRules: [],
    maxTurns: 25,
    temperature: 0.7,
    maxTokens: 4096,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return config;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  description: string,
  pattern: AgentPatternType,
  tools: string[],
): string {
  const lines: string[] = [];

  lines.push(`You are an AI agent designed to: ${description}`);
  lines.push('');

  // Pattern-specific instructions
  switch (pattern) {
    case 'react':
      lines.push('## Approach');
      lines.push('Use the ReAct pattern: think about what to do, take action using tools, observe the result, and repeat until the task is complete.');
      lines.push('Always explain your reasoning before taking action.');
      break;
    case 'plan-and-execute':
      lines.push('## Approach');
      lines.push('1. First, analyze the task and create a clear step-by-step plan.');
      lines.push('2. Execute each step in order, using tools as needed.');
      lines.push('3. After each step, evaluate progress and adjust the plan if necessary.');
      lines.push('4. Summarize the results when complete.');
      break;
    case 'tool-augmented':
      lines.push('## Approach');
      lines.push('You have access to tools that extend your capabilities. Use them when the task requires specific actions or data retrieval. Respond conversationally otherwise.');
      break;
    case 'rag':
      lines.push('## Approach');
      lines.push('When answering questions, first search your knowledge base for relevant context. Ground your responses in the retrieved information and cite your sources.');
      lines.push('If you cannot find relevant information, say so rather than making things up.');
      break;
    case 'multi-agent':
      lines.push('## Approach');
      lines.push('You coordinate multiple specialized sub-agents to complete complex tasks. Delegate specific subtasks to the appropriate agent and synthesize their results.');
      break;
  }

  if (tools.length > 0) {
    lines.push('');
    lines.push('## Available Tools');
    lines.push(`You have access to the following tools: ${tools.join(', ')}`);
    lines.push('Use them when appropriate to complete the task.');
  }

  lines.push('');
  lines.push('## Guidelines');
  lines.push('- Be concise, accurate, and helpful.');
  lines.push('- If you are unsure about something, ask for clarification.');
  lines.push('- Always explain your actions and reasoning.');

  return lines.join('\n');
}
