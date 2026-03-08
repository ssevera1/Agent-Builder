# ADR-004: Embedded SQLite for All Storage (Config, Sessions, Vectors, Checkpoints)

## Status
Accepted

## Date
2026-03-08

## Context
AgentBuilder is a CLI-first desktop application that must work cross-platform without external service dependencies. We need storage for:
- Agent configurations and provider settings
- Conversation sessions
- Long-term memory (vector embeddings)
- Episodic memory
- Workflow execution checkpoints
- Evaluation results

Research findings indicate Chroma (24K+ stars, 8M+ monthly downloads) is the leading embedded vector store, but it requires a Python runtime. For a TypeScript/Node.js application, we need a Node-native solution.

## Decision
Use **better-sqlite3** as the single storage engine for ALL data:

1. **Relational data**: Agent configs, sessions, provider settings, evaluation runs — standard SQL tables
2. **Vector storage**: Embeddings stored as BLOBs (serialized Float32Array), cosine similarity computed in JS
3. **Checkpoints**: Workflow state serialized as JSON in SQLite
4. **WAL mode**: Write-Ahead Logging for concurrent read/write access
5. **Migrations**: Versioned schema migrations tracked in a `_migrations` table

For vector search, we use brute-force cosine similarity in JavaScript. This is performant for <100K vectors — sufficient for a single-user desktop application. A `VectorStore` interface allows swapping in sqlite-vec or external databases later.

## Consequences

### Positive
- Zero infrastructure: no database server, no Docker, no external services
- Single dependency (better-sqlite3) covers all storage needs
- Prebuilt native binaries for Windows, macOS (arm64 + x64), Linux
- WAL mode provides good concurrent read performance
- Data is a single file — easy to backup, move, inspect
- Migrations ensure schema evolution is manageable

### Negative
- Brute-force vector search is O(n) — impractical beyond ~100K vectors
- No built-in full-text search index (would need FTS5 extension)
- Single-writer limitation in WAL mode (fine for desktop, not for multi-user server)
- JSON serialization for complex objects adds overhead

### Trade-offs
- Chose brute-force cosine over sqlite-vec extension: simpler deployment, accepting O(n) search for desktop scale
- Chose single SQLite DB over separate stores: simpler but couples concerns
- Chose better-sqlite3 over Prisma/Drizzle: zero ORM overhead, direct SQL control

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| Chroma (embedded) | Purpose-built vectors, 4x faster with Rust core | Python dependency, doesn't handle relational data | Wrong runtime (Python) for TypeScript project |
| sqlite-vec extension | Native vector indexing in SQLite | Requires distributing native extension per platform, adds deployment complexity | Brute-force is fast enough for desktop scale |
| LevelDB/RocksDB | Fast KV store | No SQL queries, no vector search, more complex embedding | SQLite is simpler and more capable |
| PostgreSQL + pgvector | Production-grade, full vector search | Requires running a database server, kills zero-config experience | Violates CLI-first, zero-dependency principle |
