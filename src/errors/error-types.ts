export class SelectorNotFoundError extends Error {
  public readonly selector: string;
  public readonly context: string;
  /** 修正すべきセレクタファイルの絶対パス。Gemini CLI が参照する。 */
  public readonly selectorFile?: string;

  constructor(selector: string, context: string = '', selectorFile?: string) {
    super(`Selector not found: "${selector}"${context ? ` (${context})` : ''}. UI may have changed.`);
    this.name = 'SelectorNotFoundError';
    this.selector = selector;
    this.context = context;
    this.selectorFile = selectorFile;
  }
}

export class ResponseTimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly stage: string;

  constructor(timeoutMs: number, stage: string = 'response') {
    super(`Response wait timeout after ${timeoutMs}ms at stage: ${stage}`);
    this.name = 'ResponseTimeoutError';
    this.timeoutMs = timeoutMs;
    this.stage = stage;
  }
}

export class AuthExpiredError extends Error {
  public readonly pageUrl: string;

  constructor(pageUrl: string = '') {
    super(`Authentication expired or not logged in${pageUrl ? ` at ${pageUrl}` : ''}`);
    this.name = 'AuthExpiredError';
    this.pageUrl = pageUrl;
  }
}

export class CaptchaError extends Error {
  public readonly captchaType: string;
  public readonly pageUrl: string;

  constructor(captchaType: string = 'unknown', pageUrl: string = '') {
    super(`CAPTCHA detected (type: ${captchaType})${pageUrl ? ` at ${pageUrl}` : ''}`);
    this.name = 'CaptchaError';
    this.captchaType = captchaType;
    this.pageUrl = pageUrl;
  }
}

export class UnexpectedNavigationError extends Error {
  public readonly expectedUrl: string;
  public readonly actualUrl: string;

  constructor(expectedUrl: string, actualUrl: string) {
    super(`Unexpected navigation: expected "${expectedUrl}", got "${actualUrl}"`);
    this.name = 'UnexpectedNavigationError';
    this.expectedUrl = expectedUrl;
    this.actualUrl = actualUrl;
  }
}
