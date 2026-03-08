# AgentBuilder

**A comprehensive, cross-platform AI agent builder — design, build, test, and deploy AI agents with any LLM provider.**

AgentBuilder is a CLI-first TypeScript monorepo that lets you create AI agents from natural language descriptions, connect them to any LLM provider (commercial or open source), equip them with tools, wire them into multi-step workflows, and evaluate their performance — all from your terminal.

---

## Features

### Multi-Provider LLM Support
Connect to **6 LLM providers** through a unified interface — switch providers with a config change, not a code change.

| Provider | Models | Tool Use | Streaming |
|----------|--------|----------|-----------|
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | Yes | Yes |
| **OpenAI** | GPT-4o, o1, o3, o4-mini | Yes | Yes |
| **Google** | Gemini 2.5 Pro, Gemini 2.5 Flash | Yes | Yes |
| **Mistral** | Mistral Large, Codestral, Nemo | Yes | Yes |
| **Cohere** | Command R+, Command R | Yes | Yes |
| **Local** | Any model via Ollama, LM Studio, or vLLM | Model-dependent | Yes |

### Agent Patterns
Five battle-tested agent architectures, each optimized for different use cases:

- **ReAct** — Reasoning + Acting loop (Thought → Action → Observation). The industry standard for complex, unpredictable tasks.
- **Plan-and-Execute** — Creates an explicit plan, then executes step-by-step with optional re-planning. Best for multi-step projects.
- **Multi-Agent** — Router agent delegates to specialist agents. Handles diverse requests by routing to the right expert.
- **RAG** — Retrieval-Augmented Generation. Searches knowledge bases, then generates grounded responses with citations.
- **Tool-Augmented** — Direct tool use without explicit reasoning chains. Fast and efficient for straightforward tool tasks.

### Built-in Tools
Five ready-to-use tools, plus an extensible plugin system:

| Tool | Description |
|------|-------------|
| `web_search` | Search the web via DuckDuckGo (pluggable backends) |
| `http_request` | Make HTTP requests with private IP blocking |
| `file_system` | Read/write/list files with path traversal protection |
| `code_executor` | Execute JavaScript (sandboxed VM) or Python (subprocess) |
| `calculator` | Safe math expression parser (no `eval`) with functions |

