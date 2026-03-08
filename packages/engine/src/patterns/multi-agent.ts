/**
 * Multi-Agent Pattern
 *
 * Supports agent-to-agent handoff via a router/specialist architecture:
 * 1. A "router" agent examines the user's request and decides which
 *    specialist agent should handle it.
 * 2. The selected specialist processes the request (using its own tools
 *    and system prompt).
 * 3. Specialists can hand back to the router or hand off to another
 *    specialist.
 * 4. A handoff loop detector prevents infinite delegation.
 *
 * Best for complex systems with multiple specialized capabilities
 * (e.g., a customer service bot that routes to billing, tech support,
 * or sales specialists).
 */

import type { AgentConfig } from '@agentbuilder/core';
import type {
  AgentContext,
  AgentEvent,
  AgentPattern,
  AgentServices,
  ContentBlock,
  LLMRequest,
  Message,
  TextBlock,
  TokenUsage,
} from './pattern.interface.js';
import { ResponseParser } from '../response-parser.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HANDOFFS = 5;

const ROUTING_PROMPT_TEMPLATE = `You are a routing agent. Your job is to analyze the user's request and decide which specialist agent should handle it.

Available specialists:
{{specialists}}

Respond with ONLY a JSON object indicating your routing decision:
{"agentId": "<specialist_id>", "reason": "<why this specialist>"}

If no specialist fits, respond with:
{"agentId": "self", "reason": "<explain and handle it yourself>"}`;

const HANDOFF_TOOL_NAME = '__handoff';
const HANDOFF_TOOL_DESCRIPTION = 'Hand off the conversation to another specialist agent.';
const HANDOFF_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    targetAgentId: {
      type: 'string',
      description: 'The ID of the agent to hand off to.',
    },
    reason: {
      type: 'string',
      description: 'Why this handoff is needed.',
    },
    context: {
      type: 'string',
      description: 'Summary of what has been done so far to pass to the next agent.',
    },
  },
  required: ['targetAgentId', 'reason'],
};

// ---------------------------------------------------------------------------
// Multi-Agent Pattern
// ---------------------------------------------------------------------------

export class MultiAgentPattern implements AgentPattern {
  readonly patternId = 'multi-agent';
  readonly displayName = 'Multi-Agent (Router + Specialists)';
  readonly description =
    'Routes requests to specialist agents and supports agent-to-agent handoffs. ' +
    'Best for systems with multiple specialized capabilities.';

  private readonly parser = new ResponseParser();

  /**
   * Specialist agent configurations. In a real system these would be
   * loaded from a registry. For the engine, they are provided via the
   * main agent config's metadata.specialistConfigs field.
   */
  private getSpecialistConfigs(config: AgentConfig): AgentConfig[] {
    const specs = config.metadata['specialistConfigs'];
    if (Array.isArray(specs)) {
      return specs as AgentConfig[];
    }
    return [];
  }

