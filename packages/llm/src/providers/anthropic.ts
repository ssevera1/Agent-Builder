import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  LLMRequest,
  LLMStreamChunk,
  LLMToolDefinition as ToolDefinition,
  Message,
  ModelInfo,
} from '@agentbuilder/core';
import { BaseClient, ProviderError } from '../base-client.js';
import { modelCatalog } from '../model-catalog.js';

// ─── Anthropic-specific types ────────────────────────────────────────────────

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicContentBlock = Anthropic.ContentBlockParam;
type AnthropicTool = Anthropic.Tool;
type AnthropicToolChoice = Anthropic.MessageCreateParams['tool_choice'];

// ─── AnthropicClient ─────────────────────────────────────────────────────────

export class AnthropicClient extends BaseClient {
  readonly providerId = 'anthropic';
  readonly modelId: string;

  private readonly client: Anthropic;

  constructor(modelId: string, options?: Record<string, unknown>) {
    super({ retry: options?.['retry'] as Record<string, unknown> | undefined });
    this.modelId = modelId;
    this.client = new Anthropic({
      apiKey: (options?.['apiKey'] as string | undefined) ?? process.env['ANTHROPIC_API_KEY'],
      baseURL: options?.['baseUrl'] as string | undefined,
    });
  }

  getModelInfo(): ModelInfo {
    return (
      modelCatalog.getModel(this.providerId, this.modelId) ?? {
        providerId: this.providerId,
        modelId: this.modelId,
        displayName: this.modelId,
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        supportsToolUse: true,
        supportsVision: true,
        supportsStreaming: true,
      }
    );
  }

  supportsToolUse(): boolean {
    return this.getModelInfo().supportsToolUse;
  }

  supportsVision(): boolean {
    return this.getModelInfo().supportsVision;
  }

  supportsStreaming(): boolean {
    return true;
  }

  // ── Raw Implementation ────────────────────────────────────────────────────

  protected async *_rawComplete(
    request: LLMRequest,
  ): AsyncIterable<LLMStreamChunk> {
    const messages = this.convertMessages(request.messages);
    const tools = request.tools
      ? this.convertTools(request.tools)
      : undefined;
    const toolChoice = this.convertToolChoice(request.toolChoice);

    const info = this.getModelInfo();
    const maxTokens = request.maxTokens ?? info.maxOutputTokens;

    const params: Anthropic.MessageCreateParams = {
      model: this.modelId,
      messages,
      max_tokens: maxTokens,
      stream: true,
    };

    if (request.systemPrompt) {
      params.system = request.systemPrompt;
    }
    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }
    if (request.topP !== undefined) {
      params.top_p = request.topP;
    }
    if (request.stopSequences && request.stopSequences.length > 0) {
      params.stop_sequences = request.stopSequences;
    }
    if (tools && tools.length > 0) {
      params.tools = tools;
    }
    if (toolChoice) {
      params.tool_choice = toolChoice;
    }

    const stream = this.client.messages.stream(params);

