#!/usr/bin/env tsx
import { Command } from 'commander';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { sendPromptAction } from './actions/send-prompt.js';
import { BrowserManager } from './browser-manager.js';
import { ChatGPTPage } from './pages/chatgpt-page.js';
import { classifyError } from './errors/error-classifier.js';
import { captureError } from './utils/screenshot.js';
import { loadConfig } from './utils/config.js';
import { Logger } from './utils/logger.js';
import { invokeGeminiRecovery, applyGeminiFix } from './recovery/gemini-fallback.js';

/** セレクタエラー時の最大自動リトライ回数 */
const MAX_SELECTOR_RETRIES = 4;
/** 現在のリトライ回数（子プロセス経由で引き継ぐ） */
const selectorRetryAttempt = parseInt(process.env.CHATGPT_BRAIN_SELECTOR_RETRY ?? '0', 10);

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
  .option('-m, --model <model>', 'Model to use: instant | thinking | pro | deepresearch  (default: thinking)')
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
      let htmlPath: string | null = null;
      let pageUrl = '';
      let pageTitle = '';
      let failedSelector = '';

      // PNG + HTML をペアで保存
      try {
        const browserManager = BrowserManager.getInstance();
        if (browserManager.isRunning()) {
          const page = await browserManager.getPage();
          pageUrl = page.url();
          pageTitle = await page.title();
          const capture = await captureError(page, config.screenshots.dir, 'error', config.screenshots.maxFiles);
          screenshotPath = capture.screenshotPath;
          htmlPath = capture.htmlPath;
        }
      } catch {
        // Best-effort capture
      }

      // Extract failed selector and selector file from error if available
      let selectorFile: string | null = null;
      if (error instanceof Error && 'selector' in error) {
        failedSelector = (error as { selector: string }).selector;
      }
      if (error instanceof Error && 'selectorFile' in error) {
        selectorFile = (error as { selectorFile?: string }).selectorFile ?? null;
      }

      const errorOutput = {
        status: 'error',
        error_type: classified.errorType,
        message: classified.message,
        screenshot_path: screenshotPath,
        html_path: htmlPath,
        recovery_attempted: false,
        context: {
          page_url: pageUrl,
          page_title: pageTitle,
          failed_selector: failedSelector,
          selector_file: selectorFile,
        },
      };

      // セレクタエラー + PNG/HTML + selectorFile がすべて揃っている場合は Gemini を自動起動
      if (
        classified.errorType === 'selector_not_found' &&
        screenshotPath && htmlPath && selectorFile
      ) {
        process.stderr.write(
          `[recovery] セレクタエラーを検出。Gemini CLI に修正を依頼します... ` +
          `(試行 ${selectorRetryAttempt + 1}/${MAX_SELECTOR_RETRIES})\n` +
          `  screenshot : ${screenshotPath}\n` +
          `  html       : ${htmlPath}\n` +
          `  selector   : ${selectorFile}\n`,
        );
        try {
          const recovery = await invokeGeminiRecovery({
            screenshotPath,
            htmlPath,
            selectorFilePath: selectorFile,
            errorJson: errorOutput,
          });
          errorOutput.recovery_attempted = true;
          process.stderr.write('\n[recovery] Gemini の修正提案:\n');
          process.stderr.write('─'.repeat(60) + '\n');
          process.stderr.write(recovery.output + '\n');
          process.stderr.write('─'.repeat(60) + '\n');

          if (recovery.success) {
            const applied = applyGeminiFix(recovery.output, selectorFile);
            if (applied && selectorRetryAttempt < MAX_SELECTOR_RETRIES) {
              process.stderr.write(
                `[recovery] 修正を適用しました。リトライします ` +
                `(${selectorRetryAttempt + 1}/${MAX_SELECTOR_RETRIES})...\n`,
              );
              try { await BrowserManager.getInstance().close(); } catch { /* ignore */ }
              await spawnRetry(selectorRetryAttempt + 1);
              return;
            }
            if (!applied) {
              process.stderr.write('[recovery] Gemini の出力から TypeScript ブロックを抽出できませんでした。\n');
            }
          } else {
            process.stderr.write(`[recovery] Gemini 失敗: ${recovery.error}\n`);
          }
        } catch (recoveryError) {
          process.stderr.write(`[recovery] Gemini 起動エラー: ${String(recoveryError)}\n`);
        }
      }

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
      let htmlPath: string | null = null;
      try {
        if (browserManager.isRunning()) {
          const page = await browserManager.getPage();
          const capture = await captureError(page, config.screenshots.dir, 'health-error', config.screenshots.maxFiles);
          screenshotPath = capture.screenshotPath;
          htmlPath = capture.htmlPath;
        }
      } catch {
        // Best-effort
      }

      const result = {
        status: 'unhealthy',
        error_type: classified.errorType,
        message: classified.message,
        screenshot_path: screenshotPath,
        html_path: htmlPath,
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

/**
 * 同じ引数でプロセスを再起動し、セレクタの修正を反映させる。
 * モジュールキャッシュをリセットするため子プロセスとして起動する。
 * 子プロセスの終了コードでそのまま終了する。
 */
async function spawnRetry(retryCount: number): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn(process.argv[0], process.argv.slice(1), {
      env: { ...process.env, CHATGPT_BRAIN_SELECTOR_RETRY: String(retryCount) },
      stdio: 'inherit',
    });
    proc.on('error', (err) => {
      process.stderr.write(`[recovery] retry spawn error: ${err.message}\n`);
      process.exit(5);
    });
    proc.on('close', (code) => {
      process.exit(code ?? 5);
    });
  });
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
