import type { BrowserContext, Page } from '@playwright/test';
import type { Server } from 'node:http';

import { chromium, expect, test } from '@playwright/test';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let context: BrowserContext;
let panel: Page;
let server: Server;
let origin: string;
let failure = false;
let groupingResponse: { groups: Record<string, unknown>[] } | undefined;
let requests: Record<string, unknown>[];
let pageErrors: string[];
let extensionPath: string;

test.use({ locale: 'zh-CN' });

test.beforeEach(async ({ locale }) => {
  requests = [];
  pageErrors = [];
  failure = false;
  groupingResponse = undefined;
  server = createServer((request, response) => {
    if (request.method === 'POST') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString());
        requests.push(payload);
        if (failure) {
          response.writeHead(401).end('Private provider error');
          return;
        }
        const tabs =
          payload.messages.length > 1 ? JSON.parse(payload.messages[1].content).tabs : [];
        const content = tabs.length
          ? JSON.stringify(
              groupingResponse ?? {
                groups: [
                  {
                    title: payload.messages[0].content.includes('Use concise English names')
                      ? 'Development'
                      : '开发资料',
                    tabIds: tabs.slice(0, 2).map((tab: { id: number }) => tab.id),
                  },
                  ...(tabs.length >= 4
                    ? [
                        {
                          title: payload.messages[0].content.includes('Use concise English names')
                            ? 'Reading'
                            : '阅读清单',
                          tabIds: tabs.slice(2, 4).map((tab: { id: number }) => tab.id),
                        },
                      ]
                    : []),
                ],
              },
            )
          : 'OK';
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
      });
      return;
    }
    const titles: Record<string, string> = {
      '/vite': 'Vite 文档',
      '/tailwind': 'Tailwind CSS 文档',
      '/design': '设计系统规范',
      '/reading': '阅读清单',
      '/pinned': '工作邮箱',
      '/existing': '保留的项目',
      '/changed': '已经跳转的页面',
    };
    const title = titles[new URL(request.url ?? '/', 'http://localhost').pathname] ?? 'Test page';
    response
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(`<title>${title}</title><h1>${title}</h1>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  origin = `http://127.0.0.1:${address.port}`;
  extensionPath = await mkdtemp(join(tmpdir(), 'ai-tab-test-'));
  await cp(resolve('dist'), extensionPath, { recursive: true });
  const manifestPath = join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Native permission dialogs are not available to headless Playwright.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    locale,
    reducedMotion: 'reduce',
    viewport: { width: 400, height: 860 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  panel = await context.newPage();
  panel.on('pageerror', (error) => pageErrors.push(error.message));
  await panel.goto(`chrome-extension://${extensionId}/index.html`);
  const paths = ['/vite?token=secret', '/tailwind', '/design', '/reading', '/pinned', '/existing'];
  // Preserve tab order so the fixture and screenshots are deterministic.
  await paths.reduce(async (pending, path) => {
    await pending;
    const page = await context.newPage();
    await page.goto(`${origin}${path}`);
  }, Promise.resolve());
  await panel.evaluate(async () => {
    const all = await chrome.tabs.query({ currentWindow: true });
    const pinned = all.find((tab) => tab.url?.endsWith('/pinned'))!;
    const existing = all.find((tab) => tab.url?.endsWith('/existing'))!;
    await chrome.tabs.update(pinned.id!, { pinned: true });
    const group = await chrome.tabs.group({ tabIds: existing.id! });
    await chrome.tabGroups.update(group, { title: '已有项目', color: 'purple' });
  });
  await panel.bringToFront();
  await panel.locator('#refresh').click();
  await expect(panel.locator('#selection-count')).toHaveText(
    locale?.startsWith('zh') ? '已选择 4 个标签' : '4 tabs selected',
  );
});

test.afterEach(async () => {
  try {
    expect(pageErrors).toEqual([]);
  } finally {
    await context?.close();
    await new Promise<void>((done, reject) =>
      server?.close((error) => (error ? reject(error) : done())),
    );
    await rm(extensionPath, { recursive: true, force: true });
  }
});

async function configure(): Promise<void> {
  await panel.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  await panel.getByLabel('API 地址', { exact: true }).fill(`${origin}/v1`);
  await panel.getByLabel('模型名称', { exact: true }).fill('local-test-model');
  await panel.getByRole('button', { name: '保存并测试' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '连接成功' })).toBeVisible();
  await panel.getByRole('button', { name: '返回标签', exact: true }).last().click();
}

