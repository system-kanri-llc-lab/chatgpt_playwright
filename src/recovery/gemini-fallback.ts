import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_TEMPLATE_PATH = path.resolve(__dirname, '../../prompts/gemini-selector-fix.md');

const HTML_MAX_CHARS = 80_000;

/**
 * HTML からサイドバーを除いたメインコンテンツ領域を抽出する。
 *
 * ChatGPT の DOM 構造:
 *   <div class="@container/main ...">  ← ここがメインコンテンツ（<main> タグは存在しない）
 *     モデル選択ボタン / コンポーザー / 応答 など
 *   </div>
 *   サイドバーは上記の外側（兄弟要素）にあるため自動的に除外される。
 *
 * <div> のネスト深さをカウントして正確に閉じタグを特定する。
 */
function extractMainContent(html: string): string {
  // ChatGPT のメインコンテナを示すクラス
  const MAIN_MARKER = '@container/main';

  const markerIdx = html.indexOf(MAIN_MARKER);
  if (markerIdx === -1) {
    // フォールバック: 先頭 HTML_MAX_CHARS 文字
    return html.slice(0, HTML_MAX_CHARS);
  }

  // マーカー位置から直前の <div まで戻る
  const startIdx = html.lastIndexOf('<div', markerIdx);
  if (startIdx === -1) {
    return html.slice(markerIdx, markerIdx + HTML_MAX_CHARS);
  }

  // <div> / </div> のネストを数えて対応する閉じタグを探す
  let depth = 0;
  let i = startIdx;
  while (i < html.length) {
    if (html.startsWith('<div', i) && /[\s>]/.test(html[i + 4] ?? '')) {
      depth++;
      i += 4;
    } else if (html.startsWith('</div>', i)) {
      depth--;
      if (depth === 0) {
        const extracted = html.slice(startIdx, i + 6);
        return extracted.length > HTML_MAX_CHARS
          ? extracted.slice(0, HTML_MAX_CHARS) + '\n<!-- ...truncated... -->'
          : extracted;
      }
      i += 6;
    } else {
      i++;
    }
  }

  return html.slice(startIdx, startIdx + HTML_MAX_CHARS);
}

export interface GeminiRecoveryInput {
  screenshotPath: string;
  htmlPath: string;
  selectorFilePath: string;
  errorJson: object;
}

export interface GeminiRecoveryResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Gemini CLI を起動してセレクタ修正提案を取得する。
 *
 * 渡す情報:
 *   --image <screenshot>  : 現在の画面状態（PNG）
 *   stdin                 : prompts/gemini-selector-fix.md の内容に
 *                           HTML / セレクタファイル / エラー JSON を埋め込んだプロンプト
 *
 * セレクタファイルは実行前に .bak として自動バックアップする。
 */
export async function invokeGeminiRecovery(
  input: GeminiRecoveryInput,
): Promise<GeminiRecoveryResult> {
  const logger = new Logger();
  logger.info('geminiRecovery', { step: 'start', ...input });

  // ── プロンプトテンプレート読み込み・置換 ────────────────────────────────
  const template = fs.readFileSync(PROMPT_TEMPLATE_PATH, 'utf-8');
  const selectorContent = fs.readFileSync(input.selectorFilePath, 'utf-8');
  const htmlRaw = fs.readFileSync(input.htmlPath, 'utf-8');
  // サイドバーを除外し <main> コンテンツのみ抽出
  const htmlContent = extractMainContent(htmlRaw);

  const filledPrompt = template
    .replace('{{ERROR_JSON}}', JSON.stringify(input.errorJson, null, 2))
    .replace('{{SELECTOR_FILE_PATH}}', input.selectorFilePath)
    .replace('{{SELECTOR_FILE_CONTENT}}', selectorContent)
    .replace('{{HTML_PATH}}', input.htmlPath)
    .replace('{{HTML_CONTENT}}', htmlContent);

  // ── セレクタファイルをバックアップ ───────────────────────────────────────
  const bakPath = `${input.selectorFilePath}.bak`;
  fs.copyFileSync(input.selectorFilePath, bakPath);
  logger.info('geminiRecovery', { step: 'backup_created', bakPath });

  // ── Gemini CLI 起動 ───────────────────────────────────────────────────────
  // PNG はマルチモーダル入力として --image で渡す
  // プロンプト本文（HTML・セレクタファイル埋め込み済み）は stdin で渡す
  return new Promise((resolve) => {
    const args = ['--image', input.screenshotPath];
    const proc = spawn('gemini', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.write(filledPrompt);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      logger.error('geminiRecovery', { step: 'spawn_error', error: err.message });
      resolve({ success: false, output: '', error: err.message });
    });

    proc.on('close', (code) => {
      logger.info('geminiRecovery', { step: 'done', exitCode: code });
      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        resolve({ success: false, output: stdout, error: stderr || `exit code ${code}` });
      }
    });
  });
}
