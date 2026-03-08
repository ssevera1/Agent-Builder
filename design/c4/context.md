# C4 Level 1: System Context Diagram

The highest-level view showing AgentBuilder and its relationships with users and external systems.

```mermaid
C4Context
    title AgentBuilder - System Context Diagram

    Person(developer, "Developer", "Builds and configures AI agents")
    Person(enduser, "End User", "Interacts with deployed agents")

    System(agentbuilder, "AgentBuilder", "Platform for designing, building, and deploying AI agents with configurable behaviors and tool integrations")

    System_Ext(llm_provider, "LLM Provider", "Claude API / other LLM APIs for agent reasoning")
    System_Ext(tool_registry, "External Tools", "APIs and services agents can invoke")
    System_Ext(memory_store, "Memory Store", "Persistent memory for agent context across sessions")

    Rel(developer, agentbuilder, "Designs & configures agents")
    Rel(enduser, agentbuilder, "Interacts with agents")
    Rel(agentbuilder, llm_provider, "Sends prompts, receives completions", "HTTPS/API")
    Rel(agentbuilder, tool_registry, "Invokes external tools", "HTTPS/API")
    Rel(agentbuilder, memory_store, "Reads/writes agent memory", "HTTPS/API")
```

## Key Interactions

| From | To | Description | Protocol | Latency Requirement |
|------|----|-------------|----------|-------------------|
| Developer | AgentBuilder | Agent configuration & design | HTTP/WebSocket | < 200ms UI response |
| End User | AgentBuilder | Conversational interaction | HTTP/WebSocket | < 500ms first token |
| AgentBuilder | LLM Provider | Reasoning & generation | HTTPS | < 2s first token |
| AgentBuilder | External Tools | Tool execution | HTTPS | < 5s per tool call |
| AgentBuilder | Memory Store | Context persistence | HTTPS | < 100ms read/write |

## Notes

- The system acts as an orchestration layer between users and LLM providers
- External tools are dynamically registered and invoked based on agent configuration
- Memory store enables agents to maintain context across sessions
