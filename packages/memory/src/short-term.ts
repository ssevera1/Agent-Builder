/**
 * ShortTermMemory — per-session in-memory message buffer with a sliding
 * window that truncates (or optionally summarises) the oldest messages
 * when the limit is exceeded.
 */

import type { Message } from '@agentbuilder/core';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ShortTermMemoryOptions {
  /** Maximum number of messages to retain per session (default: 50). */
  maxMessages?: number;
}

// ---------------------------------------------------------------------------
// ShortTermMemory
// ---------------------------------------------------------------------------

export class ShortTermMemory {
  private readonly sessions = new Map<string, Message[]>();
  private readonly maxMessages: number;

  constructor(options?: ShortTermMemoryOptions) {
    this.maxMessages = options?.maxMessages ?? 50;
  }

  // ── Retrieval ───────────────────────────────────────────────────────────

  /**
   * Get all messages for a session (newest last).
   * Returns a shallow copy so callers cannot mutate internal state.
   */
  getMessages(sessionId: string): Message[] {
    const messages = this.sessions.get(sessionId);
    return messages ? [...messages] : [];
  }

  /**
   * Get the most recent N messages for a session.
   */
  getRecent(sessionId: string, count: number): Message[] {
    const messages = this.sessions.get(sessionId) ?? [];
    return messages.slice(-count);
  }

  // ── Mutation ────────────────────────────────────────────────────────────

  /**
   * Add a message to a session's buffer. If the buffer exceeds
   * `maxMessages`, the oldest non-system messages are dropped.
   */
  addMessage(sessionId: string, message: Message): void {
    let messages = this.sessions.get(sessionId);
    if (!messages) {
      messages = [];
      this.sessions.set(sessionId, messages);
    }

    messages.push(message);

    // Trim if over limit, preserving system messages at the front.
    if (messages.length > this.maxMessages) {
      this.trimToLimit(messages);
    }
  }

  /**
   * Clear all messages for a session.
   */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Clear all sessions.
   */
  clearAll(): void {
    this.sessions.clear();
  }

  // ── Info ────────────────────────────────────────────────────────────────

  /**
   * Count messages in a session.
   */
  getMessageCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.length ?? 0;
  }

  /**
   * Rough token count estimate for a session's messages.
   * Uses the common heuristic of ~4 characters per token.
   */
  getTokenCount(sessionId: string): number {
    const messages = this.sessions.get(sessionId) ?? [];
    let totalChars = 0;

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            totalChars += block.text.length;
          } else if (block.type === 'tool_call') {
            totalChars += block.name.length + block.arguments.length;
          } else if (block.type === 'tool_result') {
            totalChars += block.content.length;
          }
        }
      }
    }

    return Math.ceil(totalChars / 4);
  }

  /**
   * Check whether a session exists in memory.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Return all active session IDs.
   */
  getSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  // ── Internal ────────────────────────────────────────────────────────────

  /**
   * Trim the message list to `maxMessages`, preferring to keep:
   * 1. System messages at the start.
   * 2. The most recent non-system messages.
   */
  private trimToLimit(messages: Message[]): void {
    // Separate leading system messages from the rest.
    let systemCount = 0;
    while (systemCount < messages.length && messages[systemCount]?.role === 'system') {
      systemCount++;
    }

    const systemMessages = messages.slice(0, systemCount);
    const nonSystem = messages.slice(systemCount);

    // Keep as many recent non-system messages as we can.
    const keep = this.maxMessages - systemMessages.length;
    const trimmed = keep > 0 ? nonSystem.slice(-keep) : [];

    // Replace contents in place (since we hold a reference to the array).
    messages.length = 0;
    messages.push(...systemMessages, ...trimmed);
  }
}
