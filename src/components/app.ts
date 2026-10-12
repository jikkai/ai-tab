import {
  Check,
  ChevronRight,
  createIcons,
  GalleryVerticalEnd,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
} from 'lucide';
import type { LanguagePreference, Locale } from '../i18n';
import type { IGroup, ISettings, ITab } from '../types';
import type { BookmarkOrganizerElement } from './bookmarks';
import type { ISettingsSaveDetail, SettingsFormElement } from './settings-form';
import { suggestGroups, testConnection } from '../ai';
import { LocalizedError } from '../errors';
import {
  errorMessage,
  isLanguagePreference,
  loadLanguage,
  localize,
  resolveLocale,
  saveLanguage,
  t,
} from '../i18n';
import { DEFAULT_SETTINGS, loadSettings, permissionFor, saveSettings } from '../settings';
import { applyGroups, readUndo, readWindow, undoLast } from '../tabs';
import { element } from '../ui';
import { GroupCardElement } from './group-card';
import { LinkRowElement } from './link-row';

export class AiTabAppElement extends HTMLElement {
  private initialized = false;
  private readonly extension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  private settings: ISettings = { ...DEFAULT_SETTINGS };
  private language: LanguagePreference = 'auto';
  private locale: Locale = resolveLocale(navigator.language);
  private windowId = -1;
  private totalTabs = 0;
  private tabs: ITab[] = [];
  private existingGroups: chrome.tabGroups.TabGroup[] = [];
  private selected = new Set<number>();
  private groups: IGroup[] = [];
  private included = new Set<number>();
  private checkedGroups = new Set<number>();
  private preview = false;
  private settingsOpen = false;
  private mode: 'tabs' | 'bookmarks' = 'tabs';
  private bookmarkBusy = false;
  private busy = false;
  private hasUndo = false;
  private controller?: AbortController;
  private readonly cancelRequest = (): void => this.controller?.abort();

