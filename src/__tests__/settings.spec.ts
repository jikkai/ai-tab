import { afterEach, describe, expect, it, vi } from 'vitest';

import { endpointFor, normalizeSettings, permissionFor, saveSettings } from '../settings';

const settings = {
  baseUrl: 'https://ai.example/v1/',
  apiKey: ' key ',
  model: ' my-model ',
  instructions: '',
};

afterEach(() => vi.unstubAllGlobals());

describe('AI service settings', () => {
  it('accepts a base URL or a full completion endpoint without appending the path twice', () => {
    const clean = normalizeSettings(settings);
    expect(endpointFor(clean.baseUrl)).toBe('https://ai.example/v1/chat/completions');
    expect(endpointFor('https://ai.example/v1/chat/completions')).toBe(
      'https://ai.example/v1/chat/completions',
    );
    expect(clean.apiKey).toBe('key');
    expect(clean.model).toBe('my-model');
  });

  it('accepts keyless local services and requests a Chrome host pattern without a port', () => {
    const local = normalizeSettings({
      ...settings,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
    });
    expect(local.apiKey).toBe('');
    expect(permissionFor(local.baseUrl)).toBe('http://localhost/*');
  });

  it.each([
    ['http://remote.example/v1', 'errorHttpsRequired'],
    ['https://user:secret@ai.example/v1', 'errorUrlCredentials'],
    ['https://ai.example/v1?key=secret', 'errorUrlCredentials'],
    ['https://ai.example/#secret', 'errorUrlCredentials'],
    ['file:///tmp/model', 'errorHttpsRequired'],
    ['not a url', 'errorInvalidUrl'],
  ])('rejects unsafe endpoint %s', (baseUrl, message) => {
    expect(() => normalizeSettings({ ...settings, baseUrl })).toThrow(message);
  });

  it('does not save credentials when host permission is denied', async () => {
    const set = vi.fn<(items: Record<string, unknown>) => Promise<void>>();
    vi.stubGlobal('chrome', {
      permissions: {
        request: vi
          .fn<(permissions: chrome.permissions.Permissions) => Promise<boolean>>()
          .mockResolvedValue(false),
      },
      storage: { local: { set } },
    });
    await expect(saveSettings(settings)).rejects.toThrow('errorPermissionDenied');
    expect(set).not.toHaveBeenCalled();
  });

  it('restricts storage to trusted extension contexts before persisting credentials', async () => {
    const calls: string[] = [];
    vi.stubGlobal('chrome', {
      permissions: {
        request: vi.fn<(permissions: chrome.permissions.Permissions) => Promise<boolean>>(
          async () => {
            calls.push('permission');
            return true;
          },
        ),
      },
      storage: {
        local: {
          setAccessLevel: vi.fn<
            (options: { accessLevel: `${chrome.storage.AccessLevel}` }) => Promise<void>
          >(async () => {
            calls.push('restrict');
          }),
          set: vi.fn<(items: Record<string, unknown>) => Promise<void>>(async () => {
            calls.push('save');
          }),
        },
      },
    });
    await saveSettings(settings);
    expect(calls).toEqual(['permission', 'restrict', 'save']);
  });
});
