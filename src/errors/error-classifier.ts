import {
  SelectorNotFoundError,
  ResponseTimeoutError,
  AuthExpiredError,
  CaptchaError,
  UnexpectedNavigationError,
} from './error-types.js';

export interface ClassifiedError {
  exitCode: number;
  errorType: string;
  message: string;
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof SelectorNotFoundError) {
    return {
      exitCode: 1,
      errorType: 'selector_not_found',
      message: error.message,
    };
  }

  if (error instanceof ResponseTimeoutError) {
    return {
      exitCode: 2,
      errorType: 'response_timeout',
      message: error.message,
    };
  }

  if (error instanceof AuthExpiredError) {
    return {
      exitCode: 3,
      errorType: 'auth_expired',
      message: error.message,
    };
  }

  if (error instanceof CaptchaError) {
    return {
      exitCode: 3,
      errorType: 'captcha',
      message: error.message,
    };
  }

  if (error instanceof UnexpectedNavigationError) {
    return {
      exitCode: 4,
      errorType: 'unexpected_navigation',
      message: error.message,
    };
  }

  const message =
    error instanceof Error ? error.message : String(error);

  return {
    exitCode: 5,
    errorType: 'unknown',
    message,
  };
}