  connectedCallback(): void {
    window.addEventListener('pagehide', this.cancelRequest);
    if (this.initialized) return;
    this.initialized = true;
    this.className =
      'block min-h-dvh bg-white font-sans text-neutral-900 antialiased scheme-light selection:bg-neutral-100 dark:bg-neutral-950 dark:text-neutral-50 dark:scheme-dark dark:selection:bg-neutral-900';
    this.innerHTML = `<div class="relative mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      <header class="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
        <div class="flex items-center gap-2.5">
          <img src="/icon.svg" width="28" height="28" alt="" class="size-7 shrink-0 dark:invert" />
          <span class="text-sm font-semibold">AI Tab</span>
        </div>
        <button id="settings-toggle" class="flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 motion-reduce:transition-none dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" aria-label="AI settings" title="AI settings" data-i18n-label="aiSettings" data-i18n-title="aiSettings">
          <i data-lucide="settings-2" class="size-3.5" aria-hidden="true"></i>
        </button>
      </header>

      <nav id="organizer-switch" class="flex gap-1 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800" data-i18n-label="organizerNavigation">
        <button id="open-tabs" class="cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium aria-pressed:bg-neutral-100 dark:aria-pressed:bg-neutral-900 disabled:opacity-45" aria-pressed="true" data-i18n="tabsMode"></button>
        <button id="open-bookmarks" class="cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium aria-pressed:bg-neutral-100 dark:aria-pressed:bg-neutral-900 disabled:opacity-45" aria-pressed="false" data-i18n="bookmarksMode"></button>
      </nav>

      <main class="flex-1 px-4 py-4">
        <div id="notice" class="rounded-lg border border-neutral-200 bg-white p-3 text-xs leading-relaxed text-neutral-900 data-[error=true]:border-neutral-900 data-[error=true]:font-medium dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:data-[error=true]:border-neutral-50 mb-4" role="status" aria-live="polite" hidden></div>

        <section id="organize-view" aria-labelledby="view-title">
          <div class="mb-4 flex items-start justify-between gap-2">
            <div>
              <h1 id="view-title" class="text-lg leading-tight font-semibold tracking-tight" data-i18n="organizeTitle">Tab groups</h1>
              <p id="window-count" class="mt-1 text-xs text-neutral-500 dark:text-neutral-400" data-i18n="readingTabs">Reading tabs…</p>
            </div>
            <button id="refresh" class="flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 motion-reduce:transition-none dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" aria-label="Refresh tabs" title="Refresh tabs" data-i18n-label="refresh" data-i18n-title="refresh">
              <i data-lucide="refresh-cw" class="size-3.5" aria-hidden="true"></i>
            </button>
          </div>

          <button id="setup-prompt" class="mb-4 flex w-full items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" hidden>
            <i data-lucide="settings-2" class="size-4 shrink-0 text-neutral-500 dark:text-neutral-400" aria-hidden="true"></i>
            <span class="text-left"><span class="block text-sm font-medium" data-i18n="configureService">Configure AI service</span><span class="mt-1 block text-xs text-neutral-500 dark:text-neutral-400" data-i18n="configureHint">Enter the API URL, key, and model.</span></span>
            <i data-lucide="chevron-right" class="ml-auto size-4 shrink-0 text-neutral-500 dark:text-neutral-400" aria-hidden="true"></i>
          </button>

          <div id="selection-view">
            <label class="flex items-center gap-2.5 rounded-md border border-neutral-200 bg-white px-3 py-2 shadow-xs focus-within:border-neutral-500 focus-within:ring-2 focus-within:ring-neutral-200 dark:border-neutral-800 dark:bg-neutral-950 dark:focus-within:border-neutral-400 dark:focus-within:ring-neutral-800">
              <i data-lucide="search" class="size-4 shrink-0 text-neutral-500 dark:text-neutral-400" aria-hidden="true"></i>
              <input id="search" class="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-neutral-500/70 dark:placeholder:text-neutral-400/70" type="search" placeholder="Search titles, sites, or groups" aria-label="Search tabs" autocomplete="off" data-i18n-placeholder="searchPlaceholder" data-i18n-label="searchLabel" />
            </label>
            <div class="mt-4 mb-2 flex items-center justify-between text-xs">
              <span class="font-medium text-neutral-500 dark:text-neutral-400"><span data-i18n="tabsToOrganize">Tabs to organize</span> <span id="eligible-count" class="ml-1 inline-flex min-w-5 items-center justify-center rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50">0</span></span>
              <button id="select-all" class="rounded text-xs font-medium text-neutral-900 hover:underline disabled:no-underline dark:text-neutral-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" data-i18n="deselectAll">Deselect all</button>
            </div>
            <div id="tab-list" class="space-y-3"></div>
            <div id="empty-state" class="rounded-lg border border-dashed border-neutral-200 px-5 py-8 text-center dark:border-neutral-800" hidden>
              <i data-lucide="gallery-vertical-end" class="mx-auto mb-3 size-6 text-neutral-500 dark:text-neutral-400" aria-hidden="true"></i>
              <h2 id="empty-title" class="text-sm font-medium" data-i18n="emptyTitle">No tabs to organize</h2>
              <p id="empty-description" class="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400" data-i18n="emptyHint">Open some web pages, then refresh the list.</p>
            </div>
            <p class="mt-4 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400" data-i18n="selectionHint">You can regroup existing groups. Pinned, loading, and split-view tabs are excluded.</p>
          </div>

          <section id="preview-view" aria-labelledby="preview-title" hidden>
            <div class="mb-2 flex items-center justify-between gap-2">
              <h2 id="preview-title" class="text-sm font-semibold">
                <span data-i18n="suggestions">Suggested groups</span> <span id="group-count" class="ml-1 inline-flex min-w-5 items-center justify-center rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50">0</span>
              </h2>
              <button id="back" class="rounded text-xs font-medium text-neutral-900 hover:underline disabled:no-underline dark:text-neutral-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" data-i18n="reselect">Change selection</button>
            </div>
            <p class="mb-3 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400" data-i18n="previewHint">Edit new group names. Unchecked tabs stay where they are.</p>
            <div id="group-list" class="space-y-3"></div>
            <p id="ungrouped-note" class="mt-3 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"></p>
          </section>
        </section>

        <ai-bookmark-organizer id="bookmarks-view" hidden></ai-bookmark-organizer>
        <ai-tab-settings id="settings-view" role="region" aria-labelledby="settings-title" hidden></ai-tab-settings>

        <section id="install-view" class="rounded-lg border border-dashed border-neutral-200 px-5 py-8 text-center dark:border-neutral-800" hidden>
          <h1 class="text-lg font-semibold" data-i18n="installTitle">Open AI Tab in Chrome</h1>
          <p class="mt-3 text-sm leading-7 text-neutral-500 dark:text-neutral-400" data-i18n="installBuild">Run pnpm build, enable Developer mode at chrome://extensions, and load the dist folder.</p>
          <p class="mt-3 text-sm leading-7 text-neutral-500 dark:text-neutral-400" data-i18n="installOpen">Click the extension icon to organize your tabs in the side panel.</p>
        </section>
      </main>

      <footer id="action-bar" class="sticky bottom-0 z-10 border-t border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <div class="mb-2 flex items-center justify-between gap-2 text-xs">
          <span id="selection-count" class="text-neutral-500 dark:text-neutral-400"></span>
          <span id="model-status" class="group/status flex min-w-0 max-w-[55%] items-center gap-1.5 text-neutral-500 dark:text-neutral-400"><span class="size-1.5 shrink-0 rounded-full bg-neutral-500/60 group-data-[ready=true]/status:bg-neutral-900 dark:bg-neutral-400/60 dark:group-data-[ready=true]/status:bg-neutral-50"></span><span id="model-label" class="truncate text-xs" data-i18n="disconnected">Not connected</span></span>
        </div>
        <button id="analyze" class="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 shadow-xs transition-colors hover:bg-neutral-900/90 motion-reduce:transition-none dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-50/90 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400">
          <i data-lucide="sparkles" class="size-4" aria-hidden="true"></i><span data-i18n="generate">Suggest groups</span>
        </button>
        <button id="apply" class="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 shadow-xs transition-colors hover:bg-neutral-900/90 motion-reduce:transition-none dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-50/90 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" hidden>
          <i data-lucide="check" class="size-4" aria-hidden="true"></i><span data-i18n="applyGroups">Apply selected groups</span>
        </button>
        <button id="undo" class="rounded text-xs font-medium text-neutral-900 hover:underline disabled:no-underline dark:text-neutral-50 mx-auto mt-3 block cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" title="Restore previous group membership, without restoring tab order" hidden data-i18n-title="undoHint" data-i18n="undo">Undo last grouping</button>
      </footer>
      <div id="busy-bar" class="sticky bottom-0 z-20 flex items-center gap-3 border-t border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950" role="status" aria-live="polite" hidden>
        <i data-lucide="loader-circle" class="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true"></i><span id="busy-label" class="flex-1 text-sm" data-i18n="working">Working…</span><button id="cancel" class="rounded text-xs font-medium text-neutral-900 hover:underline disabled:no-underline dark:text-neutral-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:focus-visible:outline-neutral-400" hidden data-i18n="cancel">Cancel</button>
      </div>
    </div>`;
    createIcons({
      root: this,
      icons: {
        Check,
        ChevronRight,
        GalleryVerticalEnd,
        LoaderCircle,
        RefreshCw,
        Search,
        Settings2,
        Sparkles,
      },
      attrs: { 'stroke-width': 1.75 },
    });
    this.bindEvents();
    this.applyLanguage();
    this.start().catch((error: unknown) => this.fail(error));
  }

