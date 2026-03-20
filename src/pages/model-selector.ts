/**
 * モデル選択 UI の操作を完全に切り出したファイル。
 *
 * ── Gemini CLI による修正手順 ──────────────────────────────────────────────
 * エラー発生時、呼び出し元から以下の 3 点が渡される:
 *   1. screenshot_path  : エラー時の PNG（現在の画面状態）
 *   2. html_path        : エラー時の HTML ソース（実際の DOM 構造）
 *   3. context.selector_file : このファイル（= __filename）
 *
 * HTML を確認し、以下の 2 箇所を修正するだけで動作が復旧する:
 *   - MODEL_SELECTORS : ボタン・モーダルの CSS セレクタ
 *   - MODEL_MAP       : モデル名 → UI ラベルのマッピング
 * ────────────────────────────────────────────────────────────────────────────
 */

import { fileURLToPath } from 'url';
import type { Page } from 'playwright';
import { SelectorNotFoundError } from '../errors/error-types.js';
import { Logger } from '../utils/logger.js';

/** このファイルの絶対パス。エラー出力の selector_file に埋め込む。 */
export const SELECTOR_FILE = fileURLToPath(import.meta.url);

// ── セレクタ定義（UI が変わったらここだけ直す） ──────────────────────────────
export const MODEL_SELECTORS = {
  /**
   * ページ上部「ChatGPT ▼」モデル選択トリガーボタン。
   *
   * 実際の DOM（error-20260320-201943.html より確認）:
   *   <button aria-label="モデルセレクター"
   *           data-testid="model-switcher-dropdown-button"
   *           aria-haspopup="menu" aria-expanded="false" ...>
   *
   * サイドバーの trailing button（data-trailing-button / __menu-item-trailing-btn）は除外。
   */
  triggerButton: [
    '[aria-label="モデルセレクター"]',
    '[data-testid="model-switcher-dropdown-button"]',
    '[data-testid="model-selector"]',
    'button[aria-haspopup="menu"]:not([data-trailing-button]):not([class*="trailing"])',
  ].join(', '),

  /** モデル選択モーダル本体 */
  modal: '[data-testid="modal-intelligence-menu"]',

  /**
   * コンポーザー左の「+」ボタン。
   * DeepResearch はヘッダードロップダウンに存在せず、ここからのみ選択可能。
   *
   * 実際の DOM（error-20260320-201943.html より確認）:
   *   <button data-testid="composer-plus-btn" aria-label="ファイルの追加など" ...>
   */
  composerPlusButton: [
    '[data-testid="composer-plus-btn"]',
    '[aria-label="ファイルの追加など"]',
    'button[id="composer-plus-btn"]',
  ].join(', '),
} as const;

// ── モデル名マッピング（UI ラベルが変わったらここだけ直す） ─────────────────
export const MODEL_MAP: Record<string, string[]> = {
  instant:      ['Instant', '4o mini', 'GPT-4o mini'],
  thinking:     ['Thinking', 'o3-mini', 'o1'],
  pro:          ['Pro', 'o3 pro', 'o3-pro'],
  deepresearch: ['Deep research', 'DeepResearch', 'ディープリサーチ'],
};

export type ModelName = keyof typeof MODEL_MAP;

// ── 操作ロジック ──────────────────────────────────────────────────────────────

/**
 * ChatGPT のモデル選択 UI を操作する。
 *
 * @param page  Playwright Page インスタンス
 * @param model MODEL_MAP のキー（"thinking" など）または UI ラベル文字列
 */
export async function selectModel(page: Page, model: string): Promise<void> {
  const logger = new Logger();
  const key = model.toLowerCase().replace(/[^a-z]/g, '');
  const labels = MODEL_MAP[key] ?? [model];

  logger.info('modelSelector', { step: 'start', model, key, labels });

  if (key === 'deepresearch') {
    await selectDeepResearch(page, labels, logger);
  } else {
    await selectViaHeaderDropdown(page, labels, logger);
  }
}

/**
 * Instant / Thinking / Pro:
 * ヘッダーの「ChatGPT ▼」ボタン → モーダル内で選択
 */
async function selectViaHeaderDropdown(
  page: Page,
  labels: string[],
  logger: Logger,
): Promise<void> {
  // ── Step 1: トリガーボタンを探す ─────────────────────────────────────────
  let triggerBtn = page.locator(MODEL_SELECTORS.triggerButton).first();

  if (!await triggerBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    // フォールバック: モデル名 or "ChatGPT" テキストを含むボタン
    const allLabels = Object.values(MODEL_MAP).flat();
    const pattern = new RegExp([...allLabels, 'ChatGPT'].join('|'), 'i');
    triggerBtn = page
      .locator('button')
      .filter({ hasText: pattern })
      .filter({ hasNot: page.locator('[data-trailing-button]') })
      .first();
  }

  if (!await triggerBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new SelectorNotFoundError(
      MODEL_SELECTORS.triggerButton,
      'trigger button not found',
      SELECTOR_FILE,
    );
  }

  // SVG アイコンが遮蔽するため force:true でクリック
  await triggerBtn.click({ force: true });
  logger.debug('modelSelector', { step: 'trigger_clicked' });

  // ── Step 2: モーダルが開くのを待つ ───────────────────────────────────────
  const modal = page.locator(MODEL_SELECTORS.modal);
  const modalOpened = await modal
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  await page.waitForTimeout(400);

  // ── Step 3: モーダル内でオプションを探してクリック ───────────────────────
  const scope = modalOpened ? modal : page;

  let clicked = false;
  for (const label of labels) {
    const option = scope.getByText(label, { exact: false }).first();
    if (await option.isVisible({ timeout: 1500 }).catch(() => false)) {
      await option.click();
      clicked = true;
      logger.info('modelSelector', { step: 'selected', matchedLabel: label });
      break;
    }
  }

  if (!clicked) {
    await page.keyboard.press('Escape');
    throw new SelectorNotFoundError(
      `model options: ${labels.join(' / ')}`,
      'none of the candidate labels found in modal',
      SELECTOR_FILE,
    );
  }

  await modal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * DeepResearch のみ:
 * コンポーザー左の「+」ボタン → メニュー内で選択
 */
async function selectDeepResearch(
  page: Page,
  labels: string[],
  logger: Logger,
): Promise<void> {
  // ── Step 1: 「+」ボタンをクリック ────────────────────────────────────────
  const plusBtn = page.locator(MODEL_SELECTORS.composerPlusButton).first();

  if (!await plusBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    throw new SelectorNotFoundError(
      MODEL_SELECTORS.composerPlusButton,
      'composer plus button not found',
      SELECTOR_FILE,
    );
  }

  await plusBtn.click();
  logger.debug('modelSelector', { step: 'plus_button_clicked' });

  await page.waitForTimeout(400);

  // ── Step 2: メニュー内で DeepResearch を選択 ──────────────────────────
  let clicked = false;
  for (const label of labels) {
    const option = page.getByText(label, { exact: false }).first();
    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      await option.click();
      clicked = true;
      logger.info('modelSelector', { step: 'selected', matchedLabel: label });
      break;
    }
  }

  if (!clicked) {
    await page.keyboard.press('Escape');
    throw new SelectorNotFoundError(
      `DeepResearch options: ${labels.join(' / ')}`,
      'not found in composer plus menu',
      SELECTOR_FILE,
    );
  }

  await page.waitForTimeout(300);
}
