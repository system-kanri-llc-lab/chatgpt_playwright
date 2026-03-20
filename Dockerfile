# ── Stage 1: deps ─────────────────────────────────────────────────────────────
# npm install をキャッシュ。ソースコード変更時にも再実行されない。
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# Playwright公式イメージ (Chromium + 依存ライブラリ同梱)
FROM mcr.microsoft.com/playwright:v1.50.0-noble AS runtime
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends xvfb jq && \
    rm -rf /var/lib/apt/lists/*

# deps ステージから node_modules をコピー（Chromiumはplaywright imageに同梱）
COPY --from=deps /app/node_modules ./node_modules

# ソースを最後にコピー（キャッシュ効率最大化）
COPY . .
RUN chmod +x docker/entrypoint.sh

ENTRYPOINT ["./docker/entrypoint.sh"]
