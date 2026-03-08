/**
 * ReAct (Reasoning + Acting) Pattern
 *
 * Implements the classic Thought -> Action -> Observation loop:
 * 1. The LLM generates reasoning (thought), then optionally a tool call (action).
 * 2. Tool results become observations.
 * 3. The loop continues until the LLM generates a final answer (no tool calls).
 *
 * This is the most versatile pattern, suitable for complex multi-step tasks
 * that require interleaving reasoning with tool use.
 */

import type {
  AgentContext,
  AgentEvent,
  AgentPattern,
  AgentServices,
  ContentBlock,
  LLMRequest,
  Message,
  TokenUsage,
  ToolCall,
} from './pattern.interface.js';
import { ResponseParser } from '../response-parser.js';

// ---------------------------------------------------------------------------
// ReAct Pattern
// ---------------------------------------------------------------------------

export class ReActPattern implements AgentPattern {
  readonly patternId = 'react';
  readonly displayName = 'ReAct (Reasoning + Acting)';
  readonly description =
    'Interleaves reasoning and tool use in a Thought-Action-Observation loop. ' +
    'Best for complex tasks requiring multi-step problem solving.';

  private readonly parser = new ResponseParser();

  async *execute(
    input: Message,
    context: AgentContext,
    services: AgentServices,
  ): AsyncIterable<AgentEvent> {
    const { config, session } = context;
    const maxTurns = config.maxTurns || 10;
    const startTime = Date.now();
    let turnNumber = 0;
    let totalToolCalls = 0;
    const cumulativeUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    // Build tool definitions for the LLM
    const toolDefs = services.tools.getDefinitions(config.tools);
    const builtPrompt = services.promptBuilder.build(config, context, toolDefs);

    // Working message history: starts with context + user input
    const messages: Message[] = [...builtPrompt.messages];

    // Ensure the user input is included at the end
    if (
      messages.length === 0 ||
      messages[messages.length - 1] !== input
    ) {
      messages.push(input);
    }

    let finalText = '';

    // ---- Main ReAct Loop ----
    while (turnNumber < maxTurns) {
      turnNumber++;

      services.logger.debug('ReAct loop iteration', { turnNumber, maxTurns });

      // Build the LLM request
      const request: LLMRequest = {
        model: config.provider.modelId,
        messages: [builtPrompt.systemMessage, ...messages],
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        tools: builtPrompt.tools.length > 0 ? builtPrompt.tools : undefined,
        toolChoice: builtPrompt.tools.length > 0 ? 'auto' : undefined,
        stream: true,
      };

      // Stream the LLM response
      let turnText = '';
      const toolCalls: ToolCall[] = [];
      try {
        const stream = services.llm.stream(request);

        for await (const event of this.parser.parseStreamIncremental(stream)) {
          switch (event.type) {
            case 'text_delta': {
              turnText += event.delta;
              yield this.createEvent('text_delta', { delta: event.delta });
              break;
            }

            case 'tool_call_start': {
              // Tool call metadata captured by parseStreamIncremental;
              // the full ToolCall is emitted via 'tool_call_ready'.
              break;
            }

            case 'tool_call_ready': {
              toolCalls.push(event.toolCall);
              break;
            }

            case 'usage': {
              if (event.usage) {
                cumulativeUsage.promptTokens += event.usage.promptTokens ?? 0;
                cumulativeUsage.completionTokens += event.usage.completionTokens ?? 0;
                cumulativeUsage.totalTokens += event.usage.totalTokens ?? 0;
                yield this.createEvent('usage_update', {
                  usage: event.usage as TokenUsage,
                  cumulativeUsage: { ...cumulativeUsage },
                });
              }
              break;
            }

            case 'stop':
              break;

            case 'warning': {
              services.logger.warn('ReAct stream warning', { message: event.message });
              break;
            }
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        services.logger.error('LLM stream error in ReAct loop', { error: errMsg, turnNumber });

        yield this.createEvent('error', {
          code: 'LLM_STREAM_ERROR',
          message: `LLM error on turn ${turnNumber}: ${errMsg}`,
          recoverable: turnNumber < maxTurns,
        });

        // On recoverable error, skip this turn and try again
        if (turnNumber < maxTurns) continue;
        break;
      }

      // Emit thinking event if there was text alongside tool calls
      if (turnText.length > 0 && toolCalls.length > 0) {
        yield this.createEvent('thinking', {
          thought: turnText,
          turnNumber,
        });
      }

      // If there are no tool calls, the LLM is providing the final answer
      if (toolCalls.length === 0) {
        finalText = turnText;
        if (turnText.length > 0) {
          yield this.createEvent('text_done', { fullText: turnText });
        }
        break;
      }

      // ---- Process tool calls ----
      // Add the assistant message with tool calls to history
      const assistantContent: ContentBlock[] = [];
      if (turnText.length > 0) {
        assistantContent.push({ type: 'text', text: turnText });
      }
      for (const tc of toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.parameters,
        });
      }
      messages.push({ role: 'assistant', content: assistantContent });

      // Execute each tool call
      for (const tc of toolCalls) {
        totalToolCalls++;

        yield this.createEvent('tool_call_start', {
          toolCallId: tc.id,
          toolName: tc.name,
          parameters: tc.parameters,
        });

        let result;
        try {
          result = await services.tools.dispatch(tc, {
            agentId: config.id,
            sessionId: session.id,
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

        yield this.createEvent('tool_call_done', {
          toolCallId: tc.id,
          toolName: tc.name,
          durationMs: result.durationMs,
        });

        yield this.createEvent('tool_result', {
          toolCallId: tc.id,
          toolName: tc.name,
          output: result.output,
          error: result.error,
          success: result.success,
          durationMs: result.durationMs,
        });

        // Add the tool result to the conversation
        const toolResultContent: ContentBlock[] = [
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
        ];

        messages.push({
          role: 'tool',
          content: toolResultContent,
          toolCallId: tc.id,
        });
      }

      // Continue the loop — the LLM will see tool results and decide next step
    }

    // If we exhausted turns without a final answer, note it
    if (turnNumber >= maxTurns && finalText === '') {
      finalText =
        'I was unable to complete the task within the maximum number of reasoning steps. ' +
        'Here is what I have so far based on the tools I used.';
      yield this.createEvent('text_done', { fullText: finalText });
    }

    // Emit run_done
    yield this.createEvent('run_done', {
      finalResponse: finalText,
      totalTokens: cumulativeUsage,
      totalDurationMs: Date.now() - startTime,
      turnsUsed: turnNumber,
      toolCallsCount: totalToolCalls,
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private createEvent(type: AgentEvent['type'], data: AgentEvent['data']): AgentEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
  }
}
