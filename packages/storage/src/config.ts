/**
 * Configuration management for AgentBuilder data storage.
 *
 * Provides cross-platform data directory resolution, database path
 * management, and provider configuration persistence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_NAME = 'agentbuilder';
const CONFIG_FILE = 'config.json';
const DB_FILE = 'agentbuilder.db';

// ---------------------------------------------------------------------------
// Data directory resolution
// ---------------------------------------------------------------------------

/**
 * Get the platform-specific data directory for AgentBuilder.
 *
 * - Windows: %APPDATA%/agentbuilder
 * - macOS:   ~/Library/Application Support/agentbuilder
 * - Linux:   $XDG_DATA_HOME/agentbuilder or ~/.local/share/agentbuilder
 *
 * Can be overridden with the AGENTBUILDER_DATA_DIR environment variable.
 */
export function getDataDir(): string {
  const envOverride = process.env['AGENTBUILDER_DATA_DIR'];
  if (envOverride) {
    return envOverride;
  }

  const os = platform();

  if (os === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, APP_NAME);
  }

  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_NAME);
  }

  // Linux / other Unix
  const xdgData = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');
  return join(xdgData, APP_NAME);
}

/**
 * Get the path to the SQLite database file.
 */
export function getDatabasePath(): string {
  const envOverride = process.env['AGENTBUILDER_DB_PATH'];
  if (envOverride) {
    return envOverride;
  }
  return join(getDataDir(), DB_FILE);
}

/**
 * Ensure the data directory exists, creating it recursively if needed.
 */
export function ensureDataDir(): void {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Configuration file management
// ---------------------------------------------------------------------------

interface StoredConfig {
  providers: Record<string, ProviderStoredConfig>;
  defaults: {
    providerId?: string;
    modelId?: string;
  };
  settings: Record<string, unknown>;
}

interface ProviderStoredConfig {
  apiKey?: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
  isDefault?: boolean;
}

function getConfigPath(): string {
  return join(getDataDir(), CONFIG_FILE);
}

function loadConfig(): StoredConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { providers: {}, defaults: {}, settings: {} };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as StoredConfig;
  } catch {
    return { providers: {}, defaults: {}, settings: {} };
  }
}

function saveConfig(config: StoredConfig): void {
  ensureDataDir();
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get stored provider configuration (API keys, base URLs, etc.).
 */
export function getProviderConfig(providerId: string): ProviderStoredConfig | null {
  const config = loadConfig();
  return config.providers[providerId] ?? null;
}

/**
 * Store provider configuration.
 */
export function setProviderConfig(providerId: string, providerConfig: ProviderStoredConfig): void {
  const config = loadConfig();
  config.providers[providerId] = providerConfig;

  // If this is set as default, clear default from others
  if (providerConfig.isDefault) {
    for (const [id, pc] of Object.entries(config.providers)) {
      if (id !== providerId) {
        pc.isDefault = false;
      }
    }
    config.defaults.providerId = providerId;
  }

  saveConfig(config);
}

/**
 * Get a general configuration setting.
 */
export function getSetting(key: string): unknown {
  const config = loadConfig();
  return config.settings[key];
}

/**
 * Set a general configuration setting.
 */
export function setSetting(key: string, value: unknown): void {
  const config = loadConfig();
  config.settings[key] = value;
  saveConfig(config);
}

/**
 * Get all configuration as a flat record.
 */
export function getAllConfig(): Record<string, unknown> {
  const config = loadConfig();
  const result: Record<string, unknown> = {};

  // Flatten providers
  for (const [id, pc] of Object.entries(config.providers)) {
    if (pc.apiKey) {
      result[`provider.${id}.apiKey`] = maskSecret(pc.apiKey);
    }
    if (pc.baseUrl) {
      result[`provider.${id}.baseUrl`] = pc.baseUrl;
    }
    if (pc.isDefault) {
      result[`provider.${id}.isDefault`] = true;
    }
  }

  // Defaults
  if (config.defaults.providerId) {
    result['defaults.provider'] = config.defaults.providerId;
  }
  if (config.defaults.modelId) {
    result['defaults.model'] = config.defaults.modelId;
  }

  // Settings
  for (const [key, value] of Object.entries(config.settings)) {
    result[`settings.${key}`] = value;
  }

  return result;
}

/**
 * Set a config value using dot-notation key paths.
 * Examples: "provider.openai.apiKey", "defaults.provider"
 */
export function setConfigByKey(key: string, value: string): void {
  const config = loadConfig();
  const parts = key.split('.');

  if (parts[0] === 'provider' && parts.length >= 3) {
    const providerId = parts[1]!;
    const field = parts[2]!;
    if (!config.providers[providerId]) {
      config.providers[providerId] = {};
    }
    const provider = config.providers[providerId]!;
    if (field === 'apiKey') {
      provider.apiKey = value;
    } else if (field === 'baseUrl') {
      provider.baseUrl = value;
    } else if (field === 'isDefault') {
      provider.isDefault = value === 'true';
      if (provider.isDefault) {
        for (const [id, pc] of Object.entries(config.providers)) {
          if (id !== providerId) {
            pc.isDefault = false;
          }
        }
        config.defaults.providerId = providerId;
      }
    }
  } else if (parts[0] === 'defaults' && parts.length === 2) {
    const field = parts[1]!;
    if (field === 'provider') {
      config.defaults.providerId = value;
    } else if (field === 'model') {
      config.defaults.modelId = value;
    }
  } else {
    config.settings[key] = value;
  }

  saveConfig(config);
}

/**
 * Get a config value by dot-notation key path.
 */
export function getConfigByKey(key: string): unknown {
  const config = loadConfig();
  const parts = key.split('.');

  if (parts[0] === 'provider' && parts.length >= 3) {
    const providerId = parts[1]!;
    const field = parts[2]!;
    const provider = config.providers[providerId];
    if (!provider) return undefined;
    if (field === 'apiKey') return provider.apiKey ? maskSecret(provider.apiKey) : undefined;
    if (field === 'baseUrl') return provider.baseUrl;
    if (field === 'isDefault') return provider.isDefault;
    return undefined;
  }

  if (parts[0] === 'defaults' && parts.length === 2) {
    const field = parts[1]!;
    if (field === 'provider') return config.defaults.providerId;
    if (field === 'model') return config.defaults.modelId;
    return undefined;
  }

  return config.settings[key];
}

/**
 * Get all configured providers with their status.
 */
export function getProvidersList(): Array<{
  id: string;
  hasApiKey: boolean;
  baseUrl?: string;
  isDefault: boolean;
}> {
  const config = loadConfig();
  return Object.entries(config.providers).map(([id, pc]) => ({
    id,
    hasApiKey: !!pc.apiKey,
    baseUrl: pc.baseUrl,
    isDefault: pc.isDefault ?? false,
  }));
}

/**
 * Get the raw API key for a provider (not masked).
 */
export function getProviderApiKey(providerId: string): string | undefined {
  const config = loadConfig();
  return config.providers[providerId]?.apiKey;
}

/**
 * Get the default provider and model IDs.
 */
export function getDefaults(): { providerId?: string; modelId?: string } {
  const config = loadConfig();
  return config.defaults;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskSecret(secret: string): string {
  if (secret.length <= 8) {
    return '********';
  }
  return secret.slice(0, 4) + '...' + secret.slice(-4);
}
