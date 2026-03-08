/**
 * Cross-platform path utilities for determining standard directories
 * and ensuring they exist.
 */

import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';

/** Application name used for directory naming. */
const APP_NAME = 'agentbuilder';

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

type Platform = 'darwin' | 'win32' | 'linux';

function getPlatform(): Platform {
  const p = platform();
  if (p === 'darwin' || p === 'win32') return p;
  return 'linux'; // Treat all non-Mac Unix as Linux (FreeBSD, etc.)
}

// ---------------------------------------------------------------------------
// Data directory
// ---------------------------------------------------------------------------

/**
 * Get the application data directory.
 *
 * - **macOS**: `~/Library/Application Support/agentbuilder`
 * - **Linux**: `$XDG_DATA_HOME/agentbuilder` or `~/.local/share/agentbuilder`
 * - **Windows**: `%LOCALAPPDATA%/agentbuilder` or `%APPDATA%/agentbuilder`
 */
export function getDataDir(): string {
  const home = homedir();
  const p = getPlatform();

  switch (p) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', APP_NAME);
    case 'win32': {
      const localAppData = process.env['LOCALAPPDATA'] || process.env['APPDATA'];
      return localAppData
        ? join(localAppData, APP_NAME)
        : join(home, 'AppData', 'Local', APP_NAME);
    }
    case 'linux':
    default: {
      const xdgData = process.env['XDG_DATA_HOME'];
      return xdgData
        ? join(xdgData, APP_NAME)
        : join(home, '.local', 'share', APP_NAME);
    }
  }
}

// ---------------------------------------------------------------------------
// Config directory
// ---------------------------------------------------------------------------

/**
 * Get the application configuration directory.
 *
 * - **macOS**: `~/Library/Preferences/agentbuilder`
 * - **Linux**: `$XDG_CONFIG_HOME/agentbuilder` or `~/.config/agentbuilder`
 * - **Windows**: `%APPDATA%/agentbuilder/config`
 */
export function getConfigDir(): string {
  const home = homedir();
  const p = getPlatform();

  switch (p) {
    case 'darwin':
      return join(home, 'Library', 'Preferences', APP_NAME);
    case 'win32': {
      const appData = process.env['APPDATA'];
      return appData
        ? join(appData, APP_NAME, 'config')
        : join(home, 'AppData', 'Roaming', APP_NAME, 'config');
    }
    case 'linux':
    default: {
      const xdgConfig = process.env['XDG_CONFIG_HOME'];
      return xdgConfig
        ? join(xdgConfig, APP_NAME)
        : join(home, '.config', APP_NAME);
    }
  }
}

// ---------------------------------------------------------------------------
// Cache directory
// ---------------------------------------------------------------------------

/**
 * Get the application cache directory.
 *
 * - **macOS**: `~/Library/Caches/agentbuilder`
 * - **Linux**: `$XDG_CACHE_HOME/agentbuilder` or `~/.cache/agentbuilder`
 * - **Windows**: `%LOCALAPPDATA%/agentbuilder/cache`
 */
export function getCacheDir(): string {
  const home = homedir();
  const p = getPlatform();

  switch (p) {
    case 'darwin':
      return join(home, 'Library', 'Caches', APP_NAME);
    case 'win32': {
      const localAppData = process.env['LOCALAPPDATA'];
      return localAppData
        ? join(localAppData, APP_NAME, 'cache')
        : join(home, 'AppData', 'Local', APP_NAME, 'cache');
    }
    case 'linux':
    default: {
      const xdgCache = process.env['XDG_CACHE_HOME'];
      return xdgCache
        ? join(xdgCache, APP_NAME)
        : join(home, '.cache', APP_NAME);
    }
  }
}

// ---------------------------------------------------------------------------
// Ensure directory exists
// ---------------------------------------------------------------------------

/**
 * Ensure a directory exists, creating it recursively if necessary.
 *
 * @param dirPath - Absolute path to the directory.
 * @returns The path that was ensured.
 */
export async function ensureDir(dirPath: string): Promise<string> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Synchronous version of ensureDir.
 */
export function ensureDirSync(dirPath: string): string {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}
