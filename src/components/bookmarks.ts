import type { Locale, MessageKey } from '../i18n';
import type { IBookmarkGroup, IBookmarkScope, ISettings } from '../types';
import { BOOKMARK_LIMIT, suggestBookmarkGroups } from '../ai';
import {
  applyBookmarkGroups,
  bookmarkScope,
  readBookmarkLibrary,
  readBookmarkUndo,
  undoBookmarks,
} from '../bookmarks';
import { LocalizedError } from '../errors';
import { errorMessage, localize, t } from '../i18n';
import { DEFAULT_SETTINGS, permissionFor } from '../settings';
import { element } from '../ui';
import { GroupCardElement } from './group-card';
import { LinkRowElement } from './link-row';

export class BookmarkOrganizerElement extends HTMLElement {
  private initialized = false;
  private locale: Locale = 'en';
  private settings: ISettings = { ...DEFAULT_SETTINGS };
  private authorized = false;
  private busy = false;
  private hasUndo = false;
  private library?: Awaited<ReturnType<typeof readBookmarkLibrary>>;
  private scope?: IBookmarkScope;
  private snapshot?: IBookmarkScope;
  private selected = new Set<string>();
  private included = new Set<string>();
  private checked = new Set<number>();
  private groups: IBookmarkGroup[] = [];
  private preview = false;
  private controller?: AbortController;
  private readonly cancelRequest = (): void => this.controller?.abort();

