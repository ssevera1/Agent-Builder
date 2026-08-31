import { describe, expect, it } from 'vitest';
import type { LLMRequest, LLMStreamChunk } from '@agentbuilder/core';
import { OpenAIClient } from './openai.js';

/**
 * Exposes the protected raw stream loop and lets a test feed it synthetic
 * OpenAI SDK chunks instead of hitting the network.
 */
class TestOpenAIClient extends OpenAIClient {
  constructor(chunks: unknown[]) {
    super('gpt-4o', { apiKey: 'test-key' });
    (this as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: () => ({
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks) yield chunk;
            },
          }),
        },
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

async function collect(chunks: unknown[]): Promise<LLMStreamChunk[]> {
  const result: LLMStreamChunk[] = [];
  for await (const chunk of new TestOpenAIClient(chunks).run(REQUEST)) {
    result.push(chunk);
  }
  return result;
}

describe('OpenAIClient stream loop', () => {
  it('emits a usage event from a final usage-only chunk with no choices field', async () => {
    const chunks = await collect([
      {
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
      },
      {
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      },
    ]);

    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    });
  });

  it('emits a usage event even when choices is null instead of an array', async () => {
    const chunks = await collect([
      {
        choices: null,
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      },
    ]);

    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
    });
  });

  it('skips a chunk that is not an object without throwing', async () => {
    const chunks = await collect([null, undefined]);

    expect(chunks).toEqual([]);
  });
});
