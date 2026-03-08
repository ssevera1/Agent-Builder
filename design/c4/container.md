# C4 Level 2: Container Diagram

Shows the high-level technical building blocks of AgentBuilder.

```mermaid
C4Container
    title AgentBuilder - Container Diagram

    Person(developer, "Developer", "Builds and configures AI agents")
    Person(enduser, "End User", "Interacts with deployed agents")

    System_Boundary(agentbuilder, "AgentBuilder Platform") {
        Container(api_gateway, "API Gateway", "HTTP/WebSocket", "Routes requests, handles auth, rate limiting")
        Container(agent_engine, "Agent Engine", "Core Runtime", "Orchestrates agent reasoning loops, tool calls, and memory access")
        Container(tool_manager, "Tool Manager", "Service", "Registers, validates, and executes tool integrations")
        Container(memory_manager, "Memory Manager", "Service", "Manages short-term and long-term agent memory")
        Container(config_store, "Config Store", "Database", "Stores agent definitions, prompts, and tool configurations")
        Container(session_store, "Session Store", "Database", "Stores active conversation sessions")
    }

    System_Ext(llm_provider, "LLM Provider", "Claude API")
    System_Ext(external_tools, "External Tools", "Third-party APIs")
    System_Ext(memory_store, "Memory Store", "Vector DB / KV Store")

    Rel(developer, api_gateway, "Configures agents", "HTTPS")
    Rel(enduser, api_gateway, "Chats with agents", "WSS/HTTPS")
    Rel(api_gateway, agent_engine, "Forwards requests")
    Rel(agent_engine, llm_provider, "Reasoning calls", "HTTPS")
    Rel(agent_engine, tool_manager, "Tool execution requests")
    Rel(agent_engine, memory_manager, "Read/write context")
    Rel(tool_manager, external_tools, "Invokes tools", "HTTPS")
    Rel(memory_manager, memory_store, "Persists memory", "HTTPS")
    Rel(agent_engine, config_store, "Loads agent config")
    Rel(agent_engine, session_store, "Session state")
```

## Container Responsibilities

| Container | Responsibility | Technology Candidates |
|-----------|---------------|----------------------|
| API Gateway | Auth, routing, rate limiting | Express/Fastify, API Gateway |
| Agent Engine | Core orchestration loop | Custom runtime, event-driven |
| Tool Manager | Tool registration & execution | Plugin architecture |
| Memory Manager | Context window management | Sliding window + summarization |
| Config Store | Agent definitions & prompts | PostgreSQL / SQLite |
| Session Store | Active conversation state | Redis / in-memory |

## Data Flow

1. User sends message via API Gateway
2. Gateway authenticates and routes to Agent Engine
3. Agent Engine loads agent config and session state
4. Engine enters reasoning loop: LLM call -> tool use -> memory update -> repeat
5. Response streamed back through Gateway to user
