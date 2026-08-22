/**
 * MemoryManager — the main facade for the @agentbuilder/memory subsystem.
 *
 * Combines short-term (in-session), long-term (vector), and episodic
 * memory behind a single, ergonomic API.
 */

import type {
  MemoryConfig,
  Message,
  MemoryEntry,
  MemorySearchResult,
  Episode,
} from '@agentbuilder/core';
import { ShortTermMemory } from './short-term.js';
import { LongTermMemory } from './long-term.js';
import { EpisodicMemory } from './episodic.js';
import type { EmbeddingProvider } from './embedding/embedding.interface.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface MemoryManagerOptions {
  /**
   * Path to the SQLite database file used by long-term and episodic stores.
   * Defaults to ":memory:" (in-process, no persistence).
   */
  dbPath?: string;
  /**
   * Embedding provider to use for long-term and episodic memory.
   * Required if `longTermEnabled` or `episodicEnabled` is true.
   */
  embedder?: EmbeddingProvider;
}

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------

export class MemoryManager {
  private readonly config: MemoryConfig;
  private readonly shortTerm: ShortTermMemory;
  private longTerm: LongTermMemory | null = null;
  private episodic: EpisodicMemory | null = null;
  private readonly dbPath: string;
  private readonly embedder: EmbeddingProvider | undefined;
  private initialised = false;

  constructor(config: MemoryConfig, options?: MemoryManagerOptions) {
    this.config = config;
    this.dbPath = options?.dbPath ?? ':memory:';
    this.embedder = options?.embedder;

    this.shortTerm = new ShortTermMemory({
      maxMessages: config.shortTermMaxMessages,
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialised) return;

    if (this.config.longTermEnabled) {
      if (!this.embedder) {
        throw new Error(
          'An EmbeddingProvider is required when longTermEnabled is true.',
        );
      }
      try {
        this.longTerm = new LongTermMemory({
          dbPath: this.dbPath,
          embedder: this.embedder,
        });
        await this.longTerm.initialize();
      } catch (error) {
        throw new Error(
          `Failed to initialize long-term memory: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (this.config.episodicEnabled) {
      if (!this.embedder) {
        throw new Error(
          'An EmbeddingProvider is required when episodicEnabled is true.',
        );
      }
      try {
        this.episodic = new EpisodicMemory({
          dbPath: this.dbPath,
          embedder: this.embedder,
        });
        await this.episodic.initialize();
      } catch (error) {
        throw new Error(
          `Failed to initialize episodic memory: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.initialised = true;
  }

  async close(): Promise<void> {
    await this.longTerm?.close();
    await this.episodic?.close();
    this.shortTerm.clearAll();
    this.initialised = false;
  }

  // ── Short-term (in-session) ─────────────────────────────────────────────

  getShortTerm(sessionId: string): Message[] {
    return this.shortTerm.getMessages(sessionId);
  }

  addShortTerm(sessionId: string, message: Message): void {
    this.shortTerm.addMessage(sessionId, message);
  }

  clearShortTerm(sessionId: string): void {
    this.shortTerm.clear(sessionId);
  }

  // ── Long-term (vector store) ────────────────────────────────────────────

  async searchLongTerm(
    query: string,
    topK?: number,
    agentId?: string,
  ): Promise<MemorySearchResult[]> {
    this.ensureLongTerm();
    try {
      return await this.longTerm!.search(query, topK ?? this.config.longTermTopK, agentId);
    } catch (error) {
      throw new Error(
        `Long-term memory search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async storeLongTerm(entry: MemoryEntry): Promise<void> {
    this.ensureLongTerm();
    if (!entry.embedding) {
      throw new Error(
        'MemoryEntry embedding is missing. Entry must have a vector representation.',
      );
    }
    try {
      await this.longTerm!.store(entry);
    } catch (error) {
      throw new Error(
        `Failed to store long-term memory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async deleteLongTerm(id: string): Promise<void> {
    this.ensureLongTerm();
    try {
      await this.longTerm!.delete(id);
    } catch (error) {
      throw new Error(
        `Failed to delete long-term memory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Episodic ────────────────────────────────────────────────────────────

  async recordEpisode(episode: Episode): Promise<void> {
    this.ensureEpisodic();
    if (!episode.embedding) {
      throw new Error(
        'Episode embedding is missing. Episode must have a vector representation.',
      );
    }
    try {
      await this.episodic!.record(episode);
    } catch (error) {
      throw new Error(
        `Failed to record episode: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async recallEpisodes(
    query: string,
    topK?: number,
    agentId?: string,
  ): Promise<Episode[]> {
    this.ensureEpisodic();
    try {
      return await this.episodic!.recall(
        query,
        topK ?? this.config.episodicTopK,
        agentId ? { agentId } : undefined,
      );
    } catch (error) {
      throw new Error(
        `Episodic memory recall failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private ensureLongTerm(): void {
    if (!this.longTerm) {
      throw new Error(
        'Long-term memory is not enabled. Set longTermEnabled: true in MemoryConfig and call initialize().',
      );
    }
  }

  private ensureEpisodic(): void {
    if (!this.episodic) {
      throw new Error(
        'Episodic memory is not enabled. Set episodicEnabled: true in MemoryConfig and call initialize().',
      );
    }
  }
}
