/**
 * Zod schemas for memory types.
 */

import { z } from 'zod';
import type { MemoryEntry, Episode } from '../types/memory.js';

// ---------------------------------------------------------------------------
// Memory Metadata
// ---------------------------------------------------------------------------

export const memoryMetadataSchema = z.object({
  source: z.string().min(1),
  sessionId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  importance: z.number().min(0).max(1).default(0.5),
  extra: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Memory Entry
// ---------------------------------------------------------------------------

export const memoryEntrySchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  embedding: z.array(z.number()).optional(),
  agentId: z.string().min(1),
  metadata: memoryMetadataSchema,
  timestamp: z.coerce.date().default(() => new Date()),
  lastAccessedAt: z.coerce.date().optional(),
  accessCount: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Episode
// ---------------------------------------------------------------------------

export const episodeOutcomeSchema = z.enum([
  'success',
  'failure',
  'partial',
  'abandoned',
  'error',
]);

/** Minimal message schema for episode storage. */
const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.any())]),
});

export const episodeSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  summary: z.string(),
  messages: z.array(messageSchema),
  outcome: episodeOutcomeSchema,
  toolsUsed: z.array(z.string()).default([]),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
  durationMs: z.number().min(0),
  totalTokens: z.number().int().min(0).default(0),
  metadata: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

export function parseMemoryEntry(data: unknown): MemoryEntry {
  return memoryEntrySchema.parse(data) as MemoryEntry;
}

export function parseEpisode(data: unknown): Episode {
  return episodeSchema.parse(data) as unknown as Episode;
}
