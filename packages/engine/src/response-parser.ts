/**
 * ResponseParser — extracts structured content from LLM response streams.
 *
 * Handles:
 * - Assembling text content from streaming text deltas
 * - Assembling tool calls from partial JSON fragments
 * - Validating tool call parameters against known tool schemas
 * - Gracefully handling malformed LLM output
 */

import type {
  ContentBlock,
  LLMResponse,
  LLMStreamChunk,
  StopReason,
  TextBlock,
  ToolCall,
  ToolDefinition,
  ToolUseBlock,
  TokenUsage,
} from './patterns/pattern.interface.js';

// ---------------------------------------------------------------------------
// Parsed response structure
// ---------------------------------------------------------------------------

/** The fully parsed result from processing LLM output. */
export interface ParsedResponse {
  /** Concatenated text content. */
  text: string;
  /** Extracted and validated tool calls. */
  toolCalls: ToolCall[];
  /** Why the model stopped generating. */
  stopReason: StopReason;
  /** Token usage (if available). */
  usage?: TokenUsage;
  /** Parsing warnings (e.g., malformed tool call JSON). */
  warnings: string[];
}

/** Intermediate state for a tool call being assembled from stream chunks. */
interface PartialToolCall {
  id: string;
  name: string;
  /** JSON string fragments accumulated so far. */
  jsonFragments: string[];
}

// ---------------------------------------------------------------------------
// ResponseParser
// ---------------------------------------------------------------------------

export class ResponseParser {
  /**
   * Parse a complete (non-streaming) LLM response into structured data.
   *
   * @param response - A complete LLM response.
   * @param knownTools - Available tool definitions for validation.
   * @returns Parsed response with text, tool calls, and warnings.
   */
  parseComplete(response: LLMResponse, knownTools?: ToolDefinition[]): ParsedResponse {
    const text = this.extractTextFromBlocks(response.content);
    const rawToolCalls = this.extractToolCallsFromBlocks(response.content);
    const warnings: string[] = [];

    // Validate tool calls
    const toolCalls = this.validateToolCalls(rawToolCalls, knownTools, warnings);

    return {
      text,
      toolCalls,
      stopReason: response.stopReason,
      usage: response.usage,
      warnings,
    };
  }

  /**
   * Parse streaming chunks into a complete ParsedResponse.
   *
   * This method consumes the entire async iterable and assembles the final
   * result. For real-time event emission, use `parseStreamIncremental`.
   *
   * @param chunks - Async iterable of streaming chunks.
   * @param knownTools - Available tool definitions for validation.
   * @returns Parsed response.
   */
  async parseStreamChunks(
    chunks: AsyncIterable<LLMStreamChunk>,
    knownTools?: ToolDefinition[],
  ): Promise<ParsedResponse> {
    const textParts: string[] = [];
    const rawToolCalls: ToolCall[] = [];
    let stopReason: StopReason = 'end_turn';
    let usage: TokenUsage | undefined;
    const warnings: string[] = [];

    for await (const chunk of chunks) {
      switch (chunk.type) {
        case 'text': {
          if (chunk.text) {
            textParts.push(chunk.text);
          }
          break;
        }

        case 'tool_call': {
          if (chunk.toolCall) {
            let parameters: Record<string, unknown> = {};
            try {
              parameters = JSON.parse(chunk.toolCall.arguments || '{}') as Record<string, unknown>;
            } catch { /* keep empty */ }
            rawToolCalls.push({
              id: chunk.toolCall.id,
              name: chunk.toolCall.name,
              parameters,
            });
          }
          break;
        }

        case 'usage': {
          if (chunk.usage) {
            usage = this.mergeUsage(usage, {
              promptTokens: chunk.usage.inputTokens,
              completionTokens: chunk.usage.outputTokens,
              totalTokens: chunk.usage.totalTokens,
            });
          }
          break;
        }

        case 'done': {
          if (chunk.finishReason) {
            stopReason = this.mapFinishReason(chunk.finishReason);
          }
          break;
        }

        case 'error': {
          warnings.push(`Stream error: ${chunk.error?.message ?? 'Unknown streaming error'}`);
          break;
        }
      }
    }

    const toolCalls = this.validateToolCalls(rawToolCalls, knownTools, warnings);

    return {
      text: textParts.join(''),
      toolCalls,
      stopReason,
      usage,
      warnings,
    };
  }

