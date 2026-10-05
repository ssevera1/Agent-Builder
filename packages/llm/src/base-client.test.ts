import { describe, expect, it } from 'vitest';
import type { LLMRequest, LLMStreamChunk } from '@agentbuilder/core';
import { BaseClient, ProviderError } from './base-client.js';

class TestClient extends BaseClient {
  readonly providerId = 'test';
  readonly modelId = 'test-model';

  constructor(private readonly availability: () => Promise<ProviderError | undefined>) {
    super({ retry: { maxRetries: 0 } });
  }

  protected checkModelAvailability(): Promise<ProviderError | undefined> {
    return this.availability();
  }

  protected async *_rawComplete(): AsyncIterable<LLMStreamChunk> {
    yield { type: 'done' as const, finishReason: 'stop' as const };
  }

  protected async _rawCountTokens(): Promise<number> {
    return 0;
  }

  protected async _rawListModels() {
    return [];
  }

  getModelInfo() {
    return { id: this.modelId, provider: this.providerId } as never;
  }

  supportsToolUse() {
    return false;
  }

  supportsVision() {
    return false;
  }

  supportsStreaming() {
    return true;
  }
}

const REQUEST: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
};

async function collect(client: TestClient): Promise<LLMStreamChunk[]> {
  const chunks: LLMStreamChunk[] = [];
  for await (const chunk of client.complete(REQUEST)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('BaseClient.complete availability check', () => {
  it('passes through to _rawComplete when the hook reports availability', async () => {
    const chunks = await collect(new TestClient(async () => undefined));

    expect(chunks).toEqual([{ type: 'done', finishReason: 'stop' }]);
  });

  it('emits an error chunk when the hook returns a ProviderError', async () => {
    const client = new TestClient(async () => new ProviderError('bad key', 'auth', 401, false));

    const chunks = await collect(client);

    expect(chunks).toEqual([
      { type: 'error', error: { code: 'auth', message: 'bad key' } },
      { type: 'done', finishReason: 'error' },
    ]);
  });

  it('emits an error chunk instead of throwing when the hook rejects', async () => {
    const client = new TestClient(() => {
      throw new ProviderError('invalid key', 'auth', 401, false);
    });

    const chunks = await collect(client);

    expect(chunks).toEqual([
      { type: 'error', error: { code: 'auth', message: 'invalid key' } },
      { type: 'done', finishReason: 'error' },
    ]);
  });
});
