/**
 * Tool-Augmented Pattern
 *
 * A simpler alternative to ReAct — no explicit reasoning chain:
 * 1. The LLM receives the user's request and available tools.
 * 2. It decides whether to call tools based on the request.
 * 3. Tool results are appended and the LLM generates a final response.
 *
 * This pattern is a straightforward request-response loop with optional
 * tool use. It is ideal for well-defined tool-use scenarios where the
 * agent does not need multi-step reasoning.
 */

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
  ToolCall,
} from './pattern.interface.js';
import { ResponseParser } from '../response-parser.js';

// ---------------------------------------------------------------------------
// Tool-Augmented Pattern
// ---------------------------------------------------------------------------

export class ToolAugmentedPattern implements AgentPattern {
  readonly patternId = 'tool-augmented';
  readonly displayName = 'Tool-Augmented';
  readonly description =
    'Simple tool-calling agent without explicit reasoning chains. ' +
    'Best for straightforward tasks with clear tool-use scenarios.';

  private readonly parser = new ResponseParser();

  async *execute(
    input: Message,
    context: AgentContext,
    services: AgentServices,
  ): AsyncIterable<AgentEvent> {
    const { config, session } = context;
    const maxTurns = config.maxTurns || 10;
    const startTime = Date.now();
    let turnsUsed = 0;
    let totalToolCalls = 0;
    const cumulativeUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    // Build the prompt
    const toolDefs = services.tools.getDefinitions(config.tools);
    const builtPrompt = services.promptBuilder.build(config, context, toolDefs);

    // Working message history
    const messages: Message[] = [...builtPrompt.messages];

    // Ensure user input is included
    if (
      messages.length === 0 ||
      messages[messages.length - 1] !== input
    ) {
      messages.push(input);
    }

    let finalText = '';

    // ---- Tool-use loop ----
    // The LLM may call tools, in which case we loop. Otherwise, we're done.
    while (turnsUsed < maxTurns) {
      turnsUsed++;

      const request: LLMRequest = {
        model: config.provider.modelId,
        messages: [builtPrompt.systemMessage, ...messages],
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        tools: builtPrompt.tools.length > 0 ? builtPrompt.tools : undefined,
        toolChoice: builtPrompt.tools.length > 0 ? 'auto' : undefined,
        stream: true,
      };

      // Stream the response
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
              yield this.createEvent('tool_call_start', {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                parameters: {},
              });
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
              services.logger.warn('Tool-augmented stream warning', {
                message: event.message,
              });
              break;
            }
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        services.logger.error('LLM stream error in tool-augmented loop', {
          error: errMsg,
          turnsUsed,
        });

        yield this.createEvent('error', {
          code: 'LLM_STREAM_ERROR',
          message: `LLM error on turn ${turnsUsed}: ${errMsg}`,
          recoverable: turnsUsed < maxTurns,
        });

        if (turnsUsed < maxTurns) continue;
        break;
      }

      // If no tool calls, the LLM is providing the final answer
      if (toolCalls.length === 0) {
        finalText = turnText;
        if (turnText.length > 0) {
          yield this.createEvent('text_done', { fullText: turnText });
        }
        break;
      }

      // ---- Process tool calls ----
      // Add assistant message
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

        // The tool_call_start event was already emitted during streaming.
        // Now update it with parameters that we now know.
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

        // Add tool result to conversation
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

      // Continue the loop — LLM will process tool results
    }

    // If we exhausted turns without a final answer
    if (turnsUsed >= maxTurns && finalText === '') {
      finalText =
        'I reached the maximum number of tool-use iterations. ' +
        'Here is what I have so far based on the tools I used.';
      yield this.createEvent('text_done', { fullText: finalText });
    }

    yield this.createEvent('run_done', {
      finalResponse: finalText,
      totalTokens: cumulativeUsage,
      totalDurationMs: Date.now() - startTime,
      turnsUsed,
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
