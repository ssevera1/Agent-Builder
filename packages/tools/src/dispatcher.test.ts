import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolCategory } from '@agentbuilder/core';
import { ToolDispatcher } from './dispatcher.js';
import { ToolRegistry, type RegisteredTool } from './registry.js';
import { createFileSystemTool } from './builtin/file-system.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

function makeTool(overrides: Partial<RegisteredTool> = {}): RegisteredTool {
  return {
    name: 'echo',
    description: 'Echoes back whatever it is given.',
    inputSchema: { type: 'object', properties: {} },
    category: 'data' as ToolCategory,
    timeoutMs: 1_000,
    requiresApproval: false,
    hasSideEffects: false,
    zodSchema: z.object({ value: z.unknown().optional() }),
    handler: async (input) => JSON.stringify(input),
    ...overrides,
  };
}

describe('ToolDispatcher output size limits', () => {
  it('does not reject large output by default (no maxOutputChars configured)', async () => {
    const registry = new ToolRegistry();
    const bigString = 'x'.repeat(1_500_000);
    registry.register(
      makeTool({
        name: 'big_output',
        handler: async () => bigString,
      }),
    );
    const dispatcher = new ToolDispatcher(registry);

    const result = await dispatcher.dispatch({ id: '1', name: 'big_output', parameters: {} });

    expect(result.success).toBe(true);
    expect(result.output).toBe(bigString);
  });

  it('rejects output over an explicitly configured maxOutputChars', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'big_output',
        handler: async () => 'x'.repeat(100),
      }),
    );
    const dispatcher = new ToolDispatcher(registry, { maxOutputChars: 10 });

    const result = await dispatcher.dispatch({ id: '1', name: 'big_output', parameters: {} });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeds maximum/);
  });

  it('does not reject a file_system read of a file just under its own 1 MiB cap', async () => {
    // Regression test: the file_system tool's default maxReadSize (1 048 576
    // bytes) is larger than the dispatcher's old hard-coded 1 000 000 char
    // output cap, and wrapping the content in JSON adds further overhead —
    // so a file the file_system tool considered readable could previously
    // be rejected by the dispatcher's own output validation.
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-fs-tool-'));
    try {
      const content = 'y'.repeat(1_010_000); // over 1_000_000, under the 1 MiB cap
      await fs.writeFile(path.join(rootDir, 'big.txt'), content, 'utf-8');

      const registry = new ToolRegistry();
      registry.register(createFileSystemTool({ rootDir }));
      const dispatcher = new ToolDispatcher(registry);

      const result = await dispatcher.dispatch({
        id: '1',
        name: 'file_system',
        parameters: { operation: 'read', path: 'big.txt' },
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(result.output).content).toBe(content);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('ToolDispatcher output serialization errors', () => {
  it('includes the underlying JSON.stringify error message for circular output', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'circular',
        handler: async () => {
          const obj: Record<string, unknown> = {};
          obj['self'] = obj;
          return obj as unknown as string;
        },
      }),
    );
    const dispatcher = new ToolDispatcher(registry);

    const result = await dispatcher.dispatch({ id: '1', name: 'circular', parameters: {} });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not JSON serializable/);
    expect(result.error).toMatch(/circular/i);
  });
});

describe('ToolDispatcher input shape validation', () => {
  it('rejects array input with a single, non-duplicated error message', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    const dispatcher = new ToolDispatcher(registry);

    const result = await dispatcher.dispatch({
      id: '1',
      name: 'echo',
      parameters: [1, 2, 3] as unknown as Record<string, unknown>,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Tool "echo" input validation failed: input must be an object, null, or undefined',
    );
  });

  it('accepts null and undefined parameters', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ zodSchema: z.unknown() }));
    const dispatcher = new ToolDispatcher(registry);

    const result = await dispatcher.dispatch({
      id: '1',
      name: 'echo',
      parameters: null as unknown as Record<string, unknown>,
    });

    expect(result.success).toBe(true);
  });
});