    // Track partial tool calls by index
    const partialToolCalls = new Map<
      number,
      { id: string; name: string; args: string }
    >();

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            if (!block.id || !block.name) {
              throw new ProviderError(
                'Malformed tool_use block: missing id or name',
                'invalid_response',
                500,
                false,
              );
            }
            partialToolCalls.set(event.index, {
              id: block.id,
              name: block.name,
              args: '',
            });
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            yield { type: 'text', text: delta.text };
          } else if (delta.type === 'input_json_delta') {
            const partial = partialToolCalls.get(event.index);
            if (partial) {
              partial.args += delta.partial_json;
            }
          }
          break;
        }

        case 'content_block_stop': {
          const partial = partialToolCalls.get(event.index);
          if (partial) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: partial.id,
                name: partial.name,
                arguments: partial.args,
              },
            };
            partialToolCalls.delete(event.index);
          }
          break;
        }

        case 'message_delta': {
          // Final message delta contains usage and stop reason
          const stopReason = event.delta.stop_reason;
          if (stopReason === null || stopReason === undefined) {
            throw new ProviderError(
              'Malformed message_delta event: missing stop_reason',
              'invalid_response',
              500,
              false,
            );
          }
          if (event.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: 0, // input usage comes from message_start
                outputTokens: event.usage.output_tokens,
                totalTokens: event.usage.output_tokens,
              },
            };
          }
          yield {
            type: 'done',
            finishReason: this.mapStopReason(stopReason),
          };
          break;
        }

        case 'message_start': {
          const message = event.message;
          if (!message.id || !message.content) {
            throw new ProviderError(
              'Malformed message_start event: missing id or content',
              'invalid_response',
              500,
              false,
            );
          }
          if (message.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
                totalTokens:
                  message.usage.input_tokens +
                  message.usage.output_tokens,
              },
            };
          }
          break;
        }
      }
    }
  }

  protected async _rawCountTokens(text: string): Promise<number> {
    // Anthropic provides a token counting API via the messages endpoint
    // For now, use heuristic: ~3.5 chars per token for Claude models
    return Math.ceil(text.length / 3.5);
  }

  protected async _rawListModels(): Promise<ModelInfo[]> {
    return modelCatalog.listModels(this.providerId);
  }

  // ── Error Classification Override ─────────────────────────────────────────

  protected override classifyError(err: unknown): ProviderError {
    if (err instanceof Anthropic.APIError) {
      const message = err.message;
      const status = err.status;

      if (status === 401 || status === 403) {
        return new ProviderError(message, 'auth', status, false);
      }
      if (status === 429) {
        return new ProviderError(message, 'rate_limit', status, true, 5000);
      }
      if (status === 529) {
        return new ProviderError(message, 'overloaded', status, true, 10000);
      }
      if (status === 400) {
        if (/context|too long|token/i.test(message)) {
          return new ProviderError(message, 'context_length', status, false);
        }
        return new ProviderError(message, 'invalid_request', status, false);
      }
      if (status >= 500) {
        return new ProviderError(message, 'server_error', status, true);
      }
    }

    return super.classifyError(err);
  }

  // ── Conversion Helpers ────────────────────────────────────────────────────

  private convertMessages(messages: Message[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      // Skip system messages — handled as top-level param
      if (msg.role === 'system') continue;

      if (msg.role === 'tool') {
        // Tool results
        const blocks = this.extractToolResults(msg.content);
        result.push({ role: 'user', content: blocks });
        continue;
      }

      const role: 'user' | 'assistant' =
        msg.role === 'assistant' ? 'assistant' : 'user';
      const content = this.convertContent(msg.content);
      result.push({ role, content });
    }

    return result;
  }

  private convertContent(
    content: string | ContentBlock[],
  ): string | AnthropicContentBlock[] {
    if (typeof content === 'string') return content;

    const blocks: AnthropicContentBlock[] = [];

    for (const block of content) {
      switch (block.type) {
        case 'text':
          blocks.push({ type: 'text', text: block.text });
          break;

        case 'image':
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: block.mimeType as
                | 'image/jpeg'
                | 'image/png'
                | 'image/gif'
                | 'image/webp',
              data: block.data,
            },
          });
          break;

        case 'image_url':
          blocks.push({
            type: 'image',
            source: {
              type: 'url',
              url: block.url,
            },
          });
          break;

        case 'tool_call':
          blocks.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: JSON.parse(block.arguments || '{}'),
          });
          break;

        case 'tool_result':
          blocks.push({
            type: 'tool_result',
            tool_use_id: block.toolCallId,
            content: block.content,
            is_error: block.isError,
          });
          break;
      }
    }

    return blocks.length === 1 && blocks[0]!.type === 'text'
      ? (blocks[0] as Anthropic.TextBlockParam).text
      : blocks;
  }

  private extractToolResults(
    content: string | ContentBlock[],
  ): AnthropicContentBlock[] {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }];
    }

    const blocks: AnthropicContentBlock[] = [];
    for (const block of content) {
      if (block.type === 'tool_result') {
        blocks.push({
          type: 'tool_result',
          tool_use_id: block.toolCallId,
          content: block.content,
          is_error: block.isError,
        });
      }
    }
    return blocks.length > 0
      ? blocks
      : [{ type: 'text', text: typeof content === 'string' ? content : '' }];
  }

  private convertTools(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.parameters.properties ?? {},
        required: tool.parameters.required ?? [],
      },
    }));
  }

  private convertToolChoice(
    choice?: LLMRequest['toolChoice'],
  ): AnthropicToolChoice | undefined {
    if (!choice) return undefined;
    if (choice === 'auto') return { type: 'auto' };
    if (choice === 'none') return undefined; // Anthropic has no 'none' — just omit tools
    if (choice === 'required') return { type: 'any' };
    if (typeof choice === 'object' && 'name' in choice) {
      return { type: 'tool', name: choice.name };
    }
    return undefined;
  }

  private mapStopReason(
    reason: string | null | undefined,
  ): LLMStreamChunk['finishReason'] {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      default:
        return 'stop';
    }
  }
}