  disconnectedCallback(): void {
    this.cancelRequest();
    window.removeEventListener('pagehide', this.cancelRequest);
  }

  private notice(message: string, error = false): void {
    const node = element(this, 'notice');
    node.textContent = error ? t(this.locale, 'failure', { message }) : message;
    node.dataset.error = String(error);
    node.hidden = !message;
    if (message) node.scrollIntoView({ block: 'nearest' });
  }

  private fail(error: unknown): void {
    this.notice(errorMessage(error, this.locale), true);
  }

  private applyLanguage(): void {
    this.locale = this.language === 'auto' ? resolveLocale(navigator.language) : this.language;
    document.documentElement.lang = this.locale;
    document.title = t(this.locale, 'pageTitle');
    localize(this, this.locale);
    element<SettingsFormElement>(this, 'settings-view').setLanguage(this.locale, this.language);
    element<BookmarkOrganizerElement>(this, 'bookmarks-view').configure(this.settings, this.locale);
    if (this.preview) this.renderGroups();
    else if (this.windowId !== -1) this.renderTabs();
    this.controls();
  }

  private chosenGroups(): IGroup[] {
    return this.groups.flatMap((group, index) =>
      this.checkedGroups.has(index)
        ? [{ ...group, tabIds: group.tabIds.filter((id) => this.included.has(id)) }]
        : [],
    );
  }

