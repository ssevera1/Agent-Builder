/**
 * @agentbuilder/memory — memory subsystem with short-term, long-term
 * (vector), and episodic storage.
 */

// ── Manager (main facade) ─────────────────────────────────────────────────
export { MemoryManager } from './manager.js';
export type { MemoryManagerOptions } from './manager.js';

// ── Short-term ────────────────────────────────────────────────────────────
export { ShortTermMemory } from './short-term.js';
export type { ShortTermMemoryOptions } from './short-term.js';

// ── Long-term ─────────────────────────────────────────────────────────────
export { LongTermMemory } from './long-term.js';
export type { LongTermMemoryOptions } from './long-term.js';

// ── Episodic ──────────────────────────────────────────────────────────────
export { EpisodicMemory } from './episodic.js';
export type { EpisodicMemoryOptions } from './episodic.js';

// ── Embedding providers ───────────────────────────────────────────────────
export type { EmbeddingProvider } from './embedding/embedding.interface.js';
export { LocalEmbedder } from './embedding/local-embedder.js';
export type { LocalEmbedderOptions } from './embedding/local-embedder.js';
export { APIEmbedder } from './embedding/api-embedder.js';
export type { APIEmbedderOptions } from './embedding/api-embedder.js';

// ── Vector stores ─────────────────────────────────────────────────────────
export type { VectorStore, VectorSearchResult } from './store/store.interface.js';
export { InMemoryVectorStore } from './store/in-memory-store.js';
export { SQLiteVectorStore } from './store/sqlite-store.js';
export type { SQLiteVectorStoreOptions } from './store/sqlite-store.js';
