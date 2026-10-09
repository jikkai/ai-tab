import type { IGroup, ITab, IUndo, IUndoGroup } from './types';
import { LocalizedError } from './errors';

export function eligibleTabs(tabs: chrome.tabs.Tab[]): ITab[] {
  return tabs.flatMap((tab) => {
    if (
      tab.id === undefined ||
      tab.pinned ||
      tab.incognito ||
      tab.pendingUrl ||
      tab.status === 'loading' ||
      (tab.splitViewId !== undefined && tab.splitViewId !== -1)
    )
      return [];
    let url: URL;
    try {
      url = new URL(tab.url ?? '');
    } catch {
      return [];
    }
    if (!['http:', 'https:'].includes(url.protocol)) return [];
    return [
      {
        id: tab.id,
        windowId: tab.windowId,
        groupId: tab.groupId,
        title: tab.title || url.hostname,
        url: tab.url!,
        hostname: url.hostname,
      },
    ];
  });
}

export async function readWindow(
  windowId: number,
): Promise<{ tabs: ITab[]; total: number; groups: chrome.tabGroups.TabGroup[] }> {
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ]);
  return {
    tabs: eligibleTabs(tabs).map((tab) => {
      const group = groups.find((item) => item.id === tab.groupId);
      return Object.assign(tab, { groupTitle: group?.title, groupColor: group?.color });
    }),
    total: tabs.length,
    groups,
  };
}

function undoKey(windowId: number): string {
  return `undo:${windowId}`;
}

export async function readUndo(windowId: number): Promise<IUndo | undefined> {
  const result = await chrome.storage.session.get(undoKey(windowId));
  return result[undoKey(windowId)] as IUndo | undefined;
}

async function persistUndo(undo: IUndo): Promise<void> {
  await chrome.storage.session.set({ [undoKey(undo.windowId)]: undo });
}

async function finishRestoringGroups(undo: IUndo): Promise<void> {
  await undo.originalGroups.reduce(async (previous, original) => {
    await previous;
    const pending = original.pendingRestore;
    if (!pending) return;
    const live = (await chrome.tabGroups.query({ windowId: undo.windowId })).find(
      (group) => group.id === original.restoreId,
    );
    // Only finish untouched new groups; a later manual edit takes precedence.
    if (
      live &&
      live.title === pending.title &&
      live.color === pending.color &&
      live.collapsed === pending.collapsed
    ) {
      await chrome.tabGroups.update(live.id, {
        title: original.title ?? '',
        color: original.color,
        collapsed: original.collapsed,
      });
    }
    delete original.pendingRestore;
    await persistUndo(undo);
  }, Promise.resolve());
}

async function restoreGroup(group: IUndoGroup, undo: IUndo): Promise<number> {
  const windowId = undo.windowId;
  const groups = await chrome.tabGroups.query({ windowId });
  const liveGroup = groups.find((item) => item.id === group.id);
  // Renamed/recolored groups belong to the user now; do not undo their edits.
  if (!liveGroup || (liveGroup.title ?? '') !== group.title || liveGroup.color !== group.color)
    return 0;
  const live = await chrome.tabs.query({ windowId, groupId: group.id });
  const recoverable = group.tabs.filter((before) =>
    live.some(
      (tab) =>
        tab.id === before.id &&
        tab.url === before.url &&
        !tab.pendingUrl &&
        tab.status !== 'loading' &&
        !tab.pinned &&
        (tab.splitViewId === undefined || tab.splitViewId === -1),
    ),
  );
  const originalIds = [...new Set(recoverable.map((tab) => tab.groupId))];
  return originalIds.reduce(async (pending, originalId) => {
    const count = await pending;
    const tabIds = recoverable.filter((tab) => tab.groupId === originalId).map((tab) => tab.id) as [
      number,
      ...number[],
    ];
    if (originalId === -1) {
      await chrome.tabs.ungroup(tabIds);
    } else {
      const original = undo.originalGroups.find((item) => item.id === originalId);
      if (!original) throw new LocalizedError('errorOriginalGroupMissing');
      const target = (await chrome.tabGroups.query({})).find(
        (item) => item.id === original.restoreId,
      );
      if (target && target.windowId !== windowId) return count;
      if (target) {
        await chrome.tabs.group({ groupId: target.id, tabIds });
      } else {
        original.restoreId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
        original.pendingRestore = await chrome.tabGroups.get(original.restoreId);
        await persistUndo(undo);
        await finishRestoringGroups(undo);
      }
    }
    return count + tabIds.length;
  }, Promise.resolve(0));
}

export async function undoLast(windowId: number): Promise<number> {
  const undo = await readUndo(windowId);
  if (!undo) throw new LocalizedError('errorNoUndo');
  await finishRestoringGroups(undo);
  const count = await undo.groups.toReversed().reduce(async (pending, group) => {
    const restored = await pending;
    const groupCount = await restoreGroup(group, undo);
    undo.groups = undo.groups.filter((item) => item.id !== group.id);
    await persistUndo(undo);
    return restored + groupCount;
  }, Promise.resolve(0));
  await chrome.storage.session.remove(undoKey(windowId));
  return count;
}

