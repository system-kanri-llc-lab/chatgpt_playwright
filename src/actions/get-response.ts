import type { Page } from 'playwright';
import { ChatGPTPage } from '../pages/chatgpt-page.js';
import { Logger } from '../utils/logger.js';

export interface GetResponseResult {
  response: string;
  conversationUrl: string;
}

export async function getResponseAction(page: Page): Promise<GetResponseResult> {
  const logger = new Logger();
  logger.info('getResponseAction', { step: 'start' });

  const chatgptPage = new ChatGPTPage(page);
  const response = await chatgptPage.getLastResponse();
  const conversationUrl = chatgptPage.getCurrentUrl();

  logger.info('getResponseAction', { step: 'done', responseLength: response.length });

  return { response, conversationUrl };
}
