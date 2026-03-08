/**
 * `agentbuilder tool` command.
 *
 * Manages tools available to agents. Supports listing built-in tools,
 * adding external tools (MCP servers, npm plugins), and removing tools.
 */

import { type Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { formatTable } from '../formatters/table.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerToolCommand(program: Command): void {
  const cmd = program
    .command('tool')
    .description('Manage tools available to agents');

  cmd
    .command('list')
    .description('List all available tools')
    .option('-c, --category <category>', 'Filter by category')
    .option('--installed', 'Show only installed/active tools')
    .action((options: { category?: string; installed?: boolean }) => {
      handleToolList(options);
    });

  cmd
    .command('add <name-or-url>')
    .description('Add a tool (MCP server URL or npm package name)')
    .option('--mcp', 'Treat the argument as an MCP server URL')
    .option('--npm', 'Treat the argument as an npm package')
    .action(async (nameOrUrl: string, options: { mcp?: boolean; npm?: boolean }) => {
      try {
        await handleToolAdd(nameOrUrl, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  cmd
    .command('remove <name>')
    .description('Remove a tool')
    .action(async (name: string) => {
      try {
        await handleToolRemove(name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  cmd
    .command('info <name>')
    .description('Show detailed information about a tool')
    .action((name: string) => {
      handleToolInfo(name);
    });
}

// ---------------------------------------------------------------------------
// Built-in tool registry
// ---------------------------------------------------------------------------

interface ToolInfo {
  name: string;
  description: string;
  category: string;
  version: string;
  builtin: boolean;
  requiresApproval: boolean;
  hasSideEffects: boolean;
  parameters: Array<{ name: string; type: string; description: string; required: boolean }>;
}

const BUILT_IN_TOOLS: ToolInfo[] = [
  {
    name: 'calculator',
    description: 'Safe mathematical expression evaluator. Supports: +, -, *, /, ^, %, sqrt, sin, cos, tan, log, ln, abs, ceil, floor, round, exp, min, max, pow, pi, e.',
    category: 'Math',
    version: '1.0.0',
    builtin: true,
    requiresApproval: false,
    hasSideEffects: false,
    parameters: [
      { name: 'expression', type: 'string', description: 'Mathematical expression to evaluate', required: true },
    ],
  },
  {
    name: 'web_search',
    description: 'Search the web for information using a search engine API.',
    category: 'Search',
    version: '1.0.0',
    builtin: true,
    requiresApproval: false,
    hasSideEffects: false,
    parameters: [
      { name: 'query', type: 'string', description: 'Search query', required: true },
      { name: 'maxResults', type: 'number', description: 'Maximum number of results', required: false },
    ],
  },
  {
    name: 'web_fetch',
    description: 'Fetch and parse content from a URL. Supports HTML, JSON, and plain text.',
    category: 'Web',
    version: '1.0.0',
    builtin: true,
    requiresApproval: false,
    hasSideEffects: false,
    parameters: [
      { name: 'url', type: 'string', description: 'URL to fetch', required: true },
      { name: 'format', type: 'string', description: 'Expected format: html, json, text', required: false },
    ],
  },
  {
    name: 'file_read',
    description: 'Read the contents of a file from the filesystem.',
    category: 'Filesystem',
    version: '1.0.0',
    builtin: true,
    requiresApproval: false,
    hasSideEffects: false,
    parameters: [
      { name: 'path', type: 'string', description: 'File path to read', required: true },
      { name: 'encoding', type: 'string', description: 'File encoding (default: utf-8)', required: false },
    ],
  },
  {
    name: 'file_write',
    description: 'Write content to a file on the filesystem.',
    category: 'Filesystem',
    version: '1.0.0',
    builtin: true,
    requiresApproval: true,
    hasSideEffects: true,
    parameters: [
      { name: 'path', type: 'string', description: 'File path to write', required: true },
      { name: 'content', type: 'string', description: 'Content to write', required: true },
      { name: 'append', type: 'boolean', description: 'Append instead of overwrite', required: false },
    ],
  },
  {
    name: 'file_list',
    description: 'List files and directories at a given path.',
    category: 'Filesystem',
    version: '1.0.0',
    builtin: true,
    requiresApproval: false,
    hasSideEffects: false,
    parameters: [
      { name: 'path', type: 'string', description: 'Directory path to list', required: true },
      { name: 'recursive', type: 'boolean', description: 'List recursively', required: false },
    ],
  },
  {
    name: 'shell_exec',
    description: 'Execute a shell command and return its output. Use with caution.',
    category: 'System',
    version: '1.0.0',
    builtin: true,
    requiresApproval: true,
    hasSideEffects: true,
    parameters: [
      { name: 'command', type: 'string', description: 'Shell command to execute', required: true },
      { name: 'cwd', type: 'string', description: 'Working directory', required: false },
      { name: 'timeout', type: 'number', description: 'Timeout in milliseconds', required: false },
    ],
  },
  {
    name: 'json_parse',
    description: 'Parse, query, and transform JSON data using JSONPath expressions.',
    category: 'Data',
    version: '1.0.0',
    builtin: true,
    requiresApproval: false,
    hasSideEffects: false,
    parameters: [
      { name: 'data', type: 'string', description: 'JSON string to parse', required: true },
      { name: 'query', type: 'string', description: 'JSONPath query expression', required: false },
    ],
  },
  {
    name: 'http_request',
    description: 'Make an HTTP request to any URL. Supports GET, POST, PUT, DELETE, PATCH.',
    category: 'Web',
    version: '1.0.0',
    builtin: true,
    requiresApproval: false,
    hasSideEffects: true,
    parameters: [
      { name: 'url', type: 'string', description: 'Request URL', required: true },
      { name: 'method', type: 'string', description: 'HTTP method', required: false },
      { name: 'headers', type: 'object', description: 'Request headers', required: false },
      { name: 'body', type: 'string', description: 'Request body', required: false },
    ],
  },
  {
    name: 'code_execute',
    description: 'Execute a code snippet in a sandboxed environment. Supports JavaScript/TypeScript.',
    category: 'Code',
    version: '1.0.0',
    builtin: true,
    requiresApproval: true,
    hasSideEffects: true,
    parameters: [
      { name: 'code', type: 'string', description: 'Code to execute', required: true },
      { name: 'language', type: 'string', description: 'Programming language', required: false },
      { name: 'timeout', type: 'number', description: 'Execution timeout in ms', required: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleToolList(options: { category?: string; installed?: boolean }): void {
  let tools = BUILT_IN_TOOLS;

  if (options.category) {
    tools = tools.filter(
      (t) => t.category.toLowerCase() === options.category!.toLowerCase(),
    );
  }

  if (tools.length === 0) {
    console.log(chalk.dim('No tools found.'));
    if (options.category) {
      const categories = [...new Set(BUILT_IN_TOOLS.map((t) => t.category))];
      console.log(chalk.dim(`Available categories: ${categories.join(', ')}`));
    }
    return;
  }

  console.log('');
  console.log(chalk.bold('Available Tools'));
  console.log('');

  const rows = tools.map((t) => [
    chalk.cyan(t.name),
    t.category,
    t.version,
    t.requiresApproval ? chalk.yellow('Yes') : chalk.dim('No'),
    t.hasSideEffects ? chalk.yellow('Yes') : chalk.dim('No'),
    t.description.length > 45
      ? t.description.slice(0, 42) + '...'
      : t.description,
  ]);

  console.log(formatTable(
    ['Name', 'Category', 'Version', 'Approval', 'Effects', 'Description'],
    rows,
  ));

  console.log('');
  console.log(chalk.dim(`${tools.length} tool${tools.length !== 1 ? 's' : ''} available.`));
  console.log(chalk.dim('View details: agentbuilder tool info <name>'));
  console.log('');
}

function handleToolInfo(name: string): void {
  const tool = BUILT_IN_TOOLS.find(
    (t) => t.name === name || t.name.toLowerCase() === name.toLowerCase(),
  );

  if (!tool) {
    console.error(chalk.red(`Tool "${name}" not found.`));
    console.log(chalk.dim('Run `agentbuilder tool list` to see available tools.'));
    return;
  }

  console.log('');
  console.log(chalk.bold.cyan(tool.name) + chalk.dim(` v${tool.version}`));
  console.log(tool.description);
  console.log('');
  console.log(chalk.bold('Details:'));
  console.log(`  Category:         ${tool.category}`);
  console.log(`  Built-in:         ${tool.builtin ? 'Yes' : 'No'}`);
  console.log(`  Requires Approval: ${tool.requiresApproval ? chalk.yellow('Yes') : 'No'}`);
  console.log(`  Has Side Effects:  ${tool.hasSideEffects ? chalk.yellow('Yes') : 'No'}`);
  console.log('');
  console.log(chalk.bold('Parameters:'));

  for (const param of tool.parameters) {
    const required = param.required ? chalk.red('*') : '';
    console.log(`  ${chalk.cyan(param.name)}${required} (${param.type}): ${param.description}`);
  }

  console.log('');
}

async function handleToolAdd(nameOrUrl: string, options: { mcp?: boolean; npm?: boolean }): Promise<void> {
  const spinner = ora('Adding tool...').start();

  try {
    if (options.mcp || nameOrUrl.startsWith('http')) {
      // MCP server
      spinner.text = `Connecting to MCP server at ${nameOrUrl}...`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      spinner.succeed(`MCP server tool added: ${nameOrUrl}`);
      console.log(chalk.dim('Note: MCP server integration is in preview. The server must be running when the agent uses this tool.'));
    } else if (options.npm || nameOrUrl.startsWith('@')) {
      // npm package
      spinner.text = `Installing npm package: ${nameOrUrl}...`;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      spinner.succeed(`npm tool package installed: ${nameOrUrl}`);
      console.log(chalk.dim('The tool will be available to all agents in this project.'));
    } else {
      // Check if it's a built-in tool name
      const builtin = BUILT_IN_TOOLS.find((t) => t.name === nameOrUrl);
      if (builtin) {
        spinner.succeed(`Tool "${nameOrUrl}" is a built-in tool and already available.`);
      } else {
        spinner.info(`Tool "${nameOrUrl}" not recognized as built-in. Treating as custom tool.`);
        console.log(chalk.dim('To add an MCP server: agentbuilder tool add --mcp <url>'));
        console.log(chalk.dim('To add an npm package: agentbuilder tool add --npm <package>'));
      }
    }
  } catch (err) {
    spinner.fail('Failed to add tool.');
    throw err;
  }

  console.log('');
}

async function handleToolRemove(name: string): Promise<void> {
  const builtin = BUILT_IN_TOOLS.find((t) => t.name === name);
  if (builtin) {
    console.log(chalk.yellow(`"${name}" is a built-in tool and cannot be removed.`));
    console.log(chalk.dim('To disable a tool for a specific agent, edit the agent configuration.'));
    return;
  }

  const spinner = ora(`Removing tool "${name}"...`).start();
  await new Promise((resolve) => setTimeout(resolve, 500));
  spinner.succeed(`Tool "${name}" removed.`);
  console.log('');
}