  private controls(): void {
    const ready = Boolean(this.settings.baseUrl && this.settings.model);
    element(this, 'setup-prompt').hidden = ready;
    element(this, 'model-label').textContent = ready
      ? this.settings.model
      : t(this.locale, 'disconnected');
    element(this, 'model-status').dataset.ready = String(ready);
    const chosen = this.chosenGroups();
    const count = this.preview
      ? chosen.reduce((sum, group) => sum + group.tabIds.length, 0)
      : this.selected.size;
    element(this, 'selection-count').textContent = this.preview
      ? `${t(this.locale, 'groupCount', { count: chosen.length })} · ${t(this.locale, 'tabCount', { count })}`
      : t(this.locale, 'selectedCount', { count });
    if (this.windowId !== -1) {
      element(this, 'window-count').textContent = t(this.locale, 'windowCount', {
        total: this.totalTabs,
        eligible: this.tabs.length,
      });
    }
    const settingsLabel = t(
      this.locale,
      this.settingsOpen ? (this.mode === 'tabs' ? 'backToTabs' : 'backToBookmarks') : 'aiSettings',
    );
    element(this, 'settings-toggle').setAttribute('aria-label', settingsLabel);
    element(this, 'settings-toggle').title = settingsLabel;
    element<HTMLButtonElement>(this, 'settings-toggle').disabled = this.busy || this.bookmarkBusy;
    element(this, 'organizer-switch').hidden = !this.extension || this.settingsOpen;
    for (const mode of ['tabs', 'bookmarks'] as const) {
      const button = element<HTMLButtonElement>(this, `open-${mode}`);
      button.setAttribute('aria-pressed', String(this.mode === mode));
      button.disabled = this.busy || this.bookmarkBusy;
    }
    element(this, 'organize-view').hidden =
      this.settingsOpen || this.mode !== 'tabs' || !this.extension;
    element(this, 'bookmarks-view').hidden =
      this.settingsOpen || this.mode !== 'bookmarks' || !this.extension;
    element(this, 'analyze').hidden = this.preview;
    element<HTMLButtonElement>(this, 'analyze').disabled =
      this.busy ||
      !this.selected.size ||
      (this.selected.size < 2 && !this.existingGroups.length) ||
      !ready;
    element(this, 'apply').hidden = !this.preview;
    element<HTMLButtonElement>(this, 'apply').disabled =
      this.busy ||
      chosen.length === 0 ||
      chosen.some((group) =>
        group.targetGroupId === undefined
          ? group.tabIds.length < 2 || !group.title.trim()
          : !group.tabIds.length,
      );
    element(this, 'undo').hidden = !this.hasUndo;
    element(this, 'action-bar').hidden =
      this.settingsOpen || this.busy || !this.extension || this.mode !== 'tabs';
    element(this, 'busy-bar').hidden = !this.busy;
    element(this, 'cancel').hidden = !this.controller;
    element<HTMLButtonElement>(this, 'cancel').disabled = false;
    element(this, 'selection-view').hidden = this.preview;
    element(this, 'preview-view').hidden = !this.preview;
    const visible = this.filteredTabs();
    element(this, 'select-all').textContent = t(
      this.locale,
      visible.length && visible.every((tab) => this.selected.has(tab.id))
        ? 'deselectAll'
        : 'selectAll',
    );
    element<HTMLButtonElement>(this, 'select-all').disabled = this.busy || !visible.length;
  }

