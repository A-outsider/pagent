import { z } from 'zod';
import { isProtectedUrl, toErrorMessage } from '@/shared/contracts/errors';
import { assertNavigableUrl } from '@/shared/contracts/policy';
import { nowId, truncate } from '@/shared/utils/utils';
import { createTab, getActiveTab, navigateTab } from '@/shared/browser/tabs';
import { openTabsBackground } from '@/shared/browser/background-tabs';
import { openTabsBackgroundSchema } from '@/shared/contracts/background-tabs';
import { loadSettings } from '@/shared/storage/storage';
import { listDirectBrowserTools, callDirectBrowserTool, endDirectBrowserTask } from './direct-browser';
import { isDirectBrowserBusy } from '@/shared/extension/direct-browser-lock';
import { findRunningByTab, running, startAgent, type AgentControl } from '@/features/agent/background/agent-controller';
import { bossService, bossTasks, bossFavoritesTasks, isBossTaskRunning, startBossFavoritesTask, ensureContentScript, sendToContent } from '@/features/agent/background/content-bridge';
import { bossStartFavoritesInputSchema, bossListCurrentFavoritesSchema, bossApplyFavoriteJobInputSchema, bossGetFavoritesTaskSchema, bossCancelFavoritesTaskSchema, type BossFavoritesPage } from '@/shared/contracts/boss-favorites';
import { bossGetFavoritesPreferencesSchema, bossSetFavoritesGreetingSchema } from '@/shared/contracts/boss-favorites-preferences';
import { getBossFavoritesPreferences, saveBossFavoritesPreferences } from '@/features/boss/favorites-preferences';
import { bossAuditResumeImagesSchema, bossGetResumeImageScanSchema, bossSendResumeImagesSchema } from '@/shared/contracts/boss';
import { bossCancelTaskSchema, bossGetTaskSchema, bossStartTaskSchema } from '@/shared/contracts/boss-task';
import { tabStores } from '@/features/agent/background/tab-store';
import type { PageConversation, PageConversationStore } from '@/shared/contracts/session';
import type {
  DispatchTaskInput,
  DispatchTaskResult,
  GetSessionInput,
  HostSessionStatus,
  HostTab,
  HostTabAgent,
  McpHostMethod,
} from '@/shared/contracts/mcp-host';

export const dispatchTaskSchema = z.object({
  prompt: z.string().min(1).max(32_000),
  tabId: z.number().int().positive().optional(),
  url: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
});

const bossAuditHostSchema = bossAuditResumeImagesSchema.extend({ tabId: z.number().int().positive() });
const bossSendHostSchema = bossSendResumeImagesSchema.extend({ tabId: z.number().int().positive() });
const bossGetScanHostSchema = bossGetResumeImageScanSchema.extend({ tabId: z.number().int().positive() });
const bossTaskTabSchema = z.object({ tabId: z.number().int().positive() }).passthrough();
const bossGetTaskHostSchema = bossGetTaskSchema.extend({ tabId: z.number().int().positive() });
const bossCancelTaskHostSchema = bossCancelTaskSchema.extend({ tabId: z.number().int().positive() });

async function requireBossTab(tabId: number): Promise<void> {
  if (isDirectBrowserBusy(tabId)) throw new Error('此标签页有直接浏览器操作正在执行，请等它结束');
  const tab = await requireTab(tabId);
  const url = tab.url ? new URL(tab.url) : undefined;
  if (url?.origin !== 'https://www.zhipin.com' || url.pathname !== '/web/geek/chat') {
    throw new Error('BOSS 专项工具需要已打开的求职者聊天标签页');
  }
  if (findRunningByTab(tabId)) throw new Error('此标签页的 Pagent Agent 正在工作，请等它结束后再调用专项工具');
}

export const getSessionSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    tabId: z.number().int().positive().optional(),
    conversationId: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.sessionId || value.conversationId || value.tabId != null), {
    message: '需要提供 sessionId、tabId 或 conversationId',
  });

