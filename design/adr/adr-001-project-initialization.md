# ADR-001: Project Initialization and Architecture Documentation Strategy

## Status
Accepted

## Date
2026-03-08

## Context
We are starting the AgentBuilder project — a platform for designing, building, and deploying AI agents. Before writing code, we need to establish:
- A consistent way to document architectural decisions
- Visual documentation of the system architecture at multiple levels of abstraction
- A project intelligence file (CLAUDE.md) to maintain agent context across sessions

## Decision
We adopt the following documentation strategy:

1. **C4 Model Diagrams** in `design/c4/` using Mermaid.js for editable, version-controlled architecture visualizations at all four levels (Context, Container, Component, Code)
2. **Architecture Decision Records (ADRs)** in `design/adr/` to log design choices, trade-offs, and rationale
3. **CLAUDE.md** at project root as persistent context for the Claude Code agent (excluded from git)
4. **Mermaid.js** as the diagramming tool for its plain-text format, GitHub rendering support, and ease of editing

## Consequences

### Positive
- Architecture is documented before code, reducing costly mid-project redesigns
- C4 model provides consistent vocabulary for discussing architecture at different abstraction levels
- ADRs create a searchable history of "why" decisions were made
- Mermaid.js diagrams are version-controlled alongside code
- CLAUDE.md enables effective AI-assisted development with persistent context

### Negative
- Additional overhead to maintain documentation as architecture evolves
- Mermaid.js has limitations for complex diagrams compared to dedicated tools like Excalidraw

### Trade-offs
- Chose Mermaid.js over Excalidraw for version control friendliness, accepting less visual flexibility
- Chose plain markdown ADRs over tools like Log4brains for simplicity, accepting less discoverability

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| No formal documentation | Zero overhead | Architecture knowledge is tribal, decisions are forgotten | Unacceptable for a non-trivial project |
| Excalidraw diagrams | More visual flexibility, hand-drawn aesthetic | Binary files, harder to diff/version | Mermaid is more maintainable in git |
| Confluence/Notion | Rich editing, collaboration features | External dependency, not co-located with code | Prefer docs-as-code |
| PlantUML | Mature, feature-rich | Requires Java runtime, less GitHub support | Mermaid has better ecosystem integration |
