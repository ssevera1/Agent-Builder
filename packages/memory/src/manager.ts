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
      this.longTerm = new LongTermMemory({
        dbPath: this.dbPath,
        embedder: this.embedder,
      });
      await this.longTerm.initialize();
    }

    if (this.config.episodicEnabled) {
      if (!this.embedder) {
        throw new Error(
          'An EmbeddingProvider is required when episodicEnabled is true.',
        );
      }
      this.episodic = new EpisodicMemory({
        dbPath: this.dbPath,
        embedder: this.embedder,
      });
      await this.episodic.initialize();
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
    return this.longTerm!.search(query, topK ?? this.config.longTermTopK, agentId);
  }

  async storeLongTerm(entry: MemoryEntry): Promise<void> {
    this.ensureLongTerm();
    await this.longTerm!.store(entry);
  }

  async deleteLongTerm(id: string): Promise<void> {
    this.ensureLongTerm();
    await this.longTerm!.delete(id);
  }

  // ── Episodic ────────────────────────────────────────────────────────────

  async recordEpisode(episode: Episode): Promise<void> {
    this.ensureEpisodic();
    await this.episodic!.record(episode);
  }

  async recallEpisodes(
    query: string,
    topK?: number,
    agentId?: string,
  ): Promise<Episode[]> {
    this.ensureEpisodic();
    return this.episodic!.recall(
      query,
      topK ?? this.config.episodicTopK,
      agentId ? { agentId } : undefined,
    );
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
