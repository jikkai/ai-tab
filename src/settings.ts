import type { ISettings } from './types';
import { LocalizedError } from './errors';

export const DEFAULT_SETTINGS: ISettings = { baseUrl: '', apiKey: '', model: '', instructions: '' };

export function normalizeSettings(settings: ISettings): ISettings {
  let url: URL;
  try {
    url = new URL(settings.baseUrl.trim());
  } catch {
    throw new LocalizedError('errorInvalidUrl');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new LocalizedError('errorHttpsRequired');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LocalizedError('errorUrlCredentials');
  }
  if (!settings.model.trim()) throw new LocalizedError('errorModelRequired');
  if (settings.instructions.length > 2000) throw new LocalizedError('errorPreferencesLength');
  return {
    baseUrl: url.href.replace(/\/+$/, ''),
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
    instructions: settings.instructions.trim(),
  };
}

export function endpointFor(baseUrl: string): string {
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
}

export function permissionFor(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

export async function loadSettings(): Promise<ISettings> {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings === undefined) return { ...DEFAULT_SETTINGS };
  const saved = settings as Partial<ISettings> | null;
  if (
    !saved ||
    typeof saved.baseUrl !== 'string' ||
    typeof saved.apiKey !== 'string' ||
    typeof saved.model !== 'string' ||
    typeof saved.instructions !== 'string'
  ) {
    throw new LocalizedError('errorSettingsUnreadable');
  }
  return normalizeSettings({
    baseUrl: saved.baseUrl,
    apiKey: saved.apiKey,
    model: saved.model,
    instructions: saved.instructions,
  });
}

export async function saveSettings(input: ISettings): Promise<ISettings> {
  const settings = normalizeSettings(input);
  // Request directly from the Save gesture, before storage or network awaits.
  const granted = await chrome.permissions.request({ origins: [permissionFor(settings.baseUrl)] });
  if (!granted) throw new LocalizedError('errorPermissionDenied');
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.set({ settings });
  return settings;
}
