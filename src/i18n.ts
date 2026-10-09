import { LocalizedError } from './errors';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';

export type Locale = 'en' | 'zh-CN';
export type LanguagePreference = 'auto' | Locale;
export type MessageKey = keyof typeof en;

export function resolveLocale(language: string): Locale {
  return /^zh(?:[-_]|$)/i.test(language) ? 'zh-CN' : 'en';
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'auto' || value === 'en' || value === 'zh-CN';
}

export async function loadLanguage(): Promise<LanguagePreference> {
  const { language } = await chrome.storage.local.get('language');
  return isLanguagePreference(language) ? language : 'auto';
}

export async function saveLanguage(language: LanguagePreference): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.set({ language });
}

export function t(
  locale: Locale,
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  const message = (locale === 'zh-CN' ? zhCN : en)[key];
  const text =
    typeof message === 'string'
      ? message
      : message[
          new Intl.PluralRules(locale).select(Number(values.count)) === 'one' ? 'one' : 'other'
        ];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Missing translation value: ${key}.${name}`);
    return String(value);
  });
}

export function errorMessage(error: unknown, locale: Locale): string {
  if (error instanceof LocalizedError) return t(locale, error.code, error.values);
  return error instanceof Error ? error.message : t(locale, 'errorUnknown');
}

export function localize(root: ParentNode, locale: Locale): void {
  for (const [source, target] of [
    ['data-i18n', null],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-label', 'aria-label'],
    ['data-i18n-title', 'title'],
  ] as const) {
    root.querySelectorAll<HTMLElement>(`[${source}]`).forEach((node) => {
      const text = t(locale, node.getAttribute(source) as MessageKey);
      if (target) node.setAttribute(target, text);
      else node.textContent = text;
    });
  }
}
