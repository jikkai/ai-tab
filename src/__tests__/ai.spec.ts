import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseBookmarkGroups,
  parseGroups,
  suggestBookmarkGroups,
  suggestGroups,
  testConnection,
} from '../ai';

const settings = {
  baseUrl: 'https://ai.example/v1',
  apiKey: 'private-key',
  model: 'model',
  instructions: '',
};
const tabs = [
  {
    id: 1,
    windowId: 1,
    groupId: -1,
    title: 'Docs',
    hostname: 'docs.example',
    url: 'https://docs.example/private?token=secret',
  },
  {
    id: 2,
    windowId: 1,
    groupId: 20,
    groupTitle: 'Private project',
    title: 'Repo',
    hostname: 'code.example',
    url: 'https://code.example/team#private',
  },
  {
    id: 3,
    windowId: 1,
    groupId: -1,
    title: 'Mail',
    hostname: 'mail.example',
    url: 'https://mail.example/',
  },
];
const group = { title: '开发资料', tabIds: [1, 2] };
const existing = {
  id: 20,
  title: '开发资料',
  color: 'purple' as const,
  windowId: 1,
  collapsed: true,
  shared: false,
};

afterEach(() => vi.unstubAllGlobals());

describe('group response validation', () => {
  it('accepts one tab joining an existing group and preserves its name and color', () => {
    expect(
      parseGroups(
        JSON.stringify({ groups: [{ targetGroupId: 20, title: 'Renamed by model', tabIds: [1] }] }),
        tabs,
        [existing],
      ),
    ).toEqual([{ targetGroupId: 20, title: existing.title, color: existing.color, tabIds: [1] }]);
  });

  it('leaves tabs already in the target group untouched', () => {
    expect(
      parseGroups(JSON.stringify({ groups: [{ targetGroupId: 20, tabIds: [2] }] }), tabs, [
        existing,
      ]),
    ).toEqual([]);
  });

  it.each([99, -1, '20'])('rejects an unknown target group %s', (targetGroupId) => {
    expect(() =>
      parseGroups(JSON.stringify({ groups: [{ targetGroupId, tabIds: [1] }] }), tabs, [existing]),
    ).toThrow('errorGroupTarget');
  });

  it('rejects targets in another window and unselected tabs', () => {
    expect(() =>
      parseGroups(JSON.stringify({ groups: [{ targetGroupId: 20, tabIds: [1] }] }), tabs, [
        { ...existing, windowId: 2 },
      ]),
    ).toThrow('errorGroupTarget');
    expect(() =>
      parseGroups(JSON.stringify({ groups: [{ targetGroupId: 20, tabIds: [2, 99] }] }), tabs, [
        existing,
      ]),
    ).toThrow('errorGroupIds');
  });

  it('combines separate suggestions for the same target while omitting tabs already there', () => {
    expect(
      parseGroups(
        JSON.stringify({
          groups: [
            { targetGroupId: 20, tabIds: [1, 2] },
            { targetGroupId: 20, tabIds: [3] },
          ],
        }),
        tabs,
        [existing],
      ),
    ).toEqual([
      { targetGroupId: 20, title: existing.title, color: existing.color, tabIds: [1, 3] },
    ]);
  });

  it('accepts a valid plan while leaving unrelated tabs ungrouped', () => {
    expect(parseGroups(JSON.stringify({ groups: [group] }), tabs, [])).toMatchObject([group]);
    expect(
      parseGroups('```json\n' + JSON.stringify({ groups: [group] }) + '\n```', tabs, []),
    ).toMatchObject([group]);
  });

  it.each([
    [{ groups: [{ ...group, tabIds: [1, 9] }] }, 'errorGroupIds'],
    [{ groups: [{ ...group, tabIds: [1, 1] }] }, 'errorGroupIds'],
    [{ groups: [group, { ...group, tabIds: [2, 3] }] }, 'errorGroupIds'],
    [{ groups: [{ ...group, tabIds: ['1', 2] }] }, 'errorGroupIds'],
    [{ groups: [{ ...group, tabIds: [1] }] }, 'errorGroupSize'],
    [{ groups: [{ ...group, title: ' ' }] }, 'errorGroupSize'],
    [{ groups: [{ ...group, title: '过长的组名'.repeat(20) }] }, 'errorGroupSize'],
    [{ groups: [null] }, 'errorGroupSize'],
    [{ groups: 'wrong' }, 'errorGroupStructure'],
  ])('rejects malformed or unauthorized grouping plans: %j', (result, message) => {
    expect(() => parseGroups(JSON.stringify(result), tabs, [])).toThrow(message);
  });

  it('supports no suitable groups without inventing a catch-all group', () => {
    expect(parseGroups('{"groups":[]}', tabs, [])).toEqual([]);
  });
});

