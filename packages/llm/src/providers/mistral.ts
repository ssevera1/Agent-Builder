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

// ─── Mistral API types (REST, no SDK) ───────────────────────────────────────

interface MistralMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: MistralToolCall[];
  tool_call_id?: string;
}

interface MistralToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface MistralTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface MistralStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason: string | null;
}

interface MistralStreamChunk {
  id: string;
  object: string;
  model: string;
  choices: MistralStreamChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── MistralClient ──────────────────────────────────────────────────────────

export class MistralClient extends BaseClient {
  readonly providerId = 'mistral';
  readonly modelId: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(modelId: string, options?: Record<string, unknown>) {
    super({ retry: options?.['retry'] as Record<string, unknown> | undefined });
    this.modelId = modelId;
    this.apiKey =
      (options?.['apiKey'] as string | undefined) ??
      process.env['MISTRAL_API_KEY'] ??
      '';
    this.baseUrl =
      (options?.['baseUrl'] as string | undefined) ??
      'https://api.mistral.ai/v1';

    if (!this.apiKey) {
      throw new ProviderError(
        'Mistral API key is required. Set MISTRAL_API_KEY environment variable or pass apiKey option.',
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
        maxOutputTokens: 8_192,
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
      body['top_p'] = request.topP;
    }
    if (request.stopSequences && request.stopSequences.length > 0) {
      body['stop'] = request.stopSequences;
    }
    if (tools && tools.length > 0) {
      body['tools'] = tools;
      if (request.toolChoice) {
        body['tool_choice'] = this.convertToolChoice(request.toolChoice);
      }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody) as {
          message?: string;
          error?: { message?: string };
        };
        errorMessage =
          parsed.error?.message ?? parsed.message ?? errorBody;
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
    // Mistral does not expose a standalone tokenizer API.
    // Heuristic: ~3.5 characters per token
    return Math.ceil(text.length / 3.5);
  }

  protected async _rawListModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!response.ok) {
        return modelCatalog.listModels(this.providerId);
      }

      const data = (await response.json()) as {
        data: Array<{ id: string; object: string }>;
      };

      return data.data.map((m) => {
        const catalogEntry = modelCatalog.getModel(this.providerId, m.id);
        return (
          catalogEntry ?? {
            providerId: this.providerId,
            modelId: m.id,
            displayName: m.id,
            contextWindow: 128_000,
            maxOutputTokens: 8_192,
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

    const partialToolCalls = new Map<
      number,
      { id: string; name: string; args: string }
    >();

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
              const chunk = JSON.parse(data) as MistralStreamChunk;
              const choice = chunk.choices[0];

              if (choice) {
                // Text content
                if (choice.delta.content) {
                  yield { type: 'text', text: choice.delta.content };
                }

                // Tool calls
                if (choice.delta.tool_calls) {
                  for (const tc of choice.delta.tool_calls) {
                    // Use the delta's index field to identify which tool call
                    // this chunk belongs to. Fallback to Map.size only for
                    // the very first chunk of a new call (when tc.id is set).
                    if (tc.id) {
                      const idx = tc.index ?? partialToolCalls.size;
                      partialToolCalls.set(idx, {
                        id: tc.id,
                        name: tc.function?.name ?? '',
                        args: tc.function?.arguments ?? '',
                      });
                    } else if (tc.index !== undefined) {
                      // Continuation chunk — append args to the correct entry
                      const partial = partialToolCalls.get(tc.index);
                      if (partial && tc.function?.arguments) {
                        partial.args += tc.function.arguments;
                      }
                    }
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

              // Usage (typically in last chunk)
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
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }
    } finally {
      try { await reader.cancel(); } catch { /* ignore cancel errors on already-closed streams */ }
      reader.releaseLock();
    }
  }

  // ── Conversion Helpers ────────────────────────────────────────────────────

  private convertMessages(request: LLMRequest): MistralMessage[] {
    const result: MistralMessage[] = [];

    // Add system prompt
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

  private convertAssistantMessage(msg: Message): MistralMessage {
    if (typeof msg.content === 'string') {
      return { role: 'assistant', content: msg.content };
    }

    const toolCalls: MistralToolCall[] = [];
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

    const result: MistralMessage = {
      role: 'assistant',
      content: textContent,
    };

    if (toolCalls.length > 0) {
      result.tool_calls = toolCalls;
    }

    return result;
  }

  private addToolResults(
    result: MistralMessage[],
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

  private convertTools(tools: ToolDefinition[]): MistralTool[] {
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
  ): string | Record<string, unknown> {
    if (!choice || choice === 'auto') return 'auto';
    if (choice === 'none') return 'none';
    if (choice === 'required') return 'any';
    if (typeof choice === 'object' && 'name' in choice) {
      return {
        type: 'function',
        function: { name: choice.name },
      };
    }
    return 'auto';
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
    reason: string,
  ): LLMStreamChunk['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'stop';
    }
  }
}