function agentFromConversation(
  working: boolean,
  sessionId: string | undefined,
  conversation: PageConversation | undefined,
): HostTabAgent {
  return {
    working,
    sessionId,
    conversationId: conversation?.id,
    title: conversation?.title,
    thinking: conversation?.thinking || undefined,
    error: conversation?.error || undefined,
  };
}

function conversationOf(store: PageConversationStore | undefined, conversationId?: string) {
  if (!store) return undefined;
  const id = conversationId ?? store.activeId;
  return store.conversations.find((item) => item.id === id) ?? store.conversations.at(-1);
}

async function requireTab(tabId: number) {
  try {
    return await browser.tabs.get(tabId);
  } catch {
    throw new Error(`找不到标签页 ${tabId}`);
  }
}

export async function listHostTabs(): Promise<{ tabs: HostTab[] }> {
  const tabs = await browser.tabs.query({});
  return {
    tabs: tabs
      .filter((tab): tab is typeof tab & { id: number } => typeof tab.id === 'number')
      .map((tab) => {
        const control = findRunningByTab(tab.id);
        const store = tabStores.get(tab.id);
        const conversation = conversationOf(store ?? control?.store, control?.conversationId);
        const url = tab.url ?? '';
        return {
          tabId: tab.id,
          title: tab.title?.trim() || '无标题',
          url,
          active: Boolean(tab.active),
          windowId: tab.windowId,
          status: tab.status,
          pinned: Boolean(tab.pinned),
          protected: !url || isProtectedUrl(url),
          agent: agentFromConversation(
            Boolean(control),
            control?.sessionId ?? store?.sessionId,
            conversation,
          ),
        };
      }),
  };
}

async function resolveDispatchTab(input: DispatchTaskInput): Promise<number> {
  const settings = await loadSettings();
  if (input.url) assertNavigableUrl(input.url, settings);

  if (input.tabId != null && input.url) {
    await requireTab(input.tabId);
    if (isBossTaskRunning(input.tabId)) throw new Error('此标签页的 BOSS 后台任务正在运行，请先停止任务');
    await navigateTab(input.tabId, input.url);
    return input.tabId;
  }
  if (input.tabId != null) {
    await requireTab(input.tabId);
    return input.tabId;
  }
  if (input.url) {
    const tab = await createTab(input.url);
    if (!tab.id) throw new Error('创建标签页失败');
    return tab.id;
  }
  const active = await getActiveTab();
  if (!active.id) throw new Error('找不到当前标签页');
  return active.id;
}

export async function dispatchHostTask(input: DispatchTaskInput): Promise<DispatchTaskResult> {
  const data = dispatchTaskSchema.parse(input);
  const tabId = await resolveDispatchTab(data);
  const tab = await requireTab(tabId);
  if (!tab.url || isProtectedUrl(tab.url)) {
    throw new Error('当前页面受浏览器保护，无法派发 Agent 任务');
  }
  await ensureContentScript(tabId);
  await sendToContent(tabId, 'ui.open', {}).catch(() => undefined);
  const conversationId = data.conversationId ?? nowId('c');
  const started = await startAgent(tabId, data.prompt, conversationId);
  return {
    ok: true,
    tabId: started.tabId,
    sessionId: started.sessionId,
    conversationId: started.conversationId,
  };
}

function controlMatches(control: AgentControl, query: GetSessionInput): boolean {
  if (query.sessionId && control.sessionId !== query.sessionId) return false;
  if (query.conversationId && control.conversationId !== query.conversationId) return false;
  if (query.tabId != null && control.tabId !== query.tabId) return false;
  return true;
}

function storeMatches(
  tabId: number,
  store: PageConversationStore,
  query: GetSessionInput,
): PageConversation | undefined {
  if (query.sessionId && store.sessionId !== query.sessionId) return undefined;
  if (query.tabId != null && query.tabId !== tabId) return undefined;
  if (query.conversationId) {
    return store.conversations.find((item) => item.id === query.conversationId);
  }
  if (query.sessionId || query.tabId != null) return conversationOf(store);
  return undefined;
}

