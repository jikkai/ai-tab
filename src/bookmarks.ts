import type { IBookmark, IBookmarkFolder, IBookmarkGroup, IBookmarkScope } from './types';
import { BOOKMARK_LIMIT, parseBookmarkGroups } from './ai';
import { LocalizedError } from './errors';

interface IBookmarkUndo {
  source: IBookmarkFolder;
  moves: { bookmark: IBookmark; target: IBookmarkFolder }[];
  created: IBookmarkFolder[];
}

export function bookmarkLibrary(tree: chrome.bookmarks.BookmarkTreeNode[]): {
  folders: IBookmarkFolder[];
  bookmarks: IBookmark[];
} {
  const folders: IBookmarkFolder[] = [];
  const bookmarks: IBookmark[] = [];
  function visit(nodes: chrome.bookmarks.BookmarkTreeNode[], path: string[]): void {
    nodes.forEach((node, index) => {
      if (node.unmodifiable) return;
      if (node.url === undefined) {
        const parts = node.parentId ? [...path, node.title] : path;
        if (node.parentId)
          folders.push({
            id: node.id,
            parentId: node.parentId,
            title: node.title,
            path: parts.join(' / '),
          });
        visit(node.children ?? [], parts);
      } else if (node.parentId) {
        let url: URL;
        try {
          url = new URL(node.url);
        } catch {
          return;
        }
        if (!['http:', 'https:'].includes(url.protocol)) return;
        bookmarks.push({
          id: node.id,
          parentId: node.parentId,
          index,
          title: node.title,
          url: node.url,
          hostname: url.hostname,
        });
      }
    });
  }
  visit(tree, []);
  return { folders, bookmarks };
}

export async function readBookmarkLibrary(): Promise<ReturnType<typeof bookmarkLibrary>> {
  if (!(await chrome.permissions.contains({ permissions: ['bookmarks'] })))
    throw new LocalizedError('errorBookmarkPermission');
  return bookmarkLibrary(await chrome.bookmarks.getTree());
}

export function bookmarkScope(
  library: ReturnType<typeof bookmarkLibrary>,
  folderId: string,
): IBookmarkScope {
  const folder = library.folders.find((item) => item.id === folderId);
  if (!folder) throw new LocalizedError('errorBookmarkChanged');
  return {
    folder,
    bookmarks: library.bookmarks.filter((bookmark) => bookmark.parentId === folderId),
    folders: library.folders.filter((item) => item.parentId === folderId),
  };
}

function sameFolder(expected: IBookmarkFolder, actual?: IBookmarkFolder): boolean {
  return Boolean(
    actual &&
    expected.id === actual.id &&
    expected.parentId === actual.parentId &&
    expected.path === actual.path,
  );
}

function sameBookmark(
  expected: IBookmark,
  actual?: Pick<
    chrome.bookmarks.BookmarkTreeNode,
    'id' | 'title' | 'url' | 'parentId' | 'unmodifiable'
  >,
): boolean {
  return Boolean(
    actual &&
    !actual.unmodifiable &&
    actual.id === expected.id &&
    actual.url === expected.url &&
    actual.title === expected.title &&
    actual.parentId === expected.parentId,
  );
}

export async function readBookmarkUndo(): Promise<IBookmarkUndo | undefined> {
  const { bookmarkUndo } = await chrome.storage.session.get('bookmarkUndo');
  return bookmarkUndo as IBookmarkUndo | undefined;
}

async function persistUndo(undo: IBookmarkUndo): Promise<void> {
  await chrome.storage.session.set({ bookmarkUndo: undo });
}

async function restore(undo: IBookmarkUndo): Promise<number> {
  const library = await readBookmarkLibrary();
  if (
    !sameFolder(
      undo.source,
      library.folders.find((folder) => folder.id === undo.source.id),
    )
  )
    throw new LocalizedError('errorBookmarkRestoreSource');
  let restored = 0;
  // Ascending original indices restore sibling order after several bookmarks leave a folder.
  await undo.moves
    .toSorted((a, b) => a.bookmark.index - b.bookmark.index)
    .reduce(async (pending, move) => {
      await pending;
      const target = library.folders.find((folder) => folder.id === move.target.id);
      if (sameFolder(move.target, target)) {
        const live = (await chrome.bookmarks.getChildren(move.target.id)).find(
          (node) => node.id === move.bookmark.id,
        );
        if (sameBookmark({ ...move.bookmark, parentId: move.target.id }, live)) {
          const children = await chrome.bookmarks.getChildren(undo.source.id);
          await chrome.bookmarks.move(move.bookmark.id, {
            parentId: undo.source.id,
            index: Math.min(move.bookmark.index, children.length),
          });
          restored++;
        }
      }
      undo.moves = undo.moves.filter((item) => item !== move);
      await persistUndo(undo);
    }, Promise.resolve());
  await undo.created.reduce(async (pending, folder) => {
    await pending;
    const live = library.folders.find((item) => item.id === folder.id);
    if (sameFolder(folder, live) && !(await chrome.bookmarks.getChildren(folder.id)).length)
      await chrome.bookmarks.remove(folder.id);
    undo.created = undo.created.filter((item) => item.id !== folder.id);
    await persistUndo(undo);
  }, Promise.resolve());
  return restored;
}

