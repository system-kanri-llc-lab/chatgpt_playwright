import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './config.js';

type LogLevel = 'debug' | 'info' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  action: string;
  [key: string]: unknown;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  error: 2,
};

export class Logger {
  private readonly logDir: string;
  private readonly configuredLevel: LogLevel;
  private readonly maxFiles: number;
  private logFilePath: string;

  constructor() {
    const config = loadConfig();
    this.logDir = config.logs.dir;
    this.configuredLevel = config.logs.level;
    this.maxFiles = config.logs.maxFiles;

    fs.mkdirSync(this.logDir, { recursive: true });

    const date = new Date();
    const dateStr = formatDateForFilename(date);
    this.logFilePath = path.join(this.logDir, `chatgpt-brain-${dateStr}.log`);

    this.cleanupOldLogs();
  }

  info(action: string, data: Record<string, unknown> = {}): void {
    this.log('info', action, data);
  }

  error(action: string, data: Record<string, unknown> = {}): void {
    this.log('error', action, data);
  }

  debug(action: string, data: Record<string, unknown> = {}): void {
    this.log('debug', action, data);
  }

  private log(level: LogLevel, action: string, data: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.configuredLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      action,
      ...data,
    };

    const line = JSON.stringify(entry);

    // Write to stderr for real-time viewing
    process.stderr.write(line + '\n');

    // Write to log file
    try {
      fs.appendFileSync(this.logFilePath, line + '\n', 'utf-8');
    } catch {
      // Best-effort file logging
    }
  }

  private cleanupOldLogs(): void {
    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((f) => f.startsWith('chatgpt-brain-') && f.endsWith('.log'))
        .map((f) => ({
          name: f,
          fullPath: path.join(this.logDir, f),
          mtime: fs.statSync(path.join(this.logDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > this.maxFiles) {
        const toDelete = files.slice(this.maxFiles);
        for (const file of toDelete) {
          fs.unlinkSync(file.fullPath);
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

function formatDateForFilename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
