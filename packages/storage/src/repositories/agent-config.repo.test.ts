import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentConfig } from '@agentbuilder/core';
import { Database } from '../database.js';
import { AgentConfigRepository, DeserializationError } from './agent-config.repo.js';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'A test agent',
    version: '0.1.0',
    provider: { providerId: 'anthropic', modelId: 'claude-sonnet-5' },
    pattern: 'tool-augmented',
    systemPrompt: 'You are a helpful assistant.',
    tools: [],
    memoryConfig: {
      shortTermMaxMessages: 10,
      longTermEnabled: false,
      longTermTopK: 5,
      episodicEnabled: false,
      episodicTopK: 5,
    },
    guardrailRules: [],
    maxTurns: 10,
    temperature: 0.7,
    maxTokens: 1024,
    metadata: {},
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  } as AgentConfig;
}

describe('AgentConfigRepository', () => {
  let db: Database;
  let repo: AgentConfigRepository;

  beforeEach(() => {
    db = Database.inMemory();
    repo = new AgentConfigRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips a valid config', () => {
    repo.create(makeConfig());
    const result = repo.getById('agent-1');
    expect(result).not.toBeNull();
    expect(result?.createdAt).toBeInstanceOf(Date);
    expect(result?.updatedAt).toBeInstanceOf(Date);
  });

  it('throws DeserializationError (not a raw TypeError) when config_json is a JSON literal like "null"', () => {
    repo.create(makeConfig());
    db.raw.prepare('UPDATE agent_configs SET config_json = ? WHERE id = ?').run('null', 'agent-1');

    expect(() => repo.getById('agent-1')).toThrow(DeserializationError);
  });

  it('throws DeserializationError when config_json is a JSON array', () => {
    repo.create(makeConfig());
    db.raw.prepare('UPDATE agent_configs SET config_json = ? WHERE id = ?').run('[]', 'agent-1');

    expect(() => repo.getById('agent-1')).toThrow(DeserializationError);
  });

  it('throws DeserializationError when config_json has an invalid createdAt', () => {
    repo.create(makeConfig());
    db.raw
      .prepare('UPDATE agent_configs SET config_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...makeConfig(), createdAt: 'not-a-date' }), 'agent-1');

    expect(() => repo.getById('agent-1')).toThrow(DeserializationError);
  });

  it('throws DeserializationError on malformed JSON', () => {
    repo.create(makeConfig());
    db.raw.prepare('UPDATE agent_configs SET config_json = ? WHERE id = ?').run('{not json', 'agent-1');

    expect(() => repo.getById('agent-1')).toThrow(DeserializationError);
  });
});
