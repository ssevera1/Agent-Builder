/**
 * @agentbuilder/cli — main program setup.
 *
 * Registers all commands and exports the program factory for use
 * by the bin entry point and for programmatic usage in tests.
 */

import { Command } from 'commander';
import chalk from 'chalk';

import { registerInitCommand } from './commands/init.js';
import { registerCreateCommand } from './commands/create.js';
import { registerRunCommand } from './commands/run.js';
import { registerTestCommand } from './commands/test.js';
import { registerWorkflowCommand } from './commands/workflow.js';
import { registerTemplateCommand } from './commands/template.js';
import { registerToolCommand } from './commands/tool.js';
import { registerConfigCommand } from './commands/config.js';
import { registerServeCommand } from './commands/serve.js';

// ---------------------------------------------------------------------------
// Program factory
// ---------------------------------------------------------------------------

/**
 * Create and configure the CLI program with all commands registered.
 *
 * @returns A configured Commander program instance ready to parse args.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('agentbuilder')
    .description(
      chalk.bold('AI Agent Builder') +
      ' — Design, build, and deploy AI agents from the command line',
    )
    .version('0.1.0', '-v, --version')
    .configureHelp({
      sortSubcommands: true,
      sortOptions: true,
    });

  // ── Register all commands ──────────────────────────────────────────────

  registerInitCommand(program);
  registerCreateCommand(program);
  registerRunCommand(program);
  registerTestCommand(program);
  registerWorkflowCommand(program);
  registerTemplateCommand(program);
  registerToolCommand(program);
  registerConfigCommand(program);
  registerServeCommand(program);

  // ── Global error handling ──────────────────────────────────────────────

  program.exitOverride((err) => {
    if (err.code === 'commander.help' || err.code === 'commander.version') {
      // These are not errors — just exit cleanly
      process.exit(0);
    }
  });

  // Add a helpful message when no command is provided
  program.addHelpText('after', () => {
    return `
${chalk.bold('Quick Start:')}
  ${chalk.cyan('agentbuilder init')}                          Initialize a project
  ${chalk.cyan('agentbuilder create')} ${chalk.dim('"a research assistant"')}   Create an agent with AI
  ${chalk.cyan('agentbuilder template apply research-assistant')}  Create from template
  ${chalk.cyan('agentbuilder run')} ${chalk.dim('<agent-name>')}              Chat with an agent

${chalk.bold('Examples:')}
  ${chalk.dim('$ agentbuilder create "a code reviewer that checks for security issues"')}
  ${chalk.dim('$ agentbuilder create --interactive')}
  ${chalk.dim('$ agentbuilder run my-agent --provider openai --model gpt-4o')}
  ${chalk.dim('$ agentbuilder test my-agent --report json --save')}
  ${chalk.dim('$ agentbuilder workflow run pipeline.json --input \'{"url":"..."}\'')}`;
  });

  return program;
}

// ---------------------------------------------------------------------------
// Re-exports for programmatic use
// ---------------------------------------------------------------------------

export { StreamingRenderer } from './formatters/streaming.js';
export { formatTable, formatCompactTable } from './formatters/table.js';
export { formatTree, buildWorkflowTree } from './formatters/tree.js';