  connectedCallback(): void {
    window.addEventListener('pagehide', this.cancelRequest);
    if (this.initialized) return;
    this.initialized = true;
    this.classList.add('block');
    this.innerHTML = `
      <div class="mb-4 flex items-center justify-between gap-2">
        <h1 class="text-lg font-semibold tracking-tight" data-i18n="bookmarksTitle"></h1>
        <button id="bookmark-refresh" class="cursor-pointer rounded text-xs font-medium hover:underline disabled:opacity-45" data-i18n="bookmarkRefresh"></button>
      </div>
      <div id="bookmark-notice" class="mb-4 rounded-md border border-neutral-200 p-3 text-xs leading-relaxed dark:border-neutral-800" role="status" aria-live="polite" hidden></div>
      <section id="bookmark-permission" class="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 class="text-sm font-medium" data-i18n="bookmarkPermissionTitle"></h2>
        <p class="my-3 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400" data-i18n="bookmarkPermissionHint"></p>
        <button id="bookmark-grant" class="w-full cursor-pointer rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900 disabled:opacity-45" data-i18n="bookmarkGrant"></button>
      </section>
      <section id="bookmark-content" hidden>
        <label class="mb-4 block text-xs font-medium"><span data-i18n="bookmarkScope"></span>
          <select id="bookmark-folder" data-i18n-label="bookmarkScope" class="mt-2 block w-full min-w-0 rounded-md border border-neutral-200 bg-white p-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></select>
        </label>
        <p class="mb-4 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400" data-i18n="bookmarkScopeHint"></p>
        <button id="bookmark-setup" class="mb-4 w-full cursor-pointer rounded-md border border-neutral-200 p-3 text-left text-sm dark:border-neutral-800" data-i18n="configureService" hidden></button>
        <div id="bookmark-selection">
          <input id="bookmark-search" class="mb-3 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm dark:border-neutral-800" type="search" data-i18n-label="bookmarkSearch" data-i18n-placeholder="bookmarkSearch" />
          <div class="mb-2 flex items-center justify-between gap-2 text-xs"><span id="bookmark-total" class="text-neutral-500 dark:text-neutral-400"></span><button id="bookmark-select-all" class="cursor-pointer rounded font-medium hover:underline disabled:opacity-45"></button></div>
          <div id="bookmark-list" class="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800"></div>
          <p id="bookmark-empty" class="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400" hidden></p>
          <p id="bookmark-limit" class="mt-3 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"></p>
        </div>
        <section id="bookmark-preview" hidden>
          <div class="mb-2 flex items-center justify-between gap-2"><h2 class="text-sm font-semibold" data-i18n="bookmarkSuggestions"></h2><button id="bookmark-back" class="cursor-pointer rounded text-xs font-medium hover:underline" data-i18n="reselect"></button></div>
          <p class="mb-3 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400" data-i18n="bookmarkPreviewHint"></p>
          <div id="bookmark-groups" class="space-y-3"></div>
        </section>
        <footer class="sticky bottom-0 -mx-4 mt-4 border-t border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
          <p id="bookmark-count" class="mb-2 text-xs text-neutral-500 dark:text-neutral-400" aria-live="polite"></p>
          <button id="bookmark-analyze" class="w-full cursor-pointer rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900 disabled:opacity-45" data-i18n="bookmarkGenerate"></button>
          <button id="bookmark-apply" class="w-full cursor-pointer rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900 disabled:opacity-45" data-i18n="bookmarkApply" hidden></button>
          <button id="bookmark-undo" class="mx-auto mt-3 block cursor-pointer rounded text-xs font-medium hover:underline disabled:opacity-45" data-i18n="bookmarkUndo" hidden></button>
          <button id="bookmark-cancel" class="mx-auto mt-3 block cursor-pointer rounded text-xs font-medium hover:underline" data-i18n="cancel" hidden></button>
        </footer>
      </section>`;
    element(this, 'bookmark-grant').addEventListener('click', () =>
      this.run(async () => {
        if (!(await chrome.permissions.request({ permissions: ['bookmarks'] })))
          throw new LocalizedError('errorBookmarkPermission');
        await this.refresh();
      }, 'bookmarkReading'),
    );
    element(this, 'bookmark-refresh').addEventListener('click', () =>
      this.run(() => this.refresh(), 'bookmarkReading'),
    );
    element(this, 'bookmark-folder').addEventListener('change', () => {
      this.scope = bookmarkScope(
        this.library!,
        element<HTMLSelectElement>(this, 'bookmark-folder').value,
      );
      this.resetSelection();
    });
    element(this, 'bookmark-search').addEventListener('input', () => this.renderList());
    element(this, 'bookmark-select-all').addEventListener('click', () => {
      const visible = this.filtered();
      const all = visible.some((bookmark) => this.selected.has(bookmark.id));
      for (const bookmark of visible) {
        if (all) this.selected.delete(bookmark.id);
        else if (this.selected.size < BOOKMARK_LIMIT) this.selected.add(bookmark.id);
      }
      this.renderList();
    });
    element(this, 'bookmark-back').addEventListener('click', () => {
      this.preview = false;
      this.notice('');
      this.renderList();
    });
    element(this, 'bookmark-setup').addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('open-settings', { bubbles: true })),
    );
    element(this, 'bookmark-analyze').addEventListener('click', () =>
      this.run(() => this.analyze(), 'bookmarkSuggesting'),
    );
    element(this, 'bookmark-apply').addEventListener('click', () =>
      this.run(async () => {
        try {
          const count = await applyBookmarkGroups(this.chosenGroups(), this.snapshot!);
          await this.refresh();
          this.notice(t(this.locale, 'bookmarkComplete', { count }));
        } finally {
          this.hasUndo = Boolean(await readBookmarkUndo());
        }
      }, 'bookmarkApplying'),
    );
    element(this, 'bookmark-undo').addEventListener('click', () =>
      this.run(async () => {
        const count = await undoBookmarks();
        await this.refresh();
        this.notice(t(this.locale, 'bookmarkRestored', { count }));
      }, 'bookmarkUndoing'),
    );
    element(this, 'bookmark-cancel').addEventListener('click', this.cancelRequest);
    this.configure(this.settings, this.locale);
  }

  disconnectedCallback(): void {
    this.cancelRequest();
    window.removeEventListener('pagehide', this.cancelRequest);
  }

  configure(settings: ISettings, locale: Locale): void {
    this.settings = settings;
    this.locale = locale;
    if (!this.initialized) return;
    localize(this, locale);
    if (this.preview) this.renderGroups();
    else this.renderList();
  }

  async activate(): Promise<void> {
    await this.run(async () => {
      this.authorized = await chrome.permissions.contains({ permissions: ['bookmarks'] });
      if (!this.authorized) return;
      if (!this.library) await this.refresh();
      this.hasUndo = Boolean(await readBookmarkUndo());
    }, 'bookmarkReading');
  }

  private notice(message: string, error = false): void {
    const notice = element(this, 'bookmark-notice');
    notice.textContent = error ? t(this.locale, 'failure', { message }) : message;
    notice.hidden = !message;
    if (message) notice.scrollIntoView({ block: 'nearest' });
  }

  private async run(task: () => Promise<void>, label: MessageKey): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.dispatchEvent(new CustomEvent('bookmarks-busy', { bubbles: true, detail: true }));
    this.notice(t(this.locale, label));
    this.controls();
    try {
      await task();
      if (element(this, 'bookmark-notice').textContent === t(this.locale, label)) this.notice('');
    } catch (error) {
      this.notice(errorMessage(error, this.locale), true);
    } finally {
      this.controller = undefined;
      this.busy = false;
      this.controls();
      this.dispatchEvent(new CustomEvent('bookmarks-busy', { bubbles: true, detail: false }));
    }
  }

  private async refresh(): Promise<void> {
    this.authorized = await chrome.permissions.contains({ permissions: ['bookmarks'] });
    if (!this.authorized) return;
    this.library = await readBookmarkLibrary();
    const picker = element<HTMLSelectElement>(this, 'bookmark-folder');
    const previousId = picker.value;
    picker.replaceChildren(
      ...this.library.folders.map((folder) => new Option(folder.path, folder.id)),
    );
    picker.value =
      this.library.folders.find((folder) => folder.id === previousId)?.id ??
      this.library.folders.find((folder) =>
        this.library!.bookmarks.some((bookmark) => bookmark.parentId === folder.id),
      )?.id ??
      this.library.folders[0]?.id ??
      '';
    this.scope = picker.value ? bookmarkScope(this.library, picker.value) : undefined;
    this.hasUndo = Boolean(await readBookmarkUndo());
    this.resetSelection();
  }

  private resetSelection(): void {
    this.selected = new Set(
      this.scope?.bookmarks.slice(0, BOOKMARK_LIMIT).map((bookmark) => bookmark.id),
    );
    this.preview = false;
    this.groups = [];
    this.snapshot = undefined;
    element<HTMLInputElement>(this, 'bookmark-search').value = '';
    this.notice('');
    this.renderList();
  }

  private filtered(): IBookmarkScope['bookmarks'] {
    const query = element<HTMLInputElement>(this, 'bookmark-search').value.trim().toLowerCase();
    return (
      this.scope?.bookmarks.filter((bookmark) =>
        `${bookmark.title} ${bookmark.hostname}`.toLowerCase().includes(query),
      ) ?? []
    );
  }

  private renderList(): void {
    const visible = this.filtered();
    element(this, 'bookmark-list').replaceChildren(
      ...visible.map((bookmark) => {
        const row = new LinkRowElement();
        row.configure(
          { title: bookmark.title || bookmark.hostname, description: bookmark.hostname },
          {
            locale: this.locale,
            checked: this.selected.has(bookmark.id),
            disabled: this.busy,
            onChange: (checked) => {
              if (checked) this.selected.add(bookmark.id);
              else this.selected.delete(bookmark.id);
              this.controls();
            },
          },
        );
        return row;
      }),
    );
    element(this, 'bookmark-list').hidden = !visible.length;
    element(this, 'bookmark-empty').hidden = Boolean(visible.length);
    element(this, 'bookmark-empty').textContent = t(
      this.locale,
      this.scope?.bookmarks.length ? 'bookmarkNoMatches' : 'bookmarkEmpty',
    );
    element(this, 'bookmark-total').textContent = t(this.locale, 'bookmarkCount', {
      count: this.scope?.bookmarks.length ?? 0,
    });
    element(this, 'bookmark-limit').textContent = t(this.locale, 'bookmarkLimit', {
      limit: BOOKMARK_LIMIT,
    });
    this.controls();
  }

  private chosenGroups(): IBookmarkGroup[] {
    return this.groups.flatMap((group, index) =>
      this.checked.has(index)
        ? [{ ...group, bookmarkIds: group.bookmarkIds.filter((id) => this.included.has(id)) }]
        : [],
    );
  }

  private renderGroups(): void {
    element(this, 'bookmark-groups').replaceChildren(
      ...this.groups.map((group, index) => {
        const card = new GroupCardElement();
        const rows = group.bookmarkIds.map((id) => {
          const bookmark = this.snapshot!.bookmarks.find((item) => item.id === id)!;
          const row = new LinkRowElement();
          row.configure(
            { title: bookmark.title || bookmark.hostname, description: bookmark.hostname },
            {
              locale: this.locale,
              checked: this.included.has(id),
              disabled: this.busy,
              onChange: (checked) => {
                if (checked) this.included.add(id);
                else this.included.delete(id);
                card.setSelectedCount(
                  group.bookmarkIds.filter((item) => this.included.has(item)).length,
                );
                this.controls();
              },
            },
          );
          return row;
        });
        card.configure(
          {
            locale: this.locale,
            kind: 'bookmarks',
            title: group.title,
            disabled: this.busy,
            preview: {
              index,
              existing: group.targetFolderId !== undefined,
              checked: this.checked.has(index),
              onToggle: (checked) => {
                if (checked) this.checked.add(index);
                else this.checked.delete(index);
                this.controls();
              },
              onRename: (title) => {
                group.title = title;
                this.controls();
              },
            },
          },
          rows,
        );
        card.setSelectedCount(group.bookmarkIds.filter((id) => this.included.has(id)).length);
        return card;
      }),
    );
    this.controls();
  }

  private controls(): void {
    this.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
      'button, input, select',
    ).forEach((node) => {
      node.disabled = this.busy;
    });
    element(this, 'bookmark-list')
      .querySelectorAll<HTMLInputElement>('input')
      .forEach((checkbox) => {
        checkbox.disabled =
          this.busy || (!checkbox.checked && this.selected.size >= BOOKMARK_LIMIT);
      });
    const ready = Boolean(this.settings.baseUrl && this.settings.model);
    const chosen = this.chosenGroups();
    const count = this.preview
      ? chosen.reduce((sum, group) => sum + group.bookmarkIds.length, 0)
      : this.selected.size;
    element(this, 'bookmark-permission').hidden = this.authorized;
    element(this, 'bookmark-content').hidden = !this.authorized;
    element(this, 'bookmark-refresh').hidden = !this.authorized;
    element(this, 'bookmark-selection').hidden = this.preview;
    element(this, 'bookmark-preview').hidden = !this.preview;
    element<HTMLSelectElement>(this, 'bookmark-folder').disabled = this.busy || this.preview;
    element(this, 'bookmark-setup').hidden = ready;
    element(this, 'bookmark-analyze').hidden = this.preview;
    element<HTMLButtonElement>(this, 'bookmark-analyze').disabled =
      this.busy ||
      !ready ||
      !count ||
      count > BOOKMARK_LIMIT ||
      (count < 2 && !this.scope?.folders.length);
    element(this, 'bookmark-apply').hidden = !this.preview;
    element<HTMLButtonElement>(this, 'bookmark-apply').disabled =
      this.busy ||
      !chosen.length ||
      chosen.some((group) =>
        group.targetFolderId === undefined
          ? group.bookmarkIds.length < 2 || !group.title.trim()
          : !group.bookmarkIds.length,
      );
    element(this, 'bookmark-undo').hidden = !this.hasUndo;
    element(this, 'bookmark-cancel').hidden = !this.controller;
    element<HTMLButtonElement>(this, 'bookmark-cancel').disabled = false;
    element(this, 'bookmark-count').textContent = t(
      this.locale,
      this.preview ? 'bookmarkPlanned' : 'bookmarkSelected',
      { count },
    );
    const visible = this.filtered();
    element(this, 'bookmark-select-all').textContent = t(
      this.locale,
      visible.length && visible.some((bookmark) => this.selected.has(bookmark.id))
        ? 'deselectAll'
        : 'selectAll',
    );
    element<HTMLButtonElement>(this, 'bookmark-select-all').disabled = this.busy || !visible.length;
  }

  private async analyze(): Promise<void> {
    if (!(await chrome.permissions.contains({ origins: [permissionFor(this.settings.baseUrl)] })))
      throw new LocalizedError('errorPermissionRevoked');
    const chosen = this.scope!.bookmarks.filter((bookmark) => this.selected.has(bookmark.id));
    const live = bookmarkScope(await readBookmarkLibrary(), this.scope!.folder.id);
    if (
      chosen.some(
        (bookmark) =>
          !live.bookmarks.some(
            (item) =>
              item.id === bookmark.id && item.title === bookmark.title && item.url === bookmark.url,
          ),
      )
    )
      throw new LocalizedError('errorBookmarkChanged');
    this.snapshot = { ...live, bookmarks: chosen };
    this.controller = new AbortController();
    this.controls();
    this.groups = await suggestBookmarkGroups(
      this.settings,
      chosen,
      live.folders,
      this.locale,
      this.controller.signal,
    );
    if (!this.groups.length) {
      this.notice(t(this.locale, 'bookmarkNoSuggestions'));
      return;
    }
    this.included = new Set(this.groups.flatMap((group) => group.bookmarkIds));
    this.checked = new Set(this.groups.map((_, index) => index));
    this.preview = true;
    this.notice('');
    this.renderGroups();
    element(this, 'bookmark-preview').scrollIntoView({ block: 'start' });
  }
}