test('configure, preview, edit, apply and undo real Chrome groups after reopening the panel', async () => {
  await configure();
  await panel.screenshot({ path: test.info().outputPath('tabs.png'), fullPage: true });
  await panel.getByRole('button', { name: '生成分组建议' }).click();
  await expect(panel.getByLabel('分组 1 名称')).toHaveValue('开发资料');
  expect(await panel.evaluate(() => chrome.tabGroups.query({}))).toHaveLength(1);
  await panel.getByLabel('分组 1 名称').fill('前端开发');
  await expect(
    panel.getByRole('checkbox', { name: '应用分组 前端开发', exact: true }),
  ).toBeChecked();
  await panel.screenshot({ path: test.info().outputPath('preview.png'), fullPage: true });
  const payload = JSON.stringify(requests.at(-1));
  expect(payload).not.toContain('token=secret');
  expect(payload).not.toContain('工作邮箱');
  expect(payload).not.toContain('保留的项目');
  await panel.getByRole('button', { name: '应用选中分组' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '整理好了' })).toBeVisible();
  expect(
    (await panel.evaluate(() => chrome.tabGroups.query({}))).map((group) => group.title).toSorted(),
  ).toEqual(['前端开发', '已有项目', '阅读清单'].toSorted());
  await panel.reload();
  await panel.getByRole('button', { name: '撤销上次分组' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '已恢复 4 个标签' })).toBeVisible();
  expect(
    (await panel.evaluate(() => chrome.tabGroups.query({}))).map((group) => group.title),
  ).toEqual(['已有项目']);
  expect(
    await panel.evaluate(async () => (await chrome.tabs.query({ pinned: true }))[0]?.title),
  ).toBe('工作邮箱');
});

test('selects grouped tabs by group name and restores the original Chrome group after regrouping', async () => {
  await configure();
  const original = await panel.evaluate(async () => {
    const group = (await chrome.tabGroups.query({}))[0]!;
    await chrome.tabGroups.update(group.id, { collapsed: true });
    return { ...group, collapsed: true };
  });
  await expect(panel.getByRole('region', { name: original.title, exact: true })).toHaveAttribute(
    'data-color',
    original.color,
  );
  const existing = panel.getByRole('checkbox', { name: '选择 保留的项目', exact: true });
  await expect(existing).not.toBeChecked();
  await panel.getByRole('button', { name: '全选', exact: true }).click();
  await expect(existing).toBeChecked();
  await panel.getByRole('button', { name: '取消全选', exact: true }).click();
  await panel.getByLabel('搜索标签').fill('已有项目');
  await expect(panel.locator('#tab-list input')).toHaveCount(1);
  await existing.check();
  await panel.getByLabel('搜索标签').fill('');
  await panel.getByRole('checkbox', { name: '选择 Vite 文档', exact: true }).check();
  await expect(panel.getByText('已选择 2 个标签')).toBeVisible();
  await panel.screenshot({ path: test.info().outputPath('regroup-selection.png'), fullPage: true });
  await panel.getByRole('button', { name: '生成分组建议' }).click();
  await expect(panel.getByLabel('分组 1 名称')).toBeVisible();
  expect(JSON.stringify(requests.at(-1))).toContain('保留的项目');
  expect(JSON.stringify(requests.at(-1))).toContain('已有项目');
  await panel.getByRole('button', { name: '应用选中分组' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '整理好了：2 个标签' })).toBeVisible();
  expect(
    (await panel.evaluate(() => chrome.tabGroups.query({}))).map((group) => group.title),
  ).toEqual(['开发资料']);
  await panel.reload();
  await panel.getByRole('button', { name: '撤销上次分组' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '已恢复 2 个标签' })).toBeVisible();
  const restored = await panel.evaluate(async () => ({
    groups: await chrome.tabGroups.query({}),
    tabs: await chrome.tabs.query({ currentWindow: true }),
  }));
  expect(restored.groups).toHaveLength(1);
  expect(restored.groups[0]).toMatchObject({
    title: original.title,
    color: original.color,
    collapsed: original.collapsed,
  });
  expect(restored.tabs.find((tab) => tab.url?.endsWith('/existing'))?.groupId).toBe(
    restored.groups[0]!.id,
  );
  expect(restored.tabs.find((tab) => tab.url?.includes('/vite?'))?.groupId).toBe(-1);
});

