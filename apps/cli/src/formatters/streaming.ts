/**
 * StreamingRenderer — handles real-time CLI output for agent interactions.
 *
 * Manages spinners for tool calls, streaming text output, and provides
 * a polished interactive experience during agent execution.
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallDisplay {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  spinner: Ora;
}

// ---------------------------------------------------------------------------
// StreamingRenderer
// ---------------------------------------------------------------------------

export class StreamingRenderer {
  private currentText = '';
  private activeToolCalls = new Map<string, ToolCallDisplay>();
  private thinkingSpinner: Ora | null = null;
  private isFirstChunk = true;

  /**
   * Show a "thinking" indicator while the agent is processing.
   */
  startThinking(): void {
    this.thinkingSpinner = ora({
      text: chalk.dim('Agent is thinking...'),
      spinner: 'dots',
      color: 'cyan',
    }).start();
  }

  /**
   * Stop the thinking indicator.
   */
  stopThinking(): void {
    if (this.thinkingSpinner) {
      this.thinkingSpinner.stop();
      this.thinkingSpinner = null;
    }
  }

  /**
   * Handle a text chunk arriving from the agent stream.
   * Writes directly to stdout for real-time output.
   */
  onTextDelta(delta: string): void {
    this.stopThinking();

    if (this.isFirstChunk) {
      // Print a header before the first text output
      process.stdout.write(chalk.cyan('\nAssistant: '));
      this.isFirstChunk = false;
    }

    process.stdout.write(delta);
    this.currentText += delta;
  }

  /**
   * Signal that text generation is complete.
   */
  onTextDone(fullText: string): void {
    this.currentText = fullText;
    if (!this.isFirstChunk) {
      process.stdout.write('\n');
    }
    this.isFirstChunk = true;
  }

  /**
   * Show a tool call starting with a spinner.
   */
  onToolCallStart(toolCallId: string, toolName: string, parameters: Record<string, unknown>): void {
    this.stopThinking();

    // Compact parameter display
    const paramStr = Object.entries(parameters)
      .map(([k, v]) => {
        const valStr = typeof v === 'string'
          ? (v.length > 40 ? v.slice(0, 37) + '...' : v)
          : JSON.stringify(v);
        return `${k}=${valStr}`;
      })
      .join(', ');

    const spinner = ora({
      text: chalk.yellow(`${toolName}`) + chalk.dim(` (${paramStr})`),
      spinner: 'dots',
      color: 'yellow',
      prefixText: chalk.dim('  tool'),
    }).start();

    this.activeToolCalls.set(toolCallId, {
      id: toolCallId,
      name: toolName,
      parameters,
      spinner,
    });
  }

  /**
   * Show that a tool call completed successfully.
   */
  onToolCallDone(toolCallId: string, durationMs: number): void {
    const call = this.activeToolCalls.get(toolCallId);
    if (call) {
      call.spinner.succeed(
        chalk.green(call.name) +
        chalk.dim(` completed in ${durationMs}ms`),
      );
      this.activeToolCalls.delete(toolCallId);
    }
  }

  /**
   * Show a tool call result, including errors.
   */
  onToolResult(toolCallId: string, output: string, error?: string, success = true): void {
    const call = this.activeToolCalls.get(toolCallId);
    if (call) {
      if (success) {
        call.spinner.succeed(
          chalk.green(call.name) + chalk.dim(': ') + truncateOutput(output),
        );
      } else {
        call.spinner.fail(
          chalk.red(call.name) + chalk.dim(': ') + chalk.red(error ?? 'Failed'),
        );
      }
      this.activeToolCalls.delete(toolCallId);
    } else if (!success) {
      console.log(chalk.red(`  tool error: ${error}`));
    }
  }

  /**
   * Display a guardrail violation warning.
   */
  onGuardrailTriggered(ruleName: string, action: string, detail: string): void {
    const icon = action === 'block' ? chalk.red('\u26a0') : chalk.yellow('\u26a0');
    console.log(`${icon} ${chalk.bold(ruleName)}: ${detail} [${action}]`);
  }

  /**
   * Display memory retrieval information.
   */
  onMemoryRetrieved(entries: Array<{ content: string; score: number }>, query: string): void {
    if (entries.length === 0) return;
    console.log(chalk.dim(`  memory: Found ${entries.length} relevant memories for "${truncateOutput(query, 30)}"`));
  }

  /**
   * Display plan creation.
   */
  onPlanCreated(steps: Array<{ description: string }>): void {
    console.log(chalk.cyan('\nPlan:'));
    for (let i = 0; i < steps.length; i++) {
      console.log(chalk.dim(`  ${i + 1}. ${steps[i]!.description}`));
    }
    console.log('');
  }

  /**
   * Display a plan step starting.
   */
  onPlanStepStart(stepIndex: number, description: string): void {
    console.log(chalk.yellow(`  Step ${stepIndex + 1}: ${description}...`));
  }

  /**
   * Display a plan step completing.
   */
  onPlanStepDone(stepIndex: number, description: string, status: 'done' | 'failed'): void {
    const icon = status === 'done' ? chalk.green('\u2713') : chalk.red('\u2717');
    console.log(`  ${icon} Step ${stepIndex + 1}: ${description}`);
  }

  /**
   * Display run completion summary.
   */
  onRunDone(totalDurationMs: number, turnsUsed: number, toolCallsCount: number): void {
    console.log('');
    console.log(
      chalk.dim(
        `[${turnsUsed} turn${turnsUsed !== 1 ? 's' : ''}, ` +
        `${toolCallsCount} tool call${toolCallsCount !== 1 ? 's' : ''}, ` +
        `${(totalDurationMs / 1000).toFixed(1)}s]`,
      ),
    );
  }

  /**
   * Display an error.
   */
  onError(code: string, message: string): void {
    this.stopThinking();
    this.stopAllToolCalls();
    console.error(chalk.red(`\nError [${code}]: ${message}`));
  }

  /**
   * Clean up any active spinners.
   */
  cleanup(): void {
    this.stopThinking();
    this.stopAllToolCalls();
  }

  /**
   * Stop all active tool call spinners.
   */
  private stopAllToolCalls(): void {
    for (const [, call] of this.activeToolCalls) {
      call.spinner.stop();
    }
    this.activeToolCalls.clear();
  }

  /**
   * Get the accumulated text from the current response.
   */
  getCurrentText(): string {
    return this.currentText;
  }

  /**
   * Reset the renderer state for a new interaction.
   */
  reset(): void {
    this.currentText = '';
    this.isFirstChunk = true;
    this.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateOutput(text: string, maxLen = 80): string {
  const singleLine = text.replace(/\n/g, ' ').trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen - 3) + '...';
}
