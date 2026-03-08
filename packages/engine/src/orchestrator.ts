/**
 * Orchestrator — the heart of the AgentBuilder engine.
 *
 * Implements the central orchestration loop from the C4 code diagram:
 * 1. Validate input via guardrails
 * 2. Add message to session history
 * 3. Retrieve relevant memory
 * 4. Select and execute the appropriate agent pattern
 * 5. Update memory with the interaction
 * 6. Yield AgentEvents throughout the process
 *
 * The orchestrator is provider-agnostic: it accepts any LLMClient, any
 * ToolDispatcher, and any MemoryManager. Patterns are selected based on
 * the AgentConfig.pattern field.
 */

import type { AgentConfig } from '@agentbuilder/core';
import type {
  AgentContext,
  AgentEvent,
  AgentServices,
  ContentBlock,
  LLMClient,
  Logger,
  MemoryManager,
  Message,
  Session,
  TextBlock,
  TokenUsage,
  ToolDispatcher,
} from './patterns/pattern.interface.js';
import { PatternRegistry } from './pattern-registry.js';
import { PromptBuilder } from './prompt-builder.js';
import { ContextAssembler } from './context-assembler.js';
import { Guardrails } from './guardrails.js';

// ---------------------------------------------------------------------------
// Orchestrator options
// ---------------------------------------------------------------------------

