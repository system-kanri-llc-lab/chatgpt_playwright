#!/usr/bin/env bash
# ChatGPT ログインセッションを一度だけ実行し、Docker volume に保存する。
# コンテナ内では仮想ディスプレイのため、ホスト上で実行すること。
set -euo pipefail

AUTH_VOLUME="${CHATGPT_AUTH_VOLUME:-chatgpt-auth}"
BROWSER_DATA_HOST="${HOME}/.chatgpt-brain/browser-data"

echo "=== ChatGPT Auth Setup ===" >&2
echo "ホスト上でブラウザを起動します。ChatGPT にログインして Enter を押してください。" >&2
echo "" >&2

# ── ステップ1: ホスト上でセッション開始（実ディスプレイ使用）─────────────────
if ! command -v npx &>/dev/null; then
  echo "Error: npx not found. Run this from the project root after npm install." >&2
  exit 1
fi

npx tsx "$(dirname "$0")/../src/cli.ts" session start

# ── ステップ2: Docker volume を作成して cookies をコピー ─────────────────────
if [ ! -d "$BROWSER_DATA_HOST" ] || [ -z "$(ls -A "$BROWSER_DATA_HOST" 2>/dev/null)" ]; then
  echo "Error: Browser data not found at ${BROWSER_DATA_HOST}. Did login succeed?" >&2
  exit 1
fi

echo "" >&2
echo "認証データを Docker volume '${AUTH_VOLUME}' にコピー中..." >&2

docker volume create "$AUTH_VOLUME" >/dev/null

docker run \
  --rm \
  -v "${BROWSER_DATA_HOST}:/src:ro" \
  -v "${AUTH_VOLUME}:/dest" \
  alpine \
  sh -c 'cp -r /src/. /dest/ && echo "Copied $(find /dest -type f | wc -l) files."' >&2

echo "" >&2
echo "完了。以降は ./scripts/orchestrate.sh で認証済みコンテナを起動できます。" >&2
echo "  AUTH_VOLUME=${AUTH_VOLUME}" >&2
