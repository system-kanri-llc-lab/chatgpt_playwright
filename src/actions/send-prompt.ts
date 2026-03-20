import { BrowserManager } from '../browser-manager.js';
import { ChatGPTPage } from '../pages/chatgpt-page.js';
import { loadConfig } from '../utils/config.js';
import { Logger } from '../utils/logger.js';

export interface SendPromptOptions {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  newChat?: boolean;
  conversationUrl?: string;
}

export interface SendPromptResult {
  status: 'success';
  response: string;
  conversation_url: string;
  model: string | null;
  elapsed_seconds: number;
}

export async function sendPromptAction(options: SendPromptOptions): Promise<SendPromptResult> {
  const logger = new Logger();
  const config = loadConfig();
  const startTime = Date.now();

  const {
    prompt,
    model,
    timeoutMs,
    newChat = true,
    conversationUrl,
  } = options;

  const effectiveTimeoutMs = timeoutMs ?? config.chatgpt.responseTimeoutSeconds * 1000;
  const effectiveModel = model ?? config.chatgpt.defaultModel ?? undefined;

  logger.info('sendPromptAction', { step: 'start', promptLength: prompt.length, model: effectiveModel, newChat });

  // Step 1: Launch browser
  const browserManager = BrowserManager.getInstance();
  await browserManager.launch();

  // Step 2: Get page
  const page = await browserManager.getPage();
  const chatgptPage = new ChatGPTPage(page);

  // Step 3: Navigate
  await chatgptPage.navigate();

  // Step 4: ensureAuthenticated
  await chatgptPage.ensureAuthenticated();

  // Step 5: ensureNoCaptcha
  await chatgptPage.ensureNoCaptcha();

  // Step 6: new chat or conversation
  if (conversationUrl) {
    await chatgptPage.openConversation(conversationUrl);
  } else if (newChat) {
    await chatgptPage.startNewChat();
  }

  // Step 7: Select model
  // 前回チャットのモデルが引き継がれるため、未指定時も Thinking を明示選択する
  await chatgptPage.selectModel(effectiveModel ?? 'thinking');

  // Step 8: Send prompt
  await chatgptPage.sendPrompt(prompt);

  // Step 9: Wait for response
  await chatgptPage.waitForResponse(effectiveTimeoutMs);

  // Step 10: Get last response
  const response = await chatgptPage.getLastResponse();

  // Step 11: Get current URL
  const conversationResultUrl = chatgptPage.getCurrentUrl();

  const elapsed = (Date.now() - startTime) / 1000;

  logger.info('sendPromptAction', {
    step: 'done',
    elapsed_seconds: elapsed,
    responseLength: response.length,
    conversationUrl: conversationResultUrl,
  });

  return {
    status: 'success',
    response,
    conversation_url: conversationResultUrl,
    model: effectiveModel ?? null,
    elapsed_seconds: Math.round(elapsed * 10) / 10,
  };
}
