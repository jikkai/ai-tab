import { createElement, Folder, Globe } from 'lucide';
import type { Locale } from '../i18n';
import type { LinkRowElement } from './link-row';
import { t } from '../i18n';

interface IGroupCardOptions {
  locale: Locale;
  kind: 'tabs' | 'bookmarks';
  title: string;
  color?: chrome.tabGroups.TabGroup['color'];
  ungrouped?: boolean;
  disabled: boolean;
  preview?: {
    index: number;
    existing: boolean;
    checked: boolean;
    onToggle: (checked: boolean) => void;
    onRename: (title: string) => void;
  };
}

export class GroupCardElement extends HTMLElement {
  private options?: IGroupCardOptions;
  private rows: LinkRowElement[] = [];
  private count?: HTMLSpanElement;

  configure(options: IGroupCardOptions, rows: LinkRowElement[]): void {
    this.options = options;
    this.rows = rows;
    this.render();
  }

  setSelectedCount(count: number): void {
    if (!this.count || !this.options) return;
    this.count.textContent = String(count);
    this.count.setAttribute(
      'aria-label',
      t(this.options.locale, this.options.kind === 'tabs' ? 'tabCount' : 'bookmarkCount', {
        count,
      }),
    );
  }

  private render(): void {
    const options = this.options;
    if (!options) return;
    this.className =
      'group block overflow-hidden rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950';
    if (options.color) this.dataset.color = options.color;
    else delete this.dataset.color;
    this.setAttribute('role', options.preview ? 'group' : 'region');
    this.setAttribute('aria-label', options.title);
    const heading = document.createElement('div');
    heading.className =
      'flex min-h-9 items-center gap-2 border-b border-neutral-200 px-2.5 py-1.5 dark:border-neutral-800';
    if (options.preview) {
      const preview = options.preview;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className =
        'size-4 shrink-0 cursor-pointer accent-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:cursor-not-allowed dark:accent-neutral-50 dark:focus-visible:outline-neutral-400';
      checkbox.checked = preview.checked;
      checkbox.disabled = options.disabled;
      checkbox.setAttribute(
        'aria-label',
        t(options.locale, options.kind === 'tabs' ? 'applyGroup' : 'applyFolder', {
          title: options.title,
        }),
      );
      checkbox.addEventListener('change', () => {
        preview.checked = checkbox.checked;
        preview.onToggle(checkbox.checked);
      });
      const title = document.createElement('input');
      title.className =
        'min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[13px] leading-5 font-semibold hover:bg-neutral-100 focus:bg-neutral-100 read-only:hover:bg-transparent read-only:focus:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:hover:bg-neutral-900 dark:focus:bg-neutral-900 dark:read-only:hover:bg-transparent dark:read-only:focus:bg-transparent dark:focus-visible:outline-neutral-400';
      title.value = options.title;
      if (!preview.existing) title.maxLength = 40;
      title.readOnly = preview.existing;
      title.disabled = options.disabled;
      title.setAttribute(
        'aria-label',
        t(options.locale, options.kind === 'tabs' ? 'groupName' : 'folderName', {
          index: preview.index + 1,
        }),
      );
      title.addEventListener('input', () => {
        options.title = title.value;
        this.setAttribute('aria-label', title.value);
        checkbox.setAttribute(
          'aria-label',
          t(options.locale, options.kind === 'tabs' ? 'applyGroup' : 'applyFolder', {
            title: title.value,
          }),
        );
        preview.onRename(title.value);
      });
      heading.append(checkbox, title);
      if (preview.existing) {
        const action = document.createElement('span');
        action.className = 'shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400';
        action.textContent = t(options.locale, 'addToExisting');
        heading.append(action);
      }
    } else {
      const icon = createElement(options.ungrouped ? Globe : Folder, {
        class: 'size-4 shrink-0 text-neutral-500 dark:text-neutral-400',
        'aria-hidden': 'true',
        'stroke-width': 1.75,
      });
      const title = document.createElement('h2');
      title.className = 'min-w-0 flex-1 truncate text-xs font-medium';
      title.textContent = options.title;
      title.title = options.title;
      if (!options.color) heading.append(icon);
      heading.append(title);
    }
    if (options.color) {
      const dot = document.createElement('span');
      dot.className =
        'size-2 shrink-0 rounded-full group-data-[color=grey]:bg-neutral-500 dark:group-data-[color=grey]:bg-neutral-400 group-data-[color=blue]:bg-[#2563eb] dark:group-data-[color=blue]:bg-[#8ab4f8] group-data-[color=red]:bg-[#dc2626] dark:group-data-[color=red]:bg-[#f28b82] group-data-[color=yellow]:bg-[#a16207] dark:group-data-[color=yellow]:bg-[#fdd663] group-data-[color=green]:bg-[#16803d] dark:group-data-[color=green]:bg-[#81c995] group-data-[color=pink]:bg-[#db2777] dark:group-data-[color=pink]:bg-[#fbaed2] group-data-[color=purple]:bg-[#9333ea] dark:group-data-[color=purple]:bg-[#c58af9] group-data-[color=cyan]:bg-[#0891b2] dark:group-data-[color=cyan]:bg-[#78d9ec] group-data-[color=orange]:bg-[#c2410c] dark:group-data-[color=orange]:bg-[#fcad70]';
      dot.setAttribute('aria-hidden', 'true');
      heading.insertBefore(dot, options.preview ? heading.children[1]! : heading.firstChild);
    }
    this.count = document.createElement('span');
    this.count.className =
      'ml-1 min-w-4 text-right text-[11px] font-medium text-neutral-500 tabular-nums dark:text-neutral-400';
    this.setSelectedCount(this.rows.length);
    heading.append(this.count);
    this.replaceChildren(heading, ...this.rows);
  }
}