  private async run(task: () => Promise<void>, label: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.notice('');
    element(this, 'busy-label').textContent = label;
    this.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >('button, input, textarea, select').forEach((node) => {
      node.disabled = true;
    });
    this.controls();
    try {
      await task();
    } catch (error) {
      this.fail(error);
    } finally {
      this.controller = undefined;
      this.busy = false;
      this.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('button, input, textarea, select').forEach((node) => {
        node.disabled = false;
      });
      this.controls();
    }
  }

  private filteredTabs(): ITab[] {
    const query = element<HTMLInputElement>(this, 'search').value.trim().toLowerCase();
    return this.tabs.filter((tab) =>
      `${tab.title} ${tab.hostname} ${tab.groupTitle ?? ''}`.toLowerCase().includes(query),
    );
  }

  private renderTabs(): void {
    const visible = this.filteredTabs();
    const sections = new Map<number, ITab[]>();
    for (const tab of visible) {
      const sectionTabs = sections.get(tab.groupId);
      if (sectionTabs) sectionTabs.push(tab);
      else sections.set(tab.groupId, [tab]);
    }
    element(this, 'tab-list').replaceChildren(
      ...Array.from(sections, ([groupId, sectionTabs]) => {
        const card = new GroupCardElement();
        const rows = sectionTabs.map((tab) => {
          const row = new LinkRowElement();
          row.configure(
            { title: tab.title, description: tab.hostname },
            {
              locale: this.locale,
              checked: this.selected.has(tab.id),
              disabled: this.busy,
              onChange: (checked) => {
                if (checked) this.selected.add(tab.id);
                else this.selected.delete(tab.id);
                this.controls();
              },
            },
          );
          return row;
        });
        card.configure(
          {
            locale: this.locale,
            kind: 'tabs',
            title:
              groupId === -1
                ? t(this.locale, 'ungrouped')
                : sectionTabs[0]!.groupTitle || t(this.locale, 'unnamedGroup'),
            color: sectionTabs[0]!.groupColor,
            ungrouped: groupId === -1,
            disabled: this.busy,
          },
          rows,
        );
        return card;
      }),
    );
    element(this, 'eligible-count').textContent = String(this.tabs.length);
    element(this, 'tab-list').hidden = !visible.length;
    element(this, 'empty-state').hidden = Boolean(visible.length);
    element(this, 'empty-title').textContent = t(
      this.locale,
      this.tabs.length ? 'noMatches' : 'emptyTitle',
    );
    element(this, 'empty-description').textContent = t(
      this.locale,
      this.tabs.length ? 'searchHint' : 'excludedHint',
    );
    this.controls();
  }

