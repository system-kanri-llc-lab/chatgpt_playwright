#!/usr/bin/env bash
set -euo pipefail

# ── 1. 仮想ディスプレイ起動 ──────────────────────────────────────────────────
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
XVFB_PID=$!
export DISPLAY=:99
sleep 0.5  # Xvfb の初期化待ち

# ── 2. 認証情報をボリュームからコピー ────────────────────────────────────────
BROWSER_DATA="/root/.chatgpt-brain/browser-data"
mkdir -p "$BROWSER_DATA" /output/logs /output/responses

if [ -d "/auth" ] && [ -n "$(ls -A /auth 2>/dev/null)" ]; then
  cp -r /auth/. "$BROWSER_DATA/"
fi

# ── 3. タスク実行 ─────────────────────────────────────────────────────────────
set +e
RESULT=$(npx tsx /app/src/cli.ts send \
  --prompt "$PROMPT" \
  ${MODEL:+--model "$MODEL"} \
  ${TIMEOUT:+--timeout "$TIMEOUT"} \
  2>/output/logs/chatgpt-brain.log)
EXIT_CODE=$?
set -e

# ── 4. 成果物出力 ─────────────────────────────────────────────────────────────
echo "$RESULT" > /output/result.json

# status が success なら response テキストも別ファイルに保存
if echo "$RESULT" | jq -e '.status == "success"' >/dev/null 2>&1; then
  echo "$RESULT" | jq -r '.response' > /output/responses/response.txt
fi

# ── 5. Xvfb 終了 ─────────────────────────────────────────────────────────────
kill "$XVFB_PID" 2>/dev/null || true

exit "$EXIT_CODE"