test('keeps preview colors when only some suggested groups are applied', async () => {
  await configure();
  await panel.getByRole('button', { name: '生成分组建议' }).click();
  await expect(panel.getByLabel('分组 2 名称')).toBeVisible();
  const colors = await panel
    .locator('#group-list ai-tab-group')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-color')));
  expect(new Set(colors).size).toBe(2);
  expect(colors).not.toContain(null);
  await panel.screenshot({ path: test.info().outputPath('colors-preview.png'), fullPage: true });
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.screenshot({
    path: test.info().outputPath('colors-preview-dark.png'),
    fullPage: true,
  });
  await panel.getByRole('checkbox', { name: '应用分组 开发资料', exact: true }).uncheck();
  await panel.getByRole('button', { name: '应用选中分组' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '整理好了：2 个标签' })).toBeVisible();
  const groups = await panel.evaluate(() => chrome.tabGroups.query({}));
  expect(groups.map((group) => ({ title: group.title, color: group.color }))).toEqual(
    expect.arrayContaining([
      { title: '已有项目', color: 'purple' },
      { title: '阅读清单', color: colors[1] },
    ]),
  );
  expect(groups).toHaveLength(2);
  await expect(panel.getByRole('region', { name: '阅读清单', exact: true })).toHaveAttribute(
    'data-color',
    colors[1]!,
  );
  await panel.getByRole('button', { name: '撤销上次分组' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '已恢复 2 个标签' })).toBeVisible();
  expect(
    (await panel.evaluate(() => chrome.tabGroups.query({}))).map((group) => group.title),
  ).toEqual(['已有项目']);
});

test('shows original groups separately and preserves selection when filtering their tabs', async () => {
  await configure();
  await panel.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const existing = tabs.find((tab) => tab.url?.endsWith('/existing'))!;
    const design = tabs.find((tab) => tab.url?.endsWith('/design'))!;
    const reading = tabs.find((tab) => tab.url?.endsWith('/reading'))!;
    const tailwind = tabs.find((tab) => tab.url?.endsWith('/tailwind'))!;
    await chrome.tabs.group({ groupId: existing.groupId, tabIds: design.id! });
    const sameName = await chrome.tabs.group({ tabIds: reading.id! });
    await chrome.tabGroups.update(sameName, { title: '已有项目' });
    await chrome.tabs.group({ tabIds: tailwind.id! });
  });
  await panel.getByRole('button', { name: '刷新标签', exact: true }).click();
  const list = panel.locator('#tab-list');
  const projects = list.getByRole('region', { name: '已有项目', exact: true });
  await expect(projects).toHaveCount(2);
  const project = projects.filter({
    has: panel.getByRole('checkbox', { name: '选择 保留的项目', exact: true }),
  });
  await expect(project.getByRole('checkbox')).toHaveCount(2);
  await expect(
    project.getByRole('checkbox', { name: '选择 设计系统规范', exact: true }),
  ).not.toBeChecked();
  await expect(project.getByLabel('2 个标签')).toBeVisible();
  await expect(
    list
      .getByRole('region', { name: '未命名分组', exact: true })
      .getByRole('checkbox', { name: '选择 Tailwind CSS 文档', exact: true }),
  ).toBeVisible();
  await expect(
    list
      .getByRole('region', { name: '未分组', exact: true })
      .getByRole('checkbox', { name: '选择 Vite 文档', exact: true }),
  ).toBeChecked();
  await panel.screenshot({ path: test.info().outputPath('grouped-tabs.png'), fullPage: true });
  await panel.getByLabel('搜索标签').fill('设计系统');
  await expect(list.getByRole('region')).toHaveCount(1);
  const match = projects.getByRole('checkbox', { name: '选择 设计系统规范', exact: true });
  await match.focus();
  await match.press('Space');
  await panel.getByLabel('搜索标签').fill('');
  await expect(
    project.getByRole('checkbox', { name: '选择 设计系统规范', exact: true }),
  ).toBeChecked();
  await expect(panel.getByText('已选择 2 个标签')).toBeVisible();
  await expect(list.getByRole('region')).toHaveCount(4);
  await panel.getByLabel('搜索标签').fill('没有匹配的页面');
  await expect(
    panel.getByRole('heading', { name: '没有找到匹配的标签', exact: true }),
  ).toBeVisible();
  await expect(list.getByRole('region')).toHaveCount(0);
});

