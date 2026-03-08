# ADR-003: Agent Patterns as Strategy Pattern with AsyncIterable Events

## Status
Accepted

## Date
2026-03-08

## Context
AgentBuilder needs to support multiple agent execution patterns (ReAct, Plan-and-Execute, Multi-Agent, RAG, Tool-Augmented). The 2026 industry landscape shows:

- **ReAct** is the dominant pattern in production (used by Claude Code, OpenAI Codex) — a single agent reasoning and acting in a loop
- **Multi-agent** was hyped but is settling to "use when genuinely needed" — 72% of enterprises use multi-agent, but simpler patterns work for most tasks
- **Plan-and-Execute** excels for complex multi-step tasks with dependencies
- **RAG** remains essential for knowledge-grounded applications
- **Reflection/Self-Critique** improves quality but increases cost

All patterns share common needs: LLM interaction, tool dispatch, memory access, guardrails. They differ in control flow.

## Decision
Agent patterns implement a **Strategy interface** that:

1. Each pattern implements `AgentPattern.execute()` returning `AsyncIterable<AgentEvent>`
2. Events are typed discriminated unions: `thinking`, `text_delta`, `tool_call`, `tool_result`, `handoff`, `plan`, `step`, `done`
3. Patterns receive `AgentServices` (LLM, tools, memory, etc.) via dependency injection
4. The Orchestrator selects the pattern based on `AgentConfig.pattern` and delegates execution
5. Patterns are registered in a `PatternRegistry` for extensibility

This follows the composition-over-inheritance principle from our coding conventions.

## Consequences

### Positive
- New patterns can be added without modifying the Orchestrator
- AsyncIterable provides natural streaming, backpressure, and composability
- Events work identically for CLI rendering and WebSocket streaming
- Patterns are independently testable with mock services
- Users can create custom patterns via the plugin system

### Negative
- AsyncIterable requires careful error handling (generator cleanup)
- Event type proliferation — each pattern may want unique event types
- Pattern selection at config time means no dynamic pattern switching mid-conversation

### Trade-offs
- Chose strategy pattern over inheritance: cleaner but requires passing all services through the interface
- Chose AsyncIterable over EventEmitter: better composability but less familiar to some developers
- Chose static pattern selection over dynamic: simpler but less adaptive

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| LangGraph-style state machine | Flexible, proven at scale | Complex, steep learning curve, heavy | Overkill for pattern library |
| Base class inheritance | Shared code via inheritance | Violates composition principle, rigid | CLAUDE.md mandates composition |
| EventEmitter pattern | Familiar Node.js pattern | No backpressure, harder to compose | AsyncIterable is more modern and composable |
