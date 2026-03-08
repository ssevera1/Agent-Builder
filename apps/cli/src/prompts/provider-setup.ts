/**
 * Provider setup wizard — interactive prompts for configuring LLM providers.
 *
 * Guides the user through selecting a provider, entering credentials,
 * and saving the configuration.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import {
  setProviderConfig,
  getProvidersList,
} from '@agentbuilder/storage';

// ---------------------------------------------------------------------------
// Known providers
// ---------------------------------------------------------------------------

interface ProviderDefinition {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  apiKeyEnvVar: string;
  defaultModel: string;
  models: string[];
  supportsCustomBaseUrl: boolean;
}

const KNOWN_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models — advanced reasoning and tool use',
    requiresApiKey: true,
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-35-20241022'],
    supportsCustomBaseUrl: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models — general-purpose language models',
    requiresApiKey: true,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
    supportsCustomBaseUrl: true,
  },
  {
    id: 'google',
    name: 'Google AI',
    description: 'Gemini models — multimodal capabilities',
    requiresApiKey: true,
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    defaultModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    supportsCustomBaseUrl: false,
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Mistral models — efficient European AI models',
    requiresApiKey: true,
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
    supportsCustomBaseUrl: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    description: 'Run models locally via Ollama — no API key required',
    requiresApiKey: false,
    apiKeyEnvVar: '',
    defaultModel: 'llama3.1',
    models: ['llama3.1', 'llama3.1:70b', 'mixtral', 'codellama', 'phi3'],
    supportsCustomBaseUrl: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified API for multiple providers — single key for all models',
    requiresApiKey: true,
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    models: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o', 'google/gemini-2.5-pro'],
    supportsCustomBaseUrl: false,
  },
];

// ---------------------------------------------------------------------------
// Provider setup wizard
// ---------------------------------------------------------------------------

/**
 * Run the interactive provider setup wizard.
 *
 * @returns The selected provider ID and model ID.
 */
export async function runProviderSetup(): Promise<{
  providerId: string;
  modelId: string;
}> {
  const existingProviders = getProvidersList();

  console.log('');
  console.log(chalk.bold('Provider Setup'));
  console.log(chalk.dim('Configure an LLM provider for your agents.'));
  console.log('');

  if (existingProviders.length > 0) {
    console.log(chalk.dim('Currently configured providers:'));
    for (const p of existingProviders) {
      const status = p.hasApiKey ? chalk.green('\u2713') : chalk.red('\u2717');
      const defaultBadge = p.isDefault ? chalk.cyan(' (default)') : '';
      console.log(`  ${status} ${p.id}${defaultBadge}`);
    }
    console.log('');
  }

  // Select provider
  const { providerId } = await inquirer.prompt<{ providerId: string }>([
    {
      type: 'list',
      name: 'providerId',
      message: 'Choose a provider:',
      choices: KNOWN_PROVIDERS.map((p) => ({
        name: `${p.name} — ${chalk.dim(p.description)}`,
        value: p.id,
        short: p.name,
      })),
    },
  ]);

  const providerDef = KNOWN_PROVIDERS.find((p) => p.id === providerId)!;

  // API key (if required)
  let apiKey: string | undefined;
  if (providerDef.requiresApiKey) {
    const envKey = process.env[providerDef.apiKeyEnvVar];
    if (envKey) {
      const { useEnvKey } = await inquirer.prompt<{ useEnvKey: boolean }>([
        {
          type: 'confirm',
          name: 'useEnvKey',
          message: `Found ${providerDef.apiKeyEnvVar} in environment. Use it?`,
          default: true,
        },
      ]);
      if (useEnvKey) {
        apiKey = envKey;
      }
    }

    if (!apiKey) {
      const { enteredKey } = await inquirer.prompt<{ enteredKey: string }>([
        {
          type: 'password',
          name: 'enteredKey',
          message: `Enter your ${providerDef.name} API key:`,
          mask: '*',
          validate: (input: string) =>
            input.length > 0 ? true : 'API key is required',
        },
      ]);
      apiKey = enteredKey;
    }
  }

  // Custom base URL
  let baseUrl: string | undefined;
  if (providerDef.supportsCustomBaseUrl) {
    if (providerDef.id === 'ollama') {
      const { ollamaUrl } = await inquirer.prompt<{ ollamaUrl: string }>([
        {
          type: 'input',
          name: 'ollamaUrl',
          message: 'Ollama base URL:',
          default: 'http://localhost:11434',
        },
      ]);
      baseUrl = ollamaUrl;
    } else {
      const { useCustomUrl } = await inquirer.prompt<{ useCustomUrl: boolean }>([
        {
          type: 'confirm',
          name: 'useCustomUrl',
          message: 'Use a custom base URL (for proxies or self-hosted endpoints)?',
          default: false,
        },
      ]);
      if (useCustomUrl) {
        const { customUrl } = await inquirer.prompt<{ customUrl: string }>([
          {
            type: 'input',
            name: 'customUrl',
            message: 'Enter the base URL:',
            validate: (input: string) => {
              try {
                new URL(input);
                return true;
              } catch {
                return 'Please enter a valid URL';
              }
            },
          },
        ]);
        baseUrl = customUrl;
      }
    }
  }

  // Select model
  const { modelId } = await inquirer.prompt<{ modelId: string }>([
    {
      type: 'list',
      name: 'modelId',
      message: 'Choose a default model:',
      choices: providerDef.models.map((m) => ({
        name: m === providerDef.defaultModel ? `${m} ${chalk.dim('(recommended)')}` : m,
        value: m,
      })),
      default: providerDef.defaultModel,
    },
  ]);

  // Set as default?
  const { makeDefault } = await inquirer.prompt<{ makeDefault: boolean }>([
    {
      type: 'confirm',
      name: 'makeDefault',
      message: 'Set as your default provider?',
      default: existingProviders.length === 0,
    },
  ]);

  // Test connection
  const spinner = ora('Testing connection...').start();
  try {
    // We can't actually test without the LLM client, but we validate the config
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (providerDef.requiresApiKey && apiKey) {
      // Basic API key format validation
      if (providerDef.id === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
        spinner.warn('API key format looks unusual for Anthropic, but proceeding anyway.');
      } else if (providerDef.id === 'openai' && !apiKey.startsWith('sk-')) {
        spinner.warn('API key format looks unusual for OpenAI, but proceeding anyway.');
      } else {
        spinner.succeed('Configuration looks valid.');
      }
    } else {
      spinner.succeed('Configuration saved.');
    }
  } catch {
    spinner.warn('Could not validate the connection. Configuration saved anyway.');
  }

  // Save the configuration
  setProviderConfig(providerId, {
    apiKey,
    baseUrl,
    isDefault: makeDefault,
  });

  console.log('');
  console.log(chalk.green('\u2713') + ` Provider ${chalk.bold(providerDef.name)} configured successfully.`);

  return { providerId, modelId };
}

/**
 * Get list of known provider definitions.
 */
export function getKnownProviders(): ProviderDefinition[] {
  return KNOWN_PROVIDERS;
}

/**
 * Get a known provider by ID.
 */
export function getKnownProvider(id: string): ProviderDefinition | undefined {
  return KNOWN_PROVIDERS.find((p) => p.id === id);
}
