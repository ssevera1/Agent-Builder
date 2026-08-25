import { describe, expect, it } from 'vitest';
import type { LLMRequest, LLMStreamChunk } from '@agentbuilder/core';
import { ProviderError } from '../base-client.js';
import { AnthropicClient } from './anthropic.js';

/**
 * Exposes the protected raw stream loop and lets a test feed it synthetic
 * Anthropic SDK events instead of hitting the network.
 */
class TestAnthropicClient extends AnthropicClient {
  constructor(events: unknown[]) {
    super('claude-sonnet-5', { apiKey: 'test-key' });
    (this as unknown as { client: unknown }).client = {
      messages: {
        stream: () => ({
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
          },
        }),
      },
    };
  }

  run(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    return this._rawComplete(request);
  }
}

const REQUEST: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
};

async function collect(events: unknown[]): Promise<LLMStreamChunk[]> {
  const chunks: LLMStreamChunk[] = [];
  for await (const chunk of new TestAnthropicClient(events).run(REQUEST)) {
    chunks.push(chunk);
  }
  return chunks;
}

const messageStart = (overrides: Record<string, unknown> = {}) => ({
  type: 'message_start',
  message: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 1 },
    ...overrides,
  },
});

const messageDelta = (stopReason: string | null) => ({
  type: 'message_delta',
  delta: { stop_reason: stopReason, stop_sequence: null },
  usage: { output_tokens: 7 },
});

describe('AnthropicClient stream loop', () => {
  it('treats a null stop_reason as a normal end of stream', async () => {
    const chunks = await collect([messageStart(), messageDelta(null)]);

    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    // The usage chunk from message_delta must survive a null stop_reason.
    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 0, outputTokens: 7, totalTokens: 7 },
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('maps a concrete stop_reason through mapStopReason', async () => {
    const chunks = await collect([messageStart(), messageDelta('max_tokens')]);

    expect(chunks.at(-1)).toEqual({ type: 'done', finishReason: 'max_tokens' });
  });

  it('accepts a message_start whose content array is empty', async () => {
    const chunks = await collect([messageStart({ content: [] })]);

    expect(chunks).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
      },
    ]);
  });

  it('rejects a message_start with no content field at all', async () => {
    await expect(collect([messageStart({ content: undefined })])).rejects.toThrow(
      /Malformed message_start/,
    );
  });

  it('rejects a message_start with no id', async () => {
    await expect(collect([messageStart({ id: '' })])).rejects.toThrow(
      /Malformed message_start/,
    );
  });

  it('rejects a tool_use block missing id or name', async () => {
    await expect(
      collect([
        messageStart(),
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: '', name: 'search', input: {} },
        },
      ]),
    ).rejects.toThrow(/Malformed tool_use block/);
  });

  it('emits assembled tool calls for well-formed blocks', async () => {
    const chunks = await collect([
      messageStart(),
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'search', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' },
      },
      { type: 'content_block_stop', index: 0 },
      messageDelta('tool_use'),
    ]);

    expect(chunks).toContainEqual({
      type: 'tool_call',
      toolCall: { id: 'tu_1', name: 'search', arguments: '{"q":"x"}' },
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', finishReason: 'tool_use' });
  });
});

describe('ProviderError', () => {
  it("accepts 'invalid_response' as a provider error code", () => {
    const err = new ProviderError('bad', 'invalid_response', 500, false);

    expect(err.code).toBe('invalid_response');
    expect(err.retryable).toBe(false);
  });
});
