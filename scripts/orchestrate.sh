#!/usr/bin/env bash
# Usage: ./scripts/orchestrate.sh "<prompt>" [output_base_dir]
set -euo pipefail

PROMPT="${1:?Usage: orchestrate.sh <prompt> [output_base_dir]}"
OUTPUT_BASE="${2:-$(pwd)/output}"
IMAGE="${CHATGPT_BRAIN_IMAGE:-chatgpt-brain:latest}"
AUTH_VOLUME="${CHATGPT_AUTH_VOLUME:-chatgpt-auth}"

# ── 1. run_id 生成 ────────────────────────────────────────────────────────────
if command -v md5sum &>/dev/null; then
  PROMPT_HASH=$(printf '%s' "$PROMPT" | md5sum | cut -c1-8)
else
  PROMPT_HASH=$(printf '%s' "$PROMPT" | md5 | cut -c1-8)
fi
TIMESTAMP=$(date +%Y%m%d%H%M%S)
RANDOM_SUFFIX=$(openssl rand -hex 4)
RUN_ID="${PROMPT_HASH}-${TIMESTAMP}-${RANDOM_SUFFIX}"

CONTAINER_NAME="dev-${RUN_ID}"
NETWORK_NAME="net-${RUN_ID}"
OUTPUT_DIR="${OUTPUT_BASE}/${RUN_ID}"

printf 'run_id=%s\n' "$RUN_ID" >&2

# ── 2. 出力ディレクトリ作成 ───────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR"

# ── 3. 隔離ネットワーク作成 ───────────────────────────────────────────────────
docker network create "$NETWORK_NAME" >/dev/null

# ── 4. TTL削除（24h後にゾンビ掃除）─────────────────────────────────────────
(
  sleep 86400
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
  docker network rm "$NETWORK_NAME" 2>/dev/null || true
) &
disown

# ── 5. 一時コンテナ起動 ───────────────────────────────────────────────────────
# --rm: 終了後に自動削除
# ポート公開なし（ホスト↔コンテナ間はボリュームのみ）
docker run \
  --name "$CONTAINER_NAME" \
  --network "$NETWORK_NAME" \
  --rm \
  --shm-size=2gb \
  -e PROMPT="$PROMPT" \
  ${MODEL:+-e MODEL="$MODEL"} \
  ${TIMEOUT:+-e TIMEOUT="$TIMEOUT"} \
  -v "${AUTH_VOLUME}:/auth:ro" \
  -v "${OUTPUT_DIR}:/output" \
  "$IMAGE"

CONTAINER_EXIT=$?

# ── 6. ネットワーク削除（コンテナは --rm で既に削除済み）───────────────────
docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true

# ── 7. 結果を stdout に出力 ───────────────────────────────────────────────────
printf 'output=%s/result.json\n' "$OUTPUT_DIR" >&2

if [ -f "${OUTPUT_DIR}/result.json" ]; then
  cat "${OUTPUT_DIR}/result.json"
else
  printf '{"status":"error","error_type":"container_failed","message":"Container exited without producing result.json","exit_code":%d}\n' "$CONTAINER_EXIT"
fi

exit "$CONTAINER_EXIT"
