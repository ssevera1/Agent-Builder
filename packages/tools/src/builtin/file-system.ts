/**
 * File System tool — sandboxed file operations with path traversal protection.
 *
 * All operations are restricted to a configurable root directory. Attempting
 * to access paths outside the root (via `..`, symlinks, or absolute paths)
 * is blocked.
 */

import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolCategory } from '@agentbuilder/core';
import type { RegisteredTool } from '../registry.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const fileSystemInputSchema = z.object({
  operation: z
    .enum(['read', 'write', 'list', 'exists'])
    .describe('The file system operation to perform'),
  path: z.string().min(1).describe('Relative path within the sandbox root'),
  content: z
    .string()
    .optional()
    .describe('Content to write (required for "write" operation)'),
});

export type FileSystemInput = z.infer<typeof fileSystemInputSchema>;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FileSystemToolOptions {
  /** The root directory that all operations are sandboxed to. */
  rootDir: string;
  /** Maximum file size in bytes that can be read (default: 1 048 576 = 1 MiB). */
  maxReadSize?: number;
  /** Maximum file size in bytes that can be written (default: 1 048 576 = 1 MiB). */
  maxWriteSize?: number;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Resolve a user-supplied path against the sandbox root and verify that the
 * resolved path is still within the root. This prevents path traversal
 * attacks using `..`, absolute paths, or symlink tricks.
 */
async function resolveSafePath(rootDir: string, userPath: string): Promise<string> {
  // Normalise the root to an absolute path.
  const normalizedRoot = path.resolve(rootDir);

  // Reject obviously absolute paths that escape the root.
  if (path.isAbsolute(userPath)) {
    throw new Error('Absolute paths are not allowed. Provide a path relative to the sandbox root.');
  }

  // Join and normalise.
  const joined = path.resolve(normalizedRoot, userPath);

  // Ensure the final path starts with the root (with trailing separator to
  // avoid prefix collisions like /root vs /rootEvil).
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;

  if (joined !== normalizedRoot && !joined.startsWith(rootWithSep)) {
    throw new Error('Path traversal detected: the resolved path escapes the sandbox root.');
  }

  // If the target already exists check that it is not a symlink pointing
  // outside the root.
  try {
    const realPath = await fs.realpath(joined);
    if (realPath !== normalizedRoot && !realPath.startsWith(rootWithSep)) {
      throw new Error('Symlink target escapes the sandbox root.');
    }
  } catch (err: unknown) {
    // File does not exist yet — that is fine for write/exists.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    // For non-existing files, verify the *parent* directory.
    const parentDir = path.dirname(joined);
    try {
      const realParent = await fs.realpath(parentDir);
      const parentWithSep = normalizedRoot.endsWith(path.sep)
        ? normalizedRoot
        : normalizedRoot + path.sep;
      if (realParent !== normalizedRoot && !realParent.startsWith(parentWithSep)) {
        throw new Error('Parent directory symlink escapes the sandbox root.');
      }
    } catch {
      // Parent doesn't exist either; will error naturally later.
    }
  }

  return joined;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function createFileSystemTool(options: FileSystemToolOptions): RegisteredTool {
  const maxReadSize = options.maxReadSize ?? 1_048_576;
  const maxWriteSize = options.maxWriteSize ?? 1_048_576;

  return {
    name: 'file_system',
    description:
      'Perform sandboxed file system operations: read, write, list, or check existence of files within a restricted directory.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['read', 'write', 'list', 'exists'],
          description: 'The file system operation to perform',
        },
        path: { type: 'string', description: 'Relative path within the sandbox root' },
        content: { type: 'string', description: 'Content to write (required for write)' },
      },
      required: ['operation', 'path'],
    },
    category: 'filesystem' as ToolCategory,
    timeoutMs: 10_000,
    requiresApproval: false,
    hasSideEffects: true,
    zodSchema: fileSystemInputSchema,
    handler: async (input: unknown) => {
      const { operation, path: userPath, content } = input as FileSystemInput;
      const safePath = await resolveSafePath(options.rootDir, userPath);

      switch (operation) {
        case 'read': {
          const stat = await fs.stat(safePath);
          if (!stat.isFile()) {
            throw new Error(`"${userPath}" is not a file.`);
          }
          if (stat.size > maxReadSize) {
            throw new Error(
              `File size (${stat.size} bytes) exceeds the maximum read size (${maxReadSize} bytes).`,
            );
          }
          const data = await fs.readFile(safePath, 'utf-8');
          return JSON.stringify({ path: userPath, content: data, size: stat.size });
        }

        case 'write': {
          if (content === undefined) {
            throw new Error('"content" is required for the write operation.');
          }
          if (Buffer.byteLength(content, 'utf-8') > maxWriteSize) {
            throw new Error(
              `Content size exceeds the maximum write size (${maxWriteSize} bytes).`,
            );
          }
          // Ensure parent directory exists.
          await fs.mkdir(path.dirname(safePath), { recursive: true });
          await fs.writeFile(safePath, content, 'utf-8');
          return JSON.stringify({
            path: userPath,
            written: true,
            size: Buffer.byteLength(content, 'utf-8'),
          });
        }

        case 'list': {
          const stat = await fs.stat(safePath);
          if (!stat.isDirectory()) {
            throw new Error(`"${userPath}" is not a directory.`);
          }
          const entries = await fs.readdir(safePath, { withFileTypes: true });
          const items = entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
          }));
          return JSON.stringify({ path: userPath, entries: items });
        }

        case 'exists': {
          try {
            const stat = await fs.stat(safePath);
            return JSON.stringify({
              path: userPath,
              exists: true,
              type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
              size: stat.size,
            });
          } catch {
            return JSON.stringify({ path: userPath, exists: false });
          }
        }

        default:
          throw new Error(`Unknown operation: "${operation as string}"`);
      }
    },
  };
}
