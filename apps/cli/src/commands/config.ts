/**
 * `agentbuilder config` command.
 *
 * Manages CLI and provider configuration. Supports getting, setting,
 * and listing configuration values, as well as managing provider
 * credentials.
 */

import { type Command } from 'commander';
import chalk from 'chalk';
import {
  setConfigByKey,
  getConfigByKey,
  getAllConfig,
  getProvidersList,
  getDataDir,
  getDatabasePath,
} from '@agentbuilder/storage';
import { runProviderSetup } from '../prompts/provider-setup.js';
import { formatTable } from '../formatters/table.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerConfigCommand(program: Command): void {
  const cmd = program
    .command('config')
    .description('Manage configuration settings');

  cmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      handleConfigSet(key, value);
    });

  cmd
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string) => {
      handleConfigGet(key);
    });

  cmd
    .command('list')
    .description('List all configuration settings')
    .action(() => {
      handleConfigList();
    });

  cmd
    .command('providers')
    .description('List configured providers and their status')
    .action(() => {
      handleConfigProviders();
    });

  cmd
    .command('setup-provider')
    .description('Interactive provider setup wizard')
    .action(async () => {
      try {
        await runProviderSetup();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  cmd
    .command('path')
    .description('Show configuration and data paths')
    .action(() => {
      handleConfigPath();
    });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleConfigSet(key: string, value: string): void {
  try {
    setConfigByKey(key, value);
    console.log(chalk.green('\u2713') + ` Set ${chalk.bold(key)} = ${chalk.dim(maskIfSensitive(key, value))}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error setting config: ${message}`));
  }
}

function handleConfigGet(key: string): void {
  const value = getConfigByKey(key);
  if (value === undefined) {
    console.log(chalk.dim(`${key}: (not set)`));
  } else {
    console.log(`${chalk.bold(key)}: ${String(value)}`);
  }
}

function handleConfigList(): void {
  const config = getAllConfig();
  const entries = Object.entries(config);

  if (entries.length === 0) {
    console.log(chalk.dim('No configuration values set.'));
    console.log(chalk.dim('Run `agentbuilder config set <key> <value>` to set a value.'));
    console.log(chalk.dim('Run `agentbuilder config setup-provider` to configure an LLM provider.'));
    return;
  }

  console.log('');
  console.log(chalk.bold('Configuration'));
  console.log('');

  const maxKeyLen = Math.max(...entries.map(([k]) => k.length));
  for (const [key, value] of entries) {
    console.log(`  ${chalk.cyan(key.padEnd(maxKeyLen + 2))} ${chalk.dim(String(value))}`);
  }
  console.log('');
}

function handleConfigProviders(): void {
  const providers = getProvidersList();

  if (providers.length === 0) {
    console.log('');
    console.log(chalk.dim('No providers configured.'));
    console.log('');
    console.log('Run one of these commands to set up a provider:');
    console.log(`  ${chalk.cyan('agentbuilder config setup-provider')}     — interactive wizard`);
    console.log(`  ${chalk.cyan('agentbuilder config set provider.openai.apiKey sk-...')}  — direct`);
    console.log('');
    return;
  }

  console.log('');
  console.log(chalk.bold('Configured Providers'));
  console.log('');

  const rows = providers.map((p) => [
    p.isDefault ? chalk.cyan(p.id + ' *') : p.id,
    p.hasApiKey ? chalk.green('\u2713 Configured') : chalk.red('\u2717 No API Key'),
    p.baseUrl ?? chalk.dim('default'),
    p.isDefault ? chalk.cyan('Yes') : '',
  ]);

  console.log(formatTable(
    ['Provider', 'API Key', 'Base URL', 'Default'],
    rows,
  ));

  console.log('');
  console.log(chalk.dim('* = default provider'));
  console.log(chalk.dim('Set a provider as default: agentbuilder config set provider.<id>.isDefault true'));
  console.log('');
}

function handleConfigPath(): void {
  console.log('');
  console.log(chalk.bold('Data Paths'));
  console.log(`  Data directory: ${chalk.dim(getDataDir())}`);
  console.log(`  Database file:  ${chalk.dim(getDatabasePath())}`);
  console.log('');
  console.log(chalk.dim('Override with environment variables:'));
  console.log(chalk.dim('  AGENTBUILDER_DATA_DIR — custom data directory'));
  console.log(chalk.dim('  AGENTBUILDER_DB_PATH  — custom database file path'));
  console.log('');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskIfSensitive(key: string, value: string): string {
  const sensitivePatterns = ['apiKey', 'apikey', 'secret', 'password', 'token'];
  const isHidden = sensitivePatterns.some((p) => key.toLowerCase().includes(p.toLowerCase()));

  if (isHidden && value.length > 8) {
    return value.slice(0, 4) + '...' + value.slice(-4);
  }
  return value;
}