function toSessionStatus(
  tabId: number,
  store: PageConversationStore,
  conversation: PageConversation,
  runningNow: boolean,
  sessionId: string | undefined,
  tab?: { url?: string; title?: string },
): HostSessionStatus {
  return {
    found: true,
    running: runningNow,
    tabId,
    url: tab?.url,
    title: tab?.title?.trim() || undefined,
    sessionId: sessionId ?? store.sessionId,
    conversationId: conversation.id,
    conversationTitle: conversation.title,
    thinking: conversation.thinking || undefined,
    error: conversation.error || undefined,
    updatedAt: conversation.updatedAt,
    budget: conversation.budget,
    tasks: conversation.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      detail: task.detail,
    })),
    messages: conversation.messages.slice(-8).map((message) => ({
      role: message.role,
      content: truncate(message.content, 500),
    })),
  };
}

export async function getHostSession(input: GetSessionInput): Promise<HostSessionStatus> {
  const query = getSessionSchema.parse(input);

  for (const control of running.values()) {
    if (!controlMatches(control, query)) continue;
    const conversation = conversationOf(control.store, control.conversationId ?? query.conversationId);
    if (!conversation) continue;
    let tab: { url?: string; title?: string } | undefined;
    try {
      tab = await browser.tabs.get(control.tabId);
    } catch {
      tab = undefined;
    }
    return toSessionStatus(control.tabId, control.store, conversation, true, control.sessionId, tab);
  }

  for (const [tabId, store] of tabStores) {
    const conversation = storeMatches(tabId, store, query);
    if (!conversation) continue;
    let tab: { url?: string; title?: string } | undefined;
    try {
      tab = await browser.tabs.get(tabId);
    } catch {
      tab = undefined;
    }
    return toSessionStatus(tabId, store, conversation, Boolean(findRunningByTab(tabId)), store.sessionId, tab);
  }

  return { found: false, running: false };
}

