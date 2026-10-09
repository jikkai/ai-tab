import { ArrowLeft, ChevronDown, createElement } from 'lucide';

import type { LanguagePreference, Locale } from '../i18n';
import type { ISettings } from '../types';
import { isLanguagePreference, localize, t } from '../i18n';
import { element } from '../ui';

export interface ISettingsSaveDetail {
  settings: ISettings;
  test: boolean;
}

export class SettingsFormElement extends HTMLElement {
  private initialized = false;
  private locale: Locale = 'en';

  connectedCallback(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.classList.add('block');
    this.innerHTML = `<button id="settings-back" class="rounded text-xs font-medium text-neutral-900 hover:underline disabled:no-underline dark:text-neutral-50 mb-4 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400">
            <span id="settings-back-icon"></span><span data-i18n="backToTabs">Back to tabs</span>
          </button>
          <h1 id="settings-title" class="text-lg font-semibold tracking-tight" data-i18n="aiSettings">AI settings</h1>
          <p class="mt-2 mb-4 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400" data-i18n="compatibleApi">Supports OpenAI-compatible APIs.</p>

          <div class="mb-4">
            <label for="language" class="mb-2 block text-sm font-medium" data-i18n="language">Language</label>
            <div class="relative">
              <select id="language" class="block w-full cursor-pointer appearance-none rounded-md border border-neutral-200 bg-white py-1.5 pr-9 pl-3 text-sm shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:cursor-not-allowed dark:border-neutral-800 dark:bg-neutral-950 dark:focus-visible:outline-neutral-400">
                <option value="auto" data-i18n="automaticLanguage">Browser default</option>
                <option value="zh-CN" lang="zh-CN">简体中文</option>
                <option value="en" lang="en">English</option>
              </select>
              <span id="language-chevron"></span>
            </div>
          </div>
          <form id="settings-form" class="space-y-4">
            <div>
              <label for="base-url" class="mb-2 block text-sm font-medium" data-i18n="apiUrl">API URL</label>
              <input id="base-url" class="w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm leading-relaxed shadow-xs placeholder:text-neutral-500 focus:border-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:placeholder:text-neutral-400 dark:focus:border-neutral-400 font-mono focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" type="url" placeholder="https://api.example.com/v1" required spellcheck="false" autocomplete="off" />
              <p class="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400" data-i18n="apiUrlHint">Use a base URL or the full /chat/completions URL.</p>
            </div>
            <div>
              <div class="mb-2 flex items-center justify-between">
                <label for="api-key" class="text-sm font-medium">API Key <span class="text-xs font-normal text-neutral-500 dark:text-neutral-400" data-i18n="optional">Optional</span></label><button id="toggle-key" type="button" class="rounded text-xs font-medium text-neutral-900 hover:underline disabled:no-underline dark:text-neutral-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" aria-pressed="false" data-i18n="showKey">Show</button>
              </div>
              <input id="api-key" class="w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm leading-relaxed shadow-xs placeholder:text-neutral-500 focus:border-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:placeholder:text-neutral-400 dark:focus:border-neutral-400 font-mono focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" type="password" placeholder="sk-…" spellcheck="false" autocomplete="off" />
              <p class="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400" data-i18n="apiKeyHint">Leave empty for keyless local services such as Ollama.</p>
            </div>
            <div>
              <label for="model" class="mb-2 block text-sm font-medium" data-i18n="modelName">Model name</label>
              <input id="model" class="w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm leading-relaxed shadow-xs placeholder:text-neutral-500 focus:border-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:placeholder:text-neutral-400 dark:focus:border-neutral-400 font-mono focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" placeholder="Model ID from your provider" required spellcheck="false" autocomplete="off" data-i18n-placeholder="modelPlaceholder" />
            </div>
            <div>
              <label for="instructions" class="mb-2 block text-sm font-medium"><span data-i18n="groupingPreferences">Grouping preferences</span> <span class="text-xs font-normal text-neutral-500 dark:text-neutral-400" data-i18n="optional">Optional</span></label>
              <textarea id="instructions" class="w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm leading-relaxed shadow-xs placeholder:text-neutral-500 focus:border-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:placeholder:text-neutral-400 dark:focus:border-neutral-400 min-h-20 resize-y focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" rows="3" maxlength="2000" placeholder="For example: group developer resources by project, keep GitHub and docs together, and use short names." data-i18n-placeholder="preferencesPlaceholder"></textarea>
            </div>
            <div class="flex flex-wrap gap-2 pt-1">
              <button id="save-settings" class="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 shadow-xs transition-colors hover:bg-neutral-900/90 motion-reduce:transition-none dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-50/90 flex-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" type="submit" data-i18n="saveSettings">Save settings</button>
              <button id="test-connection" class="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium shadow-xs hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900 flex-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" type="button" data-i18n="saveAndTest">Save and test</button>
            </div>
          </form>
          <div class="mt-5 border-t border-neutral-200 dark:border-neutral-800 pt-4 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            <p data-i18n="privacyKey">Your key stays in this browser and is not synced. Selected tab titles, hostnames, and group names in this window are sent directly to your AI service.</p>
            <p class="mt-2" data-i18n="privacyContent">Page content and full URLs are never sent.</p>
          </div>`;
    element(this, 'settings-back-icon').replaceWith(
      createElement(ArrowLeft, {
        class: 'size-4',
        'aria-hidden': 'true',
        'stroke-width': 1.75,
      }),
    );
    element(this, 'language-chevron').replaceWith(
      createElement(ChevronDown, {
        class:
          'pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-neutral-500 dark:text-neutral-400',
        'aria-hidden': 'true',
        'stroke-width': 1.75,
      }),
    );
    element(this, 'settings-back').addEventListener('click', () => {
      this.dispatchEvent(new Event('settings-close', { bubbles: true }));
    });
    element(this, 'toggle-key').addEventListener('click', () => {
      const input = element<HTMLInputElement>(this, 'api-key');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      element(this, 'toggle-key').textContent = t(this.locale, show ? 'hideKey' : 'showKey');
      element(this, 'toggle-key').setAttribute('aria-pressed', String(show));
    });
    element(this, 'settings-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit(false);
    });
    element(this, 'test-connection').addEventListener('click', () => this.submit(true));
    element(this, 'language').addEventListener('change', () => {
      const language = element<HTMLSelectElement>(this, 'language').value;
      if (!isLanguagePreference(language)) return;
      this.dispatchEvent(
        new CustomEvent<LanguagePreference>('language-change', {
          bubbles: true,
          detail: language,
        }),
      );
    });
  }

  setLanguage(locale: Locale, preference: LanguagePreference): void {
    this.locale = locale;
    localize(this, locale);
    element<HTMLSelectElement>(this, 'language').value = preference;
    const hidden = element<HTMLInputElement>(this, 'api-key').type === 'password';
    element(this, 'toggle-key').textContent = t(locale, hidden ? 'showKey' : 'hideKey');
  }

  load(settings: ISettings): void {
    element<HTMLInputElement>(this, 'base-url').value = settings.baseUrl;
    element<HTMLInputElement>(this, 'api-key').value = settings.apiKey;
    element<HTMLInputElement>(this, 'model').value = settings.model;
    element<HTMLTextAreaElement>(this, 'instructions').value = settings.instructions;
    element(this, 'base-url').focus();
  }

  hideKey(): void {
    element(this, 'api-key').setAttribute('type', 'password');
    element(this, 'toggle-key').textContent = t(this.locale, 'showKey');
    element(this, 'toggle-key').setAttribute('aria-pressed', 'false');
  }

  private submit(test: boolean): void {
    if (!element<HTMLFormElement>(this, 'settings-form').reportValidity()) return;
    this.dispatchEvent(
      new CustomEvent<ISettingsSaveDetail>('settings-save', {
        bubbles: true,
        detail: {
          test,
          settings: {
            baseUrl: element<HTMLInputElement>(this, 'base-url').value,
            apiKey: element<HTMLInputElement>(this, 'api-key').value,
            model: element<HTMLInputElement>(this, 'model').value,
            instructions: element<HTMLTextAreaElement>(this, 'instructions').value,
          },
        },
      }),
    );
  }
}
