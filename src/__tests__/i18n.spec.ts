import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizedError } from '../errors';
import { errorMessage, loadLanguage, resolveLocale, saveLanguage, t } from '../i18n';

afterEach(() => vi.unstubAllGlobals());

describe('language selection', () => {
  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh-Hant-TW', 'zh-CN'],
    ['ZH_sg', 'zh-CN'],
    ['en-GB', 'en'],
    ['ja-JP', 'en'],
  ])('resolves browser language %s to %s', (browser, expected) => {
    expect(resolveLocale(browser)).toBe(expected);
  });

  it.each([undefined, 'unsupported', null])(
    'uses the browser default for invalid stored preference %s',
    async (language) => {
      vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ language }) } } });
      expect(await loadLanguage()).toBe('auto');
    },
  );

  it('persists language independently of AI settings without requesting host access', async () => {
    const stored: Record<string, unknown> = { settings: { apiKey: 'private-key' } };
    const setAccessLevel = vi
      .fn<(options: { accessLevel: string }) => Promise<void>>()
      .mockResolvedValue();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          setAccessLevel,
          set: async (items: Record<string, unknown>) => {
            Object.assign(stored, items);
          },
          get: async (key: string) => ({ [key]: stored[key] }),
        },
      },
    });
    await saveLanguage('en');
    expect(await loadLanguage()).toBe('en');
    expect(stored.settings).toEqual({ apiKey: 'private-key' });
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });
});

describe('localized messages', () => {
  it.each([
    ['en', 0, '0 tabs selected'],
    ['en', 1, '1 tab selected'],
    ['en', 2, '2 tabs selected'],
    ['zh-CN', 1, '已选择 1 个标签'],
    ['zh-CN', 2, '已选择 2 个标签'],
  ] as const)('formats %s selection counts for %s tabs', (locale, count, expected) => {
    expect(t(locale, 'selectedCount', { count })).toBe(expected);
  });

  it('preserves user text during interpolation and rejects missing values', () => {
    const title = '<img src=x> {count} $&';
    expect(t('en', 'applyGroup', { title })).toBe(`Apply group ${title}`);
    expect(() => t('en', 'applyGroup')).toThrow('Missing translation value: applyGroup.title');
  });

  it('renders the same structured error in the chosen language without exposing its cause', () => {
    const error = new LocalizedError(
      'errorHttpAuth',
      { status: 401 },
      { cause: new Error('private-key') },
    );
    expect(errorMessage(error, 'en')).toBe(
      'AI service returned HTTP 401. Check your API key and model access.',
    );
    expect(errorMessage(error, 'zh-CN')).toBe(
      'AI 服务返回 HTTP 401。请检查 API Key 和模型访问权限。',
    );
    expect(errorMessage(new Error('Chrome error'), 'en')).toBe('Chrome error');
    expect(errorMessage(null, 'zh-CN')).toBe('操作没有完成，请重试。');
  });
});
