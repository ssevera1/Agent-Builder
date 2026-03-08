/**
 * PromptBuilder — assembles the full prompt for an LLM request.
 *
 * Responsibilities:
 * - Renders the system prompt from AgentConfig + Handlebars templates
 * - Formats tool descriptions for the provider
 * - Allocates token budget: system prompt gets priority, then recent
 *   messages, then memory, then older messages
 * - Injects standard agent instructions (tool-use conventions, help cues)
 */

import Handlebars from 'handlebars';
import type { AgentConfig } from '@agentbuilder/core';
import type {
  AgentContext,
  BuiltPrompt,
  ContentBlock,
  LLMToolDefinition,
  Message,
  MemoryEntry,
  PromptBuilder as IPromptBuilder,
  TextBlock,
  ToolDefinition,
} from './patterns/pattern.interface.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rough average characters per token — used for quick estimates. */
const CHARS_PER_TOKEN = 4;

/** Reserved budget overhead for structural JSON, separators, etc. */
const STRUCTURAL_OVERHEAD_TOKENS = 200;

// ---------------------------------------------------------------------------
// Standard instructions appended to every system prompt
// ---------------------------------------------------------------------------

const STANDARD_INSTRUCTIONS = `

## Tool Usage Guidelines
- Use tools when you need to take action or retrieve information you do not have.
- Provide all required parameters. If you are unsure of a parameter value, ask the user rather than guessing.
- After receiving a tool result, interpret it for the user in natural language.
- If a tool call fails, explain the error and suggest alternatives.

## Interaction Guidelines
- Be concise and helpful. Avoid unnecessary filler.
- If you are uncertain, say so and ask clarifying questions.
- When presenting information from tools or memory, cite the source.
- If the request is beyond your capabilities, explain your limitations.
`;

// ---------------------------------------------------------------------------
// PromptBuilder implementation
// ---------------------------------------------------------------------------

export class PromptBuilder implements IPromptBuilder {
  /** Compiled Handlebars template cache keyed by template string. */
  private readonly templateCache = new Map<string, HandlebarsTemplateDelegate>();

  /**
   * Build the full prompt payload for an LLM request.
   *
   * @param config - The agent configuration.
   * @param context - Assembled agent context (history, memory, budget).
   * @param tools - Available tool definitions.
   * @returns A BuiltPrompt containing system message, conversation messages,
   *          tool definitions, and estimated token count.
   */
  build(
    config: AgentConfig,
    context: AgentContext,
    tools: ToolDefinition[],
  ): BuiltPrompt {
    // 1. Render the system prompt
    const renderedSystem = this.renderSystemPrompt(config, context);

    // 2. Format tools for the LLM
    const llmTools = this.formatTools(tools);

    // 3. Estimate the system prompt token cost
    const systemTokens = this.estimateTokens(renderedSystem);

    // 4. Estimate tool definitions token cost
    const toolsTokens = this.estimateToolTokens(llmTools);

    // 5. Remaining budget for messages
    const usedByFixed = systemTokens + toolsTokens + STRUCTURAL_OVERHEAD_TOKENS;
    const messageBudget = Math.max(0, context.tokenBudget - usedByFixed);

    // 6. Assemble messages within budget: prioritise recent over old,
    //    then inject memory as a system-adjacent message.
    const assembledMessages = this.assembleMessages(
      context.conversationHistory,
      context.relevantMemory,
      messageBudget,
    );

    // 7. Build the system message
    const systemMessage: Message = {
      role: 'system',
      content: renderedSystem,
    };

    // Calculate total token estimate
    const messagesTokens = assembledMessages.reduce(
      (sum, m) => sum + this.estimateMessageTokens(m),
      0,
    );
    const tokenEstimate = systemTokens + toolsTokens + messagesTokens + STRUCTURAL_OVERHEAD_TOKENS;

    return {
      systemMessage,
      messages: assembledMessages,
      tools: llmTools,
      tokenEstimate,
    };
  }

  // -----------------------------------------------------------------------
  // System prompt rendering
  // -----------------------------------------------------------------------