test('refuses a stale preview and shows provider failures without moving tabs', async () => {
  await configure();
  await panel.getByRole('button', { name: '生成分组建议' }).click();
  await expect(panel.getByLabel('分组 1 名称')).toBeVisible();
  const page = context.pages().find((item) => item.url().includes('/vite?'))!;
  await page.goto(`${origin}/changed`);
  await panel.getByRole('button', { name: '应用选中分组' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '部分标签已关闭' })).toBeVisible();
  expect(await panel.evaluate(() => chrome.tabGroups.query({}))).toHaveLength(1);
  await panel.getByRole('button', { name: '刷新标签', exact: true }).click();
  failure = true;
  await panel.getByRole('button', { name: '生成分组建议' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'HTTP 401' })).toBeVisible();
  expect(await panel.evaluate(() => chrome.tabGroups.query({}))).toHaveLength(1);
});

test('keeps settings and tab selection usable at narrow widths and in dark mode', async () => {
  await panel.setViewportSize({ width: 320, height: 740 });
  await configure();
  await panel.getByLabel('搜索标签').fill('Vite');
  await expect(panel.locator('#tab-list input')).toHaveCount(1);
  await panel.getByRole('button', { name: '取消全选', exact: true }).click();
  await expect(panel.getByText('已选择 3 个标签')).toBeVisible();
  expect(
    await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.getByLabel('搜索标签').fill('');
  await panel.screenshot({ path: test.info().outputPath('narrow-dark.png'), fullPage: true });
  await panel.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  expect(
    await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await panel.screenshot({ path: test.info().outputPath('settings-dark.png'), fullPage: true });
});

test('preserves preview and form behavior when the panel component reconnects', async () => {
  await configure();
  await panel.getByRole('button', { name: '生成分组建议' }).click();
  await panel.getByLabel('分组 1 名称').fill('保留编辑');
  await panel.getByRole('checkbox', { name: '应用分组 阅读清单', exact: true }).uncheck();
  await panel.evaluate(() => {
    const app = document.querySelector('ai-tab-app')!;
    app.remove();
    document.body.append(app);
  });
  await expect(panel.getByLabel('分组 1 名称')).toHaveValue('保留编辑');
  await expect(
    panel.getByRole('checkbox', { name: '应用分组 阅读清单', exact: true }),
  ).not.toBeChecked();
  await expect(panel.getByRole('button', { name: '应用选中分组' })).toBeEnabled();
  await panel.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  await expect(panel.getByLabel('模型名称', { exact: true })).toHaveValue('local-test-model');
  await panel.getByLabel('模型名称', { exact: true }).fill('reconnected-model');
  const previousRequests = requests.length;
  await panel.getByRole('button', { name: '保存并测试' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '连接成功' })).toBeVisible();
  expect(requests).toHaveLength(previousRequests + 1);
  expect(requests.at(-1)?.model).toBe('reconnected-model');
});

test('renders tab and group titles as text inside the components', async () => {
  const title = '<img src=x onerror="alert(1)">';
  const groupTitle = '<script>alert(1)</script>';
  const page = context.pages().find((item) => item.url().includes('/vite?'))!;
  await page.evaluate((value) => {
    document.title = value;
  }, title);
  await panel.evaluate(async (value) => {
    const [group] = await chrome.tabGroups.query({});
    await chrome.tabGroups.update(group!.id, { title: value });
  }, groupTitle);
  await panel.getByRole('button', { name: '刷新标签', exact: true }).click();
  await expect(panel.getByRole('checkbox', { name: `选择 ${title}`, exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: groupTitle, exact: true })).toBeVisible();
  await expect(panel.locator('#tab-list img, #tab-list script')).toHaveCount(0);
});

test('switches language without saving service drafts and remembers the preference', async () => {
  await expect(panel.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await panel.getByRole('checkbox', { name: '选择 Vite 文档', exact: true }).uncheck();
  await panel.getByLabel('搜索标签').fill('Tailwind');
  await panel.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  await panel.getByLabel('API 地址', { exact: true }).fill('not-a-url');
  await panel.getByLabel('模型名称', { exact: true }).fill('draft-model');
  await panel.getByLabel('API Key').fill('test-only-key');
  await panel.getByRole('button', { name: '显示', exact: true }).click();
  await panel.getByLabel('界面语言').selectOption('en');
  await expect(panel.locator('html')).toHaveAttribute('lang', 'en');
  await expect(panel.getByLabel('API URL', { exact: true })).toHaveValue('not-a-url');
  await expect(panel.getByLabel('Model name', { exact: true })).toHaveValue('draft-model');
  await expect(panel.getByLabel('API Key')).toHaveValue('test-only-key');
  await expect(panel.getByLabel('API Key')).toHaveAttribute('type', 'text');
  await expect(panel.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
  expect(await panel.evaluate(() => chrome.storage.local.get(null))).toEqual({ language: 'en' });
  expect(requests).toHaveLength(0);
  await panel.getByRole('button', { name: 'Back to tabs', exact: true }).last().click();
  await expect(panel.getByLabel('Search tabs')).toHaveValue('Tailwind');
  await expect(panel.locator('#tab-list input')).toHaveCount(1);
  await expect(panel.getByText('3 tabs selected', { exact: true })).toBeVisible();
  await panel.reload();
  await panel.getByRole('button', { name: 'AI settings', exact: true }).click();
  await expect(panel.getByLabel('Language', { exact: true })).toHaveValue('en');
  await expect(panel.getByLabel('API URL', { exact: true })).toHaveValue('');
  await expect(panel.getByLabel('Model name', { exact: true })).toHaveValue('');
  await panel.getByLabel('Language', { exact: true }).selectOption('auto');
  await expect(panel.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(panel.getByLabel('界面语言')).toHaveValue('auto');
  await panel.getByLabel('界面语言').focus();
  await panel.screenshot({ path: test.info().outputPath('settings.png'), fullPage: true });
  await panel.reload();
  await expect(panel.getByRole('button', { name: 'AI 服务设置', exact: true })).toBeVisible();
});

test('preserves edited suggestions and unchecked tabs when switching languages', async () => {
  await configure();
  await panel.getByRole('button', { name: '生成分组建议' }).click();
  await panel.getByLabel('分组 1 名称').fill('保留 {count}');
  await panel.getByRole('checkbox', { name: '应用分组 阅读清单', exact: true }).uncheck();
  await panel.getByRole('checkbox', { name: '选择 Vite 文档', exact: true }).uncheck();
  await panel.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  const previousRequests = requests.length;
  await panel.getByLabel('界面语言').selectOption('en');
  await panel.getByRole('button', { name: 'Back to tabs', exact: true }).last().click();
  await expect(panel.getByLabel('Group 1 name')).toHaveValue('保留 {count}');
  await expect(
    panel.getByRole('checkbox', { name: 'Apply group 阅读清单', exact: true }),
  ).not.toBeChecked();
  await expect(
    panel.getByRole('checkbox', { name: 'Select Vite 文档', exact: true }),
  ).not.toBeChecked();
  await expect(panel.getByLabel('1 tab', { exact: true })).toBeVisible();
  await expect(panel.getByText('1 group · 1 tab', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Apply selected groups' })).toBeDisabled();
  await panel.getByRole('checkbox', { name: 'Select Vite 文档', exact: true }).check();
  await expect(panel.getByRole('button', { name: 'Apply selected groups' })).toBeEnabled();
  expect(requests).toHaveLength(previousRequests);
});

test.describe('English browser', () => {
  test.use({ locale: 'en-GB' });

  test('localizes configuration, grouping, recovery and errors', async () => {
    await expect(panel.locator('html')).toHaveAttribute('lang', 'en');
    await expect(panel).toHaveTitle('AI Tab · Tab groups');
    await expect(panel.getByRole('region', { name: '已有项目', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'AI settings', exact: true }).click();
    await panel.getByLabel('API URL', { exact: true }).fill('http://remote.example/v1');
    await panel.getByLabel('Model name', { exact: true }).fill('local-test-model');
    await panel.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(
      panel.getByRole('status').filter({ hasText: 'Operation failed: Use HTTPS' }),
    ).toBeVisible();
    await panel.getByLabel('API URL', { exact: true }).fill(`${origin}/v1`);
    await panel.getByRole('button', { name: 'Save and test' }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Connected.' })).toBeVisible();
    await panel.setViewportSize({ width: 320, height: 740 });
    await panel.emulateMedia({ colorScheme: 'dark' });
    expect(
      await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await panel.getByLabel('Grouping preferences').scrollIntoViewIfNeeded();
    await panel.screenshot({
      path: test.info().outputPath('settings-en-dark.png'),
      fullPage: true,
    });
    await panel.getByRole('button', { name: 'Back to tabs', exact: true }).last().click();
    await panel.getByRole('button', { name: 'Suggest groups', exact: true }).click();
    await expect(panel.getByLabel('Group 1 name')).toHaveValue('Development');
    await expect(panel.getByLabel('Group 2 name')).toHaveValue('Reading');
    await expect(panel.getByText('2 groups · 4 tabs', { exact: true })).toBeVisible();
    expect(
      await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await panel.screenshot({
      path: test.info().outputPath('preview-en-narrow.png'),
      fullPage: true,
    });
    await panel.setViewportSize({ width: 400, height: 860 });
    await panel.screenshot({ path: test.info().outputPath('preview-en-dark.png'), fullPage: true });
    await panel.emulateMedia({ colorScheme: 'light' });
    await panel.screenshot({ path: test.info().outputPath('preview-en.png'), fullPage: true });
    await panel.getByLabel('Group 1 name').fill('Frontend');
    await panel.getByRole('button', { name: 'Apply selected groups' }).click();
    await expect(
      panel.getByRole('status').filter({ hasText: 'Grouping complete: 4 tabs, 2 groups.' }),
    ).toBeVisible();
    expect(
      (await panel.evaluate(() => chrome.tabGroups.query({})))
        .map((group) => group.title)
        .toSorted(),
    ).toEqual(['Frontend', 'Reading', '已有项目'].toSorted());
    await panel.reload();
    await panel.getByRole('button', { name: 'Undo last grouping' }).click();
    await expect(
      panel.getByRole('status').filter({ hasText: 'Restored the previous groups for 4 tabs.' }),
    ).toBeVisible();
    failure = true;
    await panel.getByRole('button', { name: 'Suggest groups', exact: true }).click();
    await expect(
      panel
        .getByRole('status')
        .filter({ hasText: 'Operation failed: AI service returned HTTP 401.' }),
    ).toBeVisible();
    await expect(panel.locator('#notice')).not.toContainText('Private provider error');
    expect(
      (await panel.evaluate(() => chrome.tabGroups.query({}))).map((group) => group.title),
    ).toEqual(['已有项目']);
  });
});

test('keeps empty results visible after generating from the bottom of the list', async () => {
  await configure();
  groupingResponse = { groups: [] };
  await panel.setViewportSize({ width: 320, height: 360 });
  await panel.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await panel.getByRole('button', { name: '生成分组建议', exact: true }).click();
  await expect(panel.locator('#notice')).toContainText('没有合适');
  await expect(panel.locator('#notice')).toBeInViewport();
  await expect(panel.getByRole('button', { name: '生成分组建议', exact: true })).toBeEnabled();
  expect(await panel.evaluate(() => chrome.tabGroups.query({}))).toHaveLength(1);
});

test('adds one tab to an existing native group and undoes only that addition after reopening', async () => {
  await configure();
  const target = await panel.evaluate(async () => {
    const [group] = await chrome.tabGroups.query({});
    await chrome.tabGroups.update(group!.id, { collapsed: true });
    return chrome.tabGroups.get(group!.id);
  });
  const tabId = await panel.evaluate(
    async () =>
      (await chrome.tabs.query({ currentWindow: true })).find((tab) => tab.url?.includes('/vite?'))!
        .id!,
  );
  await panel.getByRole('button', { name: '全选', exact: true }).click();
  await panel.getByRole('button', { name: '取消全选', exact: true }).click();
  await panel.getByRole('checkbox', { name: '选择 Vite 文档', exact: true }).check();
  groupingResponse = { groups: [{ targetGroupId: target.id, tabIds: [tabId] }] };
  await panel.getByRole('button', { name: '生成分组建议', exact: true }).click();
  await expect(panel.getByText('加入已有', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('分组 1 名称')).toHaveValue(target.title!);
  await expect(panel.getByLabel('分组 1 名称')).toHaveAttribute('readonly', '');
  await expect(panel.getByRole('button', { name: '应用选中分组' })).toBeEnabled();
  await panel.screenshot({ path: test.info().outputPath('merge-preview.png'), fullPage: true });
  await panel.setViewportSize({ width: 320, height: 740 });
  await panel.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  await panel.getByLabel('界面语言').selectOption('en');
  await panel.getByRole('button', { name: 'Back to tabs', exact: true }).last().click();
  await expect(panel.getByText('Add to existing', { exact: true })).toBeVisible();
  expect(
    await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await panel.screenshot({ path: test.info().outputPath('merge-preview-en.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Apply selected groups' }).click();
  await expect(panel.locator('#notice')).toContainText('Grouping complete: 1 tab, 1 group.');
  expect(await panel.evaluate(() => chrome.tabGroups.query({}))).toEqual([target]);
  expect(await panel.evaluate((id) => chrome.tabs.get(id).then((tab) => tab.groupId), tabId)).toBe(
    target.id,
  );
  await panel.reload();
  await panel.getByRole('button', { name: 'Undo last grouping' }).click();
  await expect(panel.locator('#notice')).toContainText('Restored the previous group for 1 tab.');
  expect(await panel.evaluate(() => chrome.tabGroups.query({}))).toEqual([target]);
  const remaining = await panel.evaluate(
    async (id) => ({
      added: (await chrome.tabs.get(id)).groupId,
      members: (await chrome.tabs.query({ currentWindow: true }))
        .filter((tab) => tab.groupId !== -1)
        .map((tab) => tab.title),
    }),
    tabId,
  );
  expect(remaining).toEqual({ added: -1, members: ['保留的项目'] });
});

test('places two selected tabs into separate existing groups without creating any new group', async () => {
  await configure();
  const { groups, additions } = await panel.evaluate(async () => {
    const all = await chrome.tabs.query({ currentWindow: true });
    const [first] = await chrome.tabGroups.query({});
    const secondId = await chrome.tabs.group({
      tabIds: all.find((tab) => tab.url?.endsWith('/reading'))!.id!,
    });
    await chrome.tabGroups.update(secondId, { title: '设计资料', color: 'green' });
    return {
      groups: [first!, await chrome.tabGroups.get(secondId)],
      additions: [
        all.find((tab) => tab.url?.includes('/vite?'))!.id!,
        all.find((tab) => tab.url?.endsWith('/design'))!.id!,
      ],
    };
  });
  await panel.getByRole('button', { name: '刷新标签', exact: true }).click();
  await panel.getByRole('button', { name: '全选', exact: true }).click();
  await panel.getByRole('button', { name: '取消全选', exact: true }).click();
  await panel.getByRole('checkbox', { name: '选择 Vite 文档', exact: true }).check();
  await panel.getByRole('checkbox', { name: '选择 设计系统规范', exact: true }).check();
  groupingResponse = {
    groups: groups.map((group, index) => ({
      targetGroupId: group.id,
      tabIds: [additions[index]!],
    })),
  };
  await panel.getByRole('button', { name: '生成分组建议', exact: true }).click();
  await expect(panel.getByText('加入已有', { exact: true })).toHaveCount(2);
  await panel.getByRole('button', { name: '应用选中分组' }).click();
  await expect(panel.locator('#notice')).toContainText('整理好了：2 个标签，2 个分组。');
  expect(
    (await panel.evaluate(() => chrome.tabGroups.query({}))).toSorted((a, b) => a.id - b.id),
  ).toEqual(groups.toSorted((a, b) => a.id - b.id));
  expect(
    await panel.evaluate(
      async (ids) => Promise.all(ids.map(async (id) => (await chrome.tabs.get(id)).groupId)),
      additions,
    ),
  ).toEqual(groups.map((group) => group.id));
  await panel.getByRole('button', { name: '撤销上次分组' }).click();
  await expect(panel.locator('#notice')).toContainText('已恢复 2 个标签');
  expect(
    await panel.evaluate(
      async (ids) => Promise.all(ids.map(async (id) => (await chrome.tabs.get(id)).groupId)),
      additions,
    ),
  ).toEqual([-1, -1]);
  expect(
    (await panel.evaluate(() => chrome.tabGroups.query({}))).toSorted((a, b) => a.id - b.id),
  ).toEqual(groups.toSorted((a, b) => a.id - b.id));
});

test('keeps provider errors visible when generation starts at the bottom of the list', async () => {
  await configure();
  failure = true;
  await panel.setViewportSize({ width: 320, height: 360 });
  await panel.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await panel.getByRole('button', { name: '生成分组建议', exact: true }).click();
  await expect(panel.locator('#notice')).toContainText('HTTP 401');
  await expect(panel.locator('#notice')).toBeInViewport();
  await expect(panel.getByRole('button', { name: '生成分组建议', exact: true })).toBeEnabled();
});