export async function applyGroups(
  windowId: number,
  groups: IGroup[],
  snapshot: ITab[],
): Promise<number> {
  if (!groups.length) throw new LocalizedError('errorSelectGroups');
  const ids = groups.flatMap((group) => group.tabIds);
  const targets = groups.flatMap((group) =>
    group.targetGroupId === undefined ? [] : [group.targetGroupId],
  );
  if (
    new Set(ids).size !== ids.length ||
    new Set(targets).size !== targets.length ||
    groups.some((group) =>
      group.targetGroupId === undefined
        ? !group.title.trim() || group.title.length > 40 || group.tabIds.length < 2
        : !Number.isInteger(group.targetGroupId) || group.targetGroupId < 0 || !group.tabIds.length,
    )
  ) {
    throw new LocalizedError('errorInvalidPlan');
  }
  const before = new Map(snapshot.map((tab) => [tab.id, tab]));
  const current = eligibleTabs(await chrome.tabs.query({ windowId }));
  if (
    ids.some((id) => {
      const expected = before.get(id);
      const actual = current.find((tab) => tab.id === id);
      return (
        !expected ||
        expected.windowId !== windowId ||
        !actual ||
        actual.url !== expected.url ||
        actual.title !== expected.title ||
        actual.groupId !== expected.groupId
      );
    })
  )
    throw new LocalizedError('errorStalePreview');

  const windowGroups = await chrome.tabGroups.query({ windowId });
  if (
    groups.some(
      (group) =>
        group.targetGroupId !== undefined &&
        !windowGroups.some(
          (target) =>
            target.id === group.targetGroupId &&
            (target.title ?? '') === group.title &&
            target.color === group.color,
        ),
    )
  )
    throw new LocalizedError('errorTargetGroupChanged');
  const originalIds = new Set(ids.map((id) => before.get(id)!.groupId).filter((id) => id !== -1));
  const originalGroups = windowGroups.filter((group) => originalIds.has(group.id));
  if (originalGroups.length !== originalIds.size)
    throw new LocalizedError('errorOriginalGroupsChanged');
  const undo: IUndo = {
    windowId,
    groups: [],
    originalGroups: originalGroups.map((group) => Object.assign(group, { restoreId: group.id })),
  };
  const previous = await readUndo(windowId);
  // Confirm recovery storage works before moving any tabs.
  await persistUndo(undo);
  try {
    // Group changes share recovery state and must run sequentially.
    // Fill existing targets before new groups can empty their original membership.
    await groups
      .toSorted(
        (a, b) => Number(b.targetGroupId !== undefined) - Number(a.targetGroupId !== undefined),
      )
      .reduce(async (pending, group) => {
        await pending;
        const live = eligibleTabs(await chrome.tabs.query({ windowId }));
        if (
          group.tabIds.some(
            (id) =>
              !live.some(
                (tab) =>
                  tab.id === id &&
                  tab.url === before.get(id)?.url &&
                  tab.title === before.get(id)?.title &&
                  tab.groupId === before.get(id)?.groupId,
              ),
          )
        ) {
          throw new LocalizedError('errorTabsChangedDuringApply');
        }
        if (group.targetGroupId !== undefined) {
          const target = (await chrome.tabGroups.query({ windowId })).find(
            (item) => item.id === group.targetGroupId,
          );
          if (!target || (target.title ?? '') !== group.title || target.color !== group.color) {
            throw new LocalizedError('errorTargetGroupChanged');
          }
          undo.groups.push({
            id: target.id,
            title: target.title ?? '',
            color: target.color,
            tabs: group.tabIds.map((tabId) => before.get(tabId)!),
          });
          await persistUndo(undo);
          await chrome.tabs.group({
            groupId: target.id,
            tabIds: group.tabIds as [number, ...number[]],
          });
          return;
        }
        const id = await chrome.tabs.group({
          tabIds: group.tabIds as [number, ...number[]],
          createProperties: { windowId },
        });
        const record: IUndoGroup = {
          id,
          title: '',
          color: 'grey',
          tabs: group.tabIds.map((tabId) => before.get(tabId)!),
        };
        undo.groups.push(record);
        const created = await chrome.tabGroups.get(id);
        record.title = created.title ?? '';
        record.color = created.color;
        await persistUndo(undo);
        await chrome.tabGroups.update(id, { title: group.title.trim(), color: group.color });
        record.title = group.title.trim();
        record.color = group.color;
        await persistUndo(undo);
      }, Promise.resolve());
  } catch (error) {
    const failed = await undo.groups.toReversed().reduce(async (pending, group) => {
      const remaining = await pending;
      try {
        await restoreGroup(group, undo);
      } catch {
        remaining.unshift(group);
      }
      return remaining;
    }, Promise.resolve<IUndoGroup[]>([]));
    if (failed.length) {
      undo.groups = failed;
      await persistUndo(undo);
      throw new LocalizedError(
        'errorRollbackIncomplete',
        {},
        {
          cause: error,
        },
      );
    }
    if (previous) {
      // Recreating an emptied group changes its Chrome ID, including in the previous undo record.
      for (const original of undo.originalGroups) {
        for (const group of previous.groups) {
          if (group.id === original.id) group.id = original.restoreId;
        }
        for (const group of previous.originalGroups) {
          if (group.restoreId === original.id) group.restoreId = original.restoreId;
        }
      }
      await persistUndo(previous);
    } else await chrome.storage.session.remove(undoKey(windowId));
    throw error;
  }
  return ids.length;
}
