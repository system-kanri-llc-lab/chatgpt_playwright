import type { Page } from 'playwright';
import { AuthExpiredError, CaptchaError, ResponseTimeoutError, SelectorNotFoundError } from '../errors/error-types.js';
import { selectModel as selectModelImpl } from './model-selector.js';
import { loadConfig } from '../utils/config.js';
import { Logger } from '../utils/logger.js';

// MODEL_MAP / ModelName / selectModel の実装は model-selector.ts に集約
export { MODEL_MAP } from './model-selector.js';
export type { ModelName } from './model-selector.js';

const SELECTORS = {
  promptTextarea: '[data-testid="composer-input"], #prompt-textarea',
  sendButton: '[data-testid="send-button"]',
  assistantMessage: '[data-message-author-role="assistant"]',
  streamingIndicator: '[data-testid="stop-button"]',
  /** ストリーミング接続中に現れる進捗テキスト（接続生存確認用・完了判定には使わない） */
  streamingAlive: '.text-token-text-tertiary',
  /** ストリーミング中に表示される継続中バナー（消えたら完了） */
  streamingBanner: ':text("ChatGPTは引き続き回答を続けています")',
  newChatButton: '[data-testid="create-new-chat-button"], [data-testid="new-chat-button"], a[href="/"]',
  loginIndicator: 'button[data-testid="login-button"], [data-testid="auth-wall"]',
  captchaIndicator: '#challenge-form, .cf-turnstile, iframe[src*="captcha"]',
} as const;

export class ChatGPTPage {
  private readonly page: Page;
  private readonly logger: Logger;
  private readonly baseUrl: string;

  constructor(page: Page) {
    this.page = page;
    this.logger = new Logger();
    const config = loadConfig();
    this.baseUrl = config.chatgpt.baseUrl;
  }

