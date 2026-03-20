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

export async function takeScreenshot(
  page: Page,
  dir: string,
  prefix: string = 'screenshot',
  maxFiles: number = 50,
): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const filename = `${prefix}-${timestamp}.png`;
  const fullPath = path.resolve(dir, filename);

  await page.screenshot({ path: fullPath, fullPage: false });

  cleanupOldScreenshots(dir, maxFiles);

  return fullPath;
}

function cleanupOldScreenshots(dir: string, maxFiles: number): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({
        name: f,
        fullPath: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > maxFiles) {
      const toDelete = files.slice(maxFiles);
      for (const file of toDelete) {
        fs.unlinkSync(file.fullPath);
      }
    }
  } catch {
    // Best-effort cleanup
  }
}
