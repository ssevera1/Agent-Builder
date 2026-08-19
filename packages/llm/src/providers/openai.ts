import OpenAI from 'openai';
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

// ─── OpenAI type aliases ────────────────────────────────────────────────────

type ChatMessage = OpenAI.ChatCompletionMessageParam;
type ChatTool = OpenAI.ChatCompletionTool;

// ─── OpenAIClient ────────────────────────────────────────────────────────────

export class OpenAIClient extends BaseClient {
  readonly providerId = 'openai';
  readonly modelId: string;

  private readonly client: OpenAI;

  constructor(modelId: string, options?: Record<string, unknown>) {
    super({ retry: options?.['retry'] as Record<string, unknown> | undefined });
    this.modelId = modelId;
    this.client = new OpenAI({
      apiKey: (options?.['apiKey'] as string | undefined) ?? process.env['OPENAI_API_KEY'],
      baseURL: options?.['baseUrl'] as string | undefined,
    });
  }

  getModelInfo(): ModelInfo {
    return (
      modelCatalog.getModel(this.providerId, this.modelId) ?? {
        providerId: this.providerId,
        modelId: this.modelId,
        displayName: this.modelId,
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
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
    // Validate model availability before making API call
    if (!this.isModelAvailable()) {
      throw new ProviderError(
        `Model "${this.modelId}" is not available in OpenAI's catalog. Please verify the model ID is correct.`,
        'invalid_request',
        400,
        false,
      );
    }

    const messages = this.convertMessages(request);
    const tools = request.tools
      ? this.convertTools(request.tools)
      : undefined;

    const isReasoningModel = this.isReasoningModel();

    const params: OpenAI.ChatCompletionCreateParams = {
      model: this.modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    // Reasoning models (o1, o3, o4-mini) do not support temperature or top_p
    if (!isReasoningModel) {
      if (request.temperature !== undefined) {
        params.temperature = request.temperature;
      }
      if (request.topP !== undefined) {
        params.top_p = request.topP;
      }
    }

    if (request.maxTokens !== undefined) {
      if (isReasoningModel) {
        params.max_completion_tokens = request.maxTokens;
      } else {
        params.max_completion_tokens = request.maxTokens;
      }
    }

    if (request.stopSequences && request.stopSequences.length > 0) {
      params.stop = request.stopSequences;
    }

    if (tools && tools.length > 0) {
      params.tools = tools;
      if (request.toolChoice) {
        params.tool_choice = this.convertToolChoice(request.toolChoice);
      }
    }

    const stream = await this.client.chat.completions.create(params);

    // Track partial tool calls
    const partialToolCalls = new Map<
      number,
      { id: string; name: string; args: string }
    >();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      if (choice) {
        const delta = choice.delta;

        // Text content
        if (delta?.content) {
          yield { type: 'text', text: delta.content };
        }

        // Tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!partialToolCalls.has(idx)) {
              partialToolCalls.set(idx, {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                args: '',
              });
            }
            const partial = partialToolCalls.get(idx)!;
            if (tc.id) partial.id = tc.id;
            if (tc.function?.name) partial.name = tc.function.name;
            if (tc.function?.arguments) partial.args += tc.function.arguments;
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          // Emit accumulated tool calls
          for (const [, partial] of partialToolCalls) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: partial.id,
                name: partial.name,
                arguments: partial.args,
              },
            };
          }
          partialToolCalls.clear();

          yield {
            type: 'done',
            finishReason: this.mapFinishReason(choice.finish_reason),
          };
        }
      }

      // Usage info (comes in the final chunk when stream_options.include_usage is true)
      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          },
        };
      }
    }
  }

  protected async _rawCountTokens(text: string): Promise<number> {
    // OpenAI does not expose a standalone token counting API.
    // Use heuristic: ~4 characters per token for English text.
    return Math.ceil(text.length / 4);
  }

  protected async _rawListModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.client.models.list();
      const apiModels: ModelInfo[] = [];

      for await (const model of response) {
        const catalogEntry = modelCatalog.getModel(
          this.providerId,
          model.id,
        );
        if (catalogEntry) {
          apiModels.push(catalogEntry);
        } else {
          apiModels.push({
            providerId: this.providerId,
            modelId: model.id,
            displayName: model.id,
            contextWindow: 128_000,
            maxOutputTokens: 16_384,
            supportsToolUse: true,
            supportsVision: false,
            supportsStreaming: true,
          });
        }
      }

      return apiModels;
    } catch {
      return modelCatalog.listModels(this.providerId);
    }
  }

  // ── Error Classification Override ─────────────────────────────────────────

  protected override classifyError(err: unknown): ProviderError {
    if (err instanceof OpenAI.APIError) {
      const message = err.message;
      const status = err.status;

      if (status === 401 || status === 403) {
        return new ProviderError(message, 'auth', status, false);
      }
      if (status === 429) {
        return new ProviderError(message, 'rate_limit', status, true, 5000);
      }
      if (status === 400) {
        if (
          /context.*(length|window)|maximum.*tokens|too long/i.test(message)
        ) {
          return new ProviderError(message, 'context_length', status, false);
        }
        if (/content.*filter|safety/i.test(message)) {
          return new ProviderError(message, 'content_filter', status, false);
        }
        return new ProviderError(message, 'invalid_request', status, false);
      }
      if (status === 503) {
        return new ProviderError(message, 'overloaded', status, true, 5000);
      }
      if (status !== undefined && status >= 500) {
        return new ProviderError(message, 'server_error', status, true);
      }
    }

    return super.classifyError(err);
  }

  // ── Conversion Helpers ────────────────────────────────────────────────────

  private convertMessages(request: LLMRequest): ChatMessage[] {
    const result: ChatMessage[] = [];

    // Add system prompt as the first message if provided
    if (request.systemPrompt) {
      result.push({ role: 'system', content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      switch (msg.role) {
        case 'system':
          result.push({ role: 'system', content: this.getTextFromContent(msg.content) });
          break;

        case 'user':
          result.push({
            role: 'user',
            content: this.convertUserContent(msg.content),
          });
          break;

        case 'assistant':
          result.push(this.convertAssistantMessage(msg));
          break;

        case 'tool':
          this.addToolResults(result, msg.content);
          break;
      }
    }

    return result;
  }

  private convertUserContent(
    content: string | ContentBlock[],
  ): string | OpenAI.ChatCompletionContentPart[] {
    if (typeof content === 'string') return content;

    const parts: OpenAI.ChatCompletionContentPart[] = [];
    for (const block of content) {
      switch (block.type) {
        case 'text':
          parts.push({ type: 'text', text: block.text });
          break;
        case 'image':
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.mimeType};base64,${block.data}`,
            },
          });
          break;
        case 'image_url':
          parts.push({
            type: 'image_url',
            image_url: { url: block.url },
          });
          break;
      }
    }
    return parts;
  }

  private convertAssistantMessage(msg: Message): ChatMessage {
    if (typeof msg.content === 'string') {
      return { role: 'assistant', content: msg.content };
    }

    // Check for tool calls
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
    let textContent = '';

    for (const block of msg.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_call') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: block.arguments,
          },
        });
      }
    }

    const result: OpenAI.ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: textContent || null,
    };

    if (toolCalls.length > 0) {
      result.tool_calls = toolCalls;
    }

    return result;
  }

  private addToolResults(
    result: ChatMessage[],
    content: string | ContentBlock[],
  ): void {
    if (typeof content === 'string') {
      // Cannot map a plain string tool result without a tool_call_id
      return;
    }

    for (const block of content) {
      if (block.type === 'tool_result') {
        result.push({
          role: 'tool',
          tool_call_id: block.toolCallId,
          content: block.content,
        });
      }
    }
  }

  private convertTools(tools: ToolDefinition[]): ChatTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: tool.parameters.type,
          properties: tool.parameters.properties ?? {},
          required: tool.parameters.required ?? [],
        },
      },
    }));
  }

  private convertToolChoice(
    choice: LLMRequest['toolChoice'],
  ): OpenAI.ChatCompletionToolChoiceOption | undefined {
    if (!choice) return undefined;
    if (choice === 'auto') return 'auto';
    if (choice === 'none') return 'none';
    if (choice === 'required') return 'required';
    if (typeof choice === 'object' && 'name' in choice) {
      return { type: 'function', function: { name: choice.name } };
    }
    return undefined;
  }

  private getTextFromContent(content: string | ContentBlock[]): string {
    if (typeof content === 'string') return content;
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  private mapFinishReason(
    reason: string,
  ): LLMStreamChunk['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      case 'content_filter':
        return 'error';
      default:
        return 'stop';
    }
  }

  private isReasoningModel(): boolean {
    return /^(o1|o3|o4)/.test(this.modelId);
  }

  private isModelAvailable(): boolean {
    return modelCatalog.getModel(this.providerId, this.modelId) !== undefined;
  }
}
