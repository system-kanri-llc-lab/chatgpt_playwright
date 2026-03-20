# chatgpt-brain

ChatGPT Pro の Web UI を Playwright 経由で操作し、テキストの送信・応答取得を自動化する CLI ツール。

AIエージェント（Claude Code / Gemini CLI など）から呼び出すことを前提に設計されており、通常フローは決定論的スクリプトで処理し、エラー発生時のみ Gemini CLI にスクリーンショットベースのリカバリを委譲する。

---

## アーキテクチャ概要

```
呼び出し元エージェント
    │
    ├─ ローカル実行: npx tsx src/cli.ts send --prompt "..."
    │
    └─ コンテナ実行: ./scripts/orchestrate.sh "..."
         │
         └─ docker run --rm dev-{run_id}
              │
              ├─ Xvfb（仮想ディスプレイ）
              ├─ Chromium（Playwright）
              └─ chatgpt-brain CLI
```

### 2つの実行モード

| モード | 用途 | 実行方法 |
|--------|------|----------|
| **ローカル実行** | 開発・デバッグ・単発利用 | `npx tsx src/cli.ts send` |
| **コンテナ実行** | 複数エージェントからの並列呼び出し | `./scripts/orchestrate.sh` |

コンテナモードでは 1プロンプト = 1コンテナ（使い捨て）として動作し、100並列でもポート競合が発生しない。

---

## ディレクトリ構成

```
chatgpt-brain/
├── Dockerfile                  # マルチステージビルド（deps + runtime）
├── docker/
│   └── entrypoint.sh           # コンテナ内タスク実行スクリプト
├── scripts/
│   ├── orchestrate.sh          # 単発エフェメラル実行
│   ├── run-parallel.sh         # 並列実行（CPU×2 上限）
│   └── setup-auth.sh           # 初回ログインセットアップ
├── src/
│   ├── cli.ts                  # CLI エントリポイント
│   ├── server.ts               # HTTP API サーバー（オプション）
│   ├── browser-manager.ts      # ブラウザライフサイクル管理
│   ├── pages/
│   │   └── chatgpt-page.ts     # Page Object Model（セレクタ一元管理）
│   ├── actions/
│   │   ├── send-prompt.ts      # プロンプト送信フロー
│   │   └── get-response.ts     # 応答取得
│   ├── errors/
│   │   ├── error-types.ts      # エラー型定義
│   │   └── error-classifier.ts # エラー分類・exit code マッピング
│   ├── recovery/
│   │   └── gemini-fallback.ts  # Gemini CLI 委譲コンテキスト生成
│   └── utils/
│       ├── config.ts           # 設定管理
│       ├── logger.ts           # 構造化 JSON ログ
│       └── screenshot.ts       # スクリーンショット保存
└── SKILL.md                    # Gemini CLI リカバリスキル定義
```

---

## セットアップ

### 前提条件

- Node.js 22+
- Docker Desktop
- ChatGPT Pro アカウント

### インストール

```bash
npm install
npx playwright install chromium
```

---

## ローカル実行

### 初回: ブラウザにログイン

```bash
npx tsx src/cli.ts session start
# ブラウザが開く → ChatGPT にログイン → Enter で終了
# Cookie は ~/.chatgpt-brain/browser-data/ に永続化
```

### プロンプト送信

```bash
# 基本
npx tsx src/cli.ts send --prompt "質問テキスト"

# stdin から読み込み
echo "質問テキスト" | npx tsx src/cli.ts send --prompt -

# モデル・タイムアウト指定
npx tsx src/cli.ts send --prompt "質問" --model "o3-pro" --timeout 600

# 既存チャットに続きを送信
npx tsx src/cli.ts send --prompt "続きの質問" --conversation-url "https://chatgpt.com/c/xxxx"
```

**成功時の出力（stdout）:**

```json
{
  "status": "success",
  "response": "ChatGPT の応答テキスト全文",
  "conversation_url": "https://chatgpt.com/c/xxxx",
  "model": "o3-pro",
  "elapsed_seconds": 45.2
}
```

**エラー時の出力（stdout）:**

```json
{
  "status": "error",
  "error_type": "selector_not_found",
  "message": "エラー詳細",
  "screenshot_path": "/path/to/screenshots/error-20260319-143022.png",
  "recovery_attempted": false,
  "context": {
    "page_url": "https://chatgpt.com/...",
    "page_title": "...",
    "failed_selector": "..."
  }
}
```

### その他のコマンド

```bash
npx tsx src/cli.ts health           # UI が操作可能か確認
npx tsx src/cli.ts session status   # セッション状態確認
npx tsx src/cli.ts session stop     # ブラウザ終了
```

### Exit Code

| Code | 意味 | 対応 |
|------|------|------|
| `0` | 成功 | 結果を利用 |
| `1` | セレクタ不在（UI変更の可能性） | Gemini CLI に委譲 |
| `2` | タイムアウト | リトライまたは Gemini CLI に委譲 |
| `3` | 認証切れ / CAPTCHA | 人間に通知 |
| `4` | 予期しないページ遷移 | Gemini CLI に委譲 |
| `5` | 不明なエラー | ログ確認 |

---

## コンテナ実行（並列・エフェメラル）

複数のエージェントから同時に呼び出される場合はコンテナモードを使用する。
1コンテナ = 1プロンプト = 使い捨て。ポートを一切使用しない。

### 初回セットアップ

