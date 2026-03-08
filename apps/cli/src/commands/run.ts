/**
 * `agentbuilder run <agent-name>` command.
 *
 * Starts an interactive REPL session with a configured agent.
 * Features streaming output, tool call visualization, session
 * persistence, and special commands.
 */

import { type Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync } from 'node:fs';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { AgentConfig, Message } from '@agentbuilder/core';
import {
  Database,
  AgentConfigRepository,
  SessionRepository,
  type SessionRecord,
} from '@agentbuilder/storage';
import { StreamingRenderer } from '../formatters/streaming.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerRunCommand(program: Command): void {
  program
    .command('run <agent-name>')
    .description('Start an interactive session with an agent')
    .option('-p, --provider <provider>', 'Override the LLM provider')
    .option('-m, --model <model>', 'Override the model')
    .option('-s, --session <sessionId>', 'Resume an existing session')
    .option('--no-stream', 'Disable streaming output')
    .action(async (agentName: string, options: RunOptions) => {
      try {
        await handleRun(agentName, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}

interface RunOptions {
  provider?: string;
  model?: string;
  session?: string;
  stream: boolean;
}

// ---------------------------------------------------------------------------
// Special REPL commands
// ---------------------------------------------------------------------------

const SPECIAL_COMMANDS: Record<string, string> = {
  '/quit': 'Exit the session',
  '/exit': 'Exit the session',
  '/history': 'Show conversation history',
  '/clear': 'Clear conversation history',
  '/export': 'Export conversation to JSON',
  '/help': 'Show available commands',
  '/info': 'Show agent information',
  '/tokens': 'Show token usage estimate',
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleRun(agentName: string, options: RunOptions): Promise<void> {
  const db = Database.create();

  try {
    // Load agent configuration
    const agentRepo = new AgentConfigRepository(db);
    const config = agentRepo.getByName(agentName) ?? agentRepo.getById(agentName);

    if (!config) {
      console.error(chalk.red(`Agent "${agentName}" not found.`));
      console.log('');
      console.log(chalk.dim('Available agents:'));
      const agents = agentRepo.list({ limit: 20 });
      if (agents.length === 0) {
        console.log(chalk.dim('  No agents configured. Create one with: agentbuilder create'));
      } else {
        for (const agent of agents) {
          console.log(`  ${chalk.cyan(agent.name)} — ${chalk.dim(agent.description)}`);
        }
      }
      return;
    }

    // Apply overrides
    if (options.provider) {
      config.provider.providerId = options.provider;
    }
    if (options.model) {
      config.provider.modelId = options.model;
    }

    // Load or create session
    const sessionRepo = new SessionRepository(db);
    let session: SessionRecord;
    let messages: Message[] = [];

    if (options.session) {
      const existingSession = sessionRepo.getById(options.session);
      if (!existingSession) {
        console.error(chalk.red(`Session "${options.session}" not found.`));
        return;
      }
      session = existingSession;
      messages = session.messages as Message[];
      console.log(chalk.dim(`Resuming session ${session.id} (${messages.length} messages)`));
    } else {
      session = {
        id: randomUUID(),
        agentId: config.id,
        state: 'active',
        messages: [],
        metadata: { startedAt: new Date().toISOString() },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      sessionRepo.create(session);
    }

    // Print header
    printSessionHeader(config, session);

    // Start REPL
    await runREPL(config, session, messages, sessionRepo, db);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Session header
// ---------------------------------------------------------------------------

function printSessionHeader(config: AgentConfig, session: SessionRecord): void {
  console.log('');
  console.log(chalk.bold.cyan(`Agent: ${config.name}`));
  console.log(chalk.dim(`Pattern: ${config.pattern} | Provider: ${config.provider.providerId}/${config.provider.modelId}`));
  console.log(chalk.dim(`Session: ${session.id.slice(0, 8)}...`));
  console.log('');
  console.log(chalk.dim('Type your message and press Enter. Special commands:'));
  console.log(chalk.dim('  /help — show commands  |  /quit — exit  |  /history — show history'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log('');
}

// ---------------------------------------------------------------------------
// REPL loop
// ---------------------------------------------------------------------------

async function runREPL(
  config: AgentConfig,
  session: SessionRecord,
  messages: Message[],
  sessionRepo: SessionRepository,
  _db: Database,
): Promise<void> {
  const renderer = new StreamingRenderer();
  const rl = createReadline();

  let running = true;

  while (running) {
    const input = await prompt(rl, chalk.green('You: '));

    if (input === null) {
      // EOF (Ctrl+D)
      running = false;
      break;
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) continue;

    // Handle special commands
    if (trimmed.startsWith('/')) {
      const handled = handleSpecialCommand(trimmed, config, session, messages);
      if (handled === 'quit') {
        running = false;
        break;
      }
      continue;
    }

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: trimmed,
    };
    messages.push(userMessage);

    // Process with agent
    renderer.reset();
    await processMessage(config, messages, renderer);

    // Save updated session
    sessionRepo.updateMessages(session.id, messages);
  }

  // Clean up
  renderer.cleanup();
  rl.close();

  // Mark session as completed
  sessionRepo.updateState(session.id, 'completed');

  console.log('');
  console.log(chalk.dim(`Session ended. ${messages.length} messages exchanged.`));
  console.log(chalk.dim(`To resume: agentbuilder run ${config.name} --session ${session.id}`));
  console.log('');
}

// ---------------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------------

/**
 * Process a message through the agent and render the response.
 *
 * This function simulates agent execution when the engine packages
 * are not yet fully wired. In production, it would create an
 * Orchestrator with all services and stream events through the renderer.
 */
async function processMessage(
  config: AgentConfig,
  messages: Message[],
  renderer: StreamingRenderer,
): Promise<void> {
  renderer.startThinking();

  try {
    // Attempt to use the LLM directly for a basic response
    const apiKey = config.provider.apiKey ?? getApiKeyFromEnv(config.provider.providerId);

    if (!apiKey) {
      renderer.stopThinking();
      const errorMsg = `No API key configured for provider "${config.provider.providerId}". ` +
        `Set it with: agentbuilder config set provider.${config.provider.providerId}.apiKey <key>`;
      console.log(chalk.red(`\n${errorMsg}`));

      const assistantMsg: Message = {
        role: 'assistant',
        content: `[Error: ${errorMsg}]`,
      };
      messages.push(assistantMsg);
      return;
    }

    // Build the request payload
    const requestMessages = buildRequestMessages(config, messages);

    // Call the LLM
    const response = await callLLMForChat(
      config.provider.providerId,
      config.provider.modelId,
      apiKey,
      requestMessages,
      config.temperature,
      config.maxTokens,
    );

    renderer.stopThinking();

    // Render the response as streaming text
    const chunks = simulateStreaming(response);
    for (const chunk of chunks) {
      renderer.onTextDelta(chunk);
      // Small delay to simulate streaming
      await sleep(15);
    }
    renderer.onTextDone(response);

    // Add assistant message
    const assistantMsg: Message = {
      role: 'assistant',
      content: response,
    };
    messages.push(assistantMsg);
  } catch (err) {
    renderer.stopThinking();
    const errorMessage = err instanceof Error ? err.message : String(err);
    renderer.onError('AGENT_ERROR', errorMessage);

    const assistantMsg: Message = {
      role: 'assistant',
      content: `[Error: ${errorMessage}]`,
    };
    messages.push(assistantMsg);
  }
}

// ---------------------------------------------------------------------------
// LLM communication
// ---------------------------------------------------------------------------

function buildRequestMessages(
  config: AgentConfig,
  messages: Message[],
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [];

  // System message
  result.push({
    role: 'system',
    content: config.systemPrompt,
  });

  // Conversation history (apply short-term memory limit)
  const maxMessages = config.memoryConfig.shortTermMaxMessages;
  const recentMessages = messages.slice(-maxMessages);

  for (const msg of recentMessages) {
    result.push({
      role: msg.role,
      content: typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content),
    });
  }

  return result;
}

async function callLLMForChat(
  providerId: string,
  modelId: string,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const { url, headers, body } = buildChatRequest(
    providerId, modelId, apiKey, messages, temperature, maxTokens,
  );

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = await response.json() as Record<string, unknown>;
  return extractChatResponse(providerId, data);
}

function buildChatRequest(
  providerId: string,
  modelId: string,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  maxTokens: number,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  switch (providerId) {
    case 'anthropic': {
      // Anthropic uses separate system parameter
      const systemMsg = messages.find((m) => m.role === 'system');
      const chatMessages = messages.filter((m) => m.role !== 'system');

      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model: modelId,
          max_tokens: maxTokens,
          temperature,
          system: systemMsg?.content ?? '',
          messages: chatMessages,
        },
      };
    }

    case 'openai':
    default:
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: {
          model: modelId,
          max_tokens: maxTokens,
          temperature,
          messages,
        },
      };

    case 'google': {
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const systemInstruction = messages.find((m) => m.role === 'system');

      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          contents,
          systemInstruction: systemInstruction
            ? { parts: [{ text: systemInstruction.content }] }
            : undefined,
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        },
      };
    }
  }
}

function extractChatResponse(providerId: string, data: Record<string, unknown>): string {
  switch (providerId) {
    case 'anthropic': {
      const content = data['content'] as Array<{ type: string; text?: string }> | undefined;
      const textBlock = content?.find((b) => b.type === 'text');
      return textBlock?.text ?? '';
    }

    case 'openai':
    default: {
      const choices = data['choices'] as Array<{ message?: { content?: string } }> | undefined;
      return choices?.[0]?.message?.content ?? '';
    }

    case 'google': {
      const candidates = data['candidates'] as Array<{
        content?: { parts?: Array<{ text?: string }> };
      }> | undefined;
      return candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }
  }
}

// ---------------------------------------------------------------------------
// Special command handler
// ---------------------------------------------------------------------------

function handleSpecialCommand(
  command: string,
  config: AgentConfig,
  session: SessionRecord,
  messages: Message[],
): 'quit' | 'handled' {
  const cmd = command.toLowerCase().trim();

  switch (cmd) {
    case '/quit':
    case '/exit':
      return 'quit';

    case '/help':
      console.log('');
      console.log(chalk.bold('Available commands:'));
      for (const [name, desc] of Object.entries(SPECIAL_COMMANDS)) {
        console.log(`  ${chalk.cyan(name.padEnd(12))} ${chalk.dim(desc)}`);
      }
      console.log('');
      return 'handled';

    case '/history':
      console.log('');
      console.log(chalk.bold('Conversation History:'));
      console.log('');
      if (messages.length === 0) {
        console.log(chalk.dim('  No messages yet.'));
      } else {
        for (const msg of messages) {
          const role = msg.role === 'user'
            ? chalk.green('You')
            : msg.role === 'assistant'
              ? chalk.cyan('Agent')
              : chalk.gray(msg.role);
          const content = typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
          const truncated = content.length > 200
            ? content.slice(0, 197) + '...'
            : content;
          console.log(`  ${role}: ${truncated}`);
        }
      }
      console.log('');
      return 'handled';

    case '/clear':
      messages.length = 0;
      console.log(chalk.dim('Conversation history cleared.'));
      return 'handled';

    case '/export': {
      const exportData = {
        agent: config.name,
        session: session.id,
        timestamp: new Date().toISOString(),
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };
      const filename = `chat-export-${session.id.slice(0, 8)}.json`;
      writeFileSync(filename, JSON.stringify(exportData, null, 2));
      console.log(chalk.green(`Exported ${messages.length} messages to ${filename}`));
      return 'handled';
    }

    case '/info':
      console.log('');
      console.log(chalk.bold('Agent Information:'));
      console.log(`  Name:        ${chalk.cyan(config.name)}`);
      console.log(`  Description: ${config.description}`);
      console.log(`  Pattern:     ${config.pattern}`);
      console.log(`  Provider:    ${config.provider.providerId}/${config.provider.modelId}`);
      console.log(`  Tools:       ${config.tools.join(', ') || 'none'}`);
      console.log(`  Temperature: ${config.temperature}`);
      console.log(`  Max Turns:   ${config.maxTurns}`);
      console.log(`  Session:     ${session.id}`);
      console.log(`  Messages:    ${messages.length}`);
      console.log('');
      return 'handled';

    case '/tokens': {
      const charCount = messages
        .map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
        .join('')
        .length;
      const estimatedTokens = Math.ceil(charCount / 4);
      console.log(chalk.dim(`Estimated token usage: ~${estimatedTokens} tokens (${charCount} chars)`));
      return 'handled';
    }

    default:
      console.log(chalk.yellow(`Unknown command: ${cmd}. Type /help for available commands.`));
      return 'handled';
  }
}

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

function createReadline(): ReadlineInterface {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
}

function prompt(rl: ReadlineInterface, promptText: string): Promise<string | null> {
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      resolve(answer);
    });
    rl.once('close', () => resolve(null));
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function simulateStreaming(text: string): string[] {
  // Split into word-level chunks to simulate streaming
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    current += word;
    if (current.length >= 3) {
      chunks.push(current);
      current = '';
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKeyFromEnv(providerId: string): string | undefined {
  const envVars: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const envVar = envVars[providerId] ?? `${providerId.toUpperCase()}_API_KEY`;
  return process.env[envVar];
}
