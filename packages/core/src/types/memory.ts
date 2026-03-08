/**
 * Memory subsystem type definitions.
 */

import type { Message } from './llm.js';

/**
 * A single entry stored in the agent's long-term memory.
 */
export interface MemoryEntry {
  /** Unique identifier for this memory entry. */
  id: string;
  /** The textual content of the memory. */
  content: string;
  /** Vector embedding of the content (for similarity search). */
  embedding?: number[];
  /** The agent that owns this memory. */
  agentId: string;
  /** Metadata for filtering and categorization. */
  metadata: MemoryMetadata;
  /** When this entry was created. */
  timestamp: Date;
  /** When this entry was last accessed (for LRU eviction). */
  lastAccessedAt?: Date;
  /** Number of times this entry has been retrieved. */
  accessCount: number;
}

/**
 * Metadata attached to a memory entry for filtering and context.
 */
export interface MemoryMetadata {
  /** Source of the memory (e.g., 'conversation', 'document', 'tool_output'). */
  source: string;
  /** Session ID where this memory was created. */
  sessionId?: string;
  /** Relevance tags for categorical filtering. */
  tags: string[];
  /** Importance score (0.0 - 1.0) for prioritization. */
  importance: number;
  /** Arbitrary key-value pairs. */
  extra?: Record<string, unknown>;
}

/**
 * An episode represents a complete interaction sequence worth remembering.
 */
export interface Episode {
  /** Unique identifier for this episode. */
  id: string;
  /** The agent that participated in this episode. */
  agentId: string;
  /** Session in which this episode occurred. */
  sessionId: string;
  /** A concise summary of what happened. */
  summary: string;
  /** The full message history of the episode. */
  messages: Message[];
  /** The outcome or result of the episode. */
  outcome: EpisodeOutcome;
  /** Tool names that were used during the episode. */
  toolsUsed: string[];
  /** When this episode started. */
  startedAt: Date;
  /** When this episode ended. */
  endedAt: Date;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Total tokens consumed during the episode. */
  totalTokens: number;
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Outcome classification for an episode.
 */
export type EpisodeOutcome = 'success' | 'failure' | 'partial' | 'abandoned' | 'error';

/**
 * A memory search result with its similarity score.
 */
export interface MemorySearchResult {
  /** The matching memory entry. */
  entry: MemoryEntry;
  /** Similarity score (0.0 - 1.0, higher is more similar). */
  score: number;
}

/**
 * Options for querying the memory store.
 */
export interface MemorySearchOptions {
  /** Maximum number of results to return. */
  topK: number;
  /** Minimum similarity score threshold. */
  minScore?: number;
  /** Filter by agent ID. */
  agentId?: string;
  /** Filter by metadata source. */
  source?: string;
  /** Filter by metadata tags (any match). */
  tags?: string[];
  /** Filter entries created after this date. */
  after?: Date;
  /** Filter entries created before this date. */
  before?: Date;
}
