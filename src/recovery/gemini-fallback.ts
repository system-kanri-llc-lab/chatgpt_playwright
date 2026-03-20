import { classifyError } from '../errors/error-classifier.js';

export function buildGeminiContext(error: unknown, prompt: string): string {
  const classified = classifyError(error);

  const errorDetails = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    : { message: String(error) };

  const context = [
    '=== ChatGPT Brain Automation Error Context ===',
    '',
    `Error Type: ${classified.errorType}`,
    `Exit Code: ${classified.exitCode}`,
    `Message: ${classified.message}`,
    '',
    '=== Original Error Details ===',
    JSON.stringify(errorDetails, null, 2),
    '',
    '=== Original Prompt ===',
    prompt,
    '',
    '=== Recovery Instructions ===',
    'The ChatGPT web automation failed. Please handle the following prompt directly:',
    '',
    prompt,
  ].join('\n');

  return context;
}
