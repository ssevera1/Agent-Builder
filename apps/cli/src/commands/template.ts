/**
 * `agentbuilder template` command.
 *
 * Manages agent blueprints/templates. Users can list, view, and apply
 * pre-built agent templates to quickly create agents for common use cases.
 */

import { type Command } from 'commander';
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import type { AgentConfig, AgentPatternType, MemoryConfig } from '@agentbuilder/core';
import {
  Database,
  AgentConfigRepository,
  getDefaults,
  getProviderApiKey,
} from '@agentbuilder/storage';
import { formatTable } from '../formatters/table.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerTemplateCommand(program: Command): void {
  const cmd = program
    .command('template')
    .description('Manage agent blueprints and templates');

  cmd
    .command('list')
    .description('List available agent templates')
    .option('-c, --category <category>', 'Filter by category')
    .action((options: { category?: string }) => {
      handleTemplateList(options);
    });

  cmd
    .command('show <name>')
    .description('Show detailed information about a template')
    .action((name: string) => {
      handleTemplateShow(name);
    });

  cmd
    .command('apply <name>')
    .description('Create an agent from a template')
    .option('-n, --name <agentName>', 'Override agent name')
    .option('-p, --provider <provider>', 'Override provider')
    .option('-m, --model <model>', 'Override model')
    .action(async (name: string, options: ApplyOptions) => {
      try {
        await handleTemplateApply(name, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}

interface ApplyOptions {
  name?: string;
  provider?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  pattern: AgentPatternType;
  systemPrompt: string;
  tools: string[];
  memoryConfig: MemoryConfig;
  temperature: number;
  maxTurns: number;
  maxTokens: number;
  samplePrompts: string[];
}

const BUILT_IN_TEMPLATES: Template[] = [
  {
    id: 'research-assistant',
    name: 'Research Assistant',
    description: 'A thorough research agent that plans and executes multi-step research tasks, synthesizing findings into comprehensive reports.',
    category: 'research',
    pattern: 'plan-and-execute',
    systemPrompt: `You are an expert research assistant. Your job is to conduct thorough research on any topic the user asks about.

## Approach
1. Break down the research question into sub-questions
2. Search for information systematically
3. Cross-reference findings from multiple sources
4. Synthesize information into a clear, well-structured report
5. Cite your sources and note any conflicting information

## Guidelines
- Be thorough but concise
- Distinguish between facts, expert opinions, and speculation
- Note the recency and reliability of sources
- If you cannot find definitive information, say so
- Present multiple perspectives when the topic is debatable
- Use bullet points and headers for readability`,
    tools: ['web_search', 'web_fetch', 'calculator'],
    memoryConfig: {
      shortTermMaxMessages: 100,
      longTermEnabled: true,
      longTermTopK: 10,
      episodicEnabled: true,
      episodicTopK: 5,
    },
    temperature: 0.3,
    maxTurns: 30,
    maxTokens: 8192,
    samplePrompts: [
      'Research the current state of quantum computing and its potential commercial applications',
      'Compare the top 5 JavaScript frameworks by performance, community, and enterprise adoption',
      'What are the latest developments in renewable energy storage technology?',
    ],
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'An expert code review agent that analyzes code for bugs, security issues, performance problems, and style improvements.',
    category: 'development',
    pattern: 'react',
    systemPrompt: `You are an expert code reviewer with deep knowledge of software engineering best practices.

## Your Review Process
1. Read the code carefully, understanding its purpose and context
2. Check for bugs, logic errors, and edge cases
3. Identify security vulnerabilities (injection, auth issues, data exposure)
4. Spot performance issues and optimization opportunities
5. Evaluate code style, readability, and maintainability
6. Suggest specific, actionable improvements with code examples

## Review Categories
Rate each area on a scale of 1-5:
- **Correctness**: Does it work as intended?
- **Security**: Are there vulnerabilities?
- **Performance**: Is it efficient?
- **Readability**: Is it easy to understand?
- **Maintainability**: Is it easy to modify?

## Guidelines
- Be constructive, not critical — focus on improvement
- Provide concrete code suggestions, not vague advice
- Prioritize issues by severity (critical > major > minor > style)
- Acknowledge good patterns and practices you see
- Consider the broader system context`,
    tools: ['file_read', 'file_list', 'code_execute'],
    memoryConfig: {
      shortTermMaxMessages: 50,
      longTermEnabled: false,
      longTermTopK: 5,
      episodicEnabled: false,
      episodicTopK: 3,
    },
    temperature: 0.2,
    maxTurns: 15,
    maxTokens: 4096,
    samplePrompts: [
      'Review this Python function for security issues and performance',
      'Check this React component for best practices and potential bugs',
      'Analyze this SQL query for performance optimization opportunities',
    ],
  },
  {
    id: 'customer-support',
    name: 'Customer Support Agent',
    description: 'A helpful customer support agent with access to knowledge bases, able to troubleshoot issues and answer product questions.',
    category: 'customer-support',
    pattern: 'rag',
    systemPrompt: `You are a friendly and professional customer support agent.

## Your Role
- Help customers with product questions, troubleshooting, and account issues
- Search the knowledge base for accurate, up-to-date information
- Escalate complex issues that you cannot resolve

## Interaction Style
- Be warm, empathetic, and patient
- Use clear, simple language (avoid jargon)
- Acknowledge the customer's frustration when appropriate
- Always confirm you understood the issue before offering solutions

## Problem Solving
1. Understand the customer's issue clearly (ask clarifying questions if needed)
2. Search the knowledge base for relevant solutions
3. Provide step-by-step instructions when applicable
4. Verify the solution resolved the issue
5. Offer additional help before closing

## Escalation
Escalate to a human agent if:
- The issue involves billing disputes over $100
- The customer has been unable to resolve the issue after 3 attempts
- The issue requires system-level access you don't have
- The customer explicitly requests a human agent`,
    tools: ['web_search', 'http_request'],
    memoryConfig: {
      shortTermMaxMessages: 30,
      longTermEnabled: true,
      longTermTopK: 5,
      episodicEnabled: true,
      episodicTopK: 3,
    },
    temperature: 0.5,
    maxTurns: 20,
    maxTokens: 2048,
    samplePrompts: [
      'My order #12345 hasn\'t arrived yet. It\'s been 10 days.',
      'How do I reset my password?',
      'I\'m getting an error when trying to export my data. Can you help?',
    ],
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    description: 'An analytical agent that processes data, generates insights, and creates visualizations from datasets.',
    category: 'analytics',
    pattern: 'plan-and-execute',
    systemPrompt: `You are an expert data analyst who helps users understand and derive insights from their data.

## Capabilities
- Load and parse data files (CSV, JSON, Excel)
- Perform statistical analysis and calculations
- Identify trends, patterns, and anomalies
- Generate summary reports with key findings
- Create data visualizations descriptions

## Approach
1. Understand the user's analytical goals
2. Examine the data structure and quality
3. Clean and prepare the data as needed
4. Perform the requested analysis
5. Present findings with clear explanations
6. Suggest follow-up analyses if relevant

## Guidelines
- Always show your work — explain the methods and calculations
- Use appropriate statistical measures for the data type
- Note any limitations, biases, or caveats in the analysis
- Present numbers with appropriate precision
- Distinguish between correlation and causation`,
    tools: ['calculator', 'file_read', 'json_parse', 'code_execute'],
    memoryConfig: {
      shortTermMaxMessages: 50,
      longTermEnabled: false,
      longTermTopK: 5,
      episodicEnabled: false,
      episodicTopK: 3,
    },
    temperature: 0.2,
    maxTurns: 25,
    maxTokens: 4096,
    samplePrompts: [
      'Analyze this CSV file and tell me the key trends',
      'Calculate the average, median, and standard deviation of this dataset',
      'Find correlations between columns A and B in this data',
    ],
  },
  {
    id: 'writing-assistant',
    name: 'Writing Assistant',
    description: 'A creative writing assistant that helps with drafting, editing, and improving written content.',
    category: 'creative',
    pattern: 'react',
    systemPrompt: `You are a skilled writing assistant who helps users create, edit, and improve their written content.

## Capabilities
- Draft articles, blog posts, emails, reports, and other content
- Edit for clarity, grammar, style, and tone
- Provide structural feedback on longer pieces
- Adapt writing style to different audiences and purposes
- Help overcome writer's block with prompts and suggestions

## Approach
- Ask about the target audience, purpose, and desired tone before writing
- Provide options when there are multiple valid approaches
- Explain your editorial suggestions so the user can learn
- Maintain the user's voice while improving the writing

## Writing Principles
- Clarity over cleverness
- Active voice over passive
- Concrete details over vague generalities
- Varied sentence structure for rhythm
- Strong openings and closings`,
    tools: ['web_search'],
    memoryConfig: {
      shortTermMaxMessages: 50,
      longTermEnabled: false,
      longTermTopK: 5,
      episodicEnabled: false,
      episodicTopK: 3,
    },
    temperature: 0.8,
    maxTurns: 15,
    maxTokens: 4096,
    samplePrompts: [
      'Help me write a professional email declining a meeting invitation',
      'Edit this paragraph for clarity and conciseness',
      'Write a blog post introduction about sustainable technology',
    ],
  },
  {
    id: 'devops-assistant',
    name: 'DevOps Assistant',
    description: 'A system administration and DevOps agent that helps with infrastructure, deployment, and monitoring tasks.',
    category: 'development',
    pattern: 'react',
    systemPrompt: `You are an experienced DevOps and systems engineering assistant.

## Expertise
- Linux/Unix system administration
- Container orchestration (Docker, Kubernetes)
- CI/CD pipelines (GitHub Actions, GitLab CI, Jenkins)
- Cloud platforms (AWS, GCP, Azure)
- Infrastructure as Code (Terraform, Pulumi)
- Monitoring and observability (Prometheus, Grafana, Datadog)
- Networking and security

## Approach
- Always explain what commands do before suggesting them
- Warn about destructive operations and suggest backups first
- Consider security implications of every suggestion
- Provide both quick fixes and long-term solutions
- Include verification steps to confirm changes worked

## Safety
- Never suggest running commands you haven't explained
- Always recommend testing in staging before production
- Suggest rollback procedures for risky changes
- Flag potential data loss scenarios`,
    tools: ['shell_exec', 'file_read', 'file_write', 'http_request'],
    memoryConfig: {
      shortTermMaxMessages: 50,
      longTermEnabled: true,
      longTermTopK: 5,
      episodicEnabled: true,
      episodicTopK: 3,
    },
    temperature: 0.3,
    maxTurns: 20,
    maxTokens: 4096,
    samplePrompts: [
      'Help me set up a GitHub Actions CI/CD pipeline for a Node.js project',
      'My Docker container is running out of memory. How do I debug this?',
      'Write a Terraform configuration for an AWS EC2 instance with an RDS database',
    ],
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleTemplateList(options: { category?: string }): void {
  let templates = BUILT_IN_TEMPLATES;

  if (options.category) {
    templates = templates.filter(
      (t) => t.category.toLowerCase() === options.category!.toLowerCase(),
    );
  }

  if (templates.length === 0) {
    console.log(chalk.dim('No templates found.'));
    if (options.category) {
      console.log(chalk.dim(`Available categories: ${[...new Set(BUILT_IN_TEMPLATES.map((t) => t.category))].join(', ')}`));
    }
    return;
  }

  console.log('');
  console.log(chalk.bold('Available Agent Templates'));
  console.log('');

  const rows = templates.map((t) => [
    chalk.cyan(t.id),
    t.name,
    t.category,
    t.pattern,
    t.description.slice(0, 50) + (t.description.length > 50 ? '...' : ''),
  ]);

  console.log(formatTable(
    ['ID', 'Name', 'Category', 'Pattern', 'Description'],
    rows,
  ));

  console.log('');
  console.log(chalk.dim('Apply a template with: agentbuilder template apply <id>'));
  console.log(chalk.dim('View details with: agentbuilder template show <id>'));
  console.log('');
}

function handleTemplateShow(name: string): void {
  const template = BUILT_IN_TEMPLATES.find(
    (t) => t.id === name || t.name.toLowerCase() === name.toLowerCase(),
  );

  if (!template) {
    console.error(chalk.red(`Template "${name}" not found.`));
    console.log(chalk.dim('Run `agentbuilder template list` to see available templates.'));
    return;
  }

  console.log('');
  console.log(chalk.bold.cyan(template.name));
  console.log(chalk.dim(template.description));
  console.log('');
  console.log(chalk.bold('Details:'));
  console.log(`  ID:          ${template.id}`);
  console.log(`  Category:    ${template.category}`);
  console.log(`  Pattern:     ${template.pattern}`);
  console.log(`  Tools:       ${template.tools.join(', ') || 'none'}`);
  console.log(`  Temperature: ${template.temperature}`);
  console.log(`  Max Turns:   ${template.maxTurns}`);
  console.log(`  Long-term:   ${template.memoryConfig.longTermEnabled ? 'enabled' : 'disabled'}`);
  console.log(`  Episodic:    ${template.memoryConfig.episodicEnabled ? 'enabled' : 'disabled'}`);
  console.log('');
  console.log(chalk.bold('System Prompt:'));
  console.log(chalk.dim(template.systemPrompt.split('\n').map((l) => '  ' + l).join('\n')));
  console.log('');
  console.log(chalk.bold('Sample Prompts:'));
  for (const prompt of template.samplePrompts) {
    console.log(`  - ${chalk.dim(prompt)}`);
  }
  console.log('');
  console.log(`Apply with: ${chalk.cyan(`agentbuilder template apply ${template.id}`)}`);
  console.log('');
}

async function handleTemplateApply(name: string, options: ApplyOptions): Promise<void> {
  const template = BUILT_IN_TEMPLATES.find(
    (t) => t.id === name || t.name.toLowerCase() === name.toLowerCase(),
  );

  if (!template) {
    console.error(chalk.red(`Template "${name}" not found.`));
    console.log(chalk.dim('Run `agentbuilder template list` to see available templates.'));
    return;
  }

  // Resolve provider
  const defaults = getDefaults();
  const providerId = options.provider ?? defaults.providerId ?? 'anthropic';
  const modelId = options.model ?? defaults.modelId ?? 'claude-sonnet-4-20250514';
  const apiKey = getProviderApiKey(providerId) ?? process.env[`${providerId.toUpperCase()}_API_KEY`];

  const agentName = options.name ?? template.id;

  const config: AgentConfig = {
    id: randomUUID(),
    name: agentName,
    description: template.description,
    version: '0.1.0',
    provider: {
      providerId,
      modelId,
      apiKey,
    },
    pattern: template.pattern,
    systemPrompt: template.systemPrompt,
    tools: template.tools,
    memoryConfig: template.memoryConfig,
    guardrailRules: [],
    maxTurns: template.maxTurns,
    temperature: template.temperature,
    maxTokens: template.maxTokens,
    metadata: { fromTemplate: template.id },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const db = Database.create();
  try {
    const repo = new AgentConfigRepository(db);

    // Check if agent already exists
    const existing = repo.getByName(agentName);
    if (existing) {
      console.log(chalk.yellow(`Agent "${agentName}" already exists. Use --name to choose a different name.`));
      return;
    }

    repo.create(config);

    console.log('');
    console.log(chalk.green('\u2713') + ` Agent ${chalk.bold(agentName)} created from template ${chalk.cyan(template.id)}`);
    console.log('');
    console.log(`  Run it with: ${chalk.cyan(`agentbuilder run ${agentName}`)}`);
    console.log(`  Test it with: ${chalk.cyan(`agentbuilder test ${agentName}`)}`);
    console.log('');
  } finally {
    db.close();
  }
}
