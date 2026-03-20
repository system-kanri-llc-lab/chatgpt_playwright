#!/usr/bin/env tsx
import { Command } from 'commander';
import * as readline from 'readline';
import { sendPromptAction } from './actions/send-prompt.js';
import { BrowserManager } from './browser-manager.js';
import { ChatGPTPage } from './pages/chatgpt-page.js';
import { classifyError } from './errors/error-classifier.js';
import { takeScreenshot } from './utils/screenshot.js';
import { loadConfig } from './utils/config.js';
import { Logger } from './utils/logger.js';

const program = new Command();

program
  .name('chatgpt-brain')
  .description('ChatGPT Web UI automation via Playwright')
  .version('1.0.0');

// ── send command ──────────────────────────────────────────────────────────────
program
  .command('send')
  .description('Send a prompt to ChatGPT and print the response as JSON')
  .option('-p, --prompt <text>', 'The prompt text (use "-" to read from stdin)')
  .option('-m, --model <model>', 'Model to use')
  .option('-t, --timeout <seconds>', 'Response timeout in seconds', parseFloat)
  .option('--no-new-chat', 'Do not start a new chat (reuse existing)')
  .option('--conversation-url <url>', 'Open a specific conversation URL')
  .option('--server-url <url>', 'Delegate to a running chatgpt-brain server (e.g. http://localhost:3001)')
  .action(async (opts) => {
    const logger = new Logger();
    const config = loadConfig();

    let prompt: string = opts.prompt ?? '';

    // Read from stdin if prompt is "-" or not provided
    if (!prompt || prompt === '-') {
      prompt = await readStdin();
    }

    if (!prompt || prompt.trim().length === 0) {
      const errorOutput = {
        status: 'error',
        error_type: 'invalid_input',
        message: 'No prompt provided. Use --prompt or pipe text via stdin.',
        screenshot_path: null,
        recovery_attempted: false,
        context: {},
      };
      process.stdout.write(JSON.stringify(errorOutput, null, 2) + '\n');
      process.exit(1);
    }

    const timeoutMs = opts.timeout != null
      ? opts.timeout * 1000
      : config.chatgpt.responseTimeoutSeconds * 1000;

    // --server-url: delegate to a running HTTP server instead of running Playwright locally
    if (opts.serverUrl) {
      await delegateToServer(opts.serverUrl, {
        prompt: prompt.trim(),
        model: opts.model,
        timeout: opts.timeout ?? config.chatgpt.responseTimeoutSeconds,
        new_chat: opts.newChat !== false,
        conversation_url: opts.conversationUrl,
      });
      return;
    }

    try {
      const result = await sendPromptAction({
        prompt: prompt.trim(),
        model: opts.model,
        timeoutMs,
        newChat: opts.newChat !== false,
        conversationUrl: opts.conversationUrl,
      });

      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(0);
    } catch (error) {
      const classified = classifyError(error);
      logger.error('cli.send', { error: classified });

      let screenshotPath: string | null = null;
      let pageUrl = '';
      let pageTitle = '';
      let failedSelector = '';

      // Try to take error screenshot
      try {
        const browserManager = BrowserManager.getInstance();
        if (browserManager.isRunning()) {
          const page = await browserManager.getPage();
          pageUrl = page.url();
          pageTitle = await page.title();
          screenshotPath = await takeScreenshot(page, config.screenshots.dir, 'error', config.screenshots.maxFiles);
        }
      } catch {
        // Best-effort screenshot
      }

      // Extract failed selector from error if available
      if (error instanceof Error && 'selector' in error) {
        failedSelector = (error as { selector: string }).selector;
      }

      const errorOutput = {
        status: 'error',
        error_type: classified.errorType,
        message: classified.message,
        screenshot_path: screenshotPath,
        recovery_attempted: false,
        context: {
          page_url: pageUrl,
          page_title: pageTitle,
          failed_selector: failedSelector,
        },
      };

      process.stdout.write(JSON.stringify(errorOutput, null, 2) + '\n');
      process.exit(classified.exitCode);
    }
  });

// ── session commands ──────────────────────────────────────────────────────────
const sessionCmd = program.command('session').description('Manage browser session');

