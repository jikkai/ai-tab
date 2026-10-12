import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IBookmarkGroup } from '../types';
import {
  applyBookmarkGroups,
  bookmarkLibrary,
  bookmarkScope,
  readBookmarkLibrary,
  readBookmarkUndo,
  undoBookmarks,
} from '../bookmarks';

const node = (
  id: string,
  parentId: string,
  title: string,
  url?: string,
): chrome.bookmarks.BookmarkTreeNode => ({ id, parentId, title, url, syncing: false });

function search(
  id: string,
  nodes: chrome.bookmarks.BookmarkTreeNode[],
): chrome.bookmarks.BookmarkTreeNode | undefined {
  for (const item of nodes) {
    if (item.id === id) return item;
    const found = item.children && search(id, item.children);
    if (found) return found;
  }
  return undefined;
}

function browser() {
  const tree: chrome.bookmarks.BookmarkTreeNode[] = [
    {
      id: '0',
      title: '',
      syncing: false,
      children: [
        {
          ...node('1', '0', 'Bookmarks bar'),
          children: [
            node('a', '1', 'Vite', 'https://vite.dev/secret?key=private'),
            node('b', '1', 'Tailwind', 'https://tailwindcss.com/'),
            {
              ...node('20', '1', 'Development'),
              children: [node('d', '20', 'Saved docs', 'https://docs.example/')],
            },
            node('c', '1', 'Reading', 'https://reading.example/'),
            node('script', '1', 'Bookmarklet', 'javascript:alert(1)'),
          ],
        },
        {
          ...node('90', '0', 'Managed'),
          unmodifiable: 'managed',
          children: [node('91', '90', 'Policy', 'https://policy.example/')],
        },
      ],
    },
  ];
  const session: Record<string, unknown> = {};
  let nextId = 100;
  let permission = true;
  let locked = false;
  function find(id: string): chrome.bookmarks.BookmarkTreeNode {
    const found = search(id, tree);
    if (!found) throw new Error('Bookmark not found');
    return found;
  }
  const api = {
    permissions: { contains: vi.fn<() => Promise<boolean>>(async () => permission) },
    bookmarks: {
      getTree: vi.fn<() => Promise<chrome.bookmarks.BookmarkTreeNode[]>>(async () =>
        structuredClone(tree),
      ),
      getChildren: vi.fn<(id: string) => Promise<chrome.bookmarks.BookmarkTreeNode[]>>(
        async (id: string) => structuredClone(find(id).children ?? []),
      ),
      create: vi.fn<
        (details: { parentId: string; title: string }) => Promise<chrome.bookmarks.BookmarkTreeNode>
      >(async ({ parentId, title }: { parentId: string; title: string }) => {
        const created = { ...node(String(nextId++), parentId, title), children: [] };
        find(parentId).children!.push(created);
        return structuredClone(created);
      }),
      move: vi.fn<
        (
          id: string,
          destination: { parentId: string; index?: number },
        ) => Promise<chrome.bookmarks.BookmarkTreeNode>
      >(async (id: string, destination: { parentId: string; index?: number }) => {
        const item = find(id);
        const before = find(item.parentId!).children!;
        before.splice(before.indexOf(item), 1);
        const after = find(destination.parentId).children!;
        after.splice(destination.index ?? after.length, 0, item);
        item.parentId = destination.parentId;
        return structuredClone(item);
      }),
      remove: vi.fn<(value: string) => Promise<void>>(async (id: string) => {
        const item = find(id);
        if (item.children?.length) throw new Error('Folder is not empty');
        const siblings = find(item.parentId!).children!;
        siblings.splice(siblings.indexOf(item), 1);
      }),
    },
    storage: {
      session: {
        get: vi.fn<(key: string) => Promise<Record<string, unknown>>>(async (key: string) => ({
          [key]: structuredClone(session[key]),
        })),
        set: vi.fn<(value: Record<string, unknown>) => Promise<void>>(
          async (value: Record<string, unknown>) => {
            Object.assign(session, structuredClone(value));
          },
        ),
        remove: vi.fn<(value: string) => Promise<void>>(async (key: string) => {
          delete session[key];
        }),
      },
    },
  };
  vi.stubGlobal('chrome', api);
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        task: (lock: object | null) => Promise<number>,
      ) => {
        if (locked) return task(null);
        locked = true;
        try {
          return await task({});
        } finally {
          locked = false;
        }
      },
    },
  });
  return {
    api,
    tree,
    find,
    session,
    revoke: () => {
      permission = false;
    },
    snapshot: () => bookmarkScope(bookmarkLibrary(tree), '1'),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('bookmark selection and permissions', () => {
  it('offers writable folders and only their direct web bookmarks', () => {
    const { tree, snapshot } = browser();
    const library = bookmarkLibrary(tree);
    expect(library.folders.map((folder) => folder.id)).toEqual(['1', '20']);
    expect(snapshot().bookmarks.map((bookmark) => bookmark.id)).toEqual(['a', 'b', 'c']);
    expect(bookmarkScope(library, '20').bookmarks.map((bookmark) => bookmark.id)).toEqual(['d']);
    expect(() => bookmarkScope(library, '0')).toThrow('errorBookmarkChanged');
  });

  it('does not read bookmarks without permission', async () => {
    const { api, revoke } = browser();
    revoke();
    await expect(readBookmarkLibrary()).rejects.toThrow('errorBookmarkPermission');
    expect(api.bookmarks.getTree).not.toHaveBeenCalled();
  });
});

describe('bookmark apply and recovery', () => {
  const plan: IBookmarkGroup[] = [{ title: 'Tools', bookmarkIds: ['a', 'b'] }];

  it('creates a native folder and restores original sibling order without touching other contents', async () => {
    const { tree, snapshot, find } = browser();
    const before = structuredClone(tree);
    await expect(
      applyBookmarkGroups([{ title: 'Resources', bookmarkIds: ['c', 'a'] }], snapshot()),
    ).resolves.toBe(2);
    expect(find('100').children!.map((item) => item.id)).toEqual(['c', 'a']);
    expect(find('20').children!.map((item) => item.id)).toEqual(['d']);
    expect(await readBookmarkUndo()).toBeDefined();
    await expect(undoBookmarks()).resolves.toBe(2);
    expect(tree).toEqual(before);
    expect(await readBookmarkUndo()).toBeUndefined();
  });

  it('adds one bookmark to an existing folder and restores only that addition', async () => {
    const { snapshot, find } = browser();
    await applyBookmarkGroups(
      [{ title: 'Development', targetFolderId: '20', bookmarkIds: ['a'] }],
      snapshot(),
    );
    expect(find('20').children!.map((item) => item.id)).toEqual(['d', 'a']);
    await undoBookmarks();
    expect(find('20').children!.map((item) => item.id)).toEqual(['d']);
    expect(find('a').parentId).toBe('1');
  });

  it.each(['bookmark', 'target', 'source'] as const)(
    'rejects a stale %s before any mutation',
    async (changed) => {
      const { api, snapshot, find } = browser();
      const before = snapshot();
      find(changed === 'bookmark' ? 'a' : changed === 'target' ? '20' : '1').title = 'Changed';
      await expect(
        applyBookmarkGroups(
          [{ title: 'Development', targetFolderId: '20', bookmarkIds: ['a'] }],
          before,
        ),
      ).rejects.toThrow('errorBookmarkChanged');
      expect(api.bookmarks.move).not.toHaveBeenCalled();
      expect(api.bookmarks.create).not.toHaveBeenCalled();
    },
  );

  it('rejects duplicate IDs and bookmarks outside the selected folder', async () => {
    const { api, snapshot } = browser();
    await expect(
      applyBookmarkGroups([{ title: 'Tools', bookmarkIds: ['a', 'a'] }], snapshot()),
    ).rejects.toThrow('errorBookmarkPlan');
    await expect(
      applyBookmarkGroups([{ title: 'Tools', bookmarkIds: ['a', 'd'] }], snapshot()),
    ).rejects.toThrow('errorBookmarkPlan');
    expect(api.bookmarks.move).not.toHaveBeenCalled();
  });

  it('refuses to start if recovery storage is unavailable', async () => {
    const { api, snapshot } = browser();
    api.storage.session.set.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(applyBookmarkGroups(plan, snapshot())).rejects.toThrow('Storage unavailable');
    expect(api.bookmarks.create).not.toHaveBeenCalled();
    expect(api.bookmarks.move).not.toHaveBeenCalled();
  });

  it('rolls back a partial move and removes the empty folder', async () => {
    const { api, tree, snapshot } = browser();
    const before = structuredClone(tree);
    const move = api.bookmarks.move.getMockImplementation()!;
    api.bookmarks.move.mockImplementationOnce(move).mockRejectedValueOnce(new Error('Move failed'));
    await expect(applyBookmarkGroups(plan, snapshot())).rejects.toThrow('Move failed');
    expect(tree).toEqual(before);
    expect(await readBookmarkUndo()).toBeUndefined();
  });

  it('retains a journal when rollback fails and can finish recovery later', async () => {
    const { api, snapshot, tree } = browser();
    const before = structuredClone(tree);
    const move = api.bookmarks.move.getMockImplementation()!;
    api.bookmarks.move
      .mockImplementationOnce(move)
      .mockRejectedValueOnce(new Error('Apply interrupted'))
      .mockRejectedValueOnce(new Error('Recovery interrupted'));
    await expect(applyBookmarkGroups(plan, snapshot())).rejects.toThrow('errorBookmarkRollback');
    expect(await readBookmarkUndo()).toBeDefined();
    await expect(undoBookmarks()).resolves.toBe(1);
    expect(tree).toEqual(before);
  });

  it('stops adding bookmarks if the destination changes during application', async () => {
    const { api, snapshot, find } = browser();
    const move = api.bookmarks.move.getMockImplementation()!;
    api.bookmarks.move.mockImplementationOnce(async (id, destination) => {
      const result = await move(id, destination);
      find(destination.parentId).title = 'Manually renamed';
      return result;
    });
    await expect(applyBookmarkGroups(plan, snapshot())).rejects.toThrow('errorBookmarkChanged');
    expect(find('b').parentId).toBe('1');
    expect(find('100').title).toBe('Manually renamed');
    expect(api.bookmarks.move).toHaveBeenCalledTimes(1);
  });

  it('preserves the previous undo record after a later operation fails', async () => {
    const { api, snapshot, find } = browser();
    await applyBookmarkGroups(
      [{ title: 'Development', targetFolderId: '20', bookmarkIds: ['a'] }],
      snapshot(),
    );
    api.bookmarks.move.mockRejectedValueOnce(new Error('Move failed'));
    await expect(
      applyBookmarkGroups([{ title: 'Other', bookmarkIds: ['b', 'c'] }], snapshot()),
    ).rejects.toThrow('Move failed');
    await expect(undoBookmarks()).resolves.toBe(1);
    expect(find('a').parentId).toBe('1');
  });

  it('skips later edits and never deletes a nonempty new folder', async () => {
    const { snapshot, find } = browser();
    await applyBookmarkGroups(plan, snapshot());
    find('a').title = 'Manually edited';
    await expect(undoBookmarks()).resolves.toBe(1);
    expect(find('a').parentId).toBe('100');
    expect(find('a').title).toBe('Manually edited');
    expect(find('100').children!.map((item) => item.id)).toEqual(['a']);
  });

  it('keeps recovery if the original folder cannot receive bookmarks', async () => {
    const { snapshot, find } = browser();
    await applyBookmarkGroups(plan, snapshot());
    find('1').title = 'Renamed';
    await expect(undoBookmarks()).rejects.toThrow('errorBookmarkRestoreSource');
    expect(await readBookmarkUndo()).toBeDefined();
    expect(find('a').parentId).toBe('100');
  });

  it('serializes mutations across extension panels', async () => {
    const { snapshot } = browser();
    const first = applyBookmarkGroups(plan, snapshot());
    await expect(undoBookmarks()).rejects.toThrow('errorBookmarksBusy');
    await first;
  });
});