export async function handleHostMethod(method: McpHostMethod, params: unknown): Promise<unknown> {
  switch (method) {
    case 'browser_list_tools': return listDirectBrowserTools(params);
    case 'browser_call_tool': return callDirectBrowserTool(params);
    case 'browser_end_task': return endDirectBrowserTask(params);
    case 'boss_get_favorites_preferences':
      bossGetFavoritesPreferencesSchema.parse(params === undefined ? {} : params);
      return getBossFavoritesPreferences();
    case 'boss_set_favorites_greeting': {
      const { greeting } = bossSetFavoritesGreetingSchema.parse(params);
      const preferences = await getBossFavoritesPreferences();
      return saveBossFavoritesPreferences({ ...preferences, greeting });
    }
    case 'boss_start_favorites_task': {
      const { tabId, ...input } = bossTaskTabSchema.parse(params);
      const request = bossStartFavoritesInputSchema.parse(input);
      const tab = await requireTab(tabId);
      const url = new URL(tab.url ?? 'about:blank');
      if (url.origin !== 'https://www.zhipin.com' || url.pathname !== '/web/geek/recommend') throw new Error('请从BOSS个人中心的感兴趣岗位页启动投递');
      if (findRunningByTab(tabId)) throw new Error('此页面的 Agent 正在工作，请等它结束后再启动投递');
      if (isDirectBrowserBusy(tabId)) throw new Error('此标签页有直接浏览器操作正在执行，请等它结束');
      return startBossFavoritesTask(tabId, request, 'external');
    }
    case 'boss_list_current_favorites': {
      const { tabId } = bossListCurrentFavoritesSchema.parse(params);
      const tab = await requireTab(tabId);
      const url = new URL(tab.url ?? 'about:blank');
      if (url.origin !== 'https://www.zhipin.com' || url.pathname !== '/web/geek/recommend'
        || url.searchParams.get('tab') !== '4' || url.searchParams.get('sub') !== '1') {
        throw new Error('请先打开 BOSS 个人中心的感兴趣职位收藏页');
      }
      if (findRunningByTab(tabId)) throw new Error('此页面的 Agent 正在工作，请等它结束后再读取收藏');
      if (isDirectBrowserBusy(tabId)) throw new Error('此标签页有直接浏览器操作正在执行，请等它结束');
      if (isBossTaskRunning(tabId)) throw new Error('此标签页已有 BOSS 任务正在运行，请先读取任务状态');
      return sendToContent<BossFavoritesPage>(tabId, 'boss.favorites.state');
    }
    case 'boss_apply_favorite_job': {
      const { tabId, jobId, ...input } = bossApplyFavoriteJobInputSchema
        .extend({ tabId: z.number().int().positive() }).parse(params);
      const tab = await requireTab(tabId);
      const url = new URL(tab.url ?? 'about:blank');
      if (url.origin !== 'https://www.zhipin.com' || url.pathname !== '/web/geek/recommend'
        || url.searchParams.get('tab') !== '4' || url.searchParams.get('sub') !== '1') {
        throw new Error('请从当前 BOSS 个人中心的感兴趣岗位页处理指定岗位');
      }
      if (findRunningByTab(tabId)) throw new Error('此页面的 Agent 正在工作，请等它结束后再投递');
      if (isDirectBrowserBusy(tabId)) throw new Error('此标签页有直接浏览器操作正在执行，请等它结束');
      if (isBossTaskRunning(tabId)) throw new Error('此标签页已有 BOSS 任务正在运行，请先读取任务状态');
      return startBossFavoritesTask(tabId, { ...input, maxRecipients: 1, targetJobId: jobId }, 'external');
    }
    case 'boss_get_favorites_task': {
      const { tabId, ...input } = bossTaskTabSchema.parse(params);
      return bossFavoritesTasks.get(tabId, bossGetFavoritesTaskSchema.parse(input));
    }
    case 'boss_cancel_favorites_task': {
      const { tabId, ...input } = bossTaskTabSchema.parse(params);
      return bossFavoritesTasks.cancel(tabId, bossCancelFavoritesTaskSchema.parse(input));
    }
    case 'boss_start_task': {
      const { tabId, ...input } = bossTaskTabSchema.parse(params);
      const request = bossStartTaskSchema.parse(input);
      await requireBossTab(tabId);
      return bossTasks.start(tabId, request);
    }
    case 'boss_get_task': {
      const { tabId, ...request } = bossGetTaskHostSchema.parse(params);
      return bossTasks.get(tabId, request);
    }
    case 'boss_cancel_task': {
      const { tabId, ...request } = bossCancelTaskHostSchema.parse(params);
      return bossTasks.cancel(tabId, request);
    }
    case 'boss_get_resume_image_scan': {
      const { tabId, ...request } = bossGetScanHostSchema.parse(params);
      await requireBossTab(tabId);
      return bossService.getResumeImageScan(tabId, request, AbortSignal.timeout(15_000));
    }
    case 'boss_audit_resume_images': {
      const { tabId, ...request } = bossAuditHostSchema.parse(params);
      await requireBossTab(tabId);
      return bossService.auditResumeImages(tabId, request, AbortSignal.timeout(300_000));
    }
    case 'boss_send_resume_images': {
      const { tabId, ...request } = bossSendHostSchema.parse(params);
      await requireBossTab(tabId);
      return bossService.sendResumeImages(tabId, request, AbortSignal.timeout(300_000));
    }
    case 'list_tabs':
      return listHostTabs();
    case 'open_tabs_background':
      return openTabsBackground(openTabsBackgroundSchema.parse(params), await loadSettings());
    case 'dispatch_task':
      return dispatchHostTask((params ?? {}) as DispatchTaskInput);
    case 'get_session':
      return getHostSession((params ?? {}) as GetSessionInput);
    default:
      throw new Error(`未知 MCP Host 方法：${method}`);
  }
}

export function hostMethodError(error: unknown): string {
  return toErrorMessage(error);
}
