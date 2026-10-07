import { tool } from 'langchain';
import { z } from 'zod';
import { isolateUntrustedPage } from '@/features/agent/runtime/middleware';
import { safeJson } from '@/shared/utils/utils';
import type { ToolBridge } from './types';
import type { PageChangeSnapshot } from '@/features/page/change-tracker';

/** Bound output at element boundaries, keeping JSON and whole form-module inventory intact. */
export function observationPage<T extends { elements: unknown[]; offset?: number; nextOffset?: number | null; truncated?: boolean }>(value: T, budget = 24_000): string {
  const page = { ...value, elements: [...value.elements] };
  while (page.elements.length > 1 && JSON.stringify(page).length > budget) {
    page.elements.pop();
    page.nextOffset = (page.offset ?? 0) + page.elements.length;
    page.truncated = true;
  }
  return JSON.stringify(page);
}

export function createObservationTools(
  bridge: ToolBridge,
  changeWatches: Map<string, PageChangeSnapshot>,
  getLastWatchId: () => string | undefined,
  setLastWatchId: (id: string | undefined) => void,
  startChangeWatch: () => Promise<PageChangeSnapshot>,
) {
  const observe = tool(
    async ({ reason, maxElements, scope, offset }) => {
      const observation = await bridge.content<Parameters<typeof observationPage>[0]>('dom.observe', { reason, maxElements, scope, offset });
      return isolateUntrustedPage(observationPage(observation));
    },
    {
      name: 'observe_page',
      description:
        '建立当前页面的语义快照，包含字段标签、模块/记录上下文和完整 formSections 清单。nextOffset 非空表示字段未读完，保持 scope 用 offset 继续；页面结构变化后从 offset=0 重读。普通操作后优先后置条件或 observe_page_changes，避免反复整页观测。scope=page 强制整页扫描。',
      schema: z.object({
        reason: z.string().optional().describe('为什么需要重新观测'),
        maxElements: z.number().int().min(10).max(300).optional(),
        offset: z.number().int().nonnegative().optional(),
        scope: z.enum(['auto', 'page', 'interaction']).optional().describe('默认 auto'),
      }),
    },
  );

  const observeChanges = tool(
    async ({ action, watchId, timeoutMs, quietMs, maxChanges }) => {
      if (action === 'start') {
        const baseline = await startChangeWatch();
        return safeJson({
          watchId: baseline.watchId,
          cursor: baseline.cursor,
          message: '已开始观测；执行操作后用同一工具读取变化。',
        });
      }
      const targetId = watchId ?? getLastWatchId();
      if (!targetId) {
        return '尚无变化观测基线。请先以 action=start 调用本工具，或先执行一个页面操作。';
      }
      const baseline = changeWatches.get(targetId);
      if (!baseline) return `变化观测 ${targetId} 已过期，请重新开始观测。`;
      const result = await bridge.content('dom.changes.read', {
        baseline,
        timeoutMs,
        quietMs,
        maxChanges,
      });
      changeWatches.delete(targetId);
      if (getLastWatchId() === targetId) setLastWatchId(undefined);
      return isolateUntrustedPage(safeJson(result));
    },
    {
      name: 'observe_page_changes',
      description:
        '读取最近一次页面操作造成的语义变化，包括新增/移除元素、文本、表单状态、可见性、滚动和导航。默认读取最近操作的变化；观测外部异步变化时先用 action=start 留下基线，之后用 action=read。',
      schema: z.object({
        action: z.enum(['start', 'read']).optional().describe('默认 read'),
        watchId: z.string().optional().describe('action=start 返回的观测 ID'),
        timeoutMs: z.number().int().min(0).max(10_000).optional(),
        quietMs: z.number().int().min(50).max(2_000).optional(),
        maxChanges: z.number().int().min(1).max(100).optional(),
      }),
    },
  );

  const search = tool(
    async ({ query, caseSensitive, maxResults, scope }) =>
      isolateUntrustedPage(
        safeJson(await bridge.content('dom.search', {
          query,
          caseSensitive,
          maxResults,
          scope,
        })),
      ),
    {
      name: 'search_page_text',
      description:
        '在当前页面全文搜索文本（类似查找）。返回 snippet、elementId、可见性和坐标。适合 locate observe_page 没列全的正文、按钮或输入值。找到后可用 click_element / scroll_page。',
      schema: z.object({
        query: z.string().min(1).max(200),
        caseSensitive: z.boolean().optional(),
        maxResults: z.number().int().min(1).max(80).optional(),
        scope: z.enum(['auto', 'page', 'interaction']).optional().describe('默认 auto'),
      }),
    },
  );

  const screenshot = tool(
    async ({ fullPage }) => {
      if (!bridge.settings.captureScreenshots) return '用户已关闭截图。';
      const raw = bridge.settings.screenshotAsImage;
      const dataUrl = await bridge.screenshot(fullPage, raw);
      if (!bridge.settings.screenshotAsImage) return dataUrl;
      return [
        { type: 'text', text: '截图完成（图片已随本结果提供，可直接查看）。' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ];
    },
    {
      name: 'capture_screenshot',
      description: '截取当前标签页可见区域或整页截图，以图片形式返回（模型可直接查看截图内容）。',
      schema: z.object({ fullPage: z.boolean().optional() }),
    },
  );

  const extractInteractions = tool(
    async ({ scope, offset, maxElements }) => isolateUntrustedPage(
      observationPage(await bridge.content<Parameters<typeof observationPage>[0]>('dom.script', {
        name: 'extract_interactions',
        scope,
        offset,
        maxElements,
      })),
    ),
    {
      name: 'extract_interactions',
      description:
        '提取当前页面的字段、状态、可用动作、模块和记录上下文。nextOffset 非空时用 offset 继续直到读完，页面结构变化后重新开始。临时层被误判时用 scope=page。',
      schema: z.object({
        scope: z.enum(['auto', 'page', 'interaction']).optional().describe('默认 auto'),
        offset: z.number().int().nonnegative().optional(),
        maxElements: z.number().int().min(10).max(300).optional(),
      }),
    },
  );

  const inspectElementTree = tool(
    async (payload) => isolateUntrustedPage(
      safeJson(await bridge.content('dom.elementTree', payload), 48_000),
    ),
    {
      name: 'inspect_element_tree',
      description:
        '把 observe_page 返回的根 elementId 转成轻量缩进文本树。每行只标注标签和语义角色；fields 可选择附带直接文本、视口坐标或指定 DOM 属性。maxDepth 超出的子树以 more-level 标注剩余层数，maxLength 超出的标签以 more-label 标注剩余标签数。',
      schema: z.object({
        elementId: z.string().describe('observe_page 或 search_page_text 返回的元素 ID'),
        revision: z.number().int().nonnegative().optional(),
        fields: z.object({
          text: z.boolean().optional().describe('附带元素的直接文本，叶子元素附带完整文本'),
          coordinates: z.boolean().optional().describe('附带 x,y,width,height 视口坐标'),
          attributes: z.array(
            z.string().regex(/^[A-Za-z_:][A-Za-z0-9:._-]*$/),
          ).max(20).optional().describe('要附带的 DOM 属性名，如 aria-label、data-testid'),
        }).optional(),
        maxDepth: z.number().int().min(0).max(20).optional().describe('最大深度，根元素为第 0 层，默认 4'),
        maxLength: z.number().int().min(2).max(2_000).optional().describe('最大输出标签数，默认 120'),
      }),
    },
  );

  const commonAncestor = tool(
    async ({ elementIds, revision }) =>
      safeJson(await bridge.content('dom.commonAncestor', { elementIds, revision })),
    {
      name: 'find_common_ancestor',
      description:
        '传入多个 elementId，快速返回它们在 DOM 树（含 Shadow DOM）中的最近共同祖先元素。返回的 elementId 已注册，可直接配合 inspect_element_tree 查看该共同容器的局部结构，适合定位多个控件共同的表单、卡片或弹窗容器。',
      schema: z.object({
        elementIds: z.array(z.string()).min(2).max(20).describe('两个或更多元素 ID'),
        revision: z.number().int().nonnegative().optional(),
      }),
    },
  );

  return [
    observe,
    observeChanges,
    search,
    screenshot,
    extractInteractions,
    inspectElementTree,
    commonAncestor,
  ];
}