describe('AI requests', () => {
  it('requests a single-tab merge only when an existing target is available', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ groups: [{ targetGroupId: 20, tabIds: [1] }] }),
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(suggestGroups(settings, tabs.slice(0, 1), [], 'en')).rejects.toThrow(
      'errorSelectTabs',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(suggestGroups(settings, tabs.slice(0, 1), [existing], 'en')).resolves.toEqual([
      { targetGroupId: 20, title: existing.title, color: existing.color, tabIds: [1] },
    ]);
  });
  it.each([
    ['en', 'English'],
    ['zh-CN', 'Simplified Chinese'],
  ] as const)('requests %s group names without private URLs', async (locale, language) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ groups: [group] }) } }],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await suggestGroups(settings, tabs.slice(0, 2), [existing], locale)).toMatchObject([
      group,
    ]);
    const [endpoint, request] = fetchMock.mock.calls[0]!;
    expect(endpoint).toBe('https://ai.example/v1/chat/completions');
    const payload = JSON.parse(request!.body as string);
    expect(payload.messages[0].content).toContain(`Use concise ${language} names`);
    expect(JSON.parse(payload.messages[1].content)).toEqual({
      tabs: [
        { id: 1, title: 'Docs', hostname: 'docs.example', groupId: -1 },
        { id: 2, title: 'Repo', hostname: 'code.example', groupId: 20 },
      ],
      existingGroups: [{ id: existing.id, title: existing.title }],
    });
    expect(request!.body).not.toContain('secret');
    expect(request!.body).not.toContain('Private project');
    expect(request!.redirect).toBe('error');
    expect(request!.credentials).toBe('omit');
  });

  it('does not send an Authorization header for keyless local models', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"choices":[{"message":{"content":"OK"}}]}'));
    vi.stubGlobal('fetch', fetchMock);
    await testConnection({ ...settings, baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' });
    expect(fetchMock.mock.calls[0]![1]!.headers).not.toHaveProperty('Authorization');
  });

  it('does not display provider error bodies that might echo the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('private-key', { status: 401 })),
    );
    await expect(testConnection(settings)).rejects.toMatchObject({
      code: 'errorHttpAuth',
      values: { status: 401 },
    });
    await expect(testConnection(settings)).rejects.not.toThrow('private-key');
  });

  it('rejects truncated model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('{"choices":[{"finish_reason":"length","message":{"content":"partial"}}]}'),
        ),
    );
    await expect(suggestGroups(settings, tabs, [], 'en')).rejects.toThrow('errorTruncated');
  });

  it('passes cancellation to fetch and reports it without provider details', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async (_url, request) => {
      controller.abort();
      request?.signal?.throwIfAborted();
      return new Response();
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(suggestGroups(settings, tabs, [], 'en', controller.signal)).rejects.toThrow(
      'errorCancelled',
    );
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it('can cancel while the provider is still sending the response body', async () => {
    const controller = new AbortController();
    const response = new Response();
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort();
      throw new Error('Body aborted');
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response));
    await expect(suggestGroups(settings, tabs, [], 'en', controller.signal)).rejects.toThrow(
      'errorCancelled',
    );
  });
});

describe('AI bookmark classification', () => {
  const bookmarks = [
    {
      id: 'a',
      parentId: '1',
      index: 0,
      title: 'Docs',
      hostname: 'docs.example',
      url: 'https://docs.example/private?token=secret',
    },
    {
      id: 'b',
      parentId: '1',
      index: 1,
      title: 'Repo',
      hostname: 'code.example',
      url: 'https://code.example/private',
    },
  ];
  const folders = [{ id: '20', parentId: '1', title: 'Development', path: 'Other / Development' }];

  it('accepts native string IDs and preserves existing folder names', () => {
    expect(
      parseBookmarkGroups(
        JSON.stringify({
          groups: [{ targetFolderId: '20', title: 'Changed', bookmarkIds: ['a'] }],
        }),
        bookmarks,
        folders,
      ),
    ).toEqual([{ targetFolderId: '20', title: 'Development', bookmarkIds: ['a'] }]);
  });

  it.each([
    { groups: [{ title: 'New', bookmarkIds: ['a', 'unknown'] }] },
    { groups: [{ title: 'New', bookmarkIds: ['a', 'a'] }] },
    { groups: [{ title: 'New', bookmarkIds: [1, 2] }] },
    { groups: [{ title: 'New', bookmarkIds: ['a'] }] },
    { groups: [{ targetFolderId: 'outside', bookmarkIds: ['a'] }] },
    { groups: [{ title: 'development', bookmarkIds: ['a', 'b'] }] },
    {
      groups: [
        { targetFolderId: '20', bookmarkIds: ['a'] },
        { targetFolderId: '20', bookmarkIds: ['b'] },
      ],
    },
    { groups: [null] },
    { groups: 'invalid' },
  ])('rejects unsafe bookmark plans: %j', (response) => {
    expect(() => parseBookmarkGroups(JSON.stringify(response), bookmarks, folders)).toThrow(
      'errorBookmarkPlan',
    );
  });

  it('sends only selected metadata and uses shared preferences, locale and transport', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [{ targetFolderId: '20', bookmarkIds: ['a'] }],
                }),
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await suggestBookmarkGroups(
      { ...settings, instructions: 'Keep docs together' },
      bookmarks.slice(0, 1),
      folders,
      'zh-CN',
    );
    const request = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(String(request.body));
    const data = JSON.parse(body.messages[1].content);
    expect(data).toEqual({
      bookmarks: [{ id: 'a', title: 'Docs', hostname: 'docs.example' }],
      folders: [{ id: '20', title: 'Development' }],
    });
    expect(body.messages[0].content).toContain('Simplified Chinese');
    expect(body.messages[0].content).toContain('Keep docs together');
    expect(String(request.body)).not.toContain('private');
    expect(request.credentials).toBe('omit');
    expect(request.redirect).toBe('error');
  });

  it('rejects oversized requests before contacting the service', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      suggestBookmarkGroups(
        settings,
        Array.from({ length: 201 }, (_, index) => ({ ...bookmarks[0]!, id: String(index) })),
        folders,
        'en',
      ),
    ).rejects.toThrow('errorBookmarkSelection');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
