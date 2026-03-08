/**
 * Plan-and-Execute Pattern
 *
 * A two-phase approach:
 * 1. **Plan**: The LLM creates a structured plan (list of steps) to
 *    accomplish the user's request.
 * 2. **Execute**: Each step is executed sequentially, using tools as needed.
 * 3. **Re-plan** (optional): After each step, the LLM can revise the plan
 *    based on what was learned.
 *
 * Best for complex, multi-step tasks where upfront planning improves outcomes
 * (e.g., coding tasks, research workflows, data pipelines).
 */

import type {
  AgentContext,
  AgentEvent,
  AgentPattern,
  AgentServices,
  ContentBlock,
  LLMRequest,
  LLMToolDefinition,
  Message,
  PlanStep,
  TextBlock,
  TokenUsage,
  ToolCall,
} from './pattern.interface.js';
import { ResponseParser } from '../response-parser.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLANNING_PROMPT = `You are in PLANNING mode. Given the user's request, create a clear, step-by-step plan to accomplish it.

Rules:
- Each step should be a single, actionable task.
- Steps should be in logical order.
- Include steps for using tools where needed.
- Keep the plan concise (typically 3-8 steps).
- If the request is simple enough, a 1-2 step plan is fine.

Respond with ONLY a JSON array of step descriptions. Example:
["Search for relevant information", "Analyze the search results", "Write a summary"]

Do NOT include any other text before or after the JSON array.`;

const EXECUTION_PROMPT_TEMPLATE = `You are now EXECUTING step {{stepNumber}} of {{totalSteps}} in your plan.

## Current Plan:
{{planSummary}}

## Current Step:
Step {{stepNumber}}: {{stepDescription}}

