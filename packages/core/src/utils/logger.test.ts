import { describe, expect, it } from 'vitest';
import { createChildLogger, createSilentLogger } from './logger.js';

describe('createChildLogger', () => {
  it('does not throw on circular references in context values', () => {
    const parent = createSilentLogger();
    const circular: Record<string, unknown> = { name: 'req' };
    circular['self'] = circular;

    expect(() => createChildLogger(parent, { req: circular })).not.toThrow();
  });

  it('does not throw on nested bigint values', () => {
    const parent = createSilentLogger();

    expect(() => createChildLogger(parent, { stats: { count: 1n } })).not.toThrow();
  });

  it('throws a descriptive error for an oversized string value', () => {
    const parent = createSilentLogger();
    const huge = 'x'.repeat(1_048_576 + 1);

    expect(() => createChildLogger(parent, { payload: huge })).toThrow(/Context value too large/);
  });

  it('throws a descriptive error for an oversized object value', () => {
    const parent = createSilentLogger();
    const huge = { payload: 'x'.repeat(1_048_576 + 1) };

    expect(() => createChildLogger(parent, { data: huge })).toThrow(/Context value too large/);
  });

  it('still rejects invalid keys', () => {
    const parent = createSilentLogger();

    expect(() => createChildLogger(parent, { '': 'value' })).toThrow(/Invalid context key/);
  });
});
