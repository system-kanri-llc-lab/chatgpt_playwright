import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import { loadConfig } from './utils/config.js';
import { Logger } from './utils/logger.js';

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly logger: Logger;

  private constructor() {
    this.logger = new Logger();
  }

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  async launch(): Promise<BrowserContext> {
    if (this.context) {
      this.logger.debug('browserManager', { step: 'already_running', message: 'Returning existing context' });
      return this.context;
    }

    const config = loadConfig();
    const userDataDir = config.browser.userDataDir;

    fs.mkdirSync(userDataDir, { recursive: true });

    this.logger.info('browserManager', {
      step: 'launching',
      userDataDir,
      headless: config.browser.headless,
    });

    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: config.browser.headless,
      viewport: config.browser.viewport,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
      ignoreHTTPSErrors: false,
    });

    this.logger.info('browserManager', { step: 'launched', message: 'Browser context created' });

    return this.context;
  }

  isRunning(): boolean {
    return this.context !== null;
  }

  async close(): Promise<void> {
    if (this.context) {
      this.logger.info('browserManager', { step: 'closing' });
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }

  async getPage(): Promise<Page> {
    if (!this.context) {
      await this.launch();
    }

    const ctx = this.context!;

    // Reuse existing page if still open
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    // Use existing pages from context
    const pages = ctx.pages();
    if (pages.length > 0) {
      this.page = pages[pages.length - 1];
    } else {
      this.page = await ctx.newPage();
    }

    this.logger.debug('browserManager', { step: 'got_page', url: this.page.url() });
    return this.page;
  }
}