  private renderGroups(): void {
    element(this, 'group-list').replaceChildren(
      ...this.groups.map((group, index) => {
        const card = new GroupCardElement();
        const rows = group.tabIds.flatMap((id) => {
          const tab = this.tabs.find((item) => item.id === id);
          if (!tab) return [];
          const row = new LinkRowElement();
          row.configure(
            {
              title: tab.title,
              description:
                tab.groupId !== -1
                  ? `${tab.hostname} · ${tab.groupTitle || t(this.locale, 'unnamedGroup')}`
                  : tab.hostname,
            },
            {
              locale: this.locale,
              checked: this.included.has(id),
              disabled: this.busy,
              onChange: (checked) => {
                if (checked) this.included.add(id);
                else this.included.delete(id);
                card.setSelectedCount(
                  group.tabIds.filter((tabId) => this.included.has(tabId)).length,
                );
                this.controls();
              },
            },
          );
          return [row];
        });
        card.configure(
          {
            locale: this.locale,
            kind: 'tabs',
            title:
              group.targetGroupId === undefined
                ? group.title
                : group.title || t(this.locale, 'unnamedGroup'),
            color: group.color,
            disabled: this.busy,
            preview: {
              index,
              existing: group.targetGroupId !== undefined,
              checked: this.checkedGroups.has(index),
              onToggle: (checked) => {
                if (checked) this.checkedGroups.add(index);
                else this.checkedGroups.delete(index);
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
        card.setSelectedCount(group.tabIds.filter((id) => this.included.has(id)).length);
        return card;
      }),
    );
    element(this, 'group-count').textContent = String(this.groups.length);
    const rest =
      this.selected.size - this.groups.reduce((sum, group) => sum + group.tabIds.length, 0);
    element(this, 'ungrouped-note').textContent = t(
      this.locale,
      rest ? 'unmatchedTabs' : 'minimumGroupSize',
      { count: rest },
    );
    this.controls();
  }

  private async refresh(): Promise<void> {
    const result = await readWindow(this.windowId);
    this.totalTabs = result.total;
    this.tabs = result.tabs;
    this.existingGroups = result.groups;
    this.selected = new Set(this.tabs.filter((tab) => tab.groupId === -1).map((tab) => tab.id));
    this.groups = [];
    this.preview = false;
    this.hasUndo = Boolean((await readUndo(this.windowId))?.groups.length);
    this.renderTabs();
  }

  private showSettings(open: boolean): void {
    this.settingsOpen = open;
    const form = element<SettingsFormElement>(this, 'settings-view');
    form.hidden = !open;
    form.hideKey();
    element(this, 'organize-view').hidden = open;
    if (open) form.load(this.settings);
    element<BookmarkOrganizerElement>(this, 'bookmarks-view').configure(this.settings, this.locale);
    const closeLabel = form.querySelector<HTMLElement>(
      '[data-i18n="backToTabs"], [data-i18n="backToBookmarks"]',
    );
    if (closeLabel) {
      closeLabel.dataset.i18n = this.mode === 'tabs' ? 'backToTabs' : 'backToBookmarks';
      closeLabel.textContent = t(
        this.locale,
        closeLabel.dataset.i18n as 'backToTabs' | 'backToBookmarks',
      );
    }
    this.notice('');
    this.controls();
  }

  private bindEvents(): void {
    element(this, 'open-tabs').addEventListener('click', () => {
      this.mode = 'tabs';
      this.notice('');
      this.controls();
    });
    element(this, 'open-bookmarks').addEventListener('click', async () => {
      if (this.mode === 'bookmarks') return;
      this.mode = 'bookmarks';
      this.notice('');
      this.controls();
      const bookmarks = element<BookmarkOrganizerElement>(this, 'bookmarks-view');
      bookmarks.configure(this.settings, this.locale);
      await bookmarks.activate();
    });
    this.addEventListener('bookmarks-busy', (event) => {
      this.bookmarkBusy = (event as CustomEvent<boolean>).detail;
      this.controls();
    });
    this.addEventListener('open-settings', () => this.showSettings(true));
    element(this, 'settings-toggle').addEventListener('click', () =>
      this.showSettings(!this.settingsOpen),
    );
    element(this, 'setup-prompt').addEventListener('click', () => this.showSettings(true));
    this.addEventListener('settings-close', () => this.showSettings(false));
    this.addEventListener('language-change', async (event) => {
      const language: unknown = (event as CustomEvent<unknown>).detail;
      if (!isLanguagePreference(language)) return;
      await this.run(
        async () => {
          await saveLanguage(language);
          this.language = language;
          this.applyLanguage();
        },
        t(this.locale, 'savingLanguage'),
      );
      element<SettingsFormElement>(this, 'settings-view').setLanguage(this.locale, this.language);
    });
    element(this, 'refresh').addEventListener('click', () =>
      this.run(() => this.refresh(), t(this.locale, 'refreshing')),
    );
    element(this, 'search').addEventListener('input', () => this.renderTabs());
    element(this, 'select-all').addEventListener('click', () => {
      const visible = this.filteredTabs();
      const allSelected = visible.every((tab) => this.selected.has(tab.id));
      visible.forEach((tab) => {
        if (allSelected) this.selected.delete(tab.id);
        else this.selected.add(tab.id);
      });
      this.renderTabs();
    });
    element(this, 'back').addEventListener('click', () => {
      this.preview = false;
      this.groups = [];
      this.renderTabs();
      this.notice('');
    });
    this.addEventListener('settings-save', (event) => {
      const detail = (event as CustomEvent<ISettingsSaveDetail>).detail;
      return this.run(
        async () => {
          this.settings = await saveSettings(detail.settings);
          if (detail.test) {
            this.controller = new AbortController();
            this.controls();
            await testConnection(this.settings, this.controller.signal);
            this.notice(t(this.locale, 'connectionSuccess'));
          } else this.notice(t(this.locale, 'settingsSaved'));
        },
        t(this.locale, detail.test ? 'testingConnection' : 'savingSettings'),
      );
    });
    element(this, 'analyze').addEventListener('click', () =>
      this.run(
        async () => {
          const allowed = await chrome.permissions.contains({
            origins: [permissionFor(this.settings.baseUrl)],
          });
          if (!allowed) throw new LocalizedError('errorPermissionRevoked');
          const live = await readWindow(this.windowId);
          const chosen = this.tabs.filter((tab) => this.selected.has(tab.id));
          if (
            chosen.some(
              (tab) =>
                !live.tabs.some(
                  (current) =>
                    current.id === tab.id &&
                    current.url === tab.url &&
                    current.title === tab.title &&
                    current.groupId === tab.groupId,
                ),
            )
          )
            throw new LocalizedError('errorSelectionChanged');
          this.controller = new AbortController();
          this.existingGroups = live.groups;
          this.controls();
          this.groups = await suggestGroups(
            this.settings,
            chosen,
            live.groups,
            this.locale,
            this.controller.signal,
          );
          if (!this.groups.length) {
            this.notice(t(this.locale, 'noSuggestions'));
            return;
          }
          this.included = new Set(this.groups.flatMap((group) => group.tabIds));
          this.checkedGroups = new Set(this.groups.map((_, index) => index));
          this.preview = true;
          this.renderGroups();
          element(this, 'preview-view').scrollIntoView({ block: 'start' });
        },
        t(this.locale, 'suggesting'),
      ),
    );
    element(this, 'apply').addEventListener('click', () =>
      this.run(
        async () => {
          try {
            const chosen = this.chosenGroups();
            const count = await applyGroups(this.windowId, chosen, this.tabs);
            await this.refresh();
            this.notice(
              t(this.locale, 'groupingComplete', {
                tabs: t(this.locale, 'tabCount', { count }),
                groups: t(this.locale, 'groupCount', { count: chosen.length }),
              }),
            );
          } finally {
            this.hasUndo = Boolean((await readUndo(this.windowId))?.groups.length);
          }
        },
        t(this.locale, 'applying'),
      ),
    );
    element(this, 'undo').addEventListener('click', () =>
      this.run(
        async () => {
          const count = await undoLast(this.windowId);
          await this.refresh();
          this.notice(t(this.locale, count ? 'undoComplete' : 'nothingToUndo', { count }));
        },
        t(this.locale, 'undoing'),
      ),
    );
    element(this, 'cancel').addEventListener('click', this.cancelRequest);
  }

  private async start(): Promise<void> {
    if (!this.extension) {
      element(this, 'organize-view').hidden = true;
      element(this, 'settings-toggle').hidden = true;
      element(this, 'action-bar').hidden = true;
      element(this, 'install-view').hidden = false;
      return;
    }
    this.language = await loadLanguage();
    this.applyLanguage();
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id === undefined) throw new LocalizedError('errorWindowUnavailable');
    this.windowId = currentWindow.id;
    try {
      this.settings = await loadSettings();
    } catch (error) {
      this.fail(error);
    }
    await this.refresh();
  }
}