  /**
   * Incrementally process stream chunks, yielding parsed events as they
   * arrive. This is used by patterns that need to emit AgentEvents in
   * real time during streaming.
   *
   * Handles the normalized chunk format emitted by all providers:
   * text / tool_call / usage / done / error.
   *
   * @param chunks - Async iterable of streaming chunks.
   * @yields StreamParseEvent for each meaningful parsing event.
   */
  async *parseStreamIncremental(
    chunks: AsyncIterable<LLMStreamChunk>,
  ): AsyncIterable<StreamParseEvent> {
    for await (const chunk of chunks) {
      switch (chunk.type) {
        case 'text': {
          if (chunk.text) {
            yield { type: 'text_delta', delta: chunk.text };
          }
          break;
        }

        case 'tool_call': {
          if (chunk.toolCall) {
            yield {
              type: 'tool_call_start',
              toolCallId: chunk.toolCall.id,
              toolName: chunk.toolCall.name,
            };
            let parameters: Record<string, unknown> = {};
            try {
              parameters = JSON.parse(chunk.toolCall.arguments || '{}') as Record<string, unknown>;
            } catch {
              // Keep empty parameters on malformed JSON
            }
            yield {
              type: 'tool_call_ready',
              toolCall: { id: chunk.toolCall.id, name: chunk.toolCall.name, parameters },
            };
          }
          break;
        }

        case 'usage': {
          if (chunk.usage) {
            yield {
              type: 'usage',
              usage: {
                promptTokens: chunk.usage.inputTokens,
                completionTokens: chunk.usage.outputTokens,
                totalTokens: chunk.usage.totalTokens,
              },
            };
          }
          break;
        }

        case 'done': {
          if (chunk.finishReason) {
            yield { type: 'stop', stopReason: chunk.finishReason as StopReason };
          }
          break;
        }

        case 'error': {
          yield {
            type: 'warning',
            message: `Stream error: ${chunk.error?.message ?? 'Unknown error'}`,
          };
          break;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Content block extraction (non-streaming)
  // -----------------------------------------------------------------------

  /** Extract concatenated text from content blocks. */
  private extractTextFromBlocks(blocks: ContentBlock[]): string {
    return blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  /** Extract tool calls from content blocks. */
  private extractToolCallsFromBlocks(blocks: ContentBlock[]): ToolCall[] {
    return blocks
      .filter((b): b is ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        parameters: b.input,
      }));
  }

  // -----------------------------------------------------------------------
  // Partial tool call assembly
  // -----------------------------------------------------------------------

  /** Assemble all partial tool calls into final ToolCall objects. */
  private assemblePartialToolCalls(
    partials: Map<number, PartialToolCall>,
    warnings: string[],
  ): ToolCall[] {
    const results: ToolCall[] = [];

    for (const [, partial] of partials) {
      const toolCall = this.assembleOneToolCall(partial);
      if (toolCall) {
        results.push(toolCall);
      } else {
        warnings.push(
          `Failed to parse tool call JSON for "${partial.name}" (id: ${partial.id}). ` +
            `Raw fragments: ${partial.jsonFragments.join('')}`,
        );
      }
    }

    return results;
  }

  /**
   * Attempt to assemble a single partial tool call.
   * Returns null if the JSON is malformed.
   */
  private assembleOneToolCall(partial: PartialToolCall): ToolCall | null {
    const rawJson = partial.jsonFragments.join('');

    // Empty input is valid — some tools have no parameters
    if (rawJson.trim() === '' || rawJson.trim() === '{}') {
      return {
        id: partial.id,
        name: partial.name,
        parameters: {},
      };
    }

    try {
      const parameters = JSON.parse(rawJson) as Record<string, unknown>;
      return {
        id: partial.id,
        name: partial.name,
        parameters,
      };
    } catch {
      // Try to repair common JSON issues
      const repaired = this.attemptJsonRepair(rawJson);
      if (repaired !== null) {
        return {
          id: partial.id,
          name: partial.name,
          parameters: repaired,
        };
      }
      return null;
    }
  }

  /**
   * Attempt basic JSON repair for common streaming artefacts:
   * - Trailing comma removal
   * - Missing closing braces
   * - Truncated strings
   */
  private attemptJsonRepair(raw: string): Record<string, unknown> | null {
    let candidate = raw.trim();

    // Remove trailing commas before closing braces/brackets
    candidate = candidate.replace(/,\s*([}\]])/g, '$1');

    // Count braces and add missing closing braces
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let prevChar = '';

    for (const ch of candidate) {
      if (ch === '"' && prevChar !== '\\') {
        inString = !inString;
      }
      if (!inString) {
        if (ch === '{') openBraces++;
        else if (ch === '}') openBraces--;
        else if (ch === '[') openBrackets++;
        else if (ch === ']') openBrackets--;
      }
      prevChar = ch;
    }

    // If we ended inside a string, try to close it
    if (inString) {
      candidate += '"';
    }

    // Add missing closing brackets/braces
    while (openBrackets > 0) {
      candidate += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      candidate += '}';
      openBraces--;
    }

    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Tool call validation
  // -----------------------------------------------------------------------

  /**
   * Validate extracted tool calls against known tool definitions.
   * Invalid calls are dropped with warnings.
   */
  private validateToolCalls(
    calls: ToolCall[],
    knownTools: ToolDefinition[] | undefined,
    warnings: string[],
  ): ToolCall[] {
    if (!knownTools || knownTools.length === 0) return calls;

    const toolMap = new Map(knownTools.map((t) => [t.name, t]));
    const validated: ToolCall[] = [];

    for (const call of calls) {
      const def = toolMap.get(call.name);

      if (!def) {
        warnings.push(
          `Unknown tool "${call.name}" (id: ${call.id}). Skipping.`,
        );
        continue;
      }

      // Validate required parameters from the input schema
      const validationErrors = this.validateParameters(
        call.parameters,
        def.inputSchema,
      );

      if (validationErrors.length > 0) {
        warnings.push(
          `Tool call "${call.name}" (id: ${call.id}) has parameter issues: ` +
            validationErrors.join('; ') +
            '. Including anyway — the tool may handle defaults.',
        );
      }

      validated.push(call);
    }

    return validated;
  }

  /**
   * Basic parameter validation against a JSON Schema.
   * Only checks required fields and top-level types for pragmatism.
   */
  private validateParameters(
    params: Record<string, unknown>,
    schema: Record<string, unknown>,
  ): string[] {
    const errors: string[] = [];

    // Check required fields
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const field of required) {
        if (typeof field === 'string' && !(field in params)) {
          errors.push(`Missing required parameter "${field}"`);
        }
      }
    }

    // Check top-level property types
    const properties = schema['properties'];
    if (properties && typeof properties === 'object') {
      for (const [key, value] of Object.entries(params)) {
        const propSchema = (properties as Record<string, Record<string, unknown>>)[key];
        if (propSchema && typeof propSchema === 'object') {
          const expectedType = propSchema['type'];
          if (typeof expectedType === 'string') {
            const actualType = this.jsonSchemaTypeOf(value);
            if (actualType !== expectedType && expectedType !== 'any') {
              errors.push(
                `Parameter "${key}" expected type "${expectedType}" but got "${actualType}"`,
              );
            }
          }
        }
      }
    }

    return errors;
  }

