/**
 * RAG (Retrieval-Augmented Generation) Pattern
 *
 * A structured retrieval-then-generate workflow:
 * 1. **Query generation**: Generate one or more search queries from the
 *    user's input (multi-query retrieval for better recall).
 * 2. **Retrieval**: Search memory/knowledge base for relevant context.
 * 3. **Augmented generation**: Build a prompt with retrieved context and
 *    generate a grounded response.
 * 4. **Citation tracking**: Track which memory entries contributed to the
 *    response.
 *
 * Best for knowledge-base Q&A, documentation assistants, and any scenario
 * where grounding responses in stored information is critical.
 */

import type {
  AgentContext,
  AgentEvent,
  AgentPattern,
  AgentServices,
  ContentBlock,
  LLMRequest,
  MemorySearchResult,
  Message,
  TextBlock,
  TokenUsage,
} from './pattern.interface.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUERY_GENERATION_PROMPT = `You are a search query generator. Given the user's question, generate 1-3 diverse search queries that would help find relevant information to answer it.

Rules:
- Generate queries that cover different aspects of the question.
- Use different phrasings to improve recall.
- Keep each query concise (5-15 words).
- For simple questions, 1 query is enough.

Respond with ONLY a JSON array of query strings. Example:
["query one", "query two", "query three"]`;

const RAG_SYSTEM_PROMPT_SUFFIX = `

## Retrieved Context
The following information has been retrieved from the knowledge base and is relevant to the user's question. Base your answer on this information. If the information is insufficient, say so.

{{citations}}

