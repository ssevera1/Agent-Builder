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

// ─── Gemini API types (REST, no SDK) ─────────────────────────────────────────

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { result: unknown } } };

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  error?: { code: number; message: string; status: string };
}

// ─── GeminiClient ────────────────────────────────────────────────────────────

export class GeminiClient extends BaseClient {
  readonly providerId = 'google';
  readonly modelId: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(modelId: string, options?: Record<string, unknown>) {
    super({ retry: options?.['retry'] as Record<string, unknown> | undefined });
    this.modelId = modelId;
    this.apiKey =
      (options?.['apiKey'] as string | undefined) ??
      process.env['GOOGLE_API_KEY'] ??
      '';
    this.baseUrl =
      (options?.['baseUrl'] as string | undefined) ??
      'https://generativelanguage.googleapis.com/v1beta';

    if (!this.apiKey) {
      throw new ProviderError(
        'Google API key is required. Set GOOGLE_API_KEY environment variable or pass apiKey option.',
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
        contextWindow: 1_000_000,
        maxOutputTokens: 65_536,
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
    const contents = this.convertMessages(request.messages);
    const systemInstruction = request.systemPrompt
      ? { parts: [{ text: request.systemPrompt }] }
      : undefined;
    const tools = request.tools
      ? this.convertTools(request.tools)
      : undefined;

    const body: Record<string, unknown> = { contents };

    if (systemInstruction) {
      body['systemInstruction'] = systemInstruction;
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.maxTokens !== undefined) {
      generationConfig['maxOutputTokens'] = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      generationConfig['temperature'] = request.temperature;
    }
    if (request.topP !== undefined) {
      generationConfig['topP'] = request.topP;
    }
    if (request.stopSequences && request.stopSequences.length > 0) {
      generationConfig['stopSequences'] = request.stopSequences;
    }
    if (Object.keys(generationConfig).length > 0) {
      body['generationConfig'] = generationConfig;
    }

    if (tools && tools.length > 0) {
      body['tools'] = [{ functionDeclarations: tools }];

      if (request.toolChoice) {
        body['toolConfig'] = {
          functionCallingConfig: this.convertToolChoice(request.toolChoice),
        };
      }
    }

    const url = `${this.baseUrl}/models/${this.modelId}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody) as { error?: { message?: string } };
        errorMessage = parsed.error?.message ?? errorBody;
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
    const url = `${this.baseUrl}/models/${this.modelId}:countTokens?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Token counting failed: ${response.status}`);
    }

    const result = (await response.json()) as { totalTokens: number };
    return result.totalTokens;
  }

  protected async _rawListModels(): Promise<ModelInfo[]> {
    try {
      const url = `${this.baseUrl}/models?key=${this.apiKey}`;
      const response = await fetch(url);

      if (!response.ok) {
        return modelCatalog.listModels(this.providerId);
      }

      const data = (await response.json()) as {
        models: Array<{
          name: string;
          displayName: string;
          inputTokenLimit: number;
          outputTokenLimit: number;
          supportedGenerationMethods: string[];
        }>;
      };

      return data.models.map((m) => {
        const modelId = m.name.replace('models/', '');
        const catalogEntry = modelCatalog.getModel(this.providerId, modelId);
        return (
          catalogEntry ?? {
            providerId: this.providerId,
            modelId,
            displayName: m.displayName,
            contextWindow: m.inputTokenLimit,
            maxOutputTokens: m.outputTokenLimit,
            supportsToolUse: true,
            supportsVision: true,
            supportsStreaming: m.supportedGenerationMethods.includes(
              'streamGenerateContent',
            ),
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
              const chunk = JSON.parse(data) as GeminiStreamChunk;

              if (chunk.error) {
                yield {
                  type: 'error',
                  error: {
                    code: String(chunk.error.code),
                    message: chunk.error.message,
                  },
                };
                continue;
              }

              const candidate = chunk.candidates?.[0];
              if (candidate?.content?.parts) {
                for (const part of candidate.content.parts) {
                  if ('text' in part) {
                    yield { type: 'text', text: part.text };
                  } else if ('functionCall' in part) {
                    yield {
                      type: 'tool_call',
                      toolCall: {
                        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args),
                      },
                    };
                  }
                }

                if (candidate.finishReason) {
                  yield {
                    type: 'done',
                    finishReason: this.mapFinishReason(candidate.finishReason),
                  };
                }
              }

              if (chunk.usageMetadata) {
                yield {
                  type: 'usage',
                  usage: {
                    inputTokens: chunk.usageMetadata.promptTokenCount,
                    outputTokens: chunk.usageMetadata.candidatesTokenCount,
                    totalTokens: chunk.usageMetadata.totalTokenCount,
                  },
                };
              }
            } catch {
              // Skip malformed JSON chunks
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

  private convertMessages(messages: Message[]): GeminiContent[] {
    const result: GeminiContent[] = [];
    // Track tool call id → function name so tool_result blocks can use the name
    const toolCallNames = new Map<string, string>();

    for (const msg of messages) {
      // System messages handled separately as systemInstruction
      if (msg.role === 'system') continue;

      // Record function names from assistant tool_call blocks
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_call') {
            toolCallNames.set(block.id, block.name);
          }
        }
      }

      const role: 'user' | 'model' =
        msg.role === 'assistant' ? 'model' : 'user';
      const parts = this.convertContentToParts(msg.content, msg.role, toolCallNames);

      if (parts.length > 0) {
        result.push({ role, parts });
      }
    }

    return result;
  }

  private convertContentToParts(
    content: string | ContentBlock[],
    role: string,
    toolCallNames?: Map<string, string>,
  ): GeminiPart[] {
    if (typeof content === 'string') {
      return [{ text: content }];
    }

    const parts: GeminiPart[] = [];

    for (const block of content) {
      switch (block.type) {
        case 'text':
          parts.push({ text: block.text });
          break;

        case 'image':
          parts.push({
            inlineData: { mimeType: block.mimeType, data: block.data },
          });
          break;

        case 'image_url':
          // Gemini REST API needs inline data; URL images need conversion
          // For now pass as text reference — callers should use base64
          parts.push({ text: `[Image: ${block.url}]` });
          break;

        case 'tool_call':
          if (role === 'assistant') {
            parts.push({
              functionCall: {
                name: block.name,
                args: JSON.parse(block.arguments || '{}'),
              },
            });
          }
          break;

        case 'tool_result':
          parts.push({
            functionResponse: {
              // Gemini requires the function name, not the call ID
              name: toolCallNames?.get(block.toolCallId) ?? block.toolCallId,
              response: { result: block.content },
            },
          });
          break;
      }
    }

    return parts;
  }

  private convertTools(
    tools: ToolDefinition[],
  ): GeminiFunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.parameters.type,
        properties: tool.parameters.properties ?? {},
        required: tool.parameters.required ?? [],
      },
    }));
  }

  private convertToolChoice(
    choice: LLMRequest['toolChoice'],
  ): Record<string, unknown> {
    if (!choice || choice === 'auto') {
      return { mode: 'AUTO' };
    }
    if (choice === 'none') {
      return { mode: 'NONE' };
    }
    if (choice === 'required') {
      return { mode: 'ANY' };
    }
    if (typeof choice === 'object' && 'name' in choice) {
      return {
        mode: 'ANY',
        allowedFunctionNames: [choice.name],
      };
    }
    return { mode: 'AUTO' };
  }

  private classifyStatusCode(
    status: number,
  ): ProviderError['code'] {
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
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
        return 'error';
      default:
        // Gemini uses STOP for function calls too — check if tool calls were emitted
        return 'stop';
    }
  }
}
