# chatgpt-brain Skill Definition

This file defines the skill interface for the `chatgpt-brain` tool, intended for use by AI agents (Claude Code, Gemini CLI, etc.).

## Skill Metadata

```yaml
name: chatgpt-brain
version: 1.2.0
description: Automate ChatGPT Web UI via Playwright to send prompts and retrieve responses
```

## Invocation

```bash
chatgpt-brain send --prompt "Your prompt here" [options]
```

Or via stdin:

```bash
echo "Your prompt here" | chatgpt-brain send --prompt -
```

## Commands

### send

Send a prompt to ChatGPT and get the response as JSON.

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `--prompt <text>` | string | The prompt to send. Use `"-"` to read from stdin |
| `--model <model>` | string | Model: `instant` / `thinking` (default) / `pro` / `deepresearch` |
| `--timeout <seconds>` | number | Response timeout in seconds (default: 300) |
| `--no-new-chat` | flag | Reuse the existing chat instead of starting a new one |
| `--conversation-url <url>` | string | Open a specific conversation URL |
| `--project <id>` | string | Project slug to chat within (see below) |
| `--server-url <url>` | string | Delegate to a running chatgpt-brain HTTP server |

**`--project` value:** The slug segment from the project URL.
`https://chatgpt.com/g/g-p-6951fdcf1b2c8191916bc565cc4197f2-yin-le-ahuri/project`
→ pass `g-p-6951fdcf1b2c8191916bc565cc4197f2-yin-le-ahuri`

**Model values:**

| Value | ChatGPT model |
|-------|---------------|
| `instant` | GPT-4o mini (fast, low cost) |
| `thinking` | o3 (default) |
| `pro` | o3 Pro |
| `deepresearch` | Deep Research (selected via composer + button) |

**Success output (stdout):**

```json
{
  "status": "success",
  "response": "The full text response from ChatGPT",
  "conversation_url": "https://chatgpt.com/c/xxxx",
  "model": "thinking",
  "elapsed_seconds": 45.2
}
```

**DeepResearch output (stdout) — returned immediately after submission:**

```json
{
  "status": "research_started",
  "conversation_url": "https://chatgpt.com/c/xxxx",
  "model": "deepresearch",
  "elapsed_seconds": 3.5,
  "message": "Deep Research を開始しました。完了後に watch コマンドで結果を取得してください。",
  "watch_hint": "npx tsx src/cli.ts watch --conversation-url \"https://chatgpt.com/c/xxxx\""
}
```

**Error output (stdout):**

```json
{
  "status": "error",
  "error_type": "selector_not_found",
  "message": "Selector not found: ...",
  "screenshot_path": "/path/to/error-20260321-143022.png",
  "html_path": "/path/to/error-20260321-143022.html",
  "recovery_attempted": true,
  "context": {
    "page_url": "https://chatgpt.com/...",
    "page_title": "ChatGPT",
    "failed_selector": "[data-testid=\"model-switcher-dropdown-button\"]",
    "selector_file": "/path/to/src/pages/model-selector.ts"
  }
}
```

### watch

Poll a conversation URL until the Deep Research response is complete.

```bash
chatgpt-brain watch --conversation-url <url> [--poll-interval <seconds>] [--timeout <seconds>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--conversation-url <url>` | required | Conversation URL returned by `send --model deepresearch` |
| `--poll-interval <seconds>` | `300` | How often to check (seconds) |
| `--timeout <seconds>` | `86400` | Maximum wait time (default: 24h) |

Returns the same `status: success` JSON as a normal `send` when complete.

### session start

Launch the browser and open ChatGPT for manual login. Keeps the browser open until Enter is pressed.

```bash
chatgpt-brain session start
```

### session status

Check if the browser session is currently active.

```bash
chatgpt-brain session status
```

### session stop

Stop the active browser session.

```bash
chatgpt-brain session stop
```

### health

Check if the ChatGPT UI is accessible and authenticated.

```bash
chatgpt-brain health
```

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Use the result |
| 1 | Selector not found (UI may have changed) | Gemini CLI auto-invoked for recovery |
| 2 | Response timeout | Retry or escalate |
| 3 | Authentication expired or CAPTCHA detected | Notify human |
| 4 | Unexpected page navigation | Escalate |
| 5 | Unknown error | Check logs |

## Gemini CLI Auto-Recovery

When exit code 1 (`selector_not_found`) occurs, `chatgpt-brain` automatically:

1. Saves a **PNG screenshot** and **HTML source** as a pair
2. Backs up `src/pages/model-selector.ts` as `.bak`
3. Invokes **Gemini CLI** with `--image screenshot.png` and a repair prompt via stdin
4. Prints Gemini's fix suggestion to stderr (`recovery_attempted: true` in JSON output)

The repair prompt template is at `prompts/gemini-selector-fix.md`. Gemini is instructed to output the full corrected `model-selector.ts` so the agent can apply it directly.

**stderr during recovery:**
```
[recovery] セレクタエラーを検出。Gemini CLI に修正を依頼します...
  screenshot : ~/.chatgpt-brain/screenshots/error-20260321-143022.png
  html       : ~/.chatgpt-brain/screenshots/error-20260321-143022.html
  selector   : /path/to/src/pages/model-selector.ts

[recovery] Gemini の修正提案:
────────────────────────────────────────────────────────────
### 変更理由
...
### 修正後のコード
```typescript
...
```
────────────────────────────────────────────────────────────
```

## Configuration

Config file: `~/.chatgpt-brain/config.json`

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

## Calling from a Shell Script

```bash
#!/bin/bash
RESULT=$(chatgpt-brain send --prompt "$PROMPT" 2>/dev/null)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "$RESULT" | jq .
  exit $EXIT_CODE
fi

STATUS=$(echo "$RESULT" | jq -r '.status')

if [ "$STATUS" = "success" ]; then
  echo "$RESULT" | jq -r '.response'
elif [ "$STATUS" = "research_started" ]; then
  CONV_URL=$(echo "$RESULT" | jq -r '.conversation_url')
  echo "[DeepResearch started] $CONV_URL" >&2
  # 完了を待つ場合:
  chatgpt-brain watch --conversation-url "$CONV_URL" | jq -r '.response'
fi
```

For selector errors (exit code 1), Gemini recovery runs automatically during the `chatgpt-brain send` call. The corrected `model-selector.ts` content is printed to stderr and can be applied to restore functionality.
