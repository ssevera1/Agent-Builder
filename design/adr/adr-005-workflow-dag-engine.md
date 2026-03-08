# ADR-005: Custom Lightweight DAG Engine for Workflow Execution

## Status
Accepted

## Date
2026-03-08

## Context
AgentBuilder needs a workflow engine for multi-step agent pipelines. Options range from adopting Temporal (durable execution, enterprise-grade) to building a custom lightweight engine.

Research findings (March 2026):
- Temporal is production-proven (launched OpenAI Agent SDK integration in 2025) but requires infrastructure (server, database, worker processes) — overkill for a desktop tool
- LangGraph uses a graph-based state machine that's proven effective for agent workflows
- n8n, Make, Zapier all use DAG-based workflow models with JSON/YAML serialization
- The consensus is: custom lightweight DAG for user-facing workflow builder, optional Temporal integration for production durability

Key requirements:
- DAG-based (no cycles, topological execution order)
- Parallel execution of independent nodes
- Conditional branching
- Human-in-the-loop pause/resume
- Checkpointing for durability
- YAML/JSON serialization for portable workflow definitions

## Decision
Build a **custom lightweight DAG engine** in TypeScript:

1. **DAG class**: Generic directed acyclic graph with topological sort (Kahn's algorithm), cycle detection (DFS), and execution layer computation (parallel groups)
2. **WorkflowExecutor**: Executes DAG layer-by-layer, running independent nodes in parallel within each layer
3. **Node handlers**: Pluggable handlers for each node type (agent, transform, condition, parallel, human)
4. **Checkpointing**: SQLite-backed state persistence after each layer
5. **Serialization**: YAML workflow definitions validated against Zod schemas
6. **State management**: Typed state snapshots with reducer-based updates (inspired by LangGraph)

Workflows are defined in YAML (user-editable, supports comments) and stored internally as JSON.

## Consequences

### Positive
- Zero infrastructure dependency — runs entirely in-process
- Full control over execution semantics
- YAML definitions are human-readable and version-controllable
- Checkpointing enables resume-on-failure
- Layer-based parallel execution maximizes throughput
- Extensible node types via handler registry

### Negative
- Not as battle-tested as Temporal for failure recovery edge cases
- No distributed execution (single-machine only)
- Must implement our own timeout, retry, and error recovery logic
- No built-in workflow versioning or migration

### Trade-offs
- Chose custom engine over Temporal: zero infrastructure vs. enterprise durability
- Chose YAML over visual-only editor: portability and version control vs. visual appeal
- Chose layer-based parallelism over full async: simpler correctness guarantees

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| Temporal | Battle-tested durability, distributed execution | Requires server infrastructure, Java/Go ecosystem | Too heavy for a desktop CLI tool |
| Bull/BullMQ | Redis-based job queues, proven | Requires Redis, not DAG-oriented | Wrong paradigm (queues vs. DAGs) |
| n8n integration | 1000+ integrations, visual editor | Full application, not a library | Can't embed, different architecture |
| LangGraph adoption | Proven at scale, state machine model | Python-centric, LangChain dependency | Wrong language, vendor lock-in |
