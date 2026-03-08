/**
 * Session management type definitions.
 * A session represents a continuous interaction between a user and an agent.
 */

import type { Message, TokenUsage } from './llm.js';

// ---------------------------------------------------------------------------
// Session State
// ---------------------------------------------------------------------------

/** Overall state of a session. */
export type SessionState = 'active' | 'paused' | 'completed' | 'expired' | 'error';

// ---------------------------------------------------------------------------
// Session Metadata
// ---------------------------------------------------------------------------

/** Metadata associated with a session. */
export interface SessionMetadata {
  /** User or client identifier. */
  userId?: string;
  /** Client application identifier. */
  clientId?: string;
  /** Tags for categorization and filtering. */
  tags: string[];
  /** Title or summary (may be auto-generated). */
  title?: string;
  /** Source channel (e.g., 'web', 'api', 'cli', 'slack'). */
  channel?: string;
  /** IP address or origin identifier. */
  origin?: string;
  /** Language / locale of the session (e.g., 'en-US'). */
  locale?: string;
  /** Arbitrary extra data. */
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** A complete session record. */
export interface Session {
  /** Unique session ID. */
  id: string;
  /** ID of the agent handling this session. */
  agentId: string;
  /** Current state of the session. */
  state: SessionState;
  /** Session metadata. */
  metadata: SessionMetadata;
  /** Ordered message history. */
  messages: Message[];
  /** Accumulated token usage across all turns. */
  totalTokenUsage: TokenUsage;
  /** Number of completed turns (user message + agent response). */
  turnCount: number;
  /** ID of the parent session, for branching / forking. */
  parentSessionId?: string;
  /** When the session was created. */
  createdAt: Date;
  /** When the session was last updated (any activity). */
  updatedAt: Date;
  /** When the session expires (for auto-cleanup). */
  expiresAt?: Date;
  /** Error information if state is 'error'. */
  error?: string;
}

/** Options for creating a new session. */
export interface CreateSessionOptions {
  /** Agent ID to associate with. */
  agentId: string;
  /** Optional pre-set session ID (defaults to auto-generated). */
  sessionId?: string;
  /** Initial metadata. */
  metadata?: Partial<SessionMetadata>;
  /** Session TTL in milliseconds. */
  ttlMs?: number;
  /** Initial system message to prepend. */
  systemPrompt?: string;
  /** Parent session ID for branching. */
  parentSessionId?: string;
}

/** Options for listing / querying sessions. */
export interface ListSessionsOptions {
  /** Filter by agent ID. */
  agentId?: string;
  /** Filter by state. */
  state?: SessionState;
  /** Filter by user ID in metadata. */
  userId?: string;
  /** Filter sessions created after this date. */
  after?: Date;
  /** Filter sessions created before this date. */
  before?: Date;
  /** Maximum number of results. */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
  /** Sort field. */
  sortBy?: 'createdAt' | 'updatedAt';
  /** Sort direction. */
  sortOrder?: 'asc' | 'desc';
}