  async navigate(): Promise<void> {
    this.logger.info('chatgptPage', { step: 'navigate', url: this.baseUrl });
    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      // networkidle may time out on heavy pages; continue anyway
    });
    this.logger.info('chatgptPage', { step: 'navigate_done', url: this.page.url() });
  }

  async ensureAuthenticated(): Promise<void> {
    this.logger.debug('chatgptPage', { step: 'ensure_authenticated' });
    const loginVisible = await this.page.locator(SELECTORS.loginIndicator).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (loginVisible) {
      throw new AuthExpiredError(this.page.url());
    }
  }

  async ensureNoCaptcha(): Promise<void> {
    this.logger.debug('chatgptPage', { step: 'ensure_no_captcha' });
    const captchaVisible = await this.page.locator(SELECTORS.captchaIndicator).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (captchaVisible) {
      throw new CaptchaError('unknown', this.page.url());
    }
  }

  async startNewChat(): Promise<void> {
    this.logger.info('chatgptPage', { step: 'start_new_chat' });
    const button = this.page.locator(SELECTORS.newChatButton).first();
    const visible = await button.isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) {
      throw new SelectorNotFoundError(SELECTORS.newChatButton, 'startNewChat');
    }
    // Use force:true to bypass SVG overlay intercepting pointer events
    await button.click({ force: true });
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    this.logger.info('chatgptPage', { step: 'new_chat_started' });
  }

  async openConversation(url: string): Promise<void> {
    this.logger.info('chatgptPage', { step: 'open_conversation', url });
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  /** モデル選択の実装は src/pages/model-selector.ts に集約 */
  async selectModel(model: string): Promise<void> {
    await selectModelImpl(this.page, model);
  }

  async sendPrompt(text: string): Promise<void> {
    this.logger.info('chatgptPage', { step: 'send_prompt', textLength: text.length });

    const textarea = this.page.locator(SELECTORS.promptTextarea).first();
    const visible = await textarea.isVisible({ timeout: 10000 }).catch(() => false);
    if (!visible) {
      throw new SelectorNotFoundError(SELECTORS.promptTextarea, 'sendPrompt');
    }

    // Strategy 1: fill
    let filled = false;
    try {
      await textarea.click();
      await textarea.fill(text);
      const value = await textarea.inputValue().catch(() => '');
      if (value === text) {
        filled = true;
        this.logger.debug('chatgptPage', { step: 'fill_textarea', strategy: 'fill' });
      }
    } catch {
      // Fall through to next strategy
    }

    // Strategy 2: keyboard.type
    if (!filled) {
      try {
        await textarea.click();
        await textarea.fill('');
        await this.page.keyboard.type(text, { delay: 10 });
        const value = await textarea.inputValue().catch(() => '');
        if (value.length > 0) {
          filled = true;
          this.logger.debug('chatgptPage', { step: 'fill_textarea', strategy: 'keyboard.type' });
        }
      } catch {
        // Fall through to next strategy
      }
    }

    // Strategy 3: keyboard.insertText
    if (!filled) {
      try {
        await textarea.click();
        await textarea.fill('');
        await this.page.keyboard.insertText(text);
        const value = await textarea.inputValue().catch(() => '');
        if (value.length > 0) {
          filled = true;
          this.logger.debug('chatgptPage', { step: 'fill_textarea', strategy: 'keyboard.insertText' });
        }
      } catch {
        // Fall through to next strategy
      }
    }

    // Strategy 4: clipboard paste via page.evaluate
    if (!filled) {
      try {
        await textarea.click();
        await this.page.evaluate(async (textContent: string) => {
          await navigator.clipboard.writeText(textContent);
        }, text);
        await this.page.keyboard.press('Control+v');
        filled = true;
        this.logger.debug('chatgptPage', { step: 'fill_textarea', strategy: 'clipboard' });
      } catch {
        // All strategies failed
      }
    }

    if (!filled) {
      throw new SelectorNotFoundError(SELECTORS.promptTextarea, 'sendPrompt: all fill strategies failed');
    }

    // Click send button
    const sendBtn = this.page.locator(SELECTORS.sendButton).first();
    const sendVisible = await sendBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!sendVisible) {
      // Try pressing Enter as fallback
      this.logger.debug('chatgptPage', { step: 'send_button', strategy: 'Enter key fallback' });
      await this.page.keyboard.press('Enter');
    } else {
      await sendBtn.click();
      this.logger.debug('chatgptPage', { step: 'send_button', strategy: 'click' });
    }

    this.logger.info('chatgptPage', { step: 'prompt_sent' });
  }

  async waitForResponse(timeoutMs: number): Promise<void> {
    this.logger.info('chatgptPage', { step: 'wait_for_response', timeoutMs });

    const config = loadConfig();
    const effectiveTimeout = timeoutMs || config.chatgpt.responseTimeoutSeconds * 1000;
    const deadline = Date.now() + effectiveTimeout;

    // Stage 1: Wait for assistant message to appear (up to 30s)
    this.logger.debug('chatgptPage', { step: 'wait_assistant_message_appear' });
    try {
      await this.page.locator(SELECTORS.assistantMessage).first().waitFor({
        state: 'visible',
        timeout: 30000,
      });
    } catch {
      throw new ResponseTimeoutError(effectiveTimeout, 'assistant_message_not_appeared');
    }

    // Stage 2: Confirm streaming has started before checking completion.
    // Wait up to 10s for any "alive" signal: stop button OR streaming progress text.
    // This prevents false-positive completion detection immediately after message appears.
    this.logger.debug('chatgptPage', { step: 'wait_streaming_start' });
    const streamingStarted = await Promise.race([
      this.page.locator(SELECTORS.streamingIndicator).first()
        .waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
      this.page.locator(SELECTORS.streamingAlive).first()
        .waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
    ]);
    this.logger.debug('chatgptPage', { step: 'streaming_start_confirmed', streamingStarted });

    // Snapshot banner presence so we can track its disappearance
    const bannerPresentAtStart = await this.page.locator(SELECTORS.streamingBanner)
      .first().isVisible({ timeout: 1000 }).catch(() => false);

    // Stage 3: Poll completion signals (OR) every POLL_INTERVAL ms.
    //
    // Signal 1 (stop_gone):   Stop button disappears            → most reliable when button appears
    // Signal 2 (banner_gone): 「引き続き回答を続けています」消失 → reliable for long responses
    // Signal 3 (text_stable): Response text length unchanged for STABLE_COUNT polls → universal fallback

    const POLL_INTERVAL = 2000;
    const STABLE_COUNT = 3;
    let stableCount = 0;
    let lastLength = -1;
    let firedSignal = '';

    this.logger.debug('chatgptPage', { step: 'polling_completion', bannerPresentAtStart });

    while (Date.now() < deadline) {
      await this.page.waitForTimeout(POLL_INTERVAL);

      const [stopVisible, bannerVisible, currentText] = await Promise.all([
        this.page.locator(SELECTORS.streamingIndicator).first()
          .isVisible({ timeout: 300 }).catch(() => false),
        this.page.locator(SELECTORS.streamingBanner).first()
          .isVisible({ timeout: 300 }).catch(() => false),
        this.page.locator(SELECTORS.assistantMessage).last()
          .textContent().catch(() => ''),
      ]);

      const currentLength = (currentText ?? '').trim().length;

      this.logger.debug('chatgptPage', {
        step: 'poll',
        stopVisible,
        bannerVisible,
        textLength: currentLength,
        stableCount,
      });

      // Signal 1: stop button gone
      if (!stopVisible && streamingStarted) {
        firedSignal = 'stop_gone';
        break;
      }

      // Signal 2: banner gone (only valid if it was present at start)
      if (bannerPresentAtStart && !bannerVisible) {
        firedSignal = 'banner_gone';
        break;
      }

      // Signal 3: text length stabilized
      if (currentLength > 0 && currentLength === lastLength) {
        stableCount++;
        if (stableCount >= STABLE_COUNT) {
          firedSignal = 'text_stable';
          break;
        }
      } else {
        stableCount = 0;
        lastLength = currentLength;
      }
    }

    if (Date.now() >= deadline) {
      throw new ResponseTimeoutError(effectiveTimeout, 'all_signals_timed_out');
    }

    this.logger.info('chatgptPage', { step: 'completion_signal_fired', signal: firedSignal });

    // Stage 4: 2s final stability check
    await this.page.waitForTimeout(2000);

    const finalText = (await this.page.locator(SELECTORS.assistantMessage).last()
      .textContent().catch(() => '') ?? '').trim();
    if (finalText.length === 0) {
      throw new ResponseTimeoutError(effectiveTimeout, 'assistant_message_empty');
    }

    this.logger.info('chatgptPage', { step: 'response_ready', messageLength: finalText.length });
  }

  /**
   * プロンプト送信後、URL が /c/xxxx 形式に変わるまで待つ。
   * 変わったら会話 URL を返す。タイムアウト時は null。
   */
  async waitForConversationCreated(timeoutMs = 60_000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const url = this.page.url();
      if (url.includes('/c/')) return url;
      await this.page.waitForTimeout(1000);
    }
    return null;
  }

  /**
   * 既に開いている会話ページを一定間隔でポーリングし、
   * アシスタントの応答が完成したら返す。
   * DeepResearch のような長時間タスク向け。
   *
   * 完了条件（OR）:
   *   - Stop ボタン不在 かつ アシスタントメッセージが minLength 文字以上
   *   - 上記が STABLE_COUNT 回連続したら確定
   */
  async pollForCompletedResponse(
    timeoutMs: number,
    pollIntervalMs = 60_000,
    minLength = 200,
  ): Promise<string> {
    const STABLE_COUNT = 2;
    const deadline = Date.now() + timeoutMs;
    let stableCount = 0;
    let lastLength = -1;

    this.logger.info('chatgptPage', { step: 'poll_for_completion', timeoutMs, pollIntervalMs });

    while (Date.now() < deadline) {
      await this.page.waitForTimeout(pollIntervalMs);

      const [stopVisible, text] = await Promise.all([
        this.page.locator(SELECTORS.streamingIndicator).first()
          .isVisible({ timeout: 300 }).catch(() => false),
        this.page.locator(SELECTORS.assistantMessage).last()
          .textContent().catch(() => ''),
      ]);

      const length = (text ?? '').trim().length;
      this.logger.debug('chatgptPage', { step: 'poll', stopVisible, length, stableCount });

      if (!stopVisible && length >= minLength) {
        if (length === lastLength) {
          stableCount++;
          if (stableCount >= STABLE_COUNT) break;
        } else {
          stableCount = 1;
          lastLength = length;
        }
      } else {
        stableCount = 0;
        lastLength = length;
      }
    }

    if (Date.now() >= deadline) {
      throw new ResponseTimeoutError(timeoutMs, 'poll_for_completed_response');
    }

    const finalText = (await this.page.locator(SELECTORS.assistantMessage).last()
      .textContent().catch(() => '') ?? '').trim();

    this.logger.info('chatgptPage', { step: 'poll_complete', messageLength: finalText.length });
    return finalText;
  }

  async getLastResponse(): Promise<string> {
    this.logger.debug('chatgptPage', { step: 'get_last_response' });
    const messages = this.page.locator(SELECTORS.assistantMessage);
    const count = await messages.count();
    if (count === 0) {
      throw new SelectorNotFoundError(SELECTORS.assistantMessage, 'getLastResponse');
    }
    const text = await messages.last().textContent();
    return text?.trim() ?? '';
  }

  getCurrentUrl(): string {
    return this.page.url();
  }

  async takeScreenshot(savePath: string): Promise<void> {
    await this.page.screenshot({ path: savePath, fullPage: false });
  }
}