sessionCmd
  .command('start')
  .description('Launch browser and open ChatGPT (press Enter to close)')
  .action(async () => {
    const logger = new Logger();
    const config = loadConfig();

    logger.info('cli.session.start', { step: 'launching' });
    const browserManager = BrowserManager.getInstance();

    try {
      await browserManager.launch();
      const page = await browserManager.getPage();
      const chatgptPage = new ChatGPTPage(page);
      await chatgptPage.navigate();

      process.stderr.write('Browser launched and navigated to ChatGPT.\n');
      process.stderr.write('Please log in if needed, then press Enter to close the browser...\n');

      await waitForEnter();

      await browserManager.close();
      process.stderr.write('Browser closed.\n');
      process.exit(0);
    } catch (error) {
      const classified = classifyError(error);
      logger.error('cli.session.start', { error: classified });
      process.stderr.write(`Failed to start session: ${classified.message}\n`);
      process.exit(classified.exitCode);
    }
  });

sessionCmd
  .command('status')
  .description('Check if browser session is running')
  .action(() => {
    const browserManager = BrowserManager.getInstance();
    const running = browserManager.isRunning();
    const output = {
      status: running ? 'running' : 'stopped',
      message: running ? 'Browser session is active' : 'No active browser session',
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(0);
  });

sessionCmd
  .command('stop')
  .description('Stop the browser session')
  .action(async () => {
    const logger = new Logger();
    const browserManager = BrowserManager.getInstance();

    try {
      if (!browserManager.isRunning()) {
        process.stdout.write(JSON.stringify({ status: 'stopped', message: 'No active session to stop' }, null, 2) + '\n');
        process.exit(0);
        return;
      }

      await browserManager.close();
      process.stdout.write(JSON.stringify({ status: 'stopped', message: 'Browser session stopped' }, null, 2) + '\n');
      process.exit(0);
    } catch (error) {
      const classified = classifyError(error);
      logger.error('cli.session.stop', { error: classified });
      process.stderr.write(`Failed to stop session: ${classified.message}\n`);
      process.exit(classified.exitCode);
    }
  });

// ── health command ────────────────────────────────────────────────────────────
program
  .command('health')
  .description('Check if ChatGPT UI is operable')
  .action(async () => {
    const logger = new Logger();
    const config = loadConfig();

    logger.info('cli.health', { step: 'start' });

    const browserManager = BrowserManager.getInstance();

    try {
      await browserManager.launch();
      const page = await browserManager.getPage();
      const chatgptPage = new ChatGPTPage(page);

      await chatgptPage.navigate();
      await chatgptPage.ensureAuthenticated();
      await chatgptPage.ensureNoCaptcha();

      const result = {
        status: 'healthy',
        message: 'ChatGPT UI is accessible and authenticated',
        url: chatgptPage.getCurrentUrl(),
      };

      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(0);
    } catch (error) {
      const classified = classifyError(error);
      logger.error('cli.health', { error: classified });

      let screenshotPath: string | null = null;
      try {
        if (browserManager.isRunning()) {
          const page = await browserManager.getPage();
          screenshotPath = await takeScreenshot(page, config.screenshots.dir, 'health-error', config.screenshots.maxFiles);
        }
      } catch {
        // Best-effort
      }

      const result = {
        status: 'unhealthy',
        error_type: classified.errorType,
        message: classified.message,
        screenshot_path: screenshotPath,
      };

      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(classified.exitCode);
    }
  });

// ── server command ────────────────────────────────────────────────────────────
program
  .command('server')
  .description('Start HTTP API server (for containerized multi-agent use)')
  .option('--port <number>', 'Port to listen on', parseInt)
  .action(async (opts) => {
    if (opts.port) process.env.PORT = String(opts.port);
    // Dynamically import to avoid loading Playwright until needed
    await import('./server.js');
  });

// ── helpers ───────────────────────────────────────────────────────────────────
async function delegateToServer(serverUrl: string, body: Record<string, unknown>): Promise<void> {
  const url = serverUrl.replace(/\/$/, '') + '/send';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
    process.exit(res.ok ? 0 : 1);
  } catch (error) {
    const errorOutput = {
      status: 'error',
      error_type: 'server_unreachable',
      message: `Failed to reach server at ${serverUrl}: ${String(error)}`,
      screenshot_path: null,
      recovery_attempted: false,
      context: {},
    };
    process.stdout.write(JSON.stringify(errorOutput, null, 2) + '\n');
    process.exit(5);
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.resume();
  });
}

async function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once('line', () => {
      rl.close();
      resolve();
    });
  });
}

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`Unhandled error: ${String(err)}\n`);
  process.exit(5);
});
