/**
 * `agentbuilder serve` command.
 *
 * Placeholder for a future web UI server. Currently prints a
 * "coming soon" message with instructions to use the CLI.
 */

import { type Command } from 'commander';
import chalk from 'chalk';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the AgentBuilder web UI (coming soon)')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .option('-h, --host <host>', 'Host to bind to', 'localhost')
    .option('--open', 'Open the browser automatically')
    .action((options: { port: string; host: string; open?: boolean }) => {
      handleServe(options);
    });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function handleServe(options: { port: string; host: string; open?: boolean }): void {
  console.log('');
  console.log(chalk.bold.cyan('AgentBuilder Web UI'));
  console.log('');
  console.log(chalk.yellow('The web interface is coming soon.'));
  console.log('');
  console.log('In the meantime, use these CLI commands:');
  console.log('');
  console.log(`  ${chalk.cyan('agentbuilder create')} ${chalk.dim('<description>')}  — Create an agent with AI`);
  console.log(`  ${chalk.cyan('agentbuilder run')} ${chalk.dim('<agent-name>')}      — Chat with an agent`);
  console.log(`  ${chalk.cyan('agentbuilder test')} ${chalk.dim('<agent-name>')}     — Run evaluation tests`);
  console.log(`  ${chalk.cyan('agentbuilder workflow run')} ${chalk.dim('<file>')}   — Execute a workflow`);
  console.log(`  ${chalk.cyan('agentbuilder template list')}              — Browse templates`);
  console.log(`  ${chalk.cyan('agentbuilder tool list')}                  — See available tools`);
  console.log(`  ${chalk.cyan('agentbuilder config providers')}           — Manage providers`);
  console.log('');
  console.log(chalk.dim(`Planned: Web UI will be available at http://${options.host}:${options.port}`));
  console.log(chalk.dim('Follow the project for updates on the web UI release.'));
  console.log('');
}
