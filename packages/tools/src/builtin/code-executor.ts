/**
 * Code Executor tool — run JavaScript (via Node.js vm) or Python (via
 * subprocess) with timeout enforcement and restricted execution context.
 */

import { z } from 'zod';
import * as vm from 'node:vm';
import { spawn } from 'node:child_process';
import type { ToolCategory } from '@agentbuilder/core';
import type { RegisteredTool } from '../registry.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const codeExecutorInputSchema = z.object({
  language: z
    .enum(['javascript', 'python'])
    .describe('Programming language to execute'),
  code: z.string().min(1).describe('Source code to execute'),
  timeout: z
    .number()
    .int()
    .min(100)
    .max(60_000)
    .optional()
    .default(10_000)
    .describe('Execution timeout in milliseconds (default: 10 000)'),
});

export type CodeExecutorInput = z.infer<typeof codeExecutorInputSchema>;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CodeExecutorToolOptions {
  /** Maximum timeout in milliseconds (caps the per-call timeout). Default: 30 000. */
  maxTimeout?: number;
  /** Path to the Python 3 binary (default: "python3"). */
  pythonBinary?: string;
}

// ---------------------------------------------------------------------------
// JavaScript execution via node:vm
// ---------------------------------------------------------------------------

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function executeJavaScript(code: string, timeoutMs: number): ExecutionResult {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  // Provide a minimal, safe sandbox. No access to require, process, fs, etc.
  const sandbox = {
    console: {
      log: (...args: unknown[]) => {
        stdoutChunks.push(args.map(String).join(' '));
      },
      error: (...args: unknown[]) => {
        stderrChunks.push(args.map(String).join(' '));
      },
      warn: (...args: unknown[]) => {
        stderrChunks.push(args.map(String).join(' '));
      },
      info: (...args: unknown[]) => {
        stdoutChunks.push(args.map(String).join(' '));
      },
    },
    Math,
    Date,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    Promise,
    Symbol,
    BigInt,
    undefined,
    NaN,
    Infinity,
  };

  const context = vm.createContext(sandbox);

  try {
    const result = vm.runInContext(code, context, {
      timeout: timeoutMs,
      filename: 'user-code.js',
    });

    // If the code returned a value, append it to stdout.
    if (result !== undefined) {
      stdoutChunks.push(typeof result === 'string' ? result : JSON.stringify(result));
    }

    return {
      stdout: stdoutChunks.join('\n'),
      stderr: stderrChunks.join('\n'),
      exitCode: 0,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    stderrChunks.push(message);
    return {
      stdout: stdoutChunks.join('\n'),
      stderr: stderrChunks.join('\n'),
      exitCode: 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Python execution via subprocess
// ---------------------------------------------------------------------------

function executePython(
  code: string,
  timeoutMs: number,
  pythonBinary: string,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const proc = spawn(pythonBinary, ['-c', code], {
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        // Minimal environment — no access to host secrets.
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
        LANG: 'en_US.UTF-8',
      },
    });

    // Handle abort signal
    const onAbort = () => {
      proc.kill('SIGKILL');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function createCodeExecutorTool(options?: CodeExecutorToolOptions): RegisteredTool {
  const maxTimeout = options?.maxTimeout ?? 30_000;
  const pythonBinary = options?.pythonBinary ?? 'python3';

  return {
    name: 'code_executor',
    description:
      'Execute JavaScript or Python code in a sandboxed environment. ' +
      'JavaScript runs in an isolated VM context with restricted globals. ' +
      'Python runs as a subprocess with a minimal environment. ' +
      'Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['javascript', 'python'],
          description: 'Programming language to execute',
        },
        code: { type: 'string', description: 'Source code to execute' },
        timeout: {
          type: 'number',
          description: 'Execution timeout in milliseconds (default: 10 000)',
        },
      },
      required: ['language', 'code'],
    },
    category: 'code' as ToolCategory,
    timeoutMs: 60_000,
    requiresApproval: true,
    hasSideEffects: true,
    zodSchema: codeExecutorInputSchema,
    handler: async (input: unknown, signal?: AbortSignal) => {
      const { language, code, timeout } = input as CodeExecutorInput;
      const effectiveTimeout = Math.min(timeout, maxTimeout);

      let result: ExecutionResult;

      if (language === 'javascript') {
        result = executeJavaScript(code, effectiveTimeout);
      } else {
        result = await executePython(code, effectiveTimeout, pythonBinary, signal);
      }

      return JSON.stringify({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    },
  };
}