### MCP Compatible
Full [Model Context Protocol](https://modelcontextprotocol.io/) support — consume tools from external MCP servers or expose your tools as an MCP server. Connect to the growing ecosystem of 97M+ monthly MCP SDK downloads.

### Memory System
Three types of memory for agents that learn and remember:

- **Short-term** — Sliding window over conversation history (in-session)
- **Long-term** — Vector similarity search over stored knowledge (SQLite + cosine similarity)
- **Episodic** — Full interaction recordings for learning from past experiences

### DAG Workflow Engine
Build multi-step agent pipelines with a visual DAG (Directed Acyclic Graph) workflow engine:

- **5 node types**: Agent, Transform, Condition, Parallel, Human-in-the-Loop
- **Parallel execution** of independent nodes
- **Conditional branching** based on intermediate results
- **Checkpointing** for durable execution (resume on failure)
- **YAML definitions** — version-controllable, human-readable

### Evaluation Framework
Test and compare agents with a full evaluation suite:

- **4 metric types**: Accuracy (exact/fuzzy/semantic), Latency (P50/P90/P99), Cost tracking, Tool usage analysis
- **3 reporters**: Console tables, JSON (for CI), self-contained HTML reports with charts
- **A/B comparison**: Compare two agent configs side-by-side with statistical significance testing
- **Dataset loading**: JSONL, JSON, and CSV test datasets

### Automated Agent Creation
The signature feature — describe what you want in plain English:

```bash
agentbuilder create "a research assistant that searches the web and provides cited answers"
```

The system uses your configured LLM to generate a complete agent configuration, selects the right pattern and tools, and optionally runs built-in tests to validate it.

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9

### Installation

```bash
# Clone the repository
git clone https://github.com/ssevera1/Agent-Builder.git
cd Agent-Builder

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Configuration

```bash
# Copy the environment template
cp .env.example .env

# Add your API key(s) — at least one provider is required
# Edit .env and add: ANTHROPIC_API_KEY=sk-ant-...
# Or: OPENAI_API_KEY=sk-...
# Or: GOOGLE_API_KEY=...
# Or for local models: OLLAMA_BASE_URL=http://localhost:11434
```

### Usage

```bash
# Initialize a new agent project
agentbuilder init

# Create an agent from a natural language description
agentbuilder create "a coding assistant that writes and tests code"

# Start an interactive chat session
agentbuilder run my-agent

# List available agent templates
agentbuilder template list

# Apply a template
agentbuilder template apply research-agent

# Run evaluation tests
agentbuilder test my-agent --dataset tests/my-tests.jsonl --report html

# Execute a workflow pipeline
agentbuilder workflow run workflows/research-pipeline.yaml

# Manage tools
agentbuilder tool list

# Configure providers
agentbuilder config providers
```

---

## Architecture

AgentBuilder is a **pnpm monorepo** with 9 packages organized in a clean dependency hierarchy:

```
packages/
├── core/        → Types, Zod schemas, errors, utilities (zero internal deps)
├── llm/         → 6 LLM provider adapters with unified interface
├── engine/      → Orchestrator, 5 agent patterns, 4 agent templates
├── tools/       → Tool registry, dispatcher, 5 builtins, MCP adapter, plugins
├── memory/      → Short-term, long-term vector, episodic memory
├── workflow/    → DAG engine, 5 node types, checkpointing, YAML serialization
├── evaluation/  → Test runner, 4 metrics, 3 reporters, A/B comparator
├── storage/     → SQLite database, migrations, 4 repositories
apps/
└── cli/         → 9 CLI commands, interactive wizard, streaming formatter
```

### Dependency Graph

```
@agentbuilder/core (zero deps)
    ↑
    ├── @agentbuilder/storage
    ├── @agentbuilder/llm
    ├── @agentbuilder/tools
    ├── @agentbuilder/memory
    ├── @agentbuilder/engine
    ├── @agentbuilder/workflow
    ├── @agentbuilder/evaluation
    └── @agentbuilder/cli (depends on all)
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Streaming** | `AsyncIterable<Event>` everywhere | Natural backpressure, composability, works for CLI and WebSocket |
| **Schemas** | Zod as single schema language | Types + validation + JSON Schema generation in one |
| **Storage** | Embedded SQLite (better-sqlite3) | Zero infrastructure, cross-platform, single file |
| **Vectors** | Brute-force cosine similarity | Fast enough for <100K vectors on desktop |
| **Patterns** | Strategy pattern (not inheritance) | Composition over inheritance, independently testable |
| **Config** | YAML for users, JSON for storage | Human-readable editing, machine-efficient storage |

For detailed architectural documentation, see:
- [`design/c4/`](design/c4/) — C4 model diagrams (Context, Container, Component, Code) in Mermaid.js
- [`design/adr/`](design/adr/) — Architecture Decision Records explaining the "why" behind each choice

---

## Project Structure

```
Agent-Builder/
├── packages/
│   ├── core/                    # @agentbuilder/core
│   │   ├── src/types/           # AgentConfig, Message, Tool, Memory, Workflow, Session, Evaluation
│   │   ├── src/schemas/         # Zod schemas for all types
│   │   ├── src/errors/          # Typed error hierarchy (LLM, Tool, Validation)
│   │   └── src/utils/           # Token counter, retry, streams, logger, ID gen, paths
│   │
│   ├── llm/                     # @agentbuilder/llm
│   │   ├── src/providers/       # anthropic.ts, openai.ts, google.ts, mistral.ts, cohere.ts, local.ts
│   │   ├── src/base-client.ts   # Shared retry, streaming, error handling
│   │   ├── src/provider-registry.ts  # Dynamic provider registration
│   │   └── src/model-catalog.ts # 22 models with capabilities and pricing
│   │
│   ├── engine/                  # @agentbuilder/engine
│   │   ├── src/orchestrator.ts  # Core agent execution loop
│   │   ├── src/patterns/        # react.ts, plan-and-execute.ts, multi-agent.ts, rag.ts, tool-augmented.ts
│   │   ├── src/templates/       # research-agent.ts, coding-agent.ts, data-analyst.ts, customer-support.ts
│   │   ├── src/prompt-builder.ts
│   │   ├── src/context-assembler.ts
│   │   ├── src/response-parser.ts
│   │   └── src/guardrails.ts    # Prompt injection detection, PII filtering
│   │
│   ├── tools/                   # @agentbuilder/tools
│   │   ├── src/builtin/         # calculator, code-executor, file-system, http-request, web-search
│   │   ├── src/mcp/             # MCP adapter (bidirectional)
│   │   ├── src/plugin/          # Plugin loader and interface
│   │   ├── src/registry.ts      # Tool registration with Zod validation
│   │   └── src/dispatcher.ts    # Tool execution with timeout and concurrency
│   │
│   ├── memory/                  # @agentbuilder/memory
│   │   ├── src/short-term.ts    # Sliding window (in-memory)
│   │   ├── src/long-term.ts     # Vector search (SQLite + cosine similarity)
│   │   ├── src/episodic.ts      # Full episode recording
│   │   ├── src/embedding/       # Local (Ollama) + API (OpenAI) embedders
│   │   └── src/store/           # SQLite and in-memory vector stores
│   │
│   ├── workflow/                # @agentbuilder/workflow
│   │   ├── src/dag.ts           # DAG with topological sort (Kahn's algorithm)
│   │   ├── src/executor.ts      # Layer-by-layer parallel execution
│   │   ├── src/nodes/           # agent, transform, condition, parallel, human
│   │   ├── src/checkpoint.ts    # SQLite + in-memory + file checkpointing
│   │   └── src/serialization.ts # YAML/JSON parsing with validation
│   │
│   ├── evaluation/              # @agentbuilder/evaluation
│   │   ├── src/runner.ts        # Test case execution with assertions
│   │   ├── src/metrics/         # accuracy, latency (percentiles), cost, tool-usage
│   │   ├── src/reporters/       # console (ANSI tables), json, html (self-contained)
│   │   ├── src/comparator.ts    # A/B testing with paired t-test
│   │   └── src/dataset.ts       # JSONL, JSON, CSV loaders
│   │
│   └── storage/                 # @agentbuilder/storage
│       ├── src/database.ts      # SQLite with WAL mode
│       ├── src/migrations/      # Versioned schema migrations
│       ├── src/repositories/    # agent-config, session, workflow, evaluation
│       └── src/config.ts        # Cross-platform data directory
│
├── apps/
│   └── cli/                     # @agentbuilder/cli
│       ├── src/commands/        # init, create, run, test, workflow, template, tool, config, serve
│       ├── src/prompts/         # Interactive agent wizard, provider setup
│       └── src/formatters/      # Table, tree, streaming output
│
├── design/                      # Architecture documentation
│   ├── c4/                      # C4 model diagrams (Mermaid.js)
│   └── adr/                     # Architecture Decision Records
│
└── examples/                    # Example configurations
    ├── agents/                  # Agent YAML configs
    ├── workflows/               # Workflow YAML definitions
    └── tests/                   # Test datasets (JSONL)
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `agentbuilder init` | Initialize a new agent project with config and directory structure |
| `agentbuilder create <description>` | Auto-generate an agent from a natural language description |
| `agentbuilder run <agent>` | Start an interactive chat session with streaming output |
| `agentbuilder test <agent>` | Run evaluation suite with metrics and reports |
| `agentbuilder workflow run <file>` | Execute a YAML workflow pipeline |
| `agentbuilder template list\|apply\|show` | Browse and apply agent blueprints |
| `agentbuilder tool list\|add\|remove` | Manage available tools |
| `agentbuilder config set\|get\|list\|providers` | Configure providers and settings |
| `agentbuilder serve` | Start the web UI dashboard (coming soon) |

**Shorthand**: Use `ab` instead of `agentbuilder` for all commands.

---

## Agent Templates

Four pre-built agent blueprints to get started quickly:

| Template | Pattern | Tools | Memory |
|----------|---------|-------|--------|
| **Research Agent** | ReAct | web_search, http_request | Long-term + episodic |
| **Coding Agent** | Plan-and-Execute | code_executor, file_system | Episodic |
| **Data Analyst** | Tool-Augmented | calculator, code_executor, http_request | Short-term |
| **Customer Support** | RAG | web_search | Long-term + episodic |

---

## Example Workflow

```yaml
# workflows/research-pipeline.yaml
name: research-pipeline
description: Multi-step research with analysis and report generation

nodes:
  - id: query_generator
    type: agent
    config:
      agentConfig: research-query-generator
      message: "Generate search queries for: {{topic}}"

  - id: web_search
    type: parallel
    config:
      itemsFrom: query_generator.queries

  - id: synthesizer
    type: agent
    config:
      agentConfig: report-synthesizer

  - id: human_review
    type: human
    config:
      prompt: "Review the report. Approve or provide feedback."

edges:
  - from: query_generator
    to: web_search
  - from: web_search
    to: synthesizer
  - from: synthesizer
    to: human_review
```

---

## Local Model Support

AgentBuilder works with any model served locally via OpenAI-compatible APIs:

### Ollama
```bash
# Install and run a model
ollama run llama3

# Configure AgentBuilder
echo "OLLAMA_BASE_URL=http://localhost:11434" >> .env
echo "AGENTBUILDER_DEFAULT_PROVIDER=local" >> .env
```

### LM Studio
```bash
# Start LM Studio's API server, then:
echo "LM_STUDIO_BASE_URL=http://localhost:1234/v1" >> .env
```

### vLLM
```bash
# Start vLLM server, then:
echo "VLLM_BASE_URL=http://localhost:8000/v1" >> .env
```

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Watch mode development
pnpm dev

# Type checking
pnpm typecheck

# Clean build artifacts
pnpm clean
```

### Adding a New LLM Provider

1. Create `packages/llm/src/providers/my-provider.ts` implementing `LLMClient`
2. Register in `packages/llm/src/provider-registry.ts`
3. Add model entries to `packages/llm/src/model-catalog.ts`

### Adding a New Tool

1. Create `packages/tools/src/builtin/my-tool.ts` with a Zod input schema
2. Register in the tool registry
3. Or create an MCP server and connect via `agentbuilder tool add mcp://...`

### Adding a New Agent Pattern

1. Implement the `AgentPattern` interface in `packages/engine/src/patterns/`
2. Register in `packages/engine/src/pattern-registry.ts`

---

## Tech Stack

| Concern | Technology |
|---------|-----------|
| Runtime | Node.js >= 20 |
| Language | TypeScript (strict mode, ESM) |
| Package Manager | pnpm workspaces |
| Build System | Turborepo + tsup |
| Database | SQLite (better-sqlite3) |
| Schema Validation | Zod |
| CLI Framework | Commander + chalk + inquirer + ora |
| Testing | Vitest |
| Logging | pino |

---

## License

MIT

---

## Stats

- **133 TypeScript source files**
- **~37,700 lines of code**
- **9 packages** in a pnpm monorepo
- **9/9 packages build successfully**
- **6 LLM providers**, **5 agent patterns**, **5 built-in tools**
- **3 memory types**, **5 workflow node types**, **4 evaluation metrics**