  async *execute(
    input: Message,
    context: AgentContext,
    services: AgentServices,
  ): AsyncIterable<AgentEvent> {
    const { config, session } = context;
    const startTime = Date.now();
    const cumulativeUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    let totalToolCalls = 0;
    let turnsUsed = 0;
    const maxTurns = config.maxTurns || 10;

    const specialists = this.getSpecialistConfigs(config);
    const handoffHistory: Array<{ from: string; to: string }> = [];

    // ---- Phase 1: Route to a specialist ----
    let currentAgentConfig = config;
    let currentInput = input;
    let finalText = '';

    // Determine which agent handles the request
    if (specialists.length > 0) {
      turnsUsed++;
      const routingResult = await this.routeRequest(
        input,
        config,
        specialists,
        services,
        cumulativeUsage,
      );

      if (routingResult.agentId !== 'self') {
        const targetAgent = specialists.find((s) => s.id === routingResult.agentId);
        if (targetAgent) {
          yield this.createEvent('handoff', {
            fromAgentId: config.id,
            toAgentId: targetAgent.id,
            reason: routingResult.reason,
          });

          handoffHistory.push({ from: config.id, to: targetAgent.id });
          currentAgentConfig = targetAgent;
        }
      }
    }

    // ---- Phase 2: Specialist execution loop with handoff support ----
    while (turnsUsed < maxTurns) {
      turnsUsed++;

      const { text, toolCallsCount, usage, handoff } = await this.executeAgent(
        currentInput,
        currentAgentConfig,
        context,
        services,
        specialists,
        maxTurns - turnsUsed,
      );

      totalToolCalls += toolCallsCount;
      cumulativeUsage.promptTokens += usage.promptTokens;
      cumulativeUsage.completionTokens += usage.completionTokens;
      cumulativeUsage.totalTokens += usage.totalTokens;

      // Stream the agent's text response
      if (text.length > 0) {
        yield this.createEvent('text_delta', { delta: text });
        finalText = text;
      }

      // Check for handoff
      if (handoff) {
        // Loop detection
        const handoffKey = `${currentAgentConfig.id}->${handoff.targetAgentId}`;
        const handoffCount = handoffHistory.filter(
          (h) => h.from === currentAgentConfig.id && h.to === handoff.targetAgentId,
        ).length;

        if (handoffCount >= 2 || handoffHistory.length >= MAX_HANDOFFS) {
          services.logger.warn('Handoff loop detected or max handoffs reached', {
            handoffHistory,
            attemptedHandoff: handoffKey,
          });

          yield this.createEvent('error', {
            code: 'HANDOFF_LOOP',
            message: `Handoff loop detected (${handoffKey}). Stopping delegation.`,
            recoverable: false,
          });
          break;
        }

        // Find the target specialist
        const targetAgent = specialists.find((s) => s.id === handoff.targetAgentId);
        if (!targetAgent) {
          services.logger.warn('Handoff target not found', {
            targetId: handoff.targetAgentId,
          });
          yield this.createEvent('error', {
            code: 'HANDOFF_TARGET_NOT_FOUND',
            message: `Specialist "${handoff.targetAgentId}" not found.`,
            recoverable: false,
          });
          break;
        }

        yield this.createEvent('handoff', {
          fromAgentId: currentAgentConfig.id,
          toAgentId: targetAgent.id,
          reason: handoff.reason,
        });

        handoffHistory.push({
          from: currentAgentConfig.id,
          to: targetAgent.id,
        });

        // Prepare the handoff context as the new input
        const handoffContext = handoff.context ?? text;
        currentInput = {
          role: 'user',
          content: `[Handoff from ${currentAgentConfig.name}] ${handoffContext}\n\nOriginal request: ${this.extractText(input)}`,
        };
        currentAgentConfig = targetAgent;
        continue;
      }

      // No handoff — execution is complete
      break;
    }

    if (!finalText) {
      finalText = 'The request could not be processed by any available specialist.';
    }

    yield this.createEvent('text_done', { fullText: finalText });
    yield this.createEvent('run_done', {
      finalResponse: finalText,
      totalTokens: cumulativeUsage,
      totalDurationMs: Date.now() - startTime,
      turnsUsed,
      toolCallsCount: totalToolCalls,
    });
  }

  // -----------------------------------------------------------------------
  // Routing
  // -----------------------------------------------------------------------

