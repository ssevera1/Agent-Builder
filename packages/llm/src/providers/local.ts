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

// ─── Local service types ────────────────────────────────────────────────────

type LocalServiceType = 'ollama' | 'lmstudio' | 'vllm' | 'unknown';

/**
 * OpenAI-compatible chat message format used by all three local services.
 */
interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface LocalChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface LocalStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason: string | null;
}

interface LocalStreamChunk {
  id: string;
  object: string;
  model: string;
  choices: LocalStreamChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Ollama-specific types ──────────────────────────────────────────────────

interface OllamaTag {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  details: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

// ─── LocalLLMClient ─────────────────────────────────────────────────────────

/**
 * Unified client for local LLM services: Ollama, LM Studio, and vLLM.
 * All three expose an OpenAI-compatible API at /v1/chat/completions.
 */
export class LocalLLMClient extends BaseClient {
  readonly providerId = 'local';
  readonly modelId: string;

  private readonly baseUrl: string;
  private detectedService: LocalServiceType | null = null;

  constructor(modelId: string, options?: Record<string, unknown>) {
    super({ retry: options?.['retry'] as Record<string, unknown> | undefined });
    this.modelId = modelId;
    this.baseUrl =
      (options?.['baseUrl'] as string | undefined) ??
      process.env['LOCAL_LLM_BASE_URL'] ??
      'http://localhost:11434';
  }