export interface OrchestratorOptions {
  /** Max reasoning loop iterations (default 10). */
  maxTurns?: number;
  /** Max tokens for the context window (default 128000). */
  maxTokensBudget?: number;
  /** Enable memory retrieval and storage (default true). */
  enableMemory?: boolean;
  /** Enable input/output guardrails (default true). */
  enableGuardrails?: boolean;
  /** Optional callback for every emitted event. */
  onEvent?: (event: AgentEvent) => void;
  /** Custom pattern registry (defaults to built-in patterns). */
  patternRegistry?: PatternRegistry;
  /** Custom logger implementation. */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Default console logger
// ---------------------------------------------------------------------------

const defaultLogger: Logger = {
  debug(message: string, data?: Record<string, unknown>) {
    // Intentionally silent in production — override with a real logger
  },
  info(message: string, data?: Record<string, unknown>) {
    // Intentionally silent in production
  },
  warn(message: string, data?: Record<string, unknown>) {
    console.warn(`[engine:warn] ${message}`, data ?? '');
  },
  error(message: string, data?: Record<string, unknown>) {
    console.error(`[engine:error] ${message}`, data ?? '');
  },
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly maxTurns: number;
  private readonly maxTokensBudget: number;
  private readonly enableMemory: boolean;
  private readonly enableGuardrails: boolean;
  private readonly onEvent?: (event: AgentEvent) => void;
  private readonly patternRegistry: PatternRegistry;
  private readonly promptBuilder: PromptBuilder;
  private readonly contextAssembler: ContextAssembler;
  private readonly guardrails: Guardrails;
  private readonly logger: Logger;

  constructor(
    private readonly config: AgentConfig,
    private readonly llmClient: LLMClient,
    private readonly toolDispatcher: ToolDispatcher,
    private readonly memoryManager: MemoryManager,
    options?: OrchestratorOptions,
  ) {
    this.maxTurns = options?.maxTurns ?? config.maxTurns ?? 10;
    this.maxTokensBudget = options?.maxTokensBudget ?? 128_000;
    this.enableMemory = options?.enableMemory ?? true;
    this.enableGuardrails = options?.enableGuardrails ?? true;
    this.onEvent = options?.onEvent;
    this.patternRegistry = options?.patternRegistry ?? new PatternRegistry();
    this.logger = options?.logger ?? defaultLogger;

    this.promptBuilder = new PromptBuilder();
    this.contextAssembler = new ContextAssembler();
    this.guardrails = new Guardrails();
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  /**
   * Run the agent for a user message.
   *
   * This is an async generator that yields AgentEvents as the agent
   * processes the request. Callers can iterate over the events for
   * real-time UI updates (streaming text, tool call progress, etc.).
   *
   * @param userMessage - The user's message.
   * @param session - The current conversation session.
   * @yields AgentEvent stream.
   */
  async *run(
    userMessage: Message,
    session: Session,
  ): AsyncIterable<AgentEvent> {
    const startTime = Date.now();

    // ---- Emit run_start ----
    yield* this.emit({
      type: 'run_start',
      timestamp: new Date().toISOString(),
      data: {
        sessionId: session.id,
        agentId: this.config.id,
        pattern: this.config.pattern,
      },
    });

    // ---- Step 1: Validate input via guardrails ----
    if (this.enableGuardrails) {
      const inputValidation = this.guardrails.validateInput(
        userMessage,
        this.config.guardrailRules,
      );

      // Emit guardrail events for any violations
      for (const violation of inputValidation.violations) {
        yield* this.emit({
          type: 'guardrail_triggered',
          timestamp: new Date().toISOString(),
          data: {
            ruleId: violation.ruleId,
            ruleName: violation.ruleName,
            action: violation.action,
            detail: violation.detail,
            direction: 'input',
          },
        });
      }

      // If any blocking violation, abort
      if (!inputValidation.passed) {
        const blockedMessage =
          'Your message was blocked by a safety check. Please rephrase your request.';

        yield* this.emit({
          type: 'text_done',
          timestamp: new Date().toISOString(),
          data: { fullText: blockedMessage },
        });

        yield* this.emit({
          type: 'run_done',
          timestamp: new Date().toISOString(),
          data: {
            finalResponse: blockedMessage,
            totalTokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            totalDurationMs: Date.now() - startTime,
            turnsUsed: 0,
            toolCallsCount: 0,
          },
        });
        return;
      }
    }

    // ---- Step 2: Add message to session history ----
    session.messages.push(userMessage);
    session.updatedAt = new Date();

    // Store the message in memory if enabled
    if (this.enableMemory) {
      try {
        await this.memoryManager.storeMessage(session.id, userMessage);
      } catch (error) {
        this.logger.warn('Failed to store user message in memory', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // ---- Step 3: Assemble context (includes memory retrieval) ----
    let context: AgentContext;
    try {
      context = await this.contextAssembler.assemble(
        session,
        userMessage,
        this.memoryManager,
        this.config,
        this.maxTokensBudget,
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('Context assembly failed', { error: errMsg });

      // Fall back to a minimal context
      context = {
        config: this.config,
        session,
        conversationHistory: session.messages.slice(-10),
        relevantMemory: [],
        tokenBudget: this.maxTokensBudget,
      };
    }

    // Emit memory_retrieved if we got memory entries
    if (context.relevantMemory.length > 0) {
      yield* this.emit({
        type: 'memory_retrieved',
        timestamp: new Date().toISOString(),
        data: {
          entries: context.relevantMemory.map((e) => ({
            id: e.id,
            content: e.content.slice(0, 200),
            score: e.metadata.importance,
          })),
          query: this.extractText(userMessage).slice(0, 200),
        },
      });
    }

    // ---- Step 4: Select and execute the appropriate pattern ----
    const pattern = this.patternRegistry.get(this.config.pattern);

    // Override maxTurns in the config if the orchestrator has a different value
    const effectiveConfig: AgentConfig = {
      ...this.config,
      maxTurns: this.maxTurns,
    };
    const effectiveContext: AgentContext = {
      ...context,
      config: effectiveConfig,
    };

    // Build the services bundle
    const services: AgentServices = {
      llm: this.llmClient,
      tools: this.toolDispatcher,
      memory: this.memoryManager,
      promptBuilder: this.promptBuilder,
      guardrails: this.guardrails,
      logger: this.logger,
    };

    // Execute the pattern and relay events
    let finalResponse = '';
    let totalTokens: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    let turnsUsed = 0;
    let toolCallsCount = 0;

    try {
      for await (const event of pattern.execute(
        userMessage,
        effectiveContext,
        services,
      )) {
        // Track aggregate stats from events
        if (event.type === 'run_done') {
          const doneData = event.data as {
            finalResponse: string;
            totalTokens: TokenUsage;
            turnsUsed: number;
            toolCallsCount: number;
          };
          finalResponse = doneData.finalResponse;
          totalTokens = doneData.totalTokens;
          turnsUsed = doneData.turnsUsed;
          toolCallsCount = doneData.toolCallsCount;
        }

        // Relay all pattern events upstream
        yield* this.emit(event);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('Pattern execution failed', {
        pattern: this.config.pattern,
        error: errMsg,
      });

      yield* this.emit({
        type: 'error',
        timestamp: new Date().toISOString(),
        data: {
          code: 'PATTERN_EXECUTION_ERROR',
          message: `Agent pattern "${this.config.pattern}" failed: ${errMsg}`,
          recoverable: false,
        },
      });

      finalResponse = `I encountered an internal error while processing your request: ${errMsg}`;

      yield* this.emit({
        type: 'text_done',
        timestamp: new Date().toISOString(),
        data: { fullText: finalResponse },
      });

      yield* this.emit({
        type: 'run_done',
        timestamp: new Date().toISOString(),
        data: {
          finalResponse,
          totalTokens,
          totalDurationMs: Date.now() - startTime,
          turnsUsed,
          toolCallsCount,
        },
      });
    }

    // ---- Step 5: Validate output via guardrails ----
    if (this.enableGuardrails && finalResponse) {
      const outputValidation = this.guardrails.validateOutput(
        finalResponse,
        this.config.guardrailRules,
      );

      for (const violation of outputValidation.violations) {
        yield* this.emit({
          type: 'guardrail_triggered',
          timestamp: new Date().toISOString(),
          data: {
            ruleId: violation.ruleId,
            ruleName: violation.ruleName,
            action: violation.action,
            detail: violation.detail,
            direction: 'output',
          },
        });
      }

      // If output is blocked, substitute a safe response
      if (!outputValidation.passed) {
        finalResponse =
          'The generated response was filtered by a safety check. Please try a different request.';
        this.logger.warn('Output guardrail blocked response');
      }
    }

    // ---- Step 6: Update memory with the interaction ----
    if (this.enableMemory && finalResponse) {
      // Store the assistant's response
      const assistantMessage: Message = {
        role: 'assistant',
        content: finalResponse,
      };
      session.messages.push(assistantMessage);

      try {
        await this.memoryManager.storeMessage(session.id, assistantMessage);
      } catch (error) {
        this.logger.warn('Failed to store assistant message in memory', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Store significant interactions in long-term memory
      if (
        this.config.memoryConfig.longTermEnabled &&
        this.shouldStoreInLongTermMemory(userMessage, finalResponse, toolCallsCount)
      ) {
        try {
          const userText = this.extractText(userMessage);
          await this.memoryManager.store({
            content: `User asked: ${userText.slice(0, 200)}\nAgent responded: ${finalResponse.slice(0, 500)}`,
            agentId: this.config.id,
            embedding: undefined,
            metadata: {
              source: 'conversation',
              sessionId: session.id,
              tags: ['interaction'],
              importance: this.calculateImportance(toolCallsCount, turnsUsed),
            },
          });
        } catch (error) {
          this.logger.warn('Failed to store interaction in long-term memory', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helper methods
  // -----------------------------------------------------------------------

  /**
   * Emit an event: yield it and call the onEvent callback if registered.
   */
  private *emit(event: AgentEvent): Generator<AgentEvent> {
    if (this.onEvent) {
      try {
        this.onEvent(event);
      } catch {
        // Event callback errors should not break the orchestration loop
      }
    }
    yield event;
  }

  /**
   * Determine whether an interaction is significant enough to store in
   * long-term memory.
   */
  private shouldStoreInLongTermMemory(
    userMessage: Message,
    response: string,
    toolCallsCount: number,
  ): boolean {
    // Store if: tools were used, response is substantial, or user message is long
    const userText = this.extractText(userMessage);
    if (toolCallsCount > 0) return true;
    if (response.length > 500) return true;
    if (userText.length > 200) return true;
    return false;
  }

  /**
   * Calculate an importance score (0-1) for a memory entry based on
   * interaction complexity.
   */
  private calculateImportance(toolCallsCount: number, turnsUsed: number): number {
    // More tools and more turns = higher importance
    const toolFactor = Math.min(toolCallsCount * 0.15, 0.45);
    const turnFactor = Math.min(turnsUsed * 0.1, 0.35);
    const base = 0.2;
    return Math.min(1.0, base + toolFactor + turnFactor);
  }

  /**
   * Extract plain text from a message.
   */
  private extractText(message: Message): string {
    if (typeof message.content === 'string') return message.content;
    return (message.content as ContentBlock[])
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------

  /** Get the agent configuration. */
  getConfig(): AgentConfig {
    return this.config;
  }

  /** Get the pattern registry. */
  getPatternRegistry(): PatternRegistry {
    return this.patternRegistry;
  }
}
