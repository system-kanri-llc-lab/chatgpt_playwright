#!/usr/bin/env tsx
/**
 * HTTP API サーバー。
 * コンテナ内で起動し、外部エージェントから POST /send 等を受け付ける。
 *
 * リクエストは FIFO キューで順番に処理する（ブラウザは1インスタンス）。
 * 並列化はコンテナを複数起動することで実現する。
 */

import http from 'http';
import { sendPromptAction } from './actions/send-prompt.js';
import { BrowserManager } from './browser-manager.js';
import { ChatGPTPage } from './pages/chatgpt-page.js';
import { classifyError } from './errors/error-classifier.js';
import { Logger } from './utils/logger.js';
import { loadConfig } from './utils/config.js';
import { takeScreenshot } from './utils/screenshot.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const logger = new Logger();
const config = loadConfig();

// ── リクエストキュー（FIFO / sequential） ──────────────────────────────────

let queue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const outer = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  queue = queue.then(() => fn().then(resolve, reject));
  return outer;
}

// ── JSON ユーティリティ ────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

// ── ルーティング ───────────────────────────────────────────────────────────

async function handleSend(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req) as Record<string, unknown>;

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    send(res, 400, { status: 'error', error_type: 'invalid_input', message: 'prompt is required' });
    return;
  }

  const model = typeof body.model === 'string' ? body.model : undefined;
  const timeoutMs = typeof body.timeout === 'number'
    ? body.timeout * 1000
    : config.chatgpt.responseTimeoutSeconds * 1000;
  const newChat = body.new_chat !== false;
  const conversationUrl = typeof body.conversation_url === 'string' ? body.conversation_url : undefined;

  // キューに積んで順番待ち
  const result = await enqueue(() =>
    sendPromptAction({ prompt, model, timeoutMs, newChat, conversationUrl }),
  ).catch(async (error: unknown) => {
    const classified = classifyError(error);
    let screenshotPath: string | null = null;
    let pageUrl = '';
    let pageTitle = '';
    let failedSelector = '';

    try {
      const browserManager = BrowserManager.getInstance();
      if (browserManager.isRunning()) {
        const page = await browserManager.getPage();
        pageUrl = page.url();
        pageTitle = await page.title();
        screenshotPath = await takeScreenshot(page, config.screenshots.dir, 'error', config.screenshots.maxFiles);
      }
    } catch { /* best-effort */ }

    if (error instanceof Error && 'selector' in error) {
      failedSelector = (error as { selector: string }).selector;
    }

    return {
      status: 'error' as const,
      error_type: classified.errorType,
      message: classified.message,
      screenshot_path: screenshotPath,
      recovery_attempted: false,
      context: { page_url: pageUrl, page_title: pageTitle, failed_selector: failedSelector },
      _exitCode: classified.exitCode,
    };
  });

  if ('_exitCode' in result) {
    const { _exitCode, ...body } = result;
    send(res, _exitCode === 2 ? 504 : _exitCode === 3 ? 403 : 502, body);
  } else {
    send(res, 200, result);
  }
}

async function handleHealth(res: http.ServerResponse): Promise<void> {
  const result = await enqueue(async () => {
    const browserManager = BrowserManager.getInstance();
    await browserManager.launch();
    const page = await browserManager.getPage();
    const chatgptPage = new ChatGPTPage(page);
    await chatgptPage.navigate();
    await chatgptPage.ensureAuthenticated();
    await chatgptPage.ensureNoCaptcha();
    return { status: 'healthy', message: 'ChatGPT UI is accessible and authenticated', url: chatgptPage.getCurrentUrl() };
  }).catch((error: unknown) => {
    const classified = classifyError(error);
    return { status: 'unhealthy', error_type: classified.errorType, message: classified.message };
  });

  send(res, result.status === 'healthy' ? 200 : 503, result);
}

function handleSessionStatus(res: http.ServerResponse): void {
  const running = BrowserManager.getInstance().isRunning();
  send(res, 200, { status: running ? 'running' : 'stopped' });
}

async function handleSessionStop(res: http.ServerResponse): Promise<void> {
  await BrowserManager.getInstance().close().catch(() => {});
  send(res, 200, { status: 'stopped' });
}

// ── サーバー本体 ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  logger.info('server', { method, url });

  try {
    if (method === 'POST' && url === '/send') {
      await handleSend(req, res);
    } else if (method === 'GET' && url === '/health') {
      await handleHealth(res);
    } else if (method === 'GET' && url === '/session/status') {
      handleSessionStatus(res);
    } else if (method === 'POST' && url === '/session/stop') {
      await handleSessionStop(res);
    } else {
      send(res, 404, { error: 'Not found' });
    }
  } catch (error) {
    logger.error('server', { error: String(error) });
    send(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  logger.info('server', { step: 'listening', port: PORT });
  process.stderr.write(`chatgpt-brain server listening on port ${PORT}\n`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('server', { step: 'shutdown' });
  server.close();
  await BrowserManager.getInstance().close().catch(() => {});
  process.exit(0);
});

process.on('SIGINT', async () => {
  server.close();
  await BrowserManager.getInstance().close().catch(() => {});
  process.exit(0);
});
