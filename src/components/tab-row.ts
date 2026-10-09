import { createElement, Globe } from 'lucide';

import type { Locale } from '../i18n';
import type { ITab } from '../types';
import { t } from '../i18n';

interface ITabRowOptions {
  locale: Locale;
  checked: boolean;
  disabled: boolean;
  showGroup: boolean;
  onChange: (checked: boolean) => void;
}

export class TabRowElement extends HTMLElement {
  private tab?: ITab;
  private options?: ITabRowOptions;

  configure(tab: ITab, options: ITabRowOptions): void {
    this.tab = tab;
    this.options = options;
    this.render();
  }

  private render(): void {
    const { tab, options } = this;
    if (!tab || !options) return;
    this.className = 'block border-b border-neutral-200 last:border-b-0 dark:border-neutral-800';
    const label = document.createElement('label');
    label.className =
      'flex min-h-12 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-900';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className =
      'size-4 shrink-0 cursor-pointer accent-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:cursor-not-allowed dark:accent-neutral-50 dark:focus-visible:outline-neutral-400';
    checkbox.checked = options.checked;
    checkbox.disabled = options.disabled;
    checkbox.setAttribute('aria-label', t(options.locale, 'selectTab', { title: tab.title }));
    checkbox.addEventListener('change', () => {
      options.checked = checkbox.checked;
      options.onChange(checkbox.checked);
    });
    const icon = createElement(Globe, {
      class: 'size-4 shrink-0 text-neutral-500 dark:text-neutral-400',
      'aria-hidden': 'true',
      'stroke-width': 1.75,
    });
    const copy = document.createElement('span');
    copy.className = 'min-w-0 flex-1';
    const title = document.createElement('span');
    title.className = 'block truncate text-[13px] leading-5 font-medium';
    title.textContent = tab.title;
    title.title = tab.title;
    const host = document.createElement('span');
    host.className = 'block truncate text-[11px] leading-4 text-neutral-500 dark:text-neutral-400';
    host.textContent =
      options.showGroup && tab.groupId !== -1
        ? `${tab.hostname} · ${tab.groupTitle || t(options.locale, 'unnamedGroup')}`
        : tab.hostname;
    copy.append(title, host);
    label.append(checkbox, icon, copy);
    this.replaceChildren(label);
  }
}