## Citation Rules
- When using information from the retrieved context, reference it naturally.
- If the retrieved context does not contain enough information to fully answer the question, acknowledge the gap.
- Do not fabricate information that is not in the retrieved context or your training data.`;

// ---------------------------------------------------------------------------
// RAG Pattern
// ---------------------------------------------------------------------------

export class RAGPattern implements AgentPattern {
  readonly patternId = 'rag';
  readonly displayName = 'RAG (Retrieval-Augmented Generation)';
  readonly description =
    'Retrieves relevant context from memory/knowledge base before generating ' +
    'a grounded response. Best for Q&A and documentation tasks.';

  async *execute(
    input: Message,
    context: AgentContext,
    services: AgentServices,
  ): AsyncIterable<AgentEvent> {
    const { config, session } = context;
    const startTime = Date.now();
    const cumulativeUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    let turnsUsed = 0;

    const toolDefs = services.tools.getDefinitions(config.tools);
    const builtPrompt = services.promptBuilder.build(config, context, toolDefs);

    // ---- Step 1: Generate search queries ----
    turnsUsed++;
    services.logger.info('RAG: generating search queries');

    const userText = this.extractText(input);
    let searchQueries: string[];

    try {
      searchQueries = await this.generateSearchQueries(
        userText,
        builtPrompt.systemMessage,
        config,
        services,
        cumulativeUsage,
      );
    } catch {
      // Fall back to using the raw user input as the search query
      searchQueries = [userText];
    }

    services.logger.debug('RAG: search queries generated', {
      queries: searchQueries,
    });

    // ---- Step 2: Retrieve relevant context ----
    turnsUsed++;
    services.logger.info('RAG: retrieving context');

    const retrievedEntries = await this.retrieveContext(
      searchQueries,
      config,
      services,
    );

    // Emit memory_retrieved event
    yield this.createEvent('memory_retrieved', {
      entries: retrievedEntries.map((e) => ({
        id: e.entry.id,
        content: e.entry.content,
        score: e.score,
      })),
      query: searchQueries.join(' | '),
    });

    services.logger.info('RAG: context retrieved', {
      entryCount: retrievedEntries.length,
    });

    // ---- Step 3: Build augmented prompt and generate response ----
    turnsUsed++;
    services.logger.info('RAG: generating augmented response');

    const citationsBlock = this.formatCitations(retrievedEntries);
    const augmentedSystemPrompt =
      this.extractText(builtPrompt.systemMessage) +
      RAG_SYSTEM_PROMPT_SUFFIX.replace('{{citations}}', citationsBlock);

    // Build the final generation request
    const generationMessages: Message[] = [
      ...builtPrompt.messages.filter((m) => m.role !== 'system'),
    ];

    // Ensure the user input is present
    if (
      generationMessages.length === 0 ||
      generationMessages[generationMessages.length - 1] !== input
    ) {
      generationMessages.push(input);
    }

    const request: LLMRequest = {
      model: config.provider.modelId,
      messages: [
        { role: 'system', content: augmentedSystemPrompt },
        ...generationMessages,
      ],
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      tools: builtPrompt.tools.length > 0 ? builtPrompt.tools : undefined,
      toolChoice: builtPrompt.tools.length > 0 ? 'auto' : undefined,
      stream: true,
    };

    // Stream the response
    let fullText = '';
    let toolCallsCount = 0;

    try {
      const stream = services.llm.stream(request);

      for await (const chunk of stream) {
        switch (chunk.type) {
          case 'content_block_delta': {
            if (chunk.textDelta) {
              fullText += chunk.textDelta;
              yield this.createEvent('text_delta', { delta: chunk.textDelta });
            }
            break;
          }

          case 'message_delta':
          case 'message_stop': {
            if (chunk.usage) {
              cumulativeUsage.promptTokens += chunk.usage.promptTokens ?? 0;
              cumulativeUsage.completionTokens += chunk.usage.completionTokens ?? 0;
              cumulativeUsage.totalTokens += chunk.usage.totalTokens ?? 0;
            }
            break;
          }

          case 'error': {
            yield this.createEvent('error', {
              code: 'RAG_GENERATION_ERROR',
              message: chunk.error?.message ?? 'Unknown streaming error',
              recoverable: false,
            });
            break;
          }
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      services.logger.error('RAG generation failed', { error: errMsg });

      yield this.createEvent('error', {
        code: 'RAG_GENERATION_ERROR',
        message: errMsg,
        recoverable: false,
      });

      fullText = `I encountered an error while generating the response: ${errMsg}`;
    }

    yield this.createEvent('text_done', { fullText });
    yield this.createEvent('run_done', {
      finalResponse: fullText,
      totalTokens: cumulativeUsage,
      totalDurationMs: Date.now() - startTime,
      turnsUsed,
      toolCallsCount,
    });
  }

  // -----------------------------------------------------------------------
  // Query Generation
  // -----------------------------------------------------------------------

  /**
   * Use the LLM to generate multiple search queries for better recall.
   */
  private async generateSearchQueries(
    userText: string,
    systemMessage: Message,
    config: AgentContext['config'],
    services: AgentServices,
    cumulativeUsage: TokenUsage,
  ): Promise<string[]> {
    const request: LLMRequest = {
      model: config.provider.modelId,
      messages: [
        systemMessage,
        { role: 'system', content: QUERY_GENERATION_PROMPT },
        { role: 'user', content: userText },
      ],
      temperature: 0.3,
      maxTokens: 256,
    };

    const response = await services.llm.complete(request);
    cumulativeUsage.promptTokens += response.usage.promptTokens;
    cumulativeUsage.completionTokens += response.usage.completionTokens;
    cumulativeUsage.totalTokens += response.usage.totalTokens;

    const text = response.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    // Parse the JSON array of queries
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const queries = JSON.parse(jsonMatch[0]) as string[];
        if (Array.isArray(queries) && queries.length > 0) {
          return queries.map(String).filter(Boolean);
        }
      } catch {
        // Fall through to fallback
      }
    }

    // Fallback: use the user text directly
    return [userText];
  }

  // -----------------------------------------------------------------------
  // Context Retrieval
  // -----------------------------------------------------------------------

  /**
   * Search memory with multiple queries and deduplicate results.
   */
  private async retrieveContext(
    queries: string[],
    config: AgentContext['config'],
    services: AgentServices,
  ): Promise<MemorySearchResult[]> {
    const allResults: MemorySearchResult[] = [];
    const seenIds = new Set<string>();

    for (const query of queries) {
      try {
        const results = await services.memory.search(query, {
          topK: config.memoryConfig.longTermTopK,
          agentId: config.id,
          minScore: 0.3,
        });

        for (const result of results) {
          if (!seenIds.has(result.entry.id)) {
            seenIds.add(result.entry.id);
            allResults.push(result);
          }
        }
      } catch (error) {
        services.logger.warn('RAG memory search failed for query', {
          query,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Sort by score descending and limit
    allResults.sort((a, b) => b.score - a.score);

    const maxEntries = config.memoryConfig.longTermTopK * 2; // Allow more for multi-query
    return allResults.slice(0, maxEntries);
  }

  // -----------------------------------------------------------------------
  // Citation Formatting
  // -----------------------------------------------------------------------

  /**
   * Format retrieved entries as a citations block for the prompt.
   */
  private formatCitations(results: MemorySearchResult[]): string {
    if (results.length === 0) {
      return 'No relevant information was found in the knowledge base.';
    }

    return results
      .map((r, i) => {
        const source = r.entry.metadata.source || 'unknown';
        const tags = r.entry.metadata.tags.length > 0
          ? ` (tags: ${r.entry.metadata.tags.join(', ')})`
          : '';
        const score = (r.score * 100).toFixed(0);

        return `[Source ${i + 1}] (relevance: ${score}%, source: ${source}${tags})\n${r.entry.content}`;
      })
      .join('\n\n---\n\n');
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private extractText(message: Message): string {
    if (typeof message.content === 'string') return message.content;
    return (message.content as ContentBlock[])
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  private createEvent(type: AgentEvent['type'], data: AgentEvent['data']): AgentEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
  }
}
