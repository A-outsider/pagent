import { tool } from 'langchain';
import { z } from 'zod';
import { assertNavigableUrl } from '@/shared/contracts/policy';
import { isolateUntrustedPage } from '@/features/agent/runtime/middleware';
import { safeJson } from '@/shared/utils/utils';
import type { ToolBridge, TrackActionFn } from './types';

export function createNavigationTools(bridge: ToolBridge, trackAction: TrackActionFn) {
  const navigate = tool(
    async ({ url }) => {
      assertNavigableUrl(url, bridge.settings);
      return safeJson(await trackAction(() => bridge.navigate(url)));
    },
    {
      name: 'navigate',
      description: '导航当前标签页到指定 http/https URL。',
      schema: z.object({ url: z.string() }),
    },
  );

  const back = tool(async () => safeJson(await trackAction(() => bridge.back())), {
    name: 'go_back',
    description: '浏览器后退。',
    schema: z.object({}),
  });

  const forward = tool(async () => safeJson(await trackAction(() => bridge.forward())), {
    name: 'go_forward',
    description: '浏览器前进。',
    schema: z.object({}),
  });

  const reload = tool(async () => safeJson(await trackAction(() => bridge.reload())), {
    name: 'reload_page',
    description: '刷新当前页面。',
    schema: z.object({}),
  });

  const pageInfo = tool(async () => safeJson(await bridge.content('page.info')), {
    name: 'page_info',
    description: '读取当前标签页 URL、标题和选区。',
    schema: z.object({}),
  });

  const getSource = tool(
    async (payload) =>
      isolateUntrustedPage(safeJson(await bridge.content('page.source', payload), 12_000)),
    {
      name: 'get_source',
      description:
        '读取当前网站源码或结构化资源。type=dom 为实时 HTML，page 为原始 HTML，url/title/text 为地址标题和可见正文，links/scripts/stylesheets 为资源列表。可用 grep 过滤（regex 视为正则）。结果默认分页，过大时用 offset 继续取下一页。',
      schema: z.object({
        type: z
          .enum(['dom', 'page', 'url', 'title', 'text', 'links', 'scripts', 'stylesheets'])
          .optional()
          .describe('默认 dom'),
        grep: z.string().min(1).max(300).optional().describe('子串或正则，用于过滤源码/资源'),
        regex: z.boolean().optional().describe('把 grep 当作正则'),
        caseSensitive: z.boolean().optional(),
        limit: z.number().int().min(1).max(400).optional().describe('本页条数或字符数'),
        offset: z.number().int().min(0).optional().describe('从 0 开始的偏移，配合 hasMore/nextOffset 翻页'),
      }),
    },
  );

  const listTabs = tool(async () => safeJson(await bridge.tabs.query()), {
    name: 'list_tabs',
    description: '列出当前窗口标签页。需要 tabs 权限才能看到完整 URL。',
    schema: z.object({}),
  });

  const openTab = tool(
    async ({ url }) => {
      if (url) assertNavigableUrl(url, bridge.settings);
      return safeJson(await bridge.tabs.create(url));
    },
    {
      name: 'open_tab',
      description: '打开新标签页。',
      schema: z.object({ url: z.string().optional() }),
    },
  );

  const switchTab = tool(
    async ({ tabId }) => safeJson(await bridge.tabs.switch(tabId)),
    {
      name: 'switch_tab',
      description: '切换到指定标签页。',
      schema: z.object({ tabId: z.number() }),
    },
  );

  const closeTab = tool(
    async ({ tabId }) => safeJson(await bridge.tabs.close(tabId)),
    {
      name: 'close_tab',
      description: '关闭指定标签页。',
      schema: z.object({ tabId: z.number() }),
    },
  );

  const namedScript = tool(
    async ({ name }) => safeJson(await bridge.content('dom.script', { name })),
    {
      name: 'execute_named_script',
      description:
        '执行扩展内置只读脚本：extract_links、extract_headings、extract_forms、extract_meta、page_stats、get_selection。交互目标请直接调用 extract_interactions，不要从这里重复提取。',
      schema: z.object({
        name: z.enum([
          'extract_links',
          'extract_headings',
          'extract_forms',
          'extract_meta',
          'page_stats',
          'get_selection',
        ]),
      }),
    },
  );

  return [
    navigate,
    back,
    forward,
    reload,
    pageInfo,
    getSource,
    listTabs,
    openTab,
    switchTab,
    closeTab,
    namedScript,
  ];
}