  /**
   * Use the router agent to decide which specialist handles the request.
   */
  private async routeRequest(
    input: Message,
    routerConfig: AgentConfig,
    specialists: AgentConfig[],
    services: AgentServices,
    cumulativeUsage: TokenUsage,
  ): Promise<{ agentId: string; reason: string }> {
    const specialistList = specialists
      .map((s) => `- **${s.id}** (${s.name}): ${s.description}`)
      .join('\n');

    const routingPrompt = ROUTING_PROMPT_TEMPLATE.replace(
      '{{specialists}}',
      specialistList,
    );

    const request: LLMRequest = {
      model: routerConfig.provider.modelId,
      messages: [
        { role: 'system', content: routerConfig.systemPrompt + '\n\n' + routingPrompt },
        input,
      ],
      temperature: 0,
      maxTokens: 256,
    };

    try {
      const response = await services.llm.complete(request);
      cumulativeUsage.promptTokens += response.usage.promptTokens;
      cumulativeUsage.completionTokens += response.usage.completionTokens;
      cumulativeUsage.totalTokens += response.usage.totalTokens;

      const text = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          agentId: string;
          reason: string;
        };
        if (parsed.agentId) {
          return { agentId: parsed.agentId, reason: parsed.reason || '' };
        }
      }
    } catch (error) {
      services.logger.warn('Routing failed, falling back to self', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { agentId: 'self', reason: 'Routing failed or no match found.' };
  }

  // -----------------------------------------------------------------------
  // Agent Execution
  // -----------------------------------------------------------------------

  /**
   * Execute a single agent (specialist or self) on the given input.
   * Supports a tool-use loop and can detect handoff requests.
   */
  private async executeAgent(
    input: Message,
    agentConfig: AgentConfig,
    parentContext: AgentContext,
    services: AgentServices,
    specialists: AgentConfig[],
    remainingTurns: number,
  ): Promise<{
    text: string;
    toolCallsCount: number;
    usage: TokenUsage;
    handoff?: { targetAgentId: string; reason: string; context?: string };
  }> {
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let toolCallsCount = 0;
    const maxIterations = Math.min(remainingTurns, agentConfig.maxTurns || 5);

    // Get tools for this specialist
    const toolDefs = services.tools.getDefinitions(agentConfig.tools);

    // Add the handoff tool if there are specialists
    const llmTools = toolDefs.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    if (specialists.length > 0) {
      llmTools.push({
        name: HANDOFF_TOOL_NAME,
        description:
          HANDOFF_TOOL_DESCRIPTION +
          ' Available agents: ' +
          specialists.map((s) => `${s.id} (${s.name})`).join(', '),
        inputSchema: HANDOFF_TOOL_SCHEMA,
      });
    }

    const messages: Message[] = [input];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      const request: LLMRequest = {
        model: agentConfig.provider.modelId,
        messages: [
          { role: 'system', content: agentConfig.systemPrompt },
          ...messages,
        ],
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
        tools: llmTools.length > 0 ? llmTools : undefined,
        toolChoice: llmTools.length > 0 ? 'auto' : undefined,
      };

      const response = await services.llm.complete(request);
      usage.promptTokens += response.usage.promptTokens;
      usage.completionTokens += response.usage.completionTokens;
      usage.totalTokens += response.usage.totalTokens;

      const parsed = this.parser.parseComplete(response, toolDefs);

      // Check for handoff tool call
      const handoffCall = parsed.toolCalls.find(
        (tc) => tc.name === HANDOFF_TOOL_NAME,
      );
      if (handoffCall) {
        return {
          text: parsed.text,
          toolCallsCount,
          usage,
          handoff: {
            targetAgentId: String(handoffCall.parameters['targetAgentId'] ?? ''),
            reason: String(handoffCall.parameters['reason'] ?? ''),
            context: handoffCall.parameters['context'] as string | undefined,
          },
        };
      }

      // No tool calls — return the final response
      if (parsed.toolCalls.length === 0) {
        return { text: parsed.text, toolCallsCount, usage };
      }

      // Process regular tool calls
      const assistantContent: ContentBlock[] = [];
      if (parsed.text) {
        assistantContent.push({ type: 'text', text: parsed.text });
      }
      for (const tc of parsed.toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.parameters,
        });
      }
      messages.push({ role: 'assistant', content: assistantContent });

      for (const tc of parsed.toolCalls) {
        toolCallsCount++;

        let result;
        try {
          result = await services.tools.dispatch(tc, {
            agentId: agentConfig.id,
            sessionId: parentContext.session.id,
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          result = {
            toolCallId: tc.id,
            output: '',
            error: errMsg,
            success: false,
            durationMs: 0,
          };
        }

        messages.push({
          role: 'tool',
          content: [
            {
              type: 'tool_result',
              toolUseId: tc.id,
              content: [
                {
                  type: 'text',
                  text: result.success
                    ? result.output
                    : `Error: ${result.error ?? 'Unknown error'}`,
                },
              ],
              isError: !result.success,
            },
          ],
          toolCallId: tc.id,
        });
      }
    }

    return {
      text: 'Agent execution reached maximum iterations.',
      toolCallsCount,
      usage,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private extractText(message: Message): string {
    if (typeof message.content === 'string') return message.content;
    return (message.content as ContentBlock[])
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  private createEvent(type: AgentEvent['type'], data: AgentEvent['data']): AgentEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
  }
}