  /**
   * Render the system prompt by combining the agent's configured system prompt
   * with standard instructions and contextual information.
   */
  private renderSystemPrompt(config: AgentConfig, context: AgentContext): string {
    // Compile the user-defined system prompt as a Handlebars template
    const template = this.getCompiledTemplate(config.systemPrompt);

    // Build template variables
    const vars: Record<string, unknown> = {
      agentName: config.name,
      agentDescription: config.description,
      agentVersion: config.version,
      pattern: config.pattern,
      maxTurns: config.maxTurns,
      tools: config.tools,
      currentDate: new Date().toISOString().split('T')[0],
      sessionId: context.session.id,
      messageCount: context.conversationHistory.length,
      memoryCount: context.relevantMemory.length,
      // Expose metadata for template use
      ...config.metadata,
    };

    let rendered: string;
    try {
      rendered = template(vars);
    } catch {
      // If template rendering fails, fall back to the raw system prompt
      rendered = config.systemPrompt;
    }

    // Append standard instructions
    return rendered + STANDARD_INSTRUCTIONS;
  }

  /**
   * Get or create a compiled Handlebars template.
   */
  private getCompiledTemplate(source: string): HandlebarsTemplateDelegate {
    let compiled = this.templateCache.get(source);
    if (!compiled) {
      compiled = Handlebars.compile(source, { noEscape: true });
      this.templateCache.set(source, compiled);
    }
    return compiled;
  }

  // -----------------------------------------------------------------------
  // Tool formatting
  // -----------------------------------------------------------------------

  /**
   * Convert internal ToolDefinitions to the LLM-facing format.
   */
  private formatTools(tools: ToolDefinition[]): LLMToolDefinition[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  // -----------------------------------------------------------------------
  // Message assembly with budget management
  // -----------------------------------------------------------------------

  /**
   * Assemble conversation messages within a token budget.
   *
   * Strategy:
   * 1. Always include the most recent messages (they are most relevant).
   * 2. If there is relevant memory, inject it as an assistant-context message
   *    after the first user message.
   * 3. Fill remaining budget with older messages, newest-first.
   */
  private assembleMessages(
    history: Message[],
    memory: MemoryEntry[],
    budget: number,
  ): Message[] {
    if (history.length === 0) return [];

    let remaining = budget;
    const result: Message[] = [];

    // Work backwards from the most recent message
    const reversed = [...history].reverse();

    for (const msg of reversed) {
      const cost = this.estimateMessageTokens(msg);
      if (cost > remaining) break;
      result.unshift(msg);
      remaining -= cost;
    }

    // Inject memory context if we have it and there is budget
    if (memory.length > 0) {
      const memoryText = this.formatMemoryContext(memory);
      const memoryCost = this.estimateTokens(memoryText);

      if (memoryCost <= remaining) {
        const memoryMessage: Message = {
          role: 'system',
          content: memoryText,
        };
        // Insert after the first message (or at the start)
        const insertIdx = result.length > 0 ? 1 : 0;
        result.splice(insertIdx, 0, memoryMessage);
      }
    }

    return result;
  }

  /**
   * Format memory entries into a context block for injection.
   */
  private formatMemoryContext(entries: MemoryEntry[]): string {
    const lines = entries.map((e, i) => {
      const tags = e.metadata.tags.length > 0 ? ` [${e.metadata.tags.join(', ')}]` : '';
      return `[Memory ${i + 1}]${tags}: ${e.content}`;
    });

    return `## Relevant Context from Memory\nThe following information was retrieved from long-term memory and may be relevant:\n\n${lines.join('\n\n')}`;
  }

  // -----------------------------------------------------------------------
  // Token estimation
  // -----------------------------------------------------------------------

  /** Estimate tokens from a plain string. */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /** Estimate tokens for a message (accounting for role overhead). */
  private estimateMessageTokens(message: Message): number {
    const roleOverhead = 4; // ~4 tokens for role marker
    const text = this.messageToText(message);
    return this.estimateTokens(text) + roleOverhead;
  }

  /** Estimate tokens for tool definitions. */
  private estimateToolTokens(tools: LLMToolDefinition[]): number {
    if (tools.length === 0) return 0;
    const serialized = JSON.stringify(tools);
    return this.estimateTokens(serialized);
  }

  /** Extract plain text from a message for token estimation. */
  private messageToText(message: Message): string {
    if (typeof message.content === 'string') return message.content;
    return (message.content as ContentBlock[])
      .map((block) => {
        if (block.type === 'text') return (block as TextBlock).text;
        if (block.type === 'tool_use') return JSON.stringify(block);
        if (block.type === 'tool_result') return JSON.stringify(block);
        return '';
      })
      .join('\n');
  }
}