  getModelInfo(): ModelInfo {
    return (
      modelCatalog.getModel(this.providerId, this.modelId) ?? {
        providerId: this.providerId,
        modelId: this.modelId,
        displayName: this.modelId,
        contextWindow: 8_192,
        maxOutputTokens: 4_096,
        supportsToolUse: false,
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

  /**
   * Detect which local service is running at the configured base URL.
   */
  async detectService(): Promise<LocalServiceType> {
    if (this.detectedService) return this.detectedService;

    // Try Ollama-specific endpoint
    try {
      const ollamaResp = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (ollamaResp.ok) {
        this.detectedService = 'ollama';
        return 'ollama';
      }
    } catch {
      // Not Ollama, continue
    }

    // Try vLLM health endpoint
    try {
      const vllmResp = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (vllmResp.ok) {
        this.detectedService = 'vllm';
        return 'vllm';
      }
    } catch {
      // Not vLLM, continue
    }

    // Try generic OpenAI-compatible /v1/models (LM Studio)
    try {
      const modelsResp = await fetch(`${this.baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (modelsResp.ok) {
        this.detectedService = 'lmstudio';
        return 'lmstudio';
      }
    } catch {
      // Service not reachable
    }

    this.detectedService = 'unknown';
    return 'unknown';
  }

  // ── Raw Implementation ────────────────────────────────────────────────────

  protected async *_rawComplete(
    request: LLMRequest,
  ): AsyncIterable<LLMStreamChunk> {
    const service = await this.detectService();
    const messages = this.convertMessages(request);
    const tools = request.tools
      ? this.convertTools(request.tools)
      : undefined;

    // Determine API endpoint
    const endpoint = this.getChatEndpoint(service);

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

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
        throw new ProviderError(
          `Local LLM service not reachable at ${this.baseUrl}. Ensure Ollama, LM Studio, or vLLM is running.`,
          'network',
          undefined,
          false,
        );
      }
      throw err;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody) as {
          error?: string | { message?: string };
        };
        errorMessage =
          typeof parsed.error === 'string'
            ? parsed.error
            : parsed.error?.message ?? errorBody;
      } catch {
        errorMessage = errorBody;
      }
      throw new ProviderError(
        errorMessage,
        this.classifyStatusCode(response.status),
        response.status,
        response.status >= 500,
      );
    }

    if (!response.body) {
      throw new ProviderError('Empty response body', 'server_error', undefined, true);
    }

    yield* this.parseSSEStream(response.body);
  }

  protected async _rawCountTokens(text: string): Promise<number> {
    // No standard tokenizer endpoint for local models
    // Heuristic: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  protected async _rawListModels(): Promise<ModelInfo[]> {
    const service = await this.detectService();

    if (service === 'ollama') {
      return this.listOllamaModels();
    }

    // OpenAI-compatible /v1/models endpoint
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(5000),
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
            contextWindow: 8_192,
            maxOutputTokens: 4_096,
            supportsToolUse: false,
            supportsVision: false,
            supportsStreaming: true,
          }
        );
      });
    } catch {
      return modelCatalog.listModels(this.providerId);
    }
  }

  // ── Ollama-specific ───────────────────────────────────────────────────────

  private async listOllamaModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return modelCatalog.listModels(this.providerId);
      }

      const data = (await response.json()) as { models: OllamaTag[] };

      return data.models.map((m) => {
        const modelId = m.name.replace(':latest', '');
        const catalogEntry = modelCatalog.getModel(this.providerId, modelId);
        return (
          catalogEntry ?? {
            providerId: this.providerId,
            modelId,
            displayName: `${m.name} (${m.details.parameter_size})`,
            contextWindow: this.estimateContextWindow(m.details.family),
            maxOutputTokens: 4_096,
            supportsToolUse: this.familySupportsTools(m.details.family),
            supportsVision: false,
            supportsStreaming: true,
          }
        );
      });
    } catch {
      return modelCatalog.listModels(this.providerId);
    }
  }

  /**
   * Use Ollama's native /api/generate endpoint for raw completions.
   * This provides access to Ollama-specific features.
   */
  async ollamaGenerate(
    prompt: string,
    options?: {
      system?: string;
      temperature?: number;
      topP?: number;
      numPredict?: number;
    },
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt,
      stream: false,
    };

    if (options?.system) body['system'] = options.system;
    if (options?.temperature !== undefined)
      body['options'] = {
        ...(body['options'] as Record<string, unknown> | undefined),
        temperature: options.temperature,
      };
    if (options?.topP !== undefined)
      body['options'] = {
        ...(body['options'] as Record<string, unknown> | undefined),
        top_p: options.topP,
      };
    if (options?.numPredict !== undefined)
      body['options'] = {
        ...(body['options'] as Record<string, unknown> | undefined),
        num_predict: options.numPredict,
      };

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError(
        `Ollama generate failed: ${errorText}`,
        'server_error',
        response.status,
        false,
      );
    }

    const result = (await response.json()) as { response: string };
    return result.response;
  }

  // ── SSE Parsing (OpenAI-compatible) ───────────────────────────────────────

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
              const chunk = JSON.parse(data) as LocalStreamChunk;
              const choice = chunk.choices[0];

              if (choice) {
                // Text content
                if (choice.delta.content) {
                  yield { type: 'text', text: choice.delta.content };
                }

                // Tool calls
                if (choice.delta.tool_calls) {
                  for (const tc of choice.delta.tool_calls) {
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
                    if (tc.function?.arguments)
                      partial.args += tc.function.arguments;
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

              // Usage (some local services include this)
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
      reader.releaseLock();
    }
  }

  // ── Conversion Helpers ────────────────────────────────────────────────────

  private convertMessages(request: LLMRequest): LocalChatMessage[] {
    const result: LocalChatMessage[] = [];

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

  private convertAssistantMessage(msg: Message): LocalChatMessage {
    if (typeof msg.content === 'string') {
      return { role: 'assistant', content: msg.content };
    }

    const toolCalls: LocalChatMessage['tool_calls'] = [];
    let textContent = '';

    for (const block of msg.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_call') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        });
      }
    }

    const result: LocalChatMessage = {
      role: 'assistant',
      content: textContent || null,
    };
    if (toolCalls.length > 0) {
      result.tool_calls = toolCalls;
    }
    return result;
  }

  private addToolResults(
    result: LocalChatMessage[],
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

  private convertTools(tools: ToolDefinition[]): LocalChatTool[] {
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
    if (choice === 'required') return 'required';
    if (typeof choice === 'object' && 'name' in choice) {
      return { type: 'function', function: { name: choice.name } };
    }
    return 'auto';
  }

  private getChatEndpoint(service: LocalServiceType): string {
    switch (service) {
      case 'ollama':
        // Ollama also supports /v1/chat/completions for OpenAI compat
        return `${this.baseUrl}/v1/chat/completions`;
      case 'lmstudio':
        return `${this.baseUrl}/v1/chat/completions`;
      case 'vllm':
        return `${this.baseUrl}/v1/chat/completions`;
      default:
        return `${this.baseUrl}/v1/chat/completions`;
    }
  }

  private getTextFromContent(content: string | ContentBlock[]): string {
    if (typeof content === 'string') return content;
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  private classifyStatusCode(status: number): ProviderError['code'] {
    if (status === 400) return 'invalid_request';
    if (status === 404) return 'invalid_request'; // Model not found
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

  private estimateContextWindow(family: string): number {
    const familyLower = family.toLowerCase();
    if (familyLower.includes('llama')) return 8_192;
    if (familyLower.includes('mistral')) return 32_000;
    if (familyLower.includes('phi')) return 128_000;
    if (familyLower.includes('qwen')) return 32_768;
    if (familyLower.includes('gemma')) return 8_192;
    return 4_096;
  }

  private familySupportsTools(family: string): boolean {
    const familyLower = family.toLowerCase();
    // Most recent model families support tools via Ollama
    return (
      familyLower.includes('llama') ||
      familyLower.includes('mistral') ||
      familyLower.includes('qwen') ||
      familyLower.includes('command')
    );
  }
}
