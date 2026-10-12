import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IGroup } from '../types';
import { applyGroups, eligibleTabs, undoLast } from '../tabs';

function createTab(id: number, overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id,
    windowId: 7,
    index: id - 1,
    title: `Tab ${id}`,
    url: `https://example.com/${id}`,
    groupId: -1,
    pinned: false,
    incognito: false,
    active: false,
    highlighted: false,
    autoDiscardable: true,
    discarded: false,
    frozen: false,
    selected: false,
    lastAccessed: 0,
    status: 'complete',
    ...overrides,
  };
}

function originalGroup(id: number): chrome.tabGroups.TabGroup {
  return { id, title: '项目资料', color: 'purple', collapsed: true, windowId: 7, shared: false };
}

function browser(initial: chrome.tabs.Tab[], initialGroups: chrome.tabGroups.TabGroup[] = []) {
  const live = structuredClone(initial);
  const groups = structuredClone(initialGroups);
  const session: Record<string, unknown> = {};
  let nextId = 100;
  function removeEmptyGroups(): void {
    for (let index = groups.length - 1; index >= 0; index--) {
      if (!live.some((tab) => tab.groupId === groups[index]!.id)) groups.splice(index, 1);
    }
  }
  const api = {
    tabs: {
      query: vi.fn<(query: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>>(async (query) =>
        live.filter(
          (tab) =>
            (query.windowId === undefined || tab.windowId === query.windowId) &&
            (query.groupId === undefined || tab.groupId === query.groupId),
        ),
      ),
      group: vi.fn<(options: chrome.tabs.GroupOptions) => Promise<number>>(
        async ({ tabIds, groupId, createProperties }) => {
          const id = groupId ?? nextId++;
          if (groupId === undefined)
            groups.push({
              id,
              title: '',
              color: 'blue',
              collapsed: false,
              windowId: createProperties?.windowId ?? 7,
              shared: false,
            });
          if (!groups.some((group) => group.id === id)) throw new Error('Group not found');
          (Array.isArray(tabIds) ? tabIds : [tabIds]).forEach((tabId) => {
            live.find((tab) => tab.id === tabId)!.groupId = id;
          });
          removeEmptyGroups();
          return id;
        },
      ),
      ungroup: vi.fn<(ids: number | [number, ...number[]]) => Promise<void>>(async (ids) => {
        (Array.isArray(ids) ? ids : [ids]).forEach((id) => {
          live.find((tab) => tab.id === id)!.groupId = -1;
        });
        removeEmptyGroups();
      }),
    },
    tabGroups: {
      query: vi.fn<(query: chrome.tabGroups.QueryInfo) => Promise<chrome.tabGroups.TabGroup[]>>(
        async (query) =>
          structuredClone(
            groups.filter(
              (group) => query.windowId === undefined || group.windowId === query.windowId,
            ),
          ),
      ),
      get: vi.fn<(id: number) => Promise<chrome.tabGroups.TabGroup>>(async (id) => {
        const found = groups.find((group) => group.id === id);
        if (!found) throw new Error('Group not found');
        return structuredClone(found);
      }),
      update: vi.fn<
        (
          id: number,
          update: chrome.tabGroups.UpdateProperties,
        ) => Promise<chrome.tabGroups.TabGroup | undefined>
      >(async (id, update) =>
        Object.assign(
          groups.find((group) => group.id === id)!,
          update,
        ),
      ),
    },
    storage: {
      session: {
        get: vi.fn<(key: string) => Promise<Record<string, unknown>>>(async (key) => ({
          [key]: structuredClone(session[key]),
        })),
        set: vi.fn<(value: Record<string, unknown>) => Promise<void>>(async (value) => {
          Object.assign(session, structuredClone(value));
        }),
        remove: vi.fn<(key: string) => Promise<void>>(async (key) => {
          delete session[key];
        }),
      },
    },
  };
  vi.stubGlobal('chrome', api);
  return { api, live, groups, session };
}

afterEach(() => vi.unstubAllGlobals());

describe('tab eligibility', () => {
  it('includes grouped pages but protects pinned, split, loading and private tabs', () => {
    const input = [
      createTab(1),
      createTab(2, { pinned: true }),
      createTab(3, { groupId: 42 }),
      createTab(4, { incognito: true }),
      createTab(5, { url: 'chrome://settings' }),
      createTab(6, { splitViewId: 3 }),
      createTab(7, { pendingUrl: 'https://new.example' }),
      createTab(8, { status: 'loading' }),
    ];
    expect(eligibleTabs(input).map((tab) => tab.id)).toEqual([1, 3]);
  });
});

describe('apply and undo groups', () => {
  const plan: IGroup[] = [{ title: '资料', color: 'blue', tabIds: [1, 2] }];

  it.each([
    { tabIds: [1], title: '项目资料' },
    { tabIds: [1, 2], title: '项目资料' },
    { tabIds: [1], title: '' },
    { tabIds: [1], title: undefined },
  ])(
    'merges selected tabs $tabIds into native group "$title" and undoes only the additions',
    async ({ tabIds, title }) => {
      const original = { ...originalGroup(50), title };
      const { live, groups } = browser(
        [createTab(1), createTab(2), createTab(3, { groupId: 50 }), createTab(4, { groupId: 50 })],
        [original],
      );
      const merge = { targetGroupId: 50, title: title ?? '', color: original.color, tabIds };
      expect(await applyGroups(7, [merge], eligibleTabs(live))).toBe(tabIds.length);
      expect(groups).toEqual([original]);
      expect(
        live.filter((tab) => tabIds.includes(tab.id!)).every((tab) => tab.groupId === 50),
      ).toBe(true);
      expect(await undoLast(7)).toBe(tabIds.length);
      expect(live.map((tab) => tab.groupId)).toEqual([-1, -1, 50, 50]);
      expect(groups).toEqual([original]);
    },
  );

  it.each([{ title: 'Renamed' }, { color: 'orange' as const }, { windowId: 8 }])(
    'rejects an existing target changed since preview: %j',
    async (change) => {
      const original = originalGroup(50);
      const { api, live } = browser(
        [createTab(1), createTab(2, { groupId: 50 })],
        [{ ...original, ...change }],
      );
      await expect(
        applyGroups(
          7,
          [{ targetGroupId: 50, title: original.title!, color: original.color, tabIds: [1] }],
          eligibleTabs(live),
        ),
      ).rejects.toThrow('errorTargetGroupChanged');
      expect(api.tabs.group).not.toHaveBeenCalled();
    },
  );

  it('rejects a deleted target before moving any selected tab', async () => {
    const { api, live } = browser([createTab(1)]);
    await expect(
      applyGroups(
        7,
        [{ targetGroupId: 50, title: 'Deleted', color: 'purple', tabIds: [1] }],
        eligibleTabs(live),
      ),
    ).rejects.toThrow('errorTargetGroupChanged');
    expect(api.tabs.group).not.toHaveBeenCalled();
  });

  it('restores emptied source groups without removing the existing destination', async () => {
    const source = originalGroup(50);
    const target = { ...originalGroup(60), title: '另一个项目' };
    const { live, groups } = browser(
      [createTab(1, { groupId: 50 }), createTab(2, { groupId: 60 })],
      [source, target],
    );
    await applyGroups(
      7,
      [{ targetGroupId: target.id, title: target.title!, color: target.color, tabIds: [1] }],
      eligibleTabs(live),
    );
    expect(groups).toEqual([target]);
    expect(await undoLast(7)).toBe(1);
    expect(groups).toEqual(expect.arrayContaining([target, { ...source, id: live[0]!.groupId }]));
    expect(live[1]!.groupId).toBe(target.id);
  });

  it('fills an existing group before moving its former members into a new group and preserves its ID on undo', async () => {
    const original = originalGroup(50);
    const { live, groups } = browser(
      [createTab(1, { groupId: 50 }), createTab(2, { groupId: 50 }), createTab(3)],
      [original],
    );
    await applyGroups(
      7,
      [...plan, { targetGroupId: 50, title: original.title!, color: original.color, tabIds: [3] }],
      eligibleTabs(live),
    );
    expect(live.map((tab) => tab.groupId)).toEqual([100, 100, 50]);
    expect(await undoLast(7)).toBe(3);
    expect(live.map((tab) => tab.groupId)).toEqual([50, 50, -1]);
    expect(groups).toEqual([original]);
  });

  it('rolls back an addition to an existing group when a later new group fails', async () => {
    const original = originalGroup(50);
    const { api, live, groups, session } = browser(
      [createTab(1), createTab(2), createTab(3), createTab(4, { groupId: 50 })],
      [original],
    );
    api.tabGroups.update.mockRejectedValueOnce(new Error('Cannot rename new group'));
    await expect(
      applyGroups(
        7,
        [
          { targetGroupId: 50, title: original.title!, color: original.color, tabIds: [1] },
          { title: 'New', color: 'blue', tabIds: [2, 3] },
        ],
        eligibleTabs(live),
      ),
    ).rejects.toThrow('Cannot rename new group');
    expect(live.map((tab) => tab.groupId)).toEqual([-1, -1, -1, 50]);
    expect(groups).toEqual([original]);
    expect(session['undo:7']).toBeUndefined();
  });

  it('retains a failed merge undo for retry without touching original members', async () => {
    const original = originalGroup(50);
    const { api, live, groups } = browser(
      [createTab(1), createTab(2, { groupId: 50 })],
      [original],
    );
    await applyGroups(
      7,
      [{ targetGroupId: 50, title: original.title!, color: original.color, tabIds: [1] }],
      eligibleTabs(live),
    );
    api.tabs.ungroup.mockRejectedValueOnce(new Error('Cannot edit tabs'));
    await expect(undoLast(7)).rejects.toThrow('Cannot edit tabs');
    expect(await undoLast(7)).toBe(1);
    expect(live.map((tab) => tab.groupId)).toEqual([-1, 50]);
    expect(groups).toEqual([original]);
  });

  it('retries an interrupted rollback in reverse application order to preserve the existing target', async () => {
    const original = originalGroup(50);
    const { api, live, groups } = browser(
      [createTab(1, { groupId: 50 }), createTab(2, { groupId: 50 }), createTab(3)],
      [original],
    );
    const move = api.tabs.group.getMockImplementation()!;
    api.tabs.group
      .mockImplementationOnce(move)
      .mockImplementationOnce(move)
      .mockRejectedValueOnce(new Error('Cannot restore members'));
    api.tabGroups.update.mockRejectedValueOnce(new Error('Cannot rename new group'));
    api.tabs.ungroup.mockRejectedValueOnce(new Error('Cannot restore addition'));
    await expect(
      applyGroups(
        7,
        [
          ...plan,
          { targetGroupId: 50, title: original.title!, color: original.color, tabIds: [3] },
        ],
        eligibleTabs(live),
      ),
    ).rejects.toThrow('errorRollbackIncomplete');
    expect(await undoLast(7)).toBe(3);
    expect(live.map((tab) => tab.groupId)).toEqual([50, 50, -1]);
    expect(groups).toEqual([original]);
  });

  it('creates native groups and lets the user undo without disturbing an existing group', async () => {
    const { live } = browser(
      [createTab(1), createTab(2), createTab(3, { groupId: 50 })],
      [originalGroup(50)],
    );
    await expect(applyGroups(7, plan, eligibleTabs(live))).resolves.toBe(2);
    expect(live.map((tab) => tab.groupId)).toEqual([100, 100, 50]);
    await expect(undoLast(7)).resolves.toBe(2);
    expect(live.map((tab) => tab.groupId)).toEqual([-1, -1, 50]);
  });

  it.each([
    { url: 'https://new.example/' },
    { groupId: 22 },
    { pinned: true },
    { windowId: 8 },
    { title: 'Changed' },
  ])('rejects a stale preview before moving any tab: %s', async (change) => {
    const { api, live } = browser([createTab(1), createTab(2)]);
    const snapshot = eligibleTabs(live);
    Object.assign(live[1]!, change);
    await expect(applyGroups(7, plan, snapshot)).rejects.toThrow('errorStalePreview');
    expect(api.tabs.group).not.toHaveBeenCalled();
  });

  it('regroups selected tabs and returns them to a surviving original group without overwriting later edits', async () => {
    const { live, groups } = browser(
      [createTab(1, { groupId: 50 }), createTab(2), createTab(3, { groupId: 50 })],
      [originalGroup(50)],
    );
    await applyGroups(7, plan, eligibleTabs(live));
    expect(live.map((tab) => tab.groupId)).toEqual([100, 100, 50]);
    Object.assign(
      groups.find((group) => group.id === 50)!,
      { title: '手动修改', color: 'blue', collapsed: false },
    );
    expect(await undoLast(7)).toBe(2);
    expect(live.map((tab) => tab.groupId)).toEqual([50, -1, 50]);
    expect(groups).toEqual([
      { ...originalGroup(50), title: '手动修改', color: 'blue', collapsed: false },
    ]);
  });

  it('recreates emptied original groups when tabs from multiple groups were combined', async () => {
    const first = originalGroup(50);
    const second = {
      ...originalGroup(60),
      title: '阅读清单',
      color: 'blue' as const,
      collapsed: false,
    };
    const { live, groups } = browser(
      [createTab(1, { groupId: 50 }), createTab(2, { groupId: 60 })],
      [first, second],
    );
    await applyGroups(7, plan, eligibleTabs(live));
    expect(groups.map((group) => group.title)).toEqual(['资料']);
    expect(await undoLast(7)).toBe(2);
    expect(groups).toEqual([
      { ...first, id: live[0]!.groupId },
      { ...second, id: live[1]!.groupId },
    ]);
    expect(live[0]!.groupId).not.toBe(live[1]!.groupId);
  });

  it('restores an original group only once when it was split into multiple new groups', async () => {
    const { live, groups } = browser(
      [1, 2, 3, 4].map((id) => createTab(id, { groupId: 50 })),
      [originalGroup(50)],
    );
    await applyGroups(
      7,
      [...plan, { title: '阅读', color: 'green', tabIds: [3, 4] }],
      eligibleTabs(live),
    );
    expect(await undoLast(7)).toBe(4);
    expect(new Set(live.map((tab) => tab.groupId)).size).toBe(1);
    expect(groups).toEqual([{ ...originalGroup(50), id: live[0]!.groupId }]);
  });

  it('finishes restoring original metadata on a retry after a partial undo failure', async () => {
    const { api, live, groups, session } = browser(
      [createTab(1, { groupId: 50 }), createTab(2)],
      [originalGroup(50)],
    );
    await applyGroups(7, plan, eligibleTabs(live));
    api.tabGroups.update.mockRejectedValueOnce(new Error('Cannot edit group'));
    await expect(undoLast(7)).rejects.toThrow('Cannot edit group');
    expect(session['undo:7']).toBeDefined();
    await undoLast(7);
    expect(groups).toEqual([{ ...originalGroup(50), id: live[0]!.groupId }]);
    expect(live[1]!.groupId).toBe(-1);
    expect(session['undo:7']).toBeUndefined();
  });

  it('restores original groups after a failed regroup and keeps the preceding undo usable', async () => {
    const { api, live, groups } = browser(
      [createTab(1, { groupId: 50 }), createTab(2), createTab(3, { groupId: 50 }), createTab(4)],
      [originalGroup(50)],
    );
    await applyGroups(7, plan, eligibleTabs(live));
    api.tabGroups.update
      .mockImplementationOnce(api.tabGroups.update.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('Cannot edit group'));
    await expect(
      applyGroups(
        7,
        [...plan, { title: '阅读', color: 'green', tabIds: [3, 4] }],
        eligibleTabs(live),
      ),
    ).rejects.toThrow('Cannot edit group');
    expect(live[0]!.groupId).toBe(live[1]!.groupId);
    expect(groups.find((group) => group.id === live[0]!.groupId)?.title).toBe('资料');
    expect(groups.find((group) => group.id === live[2]!.groupId)).toEqual({
      ...originalGroup(50),
      id: live[2]!.groupId,
    });
    expect(live[3]!.groupId).toBe(-1);
    expect(await undoLast(7)).toBe(2);
    expect(live.map((tab) => tab.groupId)).toEqual([live[2]!.groupId, -1, live[2]!.groupId, -1]);
    expect(groups).toEqual([{ ...originalGroup(50), id: live[2]!.groupId }]);
  });

  it('rolls back previously created groups if a later group fails', async () => {
    const { api, live, session } = browser([
      createTab(1),
      createTab(2),
      createTab(3),
      createTab(4),
    ]);
    api.tabGroups.update
      .mockImplementationOnce(api.tabGroups.update.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('Cannot edit tabs'));
    await expect(
      applyGroups(
        7,
        [...plan, { title: '阅读', color: 'green', tabIds: [3, 4] }],
        eligibleTabs(live),
      ),
    ).rejects.toThrow('Cannot edit');
    expect(live.every((tab) => tab.groupId === -1)).toBe(true);
    expect(session['undo:7']).toBeUndefined();
  });

  it('stops later groups and retains recovery data when a failed application cannot be rolled back', async () => {
    const { api, live } = browser([createTab(1), createTab(2), createTab(3), createTab(4)]);
    api.tabGroups.update.mockRejectedValueOnce(new Error('Cannot edit group'));
    api.tabs.ungroup.mockRejectedValueOnce(new Error('Cannot edit tabs'));
    await expect(
      applyGroups(
        7,
        [...plan, { title: '阅读', color: 'green', tabIds: [3, 4] }],
        eligibleTabs(live),
      ),
    ).rejects.toThrow('errorRollbackIncomplete');
    expect(live.map((tab) => tab.groupId)).toEqual([100, 100, -1, -1]);
    expect(await undoLast(7)).toBe(2);
    expect(live.every((tab) => tab.groupId === -1)).toBe(true);
  });

  it('does not move any tabs if recovery storage is unavailable', async () => {
    const { api, live } = browser([createTab(1), createTab(2)]);
    api.storage.session.set.mockRejectedValueOnce(new Error('Storage full'));
    await expect(applyGroups(7, plan, eligibleTabs(live))).rejects.toThrow('Storage full');
    expect(api.tabs.group).not.toHaveBeenCalled();
  });

  it('keeps tabs the user moved or navigated after applying', async () => {
    const { live } = browser([createTab(1), createTab(2)]);
    await applyGroups(7, plan, eligibleTabs(live));
    live[0]!.groupId = 900;
    live[1]!.url = 'https://new.example/';
    expect(await undoLast(7)).toBe(0);
    expect(live.map((tab) => tab.groupId)).toEqual([900, 100]);
  });

  it.each([{ title: 'My own group' }, { color: 'orange' }])(
    'keeps groups the user modified after applying: %s',
    async (changes) => {
      const { live, groups } = browser([createTab(1), createTab(2)]);
      await applyGroups(7, plan, eligibleTabs(live));
      Object.assign(groups[0]!, changes);
      expect(await undoLast(7)).toBe(0);
      expect(live.map((tab) => tab.groupId)).toEqual([100, 100]);
    },
  );
});