  /** Map a JS value to its JSON Schema type string. */
  private jsonSchemaTypeOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value; // 'string' | 'number' | 'boolean' | 'object' | etc.
  }

  // -----------------------------------------------------------------------
  // Finish reason mapping
  // -----------------------------------------------------------------------

  private mapFinishReason(reason: 'stop' | 'tool_use' | 'max_tokens' | 'error'): StopReason {
    switch (reason) {
      case 'stop': return 'end_turn';
      case 'tool_use': return 'tool_use';
      case 'max_tokens': return 'max_tokens';
      case 'error': return 'error';
    }
  }

  // -----------------------------------------------------------------------
  // Usage merging
  // -----------------------------------------------------------------------

  /** Merge partial usage updates into a running total. */
  private mergeUsage(
    existing: TokenUsage | undefined,
    partial: Partial<TokenUsage>,
  ): TokenUsage {
    return {
      promptTokens: partial.promptTokens ?? existing?.promptTokens ?? 0,
      completionTokens: partial.completionTokens ?? existing?.completionTokens ?? 0,
      totalTokens: partial.totalTokens ?? existing?.totalTokens ?? 0,
      cachedTokens: partial.cachedTokens ?? existing?.cachedTokens,
    };
  }
}

// ---------------------------------------------------------------------------
// Incremental stream parse events
// ---------------------------------------------------------------------------

export type StreamParseEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | { type: 'tool_call_ready'; toolCall: ToolCall }
  | { type: 'usage'; usage: Partial<TokenUsage> }
  | { type: 'stop'; stopReason: StopReason }
  | { type: 'warning'; message: string };
