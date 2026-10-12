import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMRequest, LLMStreamChunk } from '@agentbuilder/core';
import { ProviderError } from '../base-client.js';
import { LocalLLMClient } from './local.js';

/**
 * Exposes the protected raw stream loop so tests can drive it directly
 * instead of going through the public retry-wrapped `complete()`.
 */
class TestLocalClient extends LocalLLMClient {
  run(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    return this._rawComplete(request);
  }
}

const REQUEST: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
};

function unreachable(): Promise<Response> {
  return Promise.reject(new Error('fetch failed'));
}

function ok(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: async () => body } as Response);
}

async function collect(client: TestLocalClient): Promise<LLMStreamChunk[]> {
  const chunks: LLMStreamChunk[] = [];
  for await (const chunk of client.run(REQUEST)) chunks.push(chunk);
  return chunks;
}

describe('LocalLLMClient service detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-probes after a failed detection instead of pinning to unknown forever', async () => {
    const client = new TestLocalClient('llama3', { baseUrl: 'http://localhost:11434' });

    vi.stubGlobal('fetch', vi.fn(unreachable));
    await expect(client.detectService()).resolves.toBe('unknown');

    // The service comes up after the first probe; a cached 'unknown' must
    // not prevent a later call from detecting it.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.endsWith('/api/tags')) return ok({ models: [] });
        return unreachable();
      }),
    );
    await expect(client.detectService()).resolves.toBe('ollama');
  });

  it('fails fast with a non-retryable error when no local service is reachable', async () => {
    const client = new TestLocalClient('llama3', { baseUrl: 'http://localhost:11434' });
    vi.stubGlobal('fetch', vi.fn(unreachable));

    await expect(collect(client)).rejects.toMatchObject({
      code: 'network',
      retryable: false,
      message: expect.stringContaining('not reachable'),
    });
  });

  it('includes the server response body when a chat request 404s', async () => {
    const client = new TestLocalClient('missing-model', { baseUrl: 'http://localhost:11434' });

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('/api/tags')) return ok({ models: [] });
        if (init?.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ error: 'model "missing-model" not found' }),
          } as Response);
        }
        return unreachable();
      }),
    );

    let thrown: unknown;
    try {
      for await (const _ of client.run(REQUEST)) {
        // draining the generator surfaces the thrown ProviderError
      }
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ProviderError);
    expect((thrown as ProviderError).message).toContain('model "missing-model" not found');
  });
});
