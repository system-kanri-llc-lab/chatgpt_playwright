import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface BrowserConfig {
  userDataDir: string;
  headless: boolean;
  viewport: { width: number; height: number };
}

export interface ChatGPTConfig {
  baseUrl: string;
  defaultModel: string | null;
  responseTimeoutSeconds: number;
}

export interface ScreenshotsConfig {
  dir: string;
  maxFiles: number;
}

export interface LogsConfig {
  dir: string;
  level: 'debug' | 'info' | 'error';
  maxFiles: number;
}

export interface Config {
  browser: BrowserConfig;
  chatgpt: ChatGPTConfig;
  screenshots: ScreenshotsConfig;
  logs: LogsConfig;
}

const DEFAULT_CONFIG: Config = {
  browser: {
    userDataDir: '~/.chatgpt-brain/browser-data',
    headless: false,
    viewport: { width: 1280, height: 800 },
  },
  chatgpt: {
    baseUrl: 'https://chatgpt.com',
    defaultModel: null,
    responseTimeoutSeconds: 300,
  },
  screenshots: {
    dir: '~/.chatgpt-brain/screenshots',
    maxFiles: 50,
  },
  logs: {
    dir: '~/.chatgpt-brain/logs',
    level: 'info',
    maxFiles: 30,
  },
};

function expandTilde(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function expandTildesInConfig(config: Config): Config {
  return {
    ...config,
    browser: {
      ...config.browser,
      userDataDir: expandTilde(config.browser.userDataDir),
    },
    screenshots: {
      ...config.screenshots,
      dir: expandTilde(config.screenshots.dir),
    },
    logs: {
      ...config.logs,
      dir: expandTilde(config.logs.dir),
    },
  };
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base } as T;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const overrideVal = override[key];
    const baseVal = base[key];
    if (
      overrideVal !== null &&
      overrideVal !== undefined &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal as object, overrideVal as object) as T[keyof T];
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal as T[keyof T];
    }
  }
  return result;
}

export function loadConfig(): Config {
  const configPath = path.join(os.homedir(), '.chatgpt-brain', 'config.json');

  let userConfig: Partial<Config> = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      userConfig = JSON.parse(raw) as Partial<Config>;
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  const merged = deepMerge(DEFAULT_CONFIG, userConfig);
  return expandTildesInConfig(merged);
}
