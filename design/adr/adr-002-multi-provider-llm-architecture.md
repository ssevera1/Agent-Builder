# ADR-002: Multi-Provider LLM Architecture with Unified Interface

## Status
Accepted

## Date
2026-03-08

## Context
AgentBuilder must support all major AI providers (Anthropic Claude, OpenAI, Google Gemini, Mistral, Cohere) plus open-source models via local inference engines (Ollama, LM Studio, vLLM). Each provider has different APIs, authentication, streaming formats, tool-calling conventions, and error handling. We need a unified interface that abstracts these differences while preserving provider-specific capabilities.

Research findings (March 2026):
- The industry is converging on similar patterns (tool calling, streaming, structured output) but implementation details vary significantly
- MCP has become the universal tool integration standard (97M+ monthly SDK downloads, Linux Foundation governance)
- OpenAI-compatible API endpoints are the de facto standard for local inference (Ollama, LM Studio, vLLM all expose them)
- LLM API costs dropped ~80% from 2025 to 2026, making multi-provider routing economically advantageous

## Decision
We implement a **provider adapter pattern** with:

1. **LLMClient interface**: Abstract contract for all providers (complete, countTokens, listModels)
2. **BaseClient abstract class**: Shared retry logic, error classification, streaming, usage tracking
3. **Per-provider adapters**: Anthropic, OpenAI, Google, Mistral, Cohere, Local (OpenAI-compatible)
4. **ProviderRegistry**: Dynamic registration, factory pattern, environment-based defaults
5. **ModelCatalog**: Known models with capabilities, token limits, pricing for intelligent routing
6. **Unified streaming**: All providers emit `AsyncIterable<LLMStreamChunk>` regardless of native format

The Local adapter uses the OpenAI-compatible API, covering Ollama, LM Studio, and vLLM with a single implementation.

## Consequences

### Positive
- Single implementation covers all local inference engines via OpenAI-compatible API
- Provider switching is a config change, not a code change
- ModelCatalog enables intelligent routing (cost, speed, capability matching)
- New providers can be added without modifying existing code
- BaseClient eliminates code duplication for retry, streaming, error handling

### Negative
- Some provider-specific features may not map cleanly to the unified interface
- Tool calling format conversion introduces complexity (each provider formats tools differently)
- Token counting varies by provider and cannot be perfectly unified

### Trade-offs
- Chose adapter pattern over SDK-per-provider approach: more control but more maintenance
- Chose OpenAI-compatible API for local models over native Ollama API: broader compatibility but may miss Ollama-specific features
- Chose built-in model catalog over dynamic-only discovery: faster startup but requires updates for new models

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| LiteLLM integration | 100+ providers, battle-tested | External dependency, less control, Python-focused | Need TypeScript-native, full control over streaming |
| Direct SDK per provider | Best feature coverage | Code duplication, inconsistent interfaces | Adapter pattern gives unified interface |
| OpenAI-only API + proxy | Simplest implementation | Lose provider-specific features, dependency on proxy | Direct integration is more reliable |
