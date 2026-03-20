# chatgpt-brain Skill Definition

This file defines the Gemini CLI skill interface for the `chatgpt-brain` tool.

## Skill Metadata

```yaml
name: chatgpt-brain
version: 1.0.0
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
| `--model <model>` | string | Model to use (e.g. `o3-pro`, `gpt-4o`) |
| `--timeout <seconds>` | number | Response timeout in seconds (default: 300) |
| `--no-new-chat` | flag | Reuse the existing chat instead of starting a new one |
| `--conversation-url <url>` | string | Open a specific conversation URL |

**Success output (stdout):**

```json
{
  "status": "success",
  "response": "The full text response from ChatGPT",
  "conversation_url": "https://chatgpt.com/c/xxxx",
  "model": "o3-pro",
  "elapsed_seconds": 45.2
}
```

**Error output (stdout):**

```json
{
  "status": "error",
  "error_type": "selector_not_found",
  "message": "Selector not found: ...",
  "screenshot_path": "/path/to/error-screenshot.png",
  "recovery_attempted": false,
  "context": {
    "page_url": "https://chatgpt.com/...",
    "page_title": "ChatGPT",
    "failed_selector": "[data-testid=\"composer-input\"]"
  }
}
```

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

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Selector not found (UI may have changed) |
| 2 | Response timeout |
| 3 | Authentication expired or CAPTCHA detected |
| 4 | Unexpected page navigation |
| 5 | Unknown error |

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

## Gemini CLI Integration

When `chatgpt-brain` fails with a non-zero exit code, the shell wrapper can
delegate to Gemini CLI using the error context:

```bash
#!/bin/bash
# Example wrapper script

RESULT=$(chatgpt-brain send --prompt "$PROMPT" 2>/dev/null)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  ERROR_TYPE=$(echo "$RESULT" | jq -r '.error_type')
  MESSAGE=$(echo "$RESULT" | jq -r '.message')
  SCREENSHOT=$(echo "$RESULT" | jq -r '.screenshot_path // ""')

  # Build context for Gemini fallback
  CONTEXT="ChatGPT automation failed.
Error type: $ERROR_TYPE
Message: $MESSAGE
Screenshot: $SCREENSHOT

Please answer the following prompt directly:
$PROMPT"

  # Delegate to Gemini CLI
  echo "$CONTEXT" | gemini
else
  echo "$RESULT" | jq -r '.response'
fi
```

## Recovery Context Format

The `buildGeminiContext(error, prompt)` function from `src/recovery/gemini-fallback.ts`
produces a structured context string for Gemini CLI delegation:

```
=== ChatGPT Brain Automation Error Context ===

Error Type: selector_not_found
Exit Code: 1
Message: Selector not found: "[data-testid="composer-input"]"

=== Original Error Details ===
{
  "name": "SelectorNotFoundError",
  "message": "...",
  "stack": "..."
}

=== Original Prompt ===
<the original prompt text>

=== Recovery Instructions ===
The ChatGPT web automation failed. Please handle the following prompt directly:

<the original prompt text>
```
