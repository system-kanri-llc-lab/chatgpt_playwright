import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright';

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const sec = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${h}${min}${sec}`;
}

export interface ErrorCapture {
  screenshotPath: string;
  htmlPath: string;
}

/**
 * エラー発生時に PNG + HTML ソースをペアで保存する。
 * 同一タイムスタンプのベース名を使うため、ファイル名で紐付けできる。
 */
export async function captureError(
  page: Page,
  dir: string,
  prefix: string = 'error',
  maxFiles: number = 50,
): Promise<ErrorCapture> {
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const base = `${prefix}-${timestamp}`;
  const screenshotPath = path.resolve(dir, `${base}.png`);
  const htmlPath = path.resolve(dir, `${base}.html`);

  await page.screenshot({ path: screenshotPath, fullPage: false });

  const html = await page.content().catch(() => '<!-- failed to capture HTML -->');
  fs.writeFileSync(htmlPath, html, 'utf-8');

  cleanupOldCaptures(dir, maxFiles);

  return { screenshotPath, htmlPath };
}

/** 後方互換: PNG のみ取得したい場合 */
export async function takeScreenshot(
  page: Page,
  dir: string,
  prefix: string = 'screenshot',
  maxFiles: number = 50,
): Promise<string> {
  const { screenshotPath } = await captureError(page, dir, prefix, maxFiles);
  return screenshotPath;
}

function cleanupOldCaptures(dir: string, maxFiles: number): void {
  try {
    // PNG と HTML を別々に maxFiles 件ずつ保持する
    for (const ext of ['.png', '.html']) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(ext))
        .map((f) => ({
          fullPath: path.join(dir, f),
          mtime: fs.statSync(path.join(dir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const file of files.slice(maxFiles)) {
        fs.unlinkSync(file.fullPath);
      }
    }
  } catch {
    // Best-effort cleanup
  }
}
