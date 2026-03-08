/**
 * `agentbuilder create <description>` command — THE KILLER FEATURE.
 *
 * Takes a natural language description and uses an LLM to generate a
 * complete AgentConfig. The meta-prompt includes available patterns,
 * tools, templates, and the configuration schema, enabling the LLM
 * to produce a well-structured, validated agent configuration.
 */

import { type Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { randomUUID } from 'node:crypto';
import type { AgentConfig, AgentPatternType } from '@agentbuilder/core';
import {
  Database,
  AgentConfigRepository,
  getDefaults,
  getProviderApiKey,
} from '@agentbuilder/storage';
import { runAgentWizard } from '../prompts/agent-wizard.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerCreateCommand(program: Command): void {
  program
    .command('create [description]')
    .description('Create a new agent from a natural language description')
    .option('-p, --provider <provider>', 'LLM provider to use for generation')
    .option('-m, --model <model>', 'Model to use for generation')
    .option('-t, --template <template>', 'Start from a blueprint template')
    .option('--no-test', 'Skip auto-testing after creation')
    .option('--interactive', 'Use the step-by-step wizard instead of AI generation')
    .action(async (description: string | undefined, options: CreateOptions) => {
      try {
        await handleCreate(description, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}

interface CreateOptions {
  provider?: string;
  model?: string;
  template?: string;
  test: boolean;
  interactive?: boolean;
}

// ---------------------------------------------------------------------------
// Meta-prompt for AI agent generation
// ---------------------------------------------------------------------------

function buildMetaPrompt(description: string, template?: string): string {
  return `You are an expert AI agent architect. Your task is to design an agent configuration based on the user's requirements.

## User's Request
"${description}"
${template ? `\nThe user wants to start from the "${template}" template/blueprint.` : ''}

## Available Agent Patterns

Choose the most appropriate pattern for the user's needs:

1. **react** (ReAct — Reason + Act)
   - Interleaves reasoning steps with tool calls in an iterative loop
   - Best for: General-purpose agents, Q&A with tools, debugging, exploration
   - When to use: The agent needs to think about what to do, take action, and adapt based on results

2. **plan-and-execute** (Plan and Execute)
   - Creates a step-by-step plan first, then executes each step
   - Best for: Complex multi-step tasks, research, analysis, report generation
   - When to use: Tasks have clear sequential steps or need upfront planning

3. **tool-augmented** (Tool-Augmented)
   - Simple tool-calling without explicit reasoning steps
   - Best for: Straightforward API interactions, utility bots, data retrieval
   - When to use: Direct tool use without complex reasoning needed

4. **rag** (Retrieval-Augmented Generation)
   - Retrieves relevant context from a knowledge base before generating
   - Best for: Knowledge base Q&A, documentation assistants, support bots
   - When to use: Answers should be grounded in specific documents/data

5. **multi-agent** (Multi-Agent Orchestration)
   - Coordinates multiple specialized sub-agents
   - Best for: Complex workflows requiring different expertise areas
   - When to use: Task naturally decomposes into specialized subtasks

## Available Tools

Select tools the agent should have access to:

- **calculator**: Safe mathematical expression evaluator (supports +, -, *, /, ^, sqrt, sin, cos, etc.)
- **web_search**: Search the web for current information
- **web_fetch**: Fetch and parse content from URLs
- **file_read**: Read file contents from the filesystem
- **file_write**: Write content to files
- **file_list**: List directory contents
- **shell_exec**: Execute shell commands (use with caution)
- **json_parse**: Parse, query, and transform JSON data
- **http_request**: Make arbitrary HTTP API requests
- **code_execute**: Execute code snippets in a sandboxed environment

## Configuration Schema

Return a JSON object matching this EXACT structure:

{
  "name": "string — lowercase with hyphens, 1-50 chars (e.g., 'research-assistant')",
  "description": "string — clear description of what the agent does, 10-200 chars",
  "pattern": "react | plan-and-execute | tool-augmented | rag | multi-agent",
  "systemPrompt": "string — detailed system prompt that defines the agent's behavior, personality, and guidelines. Be thorough and specific. Include sections for ## Role, ## Approach, ## Guidelines. This is the most important field — a well-crafted system prompt is critical.",
  "tools": ["array of tool name strings from the list above"],
  "memoryConfig": {
    "shortTermMaxMessages": "number (10-200, default 50)",
    "longTermEnabled": "boolean — enable for RAG or agents that need persistent memory",
    "longTermTopK": "number (1-20, default 5)",
    "episodicEnabled": "boolean — enable for agents that should learn from past interactions",
    "episodicTopK": "number (1-10, default 3)"
  },
  "maxTurns": "number (1-100) — max reasoning/tool-use iterations per request",
  "temperature": "number (0.0-2.0) — lower for factual tasks, higher for creative tasks",
  "maxTokens": "number (256-100000) — max output tokens per response"
}

## Instructions

1. Analyze the user's description carefully.
2. Select the most appropriate pattern.
3. Choose relevant tools — only include tools the agent actually needs.
4. Write a detailed, high-quality system prompt that:
   - Clearly defines the agent's role and expertise
   - Specifies how the agent should approach tasks
   - Includes guidelines for tool usage
   - Sets appropriate tone and behavior expectations
   - Is specific to the use case (not generic boilerplate)
5. Configure memory appropriately:
   - Enable long-term memory for knowledge-heavy or persistent agents
   - Enable episodic memory for agents that should improve over time
6. Set appropriate temperature (0.0-0.3 for factual, 0.5-0.8 for balanced, 0.8-1.5 for creative)
7. Set appropriate maxTurns (5-10 for simple, 15-25 for moderate, 25-50 for complex tasks)

Respond with ONLY the JSON object, no additional text or markdown code fences.`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleCreate(
  description: string | undefined,
  options: CreateOptions,
): Promise<void> {
  // If --interactive flag or no description, use the wizard
  if (options.interactive || !description) {
    if (options.interactive || !description) {
      console.log('');
      if (!description) {
        console.log(chalk.dim('No description provided. Launching the interactive wizard...'));
      }
      const config = await runAgentWizard();

      // Save the agent
      const db = Database.create();
      try {
        const repo = new AgentConfigRepository(db);
        repo.create(config);
        console.log('');
        console.log(chalk.green('\u2713') + ` Agent ${chalk.bold(config.name)} created successfully!`);
        console.log(chalk.dim(`  ID: ${config.id}`));
        console.log('');
        console.log(`  Run it with: ${chalk.cyan(`agentbuilder run ${config.name}`)}`);
        console.log(`  Test it with: ${chalk.cyan(`agentbuilder test ${config.name}`)}`);
      } finally {
        db.close();
      }
      return;
    }
  }

  // AI-powered agent generation
  console.log('');
  console.log(chalk.bold.cyan('AI Agent Generation'));
  console.log(chalk.dim(`Creating agent from: "${description}"`));
  console.log('');

  // Resolve provider
  const defaults = getDefaults();
  const providerId = options.provider ?? defaults.providerId ?? 'anthropic';
  const modelId = options.model ?? defaults.modelId ?? 'claude-sonnet-4-20250514';
  const apiKey = getProviderApiKey(providerId) ?? getApiKeyFromEnv(providerId);

  if (!apiKey) {
    console.log(chalk.yellow('No API key found for provider: ') + chalk.bold(providerId));
    console.log(chalk.dim('Run `agentbuilder config providers` to set up a provider.'));
    console.log(chalk.dim(`Or set the environment variable: ${getEnvVarName(providerId)}`));
    console.log('');
    console.log(chalk.dim('Falling back to interactive wizard...'));
    console.log('');
    const config = await runAgentWizard();
    const db = Database.create();
    try {
      const repo = new AgentConfigRepository(db);
      repo.create(config);
      console.log(chalk.green('\u2713') + ` Agent ${chalk.bold(config.name)} created.`);
    } finally {
      db.close();
    }
    return;
  }

  const spinner = ora({
    text: `Generating agent with ${providerId}/${modelId}...`,
    spinner: 'dots',
  }).start();

  try {
    // Build the meta-prompt
    const metaPrompt = buildMetaPrompt(description, options.template);

    // Call the LLM to generate the agent config
    const generatedJson = await callLLM(providerId, modelId, apiKey, metaPrompt);

    spinner.text = 'Parsing and validating configuration...';

    // Parse the response
    const parsed = parseGeneratedConfig(generatedJson);

    // Create the full AgentConfig
    const config: AgentConfig = {
      id: randomUUID(),
      name: parsed.name,
      description: parsed.description,
      version: '0.1.0',
      provider: {
        providerId,
        modelId,
        apiKey,
      },
      pattern: parsed.pattern as AgentPatternType,
      systemPrompt: parsed.systemPrompt,
      tools: parsed.tools ?? [],
      memoryConfig: {
        shortTermMaxMessages: parsed.memoryConfig?.shortTermMaxMessages ?? 50,
        longTermEnabled: parsed.memoryConfig?.longTermEnabled ?? false,
        longTermTopK: parsed.memoryConfig?.longTermTopK ?? 5,
        episodicEnabled: parsed.memoryConfig?.episodicEnabled ?? false,
        episodicTopK: parsed.memoryConfig?.episodicTopK ?? 3,
      },
      guardrailRules: [],
      maxTurns: parsed.maxTurns ?? 25,
      temperature: parsed.temperature ?? 0.7,
      maxTokens: parsed.maxTokens ?? 4096,
      metadata: { generatedFrom: description },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to database
    const db = Database.create();
    try {
      const repo = new AgentConfigRepository(db);
      repo.create(config);
    } finally {
      db.close();
    }

    spinner.succeed('Agent created successfully!');

    // Display the generated config
    console.log('');
    console.log(chalk.bold('Generated Agent Configuration:'));
    console.log('');
    console.log(chalk.bold('  Name:        ') + chalk.cyan(config.name));
    console.log(chalk.bold('  Description: ') + config.description);
    console.log(chalk.bold('  Pattern:     ') + config.pattern);
    console.log(chalk.bold('  Provider:    ') + `${providerId}/${modelId}`);
    console.log(chalk.bold('  Tools:       ') + (config.tools.length > 0 ? config.tools.join(', ') : 'none'));
    console.log(chalk.bold('  Temperature: ') + config.temperature.toString());
    console.log(chalk.bold('  Max Turns:   ') + config.maxTurns.toString());
    console.log(chalk.bold('  Memory:      ') + `long-term=${config.memoryConfig.longTermEnabled ? 'on' : 'off'}, episodic=${config.memoryConfig.episodicEnabled ? 'on' : 'off'}`);
    console.log('');
    console.log(chalk.bold('  System Prompt (first 200 chars):'));
    console.log(chalk.dim('  ' + config.systemPrompt.slice(0, 200).replace(/\n/g, '\n  ') + '...'));
    console.log('');
    console.log(chalk.dim(`  ID: ${config.id}`));
    console.log('');
    console.log(`  Run it with: ${chalk.cyan(`agentbuilder run ${config.name}`)}`);
    console.log(`  Test it with: ${chalk.cyan(`agentbuilder test ${config.name}`)}`);
    console.log('');
  } catch (err) {
    spinner.fail('Agent generation failed.');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// LLM call helper
// ---------------------------------------------------------------------------

/**
 * Call an LLM provider to generate agent configuration JSON.
 *
 * This is a minimal HTTP-based implementation so the CLI can work
 * independently of the full @agentbuilder/llm package being built.
 */
async function callLLM(
  providerId: string,
  modelId: string,
  apiKey: string,
  prompt: string,
): Promise<string> {
  const { url, headers, body } = buildLLMRequest(providerId, modelId, apiKey, prompt);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const data = await response.json() as Record<string, unknown>;
  return extractResponseText(providerId, data);
}

function buildLLMRequest(
  providerId: string,
  modelId: string,
  apiKey: string,
  prompt: string,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  switch (providerId) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model: modelId,
          max_tokens: 4096,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }],
        },
      };

    case 'openai':
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: {
          model: modelId,
          max_tokens: 4096,
          temperature: 0.3,
          messages: [
            { role: 'system', content: 'You are an AI agent configuration generator. Respond only with valid JSON.' },
            { role: 'user', content: prompt },
          ],
        },
      };

    case 'google':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        },
      };

    default:
      // Default to OpenAI-compatible API
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: {
          model: modelId,
          max_tokens: 4096,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }],
        },
      };
  }
}

