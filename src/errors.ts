import type { en } from './locales/en';

export class LocalizedError extends Error {
  constructor(
    readonly code: Extract<keyof typeof en, `error${string}`>,
    readonly values: Record<string, string | number> = {},
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'LocalizedError';
  }
}
