/**
 * ContextAssembler — gathers and prioritises all context for an agent turn.
 *
 * Responsibilities:
 * - Implements a sliding window over conversation history
 * - Retrieves relevant long-term memory via vector search
 * - Retrieves relevant episodes
 * - Prioritises: system prompt > recent messages > relevant memory > older messages
 * - Estimates token count and truncates to fit the budget
 * - Returns an assembled AgentContext ready for prompt building
 */

import type { AgentConfig } from '@agentbuilder/core';
import type {
  AgentContext,
  ContentBlock,
  MemoryEntry,
  MemoryManager,
  MemorySearchResult,
  Message,
  Session,
  TextBlock,
} from './patterns/pattern.interface.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rough average characters per token for estimation. */
const CHARS_PER_TOKEN = 4;

/** Minimum tokens to reserve for the LLM's response. */
const RESPONSE_RESERVE_TOKENS = 1024;

/** Overhead per message for role markers and separators. */
const MESSAGE_OVERHEAD_TOKENS = 4;

// ---------------------------------------------------------------------------
// ContextAssembler
// ---------------------------------------------------------------------------

export class ContextAssembler {
  /**
   * Assemble the full agent context for a new turn.
   *
   * @param session - The current conversation session.
   * @param newMessage - The incoming user message (not yet in session.messages).
   * @param memoryManager - The memory subsystem for retrieval.
   * @param config - The agent configuration.
   * @param tokenBudget - Total token budget for the context window.
   * @returns An assembled AgentContext.
   */
  async assemble(
    session: Session,
    newMessage: Message,
    memoryManager: MemoryManager,
    config: AgentConfig,
    tokenBudget: number,
  ): Promise<AgentContext> {
    // 1. Build the full conversation history including the new message
    const fullHistory = [...session.messages, newMessage];

    // 2. Retrieve relevant memory (if enabled)
    const relevantMemory = await this.retrieveMemory(
      newMessage,
      fullHistory,
      memoryManager,
      config,
    );

    // 3. Calculate available budget for messages
    //    (total budget minus reserved response tokens)
    const availableBudget = Math.max(0, tokenBudget - RESPONSE_RESERVE_TOKENS);

    // 4. Apply sliding window to conversation history
    const windowedHistory = this.applySlidingWindow(
      fullHistory,
      config.memoryConfig.shortTermMaxMessages,
      availableBudget,
    );

    return {
      config,
      session,
      conversationHistory: windowedHistory,
      relevantMemory,
      tokenBudget: availableBudget,
    };
  }

  // -----------------------------------------------------------------------
  // Memory retrieval
  // -----------------------------------------------------------------------

  /**
   * Retrieve relevant memory entries based on the current conversation.
   */
  private async retrieveMemory(
    newMessage: Message,
    history: Message[],
    memoryManager: MemoryManager,
    config: AgentConfig,
  ): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];

    // Long-term memory search
    if (config.memoryConfig.longTermEnabled) {
      const query = this.buildSearchQuery(newMessage, history);
      try {
        const results = await memoryManager.search(query, {
          topK: config.memoryConfig.longTermTopK,
          agentId: config.id,
          minScore: 0.5,
        });
        entries.push(...results.map((r: MemorySearchResult) => r.entry));
      } catch {
        // Memory retrieval is best-effort — do not fail the whole turn
      }
    }

    // Episodic memory
    if (config.memoryConfig.episodicEnabled) {
      try {
        const episodes = await memoryManager.getRecentEpisodes(
          config.id,
          config.memoryConfig.episodicTopK,
        );
        // Convert episodes to memory entries for uniform handling
        for (const episode of episodes) {
          entries.push({
            id: `episode:${episode.id}`,
            content: `[Past interaction] ${episode.summary}`,
            agentId: episode.agentId,
            metadata: {
              source: 'episode',
              sessionId: episode.sessionId,
              tags: episode.toolsUsed,
              importance: episode.outcome === 'success' ? 0.8 : 0.5,
            },
            timestamp: episode.endedAt,
            accessCount: 0,
          });
        }
      } catch {
        // Episodic retrieval is best-effort
      }
    }

    // Sort by relevance (importance) descending
    entries.sort((a, b) => b.metadata.importance - a.metadata.importance);

    return entries;
  }

  /**
   * Build a search query from the current message and recent context.
   * Uses the new message and the last few messages for context.
   */
  private buildSearchQuery(newMessage: Message, history: Message[]): string {
    const parts: string[] = [];

    // The primary query is the new user message
    parts.push(this.extractText(newMessage));

    // Add context from the last 2 messages for better retrieval
    const recentMessages = history.slice(-3, -1); // Exclude the new message itself
    for (const msg of recentMessages) {
      const text = this.extractText(msg);
      if (text.length > 0 && text.length < 500) {
        parts.push(text);
      }
    }

    return parts.join(' ');
  }

  // -----------------------------------------------------------------------
  // Sliding window
  // -----------------------------------------------------------------------

  /**
   * Apply a sliding window to conversation history.
   *
   * Strategy:
   * 1. Always keep the most recent messages (up to maxMessages or budget).
   * 2. If there are tool-use / tool-result pairs, keep them together.
   * 3. Truncate from the oldest end.
   */
  private applySlidingWindow(
    history: Message[],
    maxMessages: number,
    tokenBudget: number,
  ): Message[] {
    if (history.length === 0) return [];

    // Start from the most recent messages
    const candidates = history.slice(-maxMessages);

    // Now trim to fit token budget
    const result: Message[] = [];
    let usedTokens = 0;

    // Work backwards from the most recent
    for (let i = candidates.length - 1; i >= 0; i--) {
      const msg = candidates[i]!;
      const msgTokens = this.estimateMessageTokens(msg);

      if (usedTokens + msgTokens > tokenBudget) {
        break;
      }

      result.unshift(msg);
      usedTokens += msgTokens;
    }

    // Ensure tool results stay paired with their tool calls.
    // If the first message is a tool result without its preceding tool call,
    // drop it to avoid confusing the LLM.
    while (result.length > 0 && result[0]!.role === 'tool') {
      result.shift();
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Token estimation
  // -----------------------------------------------------------------------

  /** Estimate the token count for a single message. */
  private estimateMessageTokens(message: Message): number {
    const text = this.extractText(message);
    return Math.ceil(text.length / CHARS_PER_TOKEN) + MESSAGE_OVERHEAD_TOKENS;
  }

  // -----------------------------------------------------------------------
  // Text extraction
  // -----------------------------------------------------------------------

  /** Extract plain text from a message for search queries and estimation. */
  private extractText(message: Message): string {
    if (typeof message.content === 'string') return message.content;
    return (message.content as ContentBlock[])
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
}