export async function undoBookmarks(): Promise<number> {
  return navigator.locks.request('ai-tab-bookmarks', { ifAvailable: true }, async (lock) => {
    if (!lock) throw new LocalizedError('errorBookmarksBusy');
    const undo = await readBookmarkUndo();
    if (!undo) return 0;
    const count = await restore(undo);
    await chrome.storage.session.remove('bookmarkUndo');
    return count;
  });
}

export async function applyBookmarkGroups(
  groups: IBookmarkGroup[],
  snapshot: IBookmarkScope,
): Promise<number> {
  return navigator.locks.request('ai-tab-bookmarks', { ifAvailable: true }, async (lock) => {
    if (!lock) throw new LocalizedError('errorBookmarksBusy');
    const live = bookmarkScope(await readBookmarkLibrary(), snapshot.folder.id);
    const ids = groups.flatMap((group) => group.bookmarkIds);
    if (!groups.length || !ids.length || ids.length > BOOKMARK_LIMIT)
      throw new LocalizedError('errorBookmarkPlan');
    const plans = parseBookmarkGroups(
      JSON.stringify({ groups }),
      snapshot.bookmarks,
      snapshot.folders,
    );
    if (
      !sameFolder(snapshot.folder, live.folder) ||
      ids.some((id) => {
        const expected = snapshot.bookmarks.find((bookmark) => bookmark.id === id);
        return (
          !expected ||
          !sameBookmark(
            expected,
            live.bookmarks.find((bookmark) => bookmark.id === id),
          )
        );
      }) ||
      plans.some((group) =>
        group.targetFolderId !== undefined
          ? !sameFolder(
              snapshot.folders.find((folder) => folder.id === group.targetFolderId)!,
              live.folders.find((folder) => folder.id === group.targetFolderId),
            )
          : live.folders.some(
              (folder) => folder.title.trim().toLowerCase() === group.title.toLowerCase(),
            ),
      )
    )
      throw new LocalizedError('errorBookmarkChanged');
    const previous = await readBookmarkUndo();
    const undo: IBookmarkUndo = { source: live.folder, moves: [], created: [] };
    // Verify storage before mutations and record every move before issuing it.
    await persistUndo(undo);
    try {
      await plans.reduce(async (pending, group) => {
        await pending;
        const current = bookmarkScope(await readBookmarkLibrary(), snapshot.folder.id);
        if (!sameFolder(snapshot.folder, current.folder))
          throw new LocalizedError('errorBookmarkChanged');
        let target: IBookmarkFolder;
        if (group.targetFolderId !== undefined) {
          const expected = snapshot.folders.find((folder) => folder.id === group.targetFolderId)!;
          const actual = current.folders.find((folder) => folder.id === group.targetFolderId);
          if (!sameFolder(expected, actual)) throw new LocalizedError('errorBookmarkChanged');
          target = actual!;
        } else {
          if (
            current.folders.some(
              (folder) => folder.title.trim().toLowerCase() === group.title.toLowerCase(),
            )
          )
            throw new LocalizedError('errorBookmarkChanged');
          const created = await chrome.bookmarks.create({
            parentId: snapshot.folder.id,
            title: group.title,
          });
          target = {
            id: created.id,
            parentId: snapshot.folder.id,
            title: group.title,
            path: `${snapshot.folder.path} / ${group.title}`,
          };
          undo.created.push(target);
          await persistUndo(undo);
        }
        await group.bookmarkIds.reduce(async (pendingMove, id) => {
          await pendingMove;
          const bookmark = live.bookmarks.find((item) => item.id === id)!;
          const children = await chrome.bookmarks.getChildren(snapshot.folder.id);
          const actual = children.find((node) => node.id === id);
          const destination = children.find((node) => node.id === target.id);
          if (
            !sameBookmark(bookmark, actual) ||
            !destination ||
            destination.title !== target.title ||
            destination.url !== undefined ||
            destination.unmodifiable
          )
            throw new LocalizedError('errorBookmarkChanged');
          undo.moves.push({ bookmark, target });
          await persistUndo(undo);
          await chrome.bookmarks.move(id, { parentId: target.id });
        }, Promise.resolve());
      }, Promise.resolve());
    } catch (error) {
      try {
        await restore(undo);
        if (previous) await persistUndo(previous);
        else await chrome.storage.session.remove('bookmarkUndo');
      } catch {
        throw new LocalizedError('errorBookmarkRollback', {}, { cause: error });
      }
      throw error;
    }
    return ids.length;
  });
}