```bash
# 1. イメージビルド
docker build -t chatgpt-brain:latest .

# 2. ホスト上でChatGPTにログインしてvolumeに保存
#    （コンテナ内は仮想ディスプレイのため、ホスト上で実行する）
./scripts/setup-auth.sh
```

> ログイン情報は `chatgpt-auth` Docker volume に保存され、
> 以降のすべてのコンテナで共有される（read-only マウント）。

### 単発実行

```bash
./scripts/orchestrate.sh "DeNA の FDE に転職するメリットは？"
```

**実行ログ（stderr）:**

```
run_id=a1b2c3d4-20260319120000-f7e8
output=./output/a1b2c3d4-20260319120000-f7e8/result.json
```

**成果物（ホスト上に自動出力）:**

```
output/{run_id}/
├── result.json          # 最終結果（JSON）
├── responses/
│   └── response.txt     # 応答テキスト（成功時のみ）
└── logs/
    └── chatgpt-brain.log  # デバッグログ
```

### 並列実行

```bash
# prompts.txt（1行1プロンプト）を並列処理
cat prompts.txt | ./scripts/run-parallel.sh

# インラインで複数プロンプト
printf "質問1\n質問2\n質問3\n" | ./scripts/run-parallel.sh

# 並列数を明示指定
MAX_PARALLEL=4 ./scripts/run-parallel.sh < prompts.txt
```

デフォルトの並列数は `CPU コア数 × 2`。

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `CHATGPT_BRAIN_IMAGE` | `chatgpt-brain:latest` | 使用する Docker イメージ |
| `CHATGPT_AUTH_VOLUME` | `chatgpt-auth` | ログイン情報を保持する volume 名 |
| `MAX_PARALLEL` | `CPU×2` | 最大同時実行数 |
| `OUTPUT_BASE` | `./output` | 成果物の出力先ディレクトリ |
| `MODEL` | （ChatGPT デフォルト） | 使用モデル |
| `TIMEOUT` | `300` | レスポンスタイムアウト（秒） |

### コンテナの命名規則

```
run_id:         {prompt_hash}-{timestamp}-{random}
container_name: dev-{run_id}
network_name:   net-{run_id}
auth_volume:    chatgpt-auth（全実行で共有）
```

コンテナは処理完了後に自動削除（`--rm`）される。
ネットワークも処理完了後に即削除。TTL（24h）による掃除も並走。

---

## HTTP API サーバーモード

コンテナをサーバーとして常駐させたい場合（旧設計）:

```bash
# サーバー起動
npx tsx src/cli.ts server --port 3001

# エージェントから呼び出し
npx tsx src/cli.ts send --server-url http://localhost:3001 --prompt "質問"

# または直接 HTTP
curl -X POST http://localhost:3001/send \
  -H "Content-Type: application/json" \
  -d '{"prompt": "質問テキスト"}'
```

> エフェメラルコンテナ設計（`orchestrate.sh`）の方が並列安全性・クリーンアップの観点で優れるため、通常はこちらを推奨。

---

## 設定ファイル

`~/.chatgpt-brain/config.json`（存在しない場合はデフォルト値を使用）:

```json
{
  "browser": {
    "userDataDir": "~/.chatgpt-brain/browser-data",
    "headless": false,
    "viewport": { "width": 1280, "height": 800 }
  },
  "chatgpt": {
    "baseUrl": "https://chatgpt.com",
    "defaultModel": null,
    "responseTimeoutSeconds": 300
  },
  "screenshots": {
    "dir": "~/.chatgpt-brain/screenshots",
    "maxFiles": 50
  },
  "logs": {
    "dir": "~/.chatgpt-brain/logs",
    "level": "info",
    "maxFiles": 30
  }
}
```

---

## Gemini CLI との連携

エラー発生時、呼び出し元スクリプトが Gemini CLI にリカバリを委譲できる。
`SKILL.md` に Gemini CLI 用のスキル定義が記載されている。

```bash
# 統合スクリプト例
RESULT=$(npx tsx src/cli.ts send --prompt "$PROMPT")
EXIT_CODE=$?

if [ $EXIT_CODE -eq 1 ] || [ $EXIT_CODE -eq 4 ]; then
  SCREENSHOT=$(echo "$RESULT" | jq -r '.screenshot_path')
  gemini -skill chatgpt-brain-recovery \
    --context "$RESULT" \
    --image "$SCREENSHOT" \
    --prompt "リカバリしてください。送信プロンプト: $PROMPT"
fi
```

---

## トラブルシューティング

### セレクタが壊れた場合

ChatGPT の UI 変更によりセレクタが機能しなくなった場合は `src/pages/chatgpt-page.ts` 冒頭の `SELECTORS` 定数のみ修正する。

```typescript
const SELECTORS = {
  promptTextarea: '[data-testid="composer-input"], #prompt-textarea',
  sendButton: '[data-testid="send-button"]',
  // ...
} as const;
```

### 応答完了が検知されない場合

`waitForResponse` は以下の OR 条件で完了を判定している:

1. **Stop ボタン消失** (`[data-testid="stop-button"]` が見えなくなる)
2. **継続中バナー消失** (「ChatGPTは引き続き回答を続けています」が消える)
3. **テキスト安定化** (2秒ごとのポーリングで3回連続して長さが変わらない)

ログの `signal` フィールドでどれが発火したか確認できる。

### コンテナが残っている場合

```bash
# 確認
docker ps -a | grep dev-

# 強制削除
docker rm -f $(docker ps -a -q --filter "name=dev-")
docker network prune -f
```
