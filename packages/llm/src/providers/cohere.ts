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

// ─── Cohere v2 Chat API types (REST) ────────────────────────────────────────

interface CohereMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: CohereToolCall[];
  tool_call_id?: string;
}

interface CohereToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface CohereTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface CohereStreamEvent {
  type: string;
  // content-delta
  delta?: {
    message?: {
      content?: { text?: string };
      tool_calls?: {
        function?: { name?: string; arguments?: string };
      };
    };
  };
  index?: number;
  // message-start
  id?: string;
  // message-end
  finish_reason?: string;
  usage?: {
    billed_units?: {
      input_tokens?: number;
      output_tokens?: number;
    };
    tokens?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
}

// ─── CohereClient ───────────────────────────────────────────────────────────

export class CohereClient extends BaseClient {
  readonly providerId = 'cohere';
  readonly modelId: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(modelId: string, options?: Record<string, unknown>) {
    super({ retry: options?.['retry'] as Record<string, unknown> | undefined });
    this.modelId = modelId;
    this.apiKey =
      (options?.['apiKey'] as string | undefined) ??
      process.env['COHERE_API_KEY'] ??
      '';
    this.baseUrl =
      (options?.['baseUrl'] as string | undefined) ??
      'https://api.cohere.ai/v2';

    if (!this.apiKey) {
      throw new ProviderError(
        'Cohere API key is required. Set COHERE_API_KEY environment variable or pass apiKey option.',
        'auth',
        undefined,
        false,
      );
    }
  }

  getModelInfo(): ModelInfo {
    return (
      modelCatalog.getModel(this.providerId, this.modelId) ?? {
        providerId: this.providerId,
        modelId: this.modelId,
        displayName: this.modelId,
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
        supportsToolUse: true,
        supportsVision: false,
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
    const messages = this.convertMessages(request);
    const tools = request.tools
      ? this.convertTools(request.tools)
      : undefined;

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      stream: true,
    };

    if (request.temperature !== undefined) {
      body['temperature'] = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body['max_tokens'] = request.maxTokens;
    }
    if (request.topP !== undefined) {
      body['p'] = request.topP;
    }
    if (request.stopSequences && request.stopSequences.length > 0) {
      body['stop_sequences'] = request.stopSequences;
    }
    if (tools && tools.length > 0) {
      body['tools'] = tools;
    }

    const response = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody) as {
          message?: string;
          error?: string;
        };
        errorMessage = parsed.message ?? parsed.error ?? errorBody;
      } catch {
        errorMessage = errorBody;
      }
      throw new ProviderError(
        errorMessage,
        this.classifyStatusCode(response.status),
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }

    if (!response.body) {
      throw new ProviderError('Empty response body', 'server_error', undefined, true);
    }

    yield* this.parseSSEStream(response.body);
  }

  protected async _rawCountTokens(text: string): Promise<number> {
    // Cohere does not expose a standalone tokenizer via the v2 API.
    // Heuristic: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  protected async _rawListModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch('https://api.cohere.ai/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!response.ok) {
        return modelCatalog.listModels(this.providerId);
      }

      const data = (await response.json()) as {
        models: Array<{
          name: string;
          endpoints: string[];
          context_length?: number;
        }>;
      };

