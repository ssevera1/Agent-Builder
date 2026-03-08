# C4 Level 3: Component Diagram

Zooms into the Agent Engine — the core container — showing its internal components.

```mermaid
C4Component
    title AgentBuilder - Agent Engine Components

    Container_Boundary(agent_engine, "Agent Engine") {
        Component(orchestrator, "Orchestrator", "Controller", "Manages the agent reasoning loop lifecycle")
        Component(prompt_builder, "Prompt Builder", "Service", "Assembles system prompts, context, and tool descriptions")
        Component(llm_client, "LLM Client", "Adapter", "Handles communication with LLM providers, streaming, retries")
        Component(tool_dispatcher, "Tool Dispatcher", "Service", "Parses tool calls from LLM output and dispatches execution")
        Component(context_assembler, "Context Assembler", "Service", "Manages context window: truncation, summarization, prioritization")
        Component(response_parser, "Response Parser", "Service", "Extracts structured output, tool calls, and text from LLM responses")
        Component(guardrails, "Guardrails", "Service", "Input/output validation, content filtering, safety checks")
    }

    System_Ext(llm_provider, "LLM Provider", "Claude API")
    Container_Ext(tool_manager, "Tool Manager")
    Container_Ext(memory_manager, "Memory Manager")
    Container_Ext(config_store, "Config Store")
    Container_Ext(session_store, "Session Store")

    Rel(orchestrator, prompt_builder, "Requests prompt assembly")
    Rel(orchestrator, llm_client, "Sends assembled prompt")
    Rel(orchestrator, tool_dispatcher, "Dispatches tool calls")
    Rel(orchestrator, context_assembler, "Manages context window")
    Rel(orchestrator, guardrails, "Validates I/O")

    Rel(llm_client, llm_provider, "API calls", "HTTPS")
    Rel(llm_client, response_parser, "Raw LLM output")
    Rel(tool_dispatcher, tool_manager, "Executes tools")
    Rel(context_assembler, memory_manager, "Retrieves/stores context")
    Rel(prompt_builder, config_store, "Loads agent config")
    Rel(orchestrator, session_store, "Session state")
```

## Component Details

### Orchestrator
The central control loop. For each user message:
1. Load session state and agent config
2. Assemble context (memory + conversation history)
3. Build prompt (system prompt + context + tools)
4. Call LLM
5. Parse response for tool calls or final answer
6. If tool calls: execute, append results, goto step 3
7. If final answer: apply guardrails, return to user

### Prompt Builder
- Assembles the full prompt from templates, agent persona, tool descriptions
- Handles token budget allocation across system prompt, context, and conversation

### LLM Client
- Abstracts LLM provider differences behind a common interface
- Handles streaming, retries, backoff, and error classification

### Tool Dispatcher
- Validates tool call parameters against registered schemas
- Executes tools with timeout and error handling
- Returns structured results back to the orchestrator

### Context Assembler
- Implements sliding window over conversation history
- Triggers summarization when context exceeds budget
- Prioritizes recent messages and relevant memory

### Guardrails
- Input validation (prompt injection detection)
- Output filtering (PII, harmful content)
- Rate limiting per user/agent
