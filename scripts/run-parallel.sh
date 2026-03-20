#!/usr/bin/env bash
# Usage: echo -e "prompt1\nprompt2" | ./scripts/run-parallel.sh
# Or:    cat prompts.txt | ./scripts/run-parallel.sh
set -euo pipefail

CPU_COUNT=$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)
MAX_PARALLEL="${MAX_PARALLEL:-$(( CPU_COUNT * 2 ))}"
OUTPUT_BASE="${OUTPUT_BASE:-$(pwd)/output}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf 'Parallel limit: %s  Output: %s\n' "$MAX_PARALLEL" "$OUTPUT_BASE" >&2

# ── セマフォ実装 ──────────────────────────────────────────────────────────────
SEMAPHORE_DIR=$(mktemp -d)
cleanup() { rm -rf "$SEMAPHORE_DIR"; }
trap cleanup EXIT

acquire_slot() {
  while true; do
    # 終了済みプロセスのスロットを回収
    for slot_file in "$SEMAPHORE_DIR"/*.pid 2>/dev/null; do
      [ -f "$slot_file" ] || continue
      local pid
      pid=$(cat "$slot_file")
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$slot_file"
      fi
    done

    local active
    active=$(ls "$SEMAPHORE_DIR"/*.pid 2>/dev/null | wc -l || echo 0)
    if [ "$active" -lt "$MAX_PARALLEL" ]; then
      break
    fi
    sleep 0.3
  done
}

release_slot() {
  local pid="$1"
  rm -f "${SEMAPHORE_DIR}/${pid}.pid" 2>/dev/null || true
}

pids=()

while IFS= read -r prompt; do
  [ -z "$prompt" ] && continue

  acquire_slot

  (
    echo $$ > "${SEMAPHORE_DIR}/$$.pid"
    "$SCRIPT_DIR/orchestrate.sh" "$prompt" "$OUTPUT_BASE"
    release_slot $$
  ) &
  pids+=($!)
done

# 全ジョブ完了待ち
for pid in "${pids[@]}"; do
  wait "$pid" || true
done

printf 'All tasks completed. Results in: %s\n' "$OUTPUT_BASE" >&2
