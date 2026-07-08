/**
 * Structured logging utility with context awareness and error tracking.
 */

import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private logFile: string | null = null;
  private contextStack: Record<string, unknown>[] = [];

  constructor() {
    const logLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (logLevel && LogLevel[logLevel as keyof typeof LogLevel] !== undefined) {
      this.level = LogLevel[logLevel as keyof typeof LogLevel];
    }

    const logPath = process.env.LOG_FILE_PATH;
    if (logPath) {
      try {
        const dir = dirname(logPath);
        mkdirSync(dir, { recursive: true });
        this.logFile = logPath;
      } catch (err) {
        console.error(`Failed to initialize log file at ${logPath}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private write(entry: LogEntry): void {
    if (!this.logFile) return;

    try {
      appendFileSync(this.logFile, this.formatEntry(entry) + '\n', { encoding: 'utf-8' });
    } catch (err) {
      console.error(`Failed to write to log file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private createEntry(level: string, message: string, context?: Record<string, unknown>, error?: Error): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    const merged = { ...context };
    this.contextStack.forEach((ctx) => {
      Object.assign(merged, ctx);
    });

    if (Object.keys(merged).length > 0) {
      entry.context = merged;
    }

    if (error) {
      entry.error = error.stack || error.message;
    }

    return entry;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const entry = this.createEntry('DEBUG', message, context);
      console.debug(message, context);
      this.write(entry);
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const entry = this.createEntry('INFO', message, context);
      console.info(message, context);
      this.write(entry);
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const entry = this.createEntry('WARN', message, context);
      console.warn(message, context);
      this.write(entry);
    }
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const entry = this.createEntry('ERROR', message, context, error);
      console.error(message, error, context);
      this.write(entry);
    }
  }

  withContext<T>(context: Record<string, unknown>, fn: () => T): T {
    this.contextStack.push(context);
    try {
      return fn();
    } finally {
      this.contextStack.pop();
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger();