{{#if previousResults}}
## Results from Previous Steps:
{{previousResults}}
{{/if}}

Execute this step. Use tools if needed. Provide a clear result for this step.`;

const REPLAN_PROMPT_TEMPLATE = `Based on the results so far, do you need to revise the remaining plan?

## Original Plan:
{{planSummary}}

## Completed Steps and Results:
{{completedSteps}}

## Remaining Steps:
{{remainingSteps}}

If the plan is still good, respond with: {"replan": false}
If the plan needs changes, respond with: {"replan": true, "steps": ["new step 1", "new step 2", ...]}

Respond with ONLY the JSON object.`;

// ---------------------------------------------------------------------------
// Plan-and-Execute Pattern
// ---------------------------------------------------------------------------

export class PlanAndExecutePattern implements AgentPattern {
  readonly patternId = 'plan-and-execute';
  readonly displayName = 'Plan and Execute';
  readonly description =
    'Creates a structured plan first, then executes each step sequentially. ' +
    'Best for complex tasks that benefit from upfront planning.';

  private readonly parser = new ResponseParser();

  async *execute(
    input: Message,
    context: AgentContext,
    services: AgentServices,
  ): AsyncIterable<AgentEvent> {
    const { config, session } = context;
    const maxTurns = config.maxTurns || 10;
    const startTime = Date.now();
    let totalToolCalls = 0;
    const cumulativeUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    const toolDefs = services.tools.getDefinitions(config.tools);
    const builtPrompt = services.promptBuilder.build(config, context, toolDefs);

    // ---- Phase 1: Planning ----
    services.logger.info('Plan-and-Execute: entering planning phase');

    let steps: PlanStep[];
    try {
      steps = await this.createPlan(input, builtPrompt.systemMessage, config, services, cumulativeUsage);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      yield this.createEvent('error', {
        code: 'PLANNING_FAILED',
        message: `Failed to create plan: ${errMsg}`,
        recoverable: false,
      });
      yield this.createEvent('run_done', {
        finalResponse: `I was unable to create a plan for this request: ${errMsg}`,
        totalTokens: cumulativeUsage,
        totalDurationMs: Date.now() - startTime,
        turnsUsed: 1,
        toolCallsCount: 0,
      });
      return;
    }

    yield this.createEvent('plan_created', { steps });

    // ---- Phase 2: Execution ----
    services.logger.info('Plan-and-Execute: entering execution phase', {
      stepCount: steps.length,
    });

    const stepResults: Array<{ index: number; description: string; result: string }> = [];
    let turnsUsed = 1; // Planning was turn 1
    let finalText = '';

    for (let i = 0; i < steps.length && turnsUsed < maxTurns; i++) {
      const step = steps[i]!;
      turnsUsed++;

      step.status = 'running';
      yield this.createEvent('plan_step_start', {
        stepIndex: step.index,
        description: step.description,
      });

      // Execute this step
      let stepResult: string;
      try {
        const { text, toolCallCount, usage } = await this.executeStep(
          step,
          steps,
          stepResults,
          input,
          builtPrompt,
          config,
          session,
          services,
        );
        stepResult = text;
        totalToolCalls += toolCallCount;
        cumulativeUsage.promptTokens += usage.promptTokens;
        cumulativeUsage.completionTokens += usage.completionTokens;
        cumulativeUsage.totalTokens += usage.totalTokens;
        step.status = 'done';
        step.result = stepResult;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        stepResult = `Step failed: ${errMsg}`;
        step.status = 'failed';
        step.result = stepResult;
        services.logger.warn('Plan step failed', {
          stepIndex: step.index,
          error: errMsg,
        });
      }

      stepResults.push({
        index: step.index,
        description: step.description,
        result: stepResult,
      });

      yield this.createEvent('plan_step_done', {
        stepIndex: step.index,
        description: step.description,
        result: stepResult,
        status: step.status as 'done' | 'failed',
      });

      // Emit the step result as text deltas for UI
      yield this.createEvent('text_delta', {
        delta: `\n**Step ${step.index + 1}**: ${step.description}\n${stepResult}\n`,
      });

      // ---- Optional re-planning after each step (except the last) ----
      if (i < steps.length - 1 && step.status === 'done' && turnsUsed < maxTurns - 1) {
        const replanResult = await this.checkReplan(
          steps,
          stepResults,
          builtPrompt.systemMessage,
          config,
          services,
          cumulativeUsage,
        );
        if (replanResult) {
          // Replace remaining steps with the new plan
          const completedCount = i + 1;
          steps = [
            ...steps.slice(0, completedCount),
            ...replanResult.map((desc, idx) => ({
              index: completedCount + idx,
              description: desc,
              status: 'pending' as const,
            })),
          ];
          yield this.createEvent('plan_created', { steps });
          services.logger.info('Plan revised', {
            newStepCount: steps.length,
          });
        }
      }
    }

    // ---- Phase 3: Final synthesis ----
    finalText = this.synthesizeResults(stepResults);

    yield this.createEvent('text_done', { fullText: finalText });
    yield this.createEvent('run_done', {
      finalResponse: finalText,
      totalTokens: cumulativeUsage,
      totalDurationMs: Date.now() - startTime,
      turnsUsed,
      toolCallsCount: totalToolCalls,
    });
  }

  // -----------------------------------------------------------------------
  // Planning
  // -----------------------------------------------------------------------

  /**
   * Ask the LLM to create a step-by-step plan.
   */
  private async createPlan(
    input: Message,
    systemMessage: Message,
    config: AgentContext['config'],
    services: AgentServices,
    cumulativeUsage: TokenUsage,
  ): Promise<PlanStep[]> {
    const planningRequest: LLMRequest = {
      model: config.provider.modelId,
      messages: [
        systemMessage,
        { role: 'system', content: PLANNING_PROMPT },
        input,
      ],
      temperature: Math.max(0, config.temperature - 0.1), // Slightly lower for planning
      maxTokens: config.maxTokens,
    };

    const response = await services.llm.complete(planningRequest);
    cumulativeUsage.promptTokens += response.usage.promptTokens;
    cumulativeUsage.completionTokens += response.usage.completionTokens;
    cumulativeUsage.totalTokens += response.usage.totalTokens;

    // Extract the plan from the response
    const text = response.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return this.parsePlan(text);
  }

  /**
   * Parse a plan from the LLM's text response.
   */
  private parsePlan(text: string): PlanStep[] {
    // Try to extract JSON array from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Fall back: split by numbered lines
      return this.parsePlanFromText(text);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as string[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return this.parsePlanFromText(text);
      }
      return parsed.map((desc, i) => ({
        index: i,
        description: String(desc),
        status: 'pending' as const,
      }));
    } catch {
      return this.parsePlanFromText(text);
    }
  }

  /**
   * Fallback: parse a plan from numbered text lines.
   */
  private parsePlanFromText(text: string): PlanStep[] {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const steps: PlanStep[] = [];
    for (const line of lines) {
      // Match patterns like "1. Do something" or "- Do something" or "Step 1: Do something"
      const match = line.match(/^(?:\d+[\.\)]\s*|[-*]\s*|Step\s+\d+:\s*)(.*)/i);
      if (match && match[1]) {
        steps.push({
          index: steps.length,
          description: match[1].trim(),
          status: 'pending',
        });
      }
    }

    // If no structured steps found, treat the whole text as a single step
    if (steps.length === 0) {
      steps.push({
        index: 0,
        description: text.trim().slice(0, 200),
        status: 'pending',
      });
    }

    return steps;
  }

  // -----------------------------------------------------------------------
  // Step Execution
  // -----------------------------------------------------------------------

  /**
   * Execute a single plan step, potentially using tools.
   */
  private async executeStep(
    step: PlanStep,
    allSteps: PlanStep[],
    previousResults: Array<{ index: number; description: string; result: string }>,
    userInput: Message,
    builtPrompt: { systemMessage: Message; tools: LLMToolDefinition[] },
    config: AgentContext['config'],
    session: { id: string },
    services: AgentServices,
  ): Promise<{ text: string; toolCallCount: number; usage: TokenUsage }> {
    // Build the plan summary
    const planSummary = allSteps
      .map((s) => `${s.index + 1}. [${s.status}] ${s.description}`)
      .join('\n');

    const previousResultsText =
      previousResults.length > 0
        ? previousResults
            .map(
              (r) => `Step ${r.index + 1} (${r.description}): ${r.result}`,
            )
            .join('\n\n')
        : '';

    const executionPrompt = EXECUTION_PROMPT_TEMPLATE
      .replace('{{stepNumber}}', String(step.index + 1))
      .replace('{{stepNumber}}', String(step.index + 1))
      .replace(/\{\{totalSteps\}\}/g, String(allSteps.length))
      .replace('{{planSummary}}', planSummary)
      .replace('{{stepDescription}}', step.description)
      .replace('{{#if previousResults}}', previousResultsText ? '' : '<!--')
      .replace('{{previousResults}}', previousResultsText)
      .replace('{{/if}}', previousResultsText ? '' : '-->');

    const messages: Message[] = [
      userInput,
      { role: 'system', content: executionPrompt },
    ];

    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let toolCallCount = 0;
    let iterations = 0;
    const maxStepIterations = 3; // Max tool-use iterations per step

    while (iterations < maxStepIterations) {
      iterations++;

      const request: LLMRequest = {
        model: config.provider.modelId,
        messages: [builtPrompt.systemMessage, ...messages],
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        tools: builtPrompt.tools.length > 0 ? builtPrompt.tools : undefined,
        toolChoice: builtPrompt.tools.length > 0 ? 'auto' : undefined,
      };

      const response = await services.llm.complete(request);
      usage.promptTokens += response.usage.promptTokens;
      usage.completionTokens += response.usage.completionTokens;
      usage.totalTokens += response.usage.totalTokens;

      const parsed = this.parser.parseComplete(response);

      // If there are tool calls, execute them and continue
      if (parsed.toolCalls.length > 0) {
        // Add assistant message with tool calls
        const assistantContent: ContentBlock[] = [];
        if (parsed.text) {
          assistantContent.push({ type: 'text', text: parsed.text });
        }
        for (const tc of parsed.toolCalls) {
          assistantContent.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.parameters,
          });
        }
        messages.push({ role: 'assistant', content: assistantContent });

        // Execute tools
        for (const tc of parsed.toolCalls) {
          toolCallCount++;
          const result = await services.tools.dispatch(tc, {
            agentId: config.id,
            sessionId: session.id,
          });

          messages.push({
            role: 'tool',
            content: [
              {
                type: 'tool_result',
                toolUseId: tc.id,
                content: [
                  {
                    type: 'text',
                    text: result.success
                      ? result.output
                      : `Error: ${result.error ?? 'Unknown error'}`,
                  },
                ],
                isError: !result.success,
              },
            ],
            toolCallId: tc.id,
          });
        }
        continue;
      }

      // No tool calls — this is the step's final result
      return { text: parsed.text, toolCallCount, usage };
    }

    // Exceeded step iterations
    return {
      text: 'Step execution reached maximum iterations.',
      toolCallCount,
      usage,
    };
  }

  // -----------------------------------------------------------------------
  // Re-planning
  // -----------------------------------------------------------------------

  /**
   * Check if the plan should be revised based on results so far.
   */
  private async checkReplan(
    steps: PlanStep[],
    completedResults: Array<{ index: number; description: string; result: string }>,
    systemMessage: Message,
    config: AgentContext['config'],
    services: AgentServices,
    cumulativeUsage: TokenUsage,
  ): Promise<string[] | null> {
    const completedSteps = completedResults
      .map((r) => `Step ${r.index + 1} (${r.description}): ${r.result}`)
      .join('\n\n');

    const remainingSteps = steps
      .filter((s) => s.status === 'pending')
      .map((s) => `${s.index + 1}. ${s.description}`)
      .join('\n');

    const planSummary = steps
      .map((s) => `${s.index + 1}. [${s.status}] ${s.description}`)
      .join('\n');

    const replanPrompt = REPLAN_PROMPT_TEMPLATE
      .replace('{{planSummary}}', planSummary)
      .replace('{{completedSteps}}', completedSteps)
      .replace('{{remainingSteps}}', remainingSteps);

    try {
      const request: LLMRequest = {
        model: config.provider.modelId,
        messages: [
          systemMessage,
          { role: 'user', content: replanPrompt },
        ],
        temperature: 0,
        maxTokens: 1024,
      };

      const response = await services.llm.complete(request);
      cumulativeUsage.promptTokens += response.usage.promptTokens;
      cumulativeUsage.completionTokens += response.usage.completionTokens;
      cumulativeUsage.totalTokens += response.usage.totalTokens;

      const text = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as {
        replan: boolean;
        steps?: string[];
      };

      if (parsed.replan && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        return parsed.steps.map(String);
      }
    } catch {
      // Re-planning is optional — failures are silently ignored
      services.logger.debug('Re-planning check failed, continuing with original plan');
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Result synthesis
  // -----------------------------------------------------------------------

  /**
   * Combine all step results into a final summary.
   */
  private synthesizeResults(
    results: Array<{ index: number; description: string; result: string }>,
  ): string {
    if (results.length === 0) {
      return 'No steps were executed.';
    }

    if (results.length === 1) {
      return results[0]!.result;
    }

    const parts = results.map(
      (r) => `**Step ${r.index + 1}** (${r.description}):\n${r.result}`,
    );

    return parts.join('\n\n');
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private createEvent(type: AgentEvent['type'], data: AgentEvent['data']): AgentEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
  }
}