      return data.models
        .filter((m) => m.endpoints.includes('chat'))
        .map((m) => {
          const catalogEntry = modelCatalog.getModel(this.providerId, m.name);
          return (
            catalogEntry ?? {
              providerId: this.providerId,
              modelId: m.name,
              displayName: m.name,
              contextWindow: m.context_length ?? 128_000,
              maxOutputTokens: 4_096,
              supportsToolUse: true,
              supportsVision: false,
              supportsStreaming: true,
            }
          );
        });
    } catch {
      return modelCatalog.listModels(this.providerId);
    }
  }

  // ── SSE Parsing ───────────────────────────────────────────────────────────

  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<LLMStreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Cohere v2 streams tool calls as complete objects in tool-call-start events
    const pendingToolCalls: Array<{ id: string; name: string; args: string }> =
      [];
    let currentToolCallArgs = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data) as CohereStreamEvent;

              switch (event.type) {
                case 'content-delta': {
                  const text = event.delta?.message?.content?.text;
                  if (text) {
                    yield { type: 'text', text };
                  }
                  break;
                }

                case 'tool-call-start': {
                  // Start accumulating a new tool call
                  const tc = event.delta?.message?.tool_calls;
                  if (tc?.function?.name) {
                    pendingToolCalls.push({
                      id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                      name: tc.function.name,
                      args: tc.function.arguments ?? '',
                    });
                    currentToolCallArgs = tc.function.arguments ?? '';
                  }
                  break;
                }

                case 'tool-call-delta': {
                  const argDelta =
                    event.delta?.message?.tool_calls?.function?.arguments;
                  if (argDelta) {
                    currentToolCallArgs += argDelta;
                    const last = pendingToolCalls[pendingToolCalls.length - 1];
                    if (last) {
                      last.args = currentToolCallArgs;
                    }
                  }
                  break;
                }

                case 'tool-call-end': {
                  // Emit the completed tool call
                  const last = pendingToolCalls[pendingToolCalls.length - 1];
                  if (last) {
                    yield {
                      type: 'tool_call',
                      toolCall: {
                        id: last.id,
                        name: last.name,
                        arguments: last.args,
                      },
                    };
                  }
                  currentToolCallArgs = '';
                  break;
                }

                case 'message-end': {
                  // Usage information
                  if (event.usage) {
                    const tokens = event.usage.tokens ?? event.usage.billed_units;
                    if (tokens) {
                      const input = tokens.input_tokens ?? 0;
                      const output = tokens.output_tokens ?? 0;
                      yield {
                        type: 'usage',
                        usage: {
                          inputTokens: input,
                          outputTokens: output,
                          totalTokens: input + output,
                        },
                      };
                    }
                  }

                  yield {
                    type: 'done',
                    finishReason: this.mapFinishReason(
                      event.finish_reason,
                    ),
                  };
                  break;
                }
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Conversion Helpers ────────────────────────────────────────────────────

  private convertMessages(request: LLMRequest): CohereMessage[] {
    const result: CohereMessage[] = [];

    // System prompt
    if (request.systemPrompt) {
      result.push({ role: 'system', content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      switch (msg.role) {
        case 'system':
          result.push({
            role: 'system',
            content: this.getTextFromContent(msg.content),
          });
          break;

        case 'user':
          result.push({
            role: 'user',
            content: this.getTextFromContent(msg.content),
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

  private convertAssistantMessage(msg: Message): CohereMessage {
    if (typeof msg.content === 'string') {
      return { role: 'assistant', content: msg.content };
    }

    const toolCalls: CohereToolCall[] = [];
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

    const result: CohereMessage = {
      role: 'assistant',
      content: textContent || undefined,
    };

    if (toolCalls.length > 0) {
      result.tool_calls = toolCalls;
    }

    return result;
  }

  private addToolResults(
    result: CohereMessage[],
    content: string | ContentBlock[],
  ): void {
    if (typeof content === 'string') return;

    for (const block of content) {
      if (block.type === 'tool_result') {
        result.push({
          role: 'tool',
          content: block.content,
          tool_call_id: block.toolCallId,
        });
      }
    }
  }

  private convertTools(tools: ToolDefinition[]): CohereTool[] {
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

  private getTextFromContent(content: string | ContentBlock[]): string {
    if (typeof content === 'string') return content;
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  private classifyStatusCode(status: number): ProviderError['code'] {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status === 400) return 'invalid_request';
    if (status >= 500) return 'server_error';
    return 'unknown';
  }

  private mapFinishReason(
    reason: string | undefined,
  ): LLMStreamChunk['finishReason'] {
    switch (reason) {
      case 'COMPLETE':
      case 'stop':
        return 'stop';
      case 'TOOL_CALL':
      case 'tool_calls':
        return 'tool_use';
      case 'MAX_TOKENS':
      case 'length':
        return 'max_tokens';
      case 'ERROR':
        return 'error';
      default:
        return 'stop';
    }
  }
}