function extractResponseText(
  providerId: string,
  data: Record<string, unknown>,
): string {
  switch (providerId) {
    case 'anthropic': {
      const content = data['content'] as Array<{ type: string; text?: string }>;
      const textBlock = content?.find((b) => b.type === 'text');
      return textBlock?.text ?? '';
    }

    case 'openai':
    default: {
      const choices = data['choices'] as Array<{ message?: { content?: string } }>;
      return choices?.[0]?.message?.content ?? '';
    }

    case 'google': {
      const candidates = data['candidates'] as Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      return candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface GeneratedConfig {
  name: string;
  description: string;
  pattern: string;
  systemPrompt: string;
  tools?: string[];
  memoryConfig?: {
    shortTermMaxMessages?: number;
    longTermEnabled?: boolean;
    longTermTopK?: number;
    episodicEnabled?: boolean;
    episodicTopK?: number;
  };
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
}

function parseGeneratedConfig(raw: string): GeneratedConfig {
  // Try to extract JSON from the response (it may be wrapped in markdown code fences)
  let jsonStr = raw.trim();

  // Remove markdown code fences if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    jsonStr = jsonMatch[1].trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `Failed to parse generated configuration as JSON. Raw response:\n${raw.slice(0, 500)}`,
    );
  }

  // Validate required fields
  if (!parsed['name'] || typeof parsed['name'] !== 'string') {
    throw new Error('Generated config missing "name" field');
  }
  if (!parsed['description'] || typeof parsed['description'] !== 'string') {
    throw new Error('Generated config missing "description" field');
  }
  if (!parsed['pattern'] || typeof parsed['pattern'] !== 'string') {
    throw new Error('Generated config missing "pattern" field');
  }
  if (!parsed['systemPrompt'] || typeof parsed['systemPrompt'] !== 'string') {
    throw new Error('Generated config missing "systemPrompt" field');
  }

  const validPatterns = ['react', 'plan-and-execute', 'tool-augmented', 'rag', 'multi-agent'];
  if (!validPatterns.includes(parsed['pattern'] as string)) {
    throw new Error(
      `Invalid pattern "${parsed['pattern']}". Must be one of: ${validPatterns.join(', ')}`,
    );
  }

  // Sanitize the name
  const name = (parsed['name'] as string)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    name: name || 'unnamed-agent',
    description: parsed['description'] as string,
    pattern: parsed['pattern'] as string,
    systemPrompt: parsed['systemPrompt'] as string,
    tools: Array.isArray(parsed['tools'])
      ? (parsed['tools'] as string[]).filter((t) => typeof t === 'string')
      : [],
    memoryConfig: parsed['memoryConfig'] as GeneratedConfig['memoryConfig'],
    maxTurns: typeof parsed['maxTurns'] === 'number' ? parsed['maxTurns'] : undefined,
    temperature: typeof parsed['temperature'] === 'number' ? parsed['temperature'] : undefined,
    maxTokens: typeof parsed['maxTokens'] === 'number' ? parsed['maxTokens'] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKeyFromEnv(providerId: string): string | undefined {
  const envVarName = getEnvVarName(providerId);
  return process.env[envVarName];
}

function getEnvVarName(providerId: string): string {
  const envVars: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  return envVars[providerId] ?? `${providerId.toUpperCase()}_API_KEY`;
}
