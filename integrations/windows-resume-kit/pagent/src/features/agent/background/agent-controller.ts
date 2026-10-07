import { CHANNEL } from '@/shared/contracts/channel';
import { runAgent } from '@/features/agent/runtime/runtime';
import {
  createPageStore,
  emptyConversation,
  titleFromPrompt,
} from '@/features/agent/session/conversations';
import { adoptLiveStore, applyAgentEventToStore, nextStoreRevision } from '@/features/agent/session/session-live';
import { conversationVaultKey } from '@/features/agent/session/vault';
import { loadSettings, saveTabUi } from '@/shared/storage/storage';
import type { AgentEvent } from '@/shared/contracts/agent';
import type { ChatMessage, PageConversationStore, UserBadge, UserReference } from '@/shared/contracts/session';
import { nowId } from '@/shared/utils/utils';
import { beginBusyKeepAlive, endBusyKeepAlive } from '@/shared/extension/keepalive';
import { isDirectBrowserBusy } from '@/shared/extension/direct-browser-lock';
import { isBossTaskRunning, createBridge, ensureContentScript, sendToContent } from './content-bridge';
import {
  queueTabStoreWrite,
  readTabStore,
  resolveTabUrl,
  tabDomains,
  tabStores,
  writeTabStore,
} from './tab-store';

export type AgentControl = {
  abort: AbortController;
  conversationId?: string;
  sessionId: string;
  store: PageConversationStore;
  tabId: number;
  bossHandoff?: { taskId: string; exceptionId: string };
};

export type AgentSettlement = {
  status: 'completed' | 'aborted' | 'failed';
  tabId: number; conversationId: string; sessionId: string; error?: string;
};
export type AgentStartOptions = {
  ifBusy?: 'reject';
  bossHandoff?: AgentControl['bossHandoff'];
  onSettled?: (result: AgentSettlement) => Promise<void> | void;
};
export class AgentBusyError extends Error {
  constructor() { super('此页面已有 Agent 正在工作，自动异常处理已排队'); this.name = 'AgentBusyError'; }
}

export const running = new Map<number, AgentControl>();
const preparing = new Map<number, AbortController>();
const inFlight = new Map<AbortController, AgentControl>();
const idleListeners = new Set<(tabId: number) => void>();

export function isAgentBusy(tabId: number): boolean {
  return preparing.has(tabId) || Boolean(findRunningByTab(tabId)) || [...inFlight.values()].some((control) => control.tabId === tabId);
}
export function onAgentIdle(listener: (tabId: number) => void): () => void {
  idleListeners.add(listener);
  return () => { idleListeners.delete(listener); };
}
function notifyIdle(tabId: number) {
  if (isAgentBusy(tabId)) return;
  for (const listener of idleListeners) { try { listener(tabId); } catch { /* One observer cannot interrupt another. */ } }
}

export function findRunningByTab(tabId: number): AgentControl | undefined {
  return [...running.values()].find((control) => control.tabId === tabId);
}

export async function retargetAgent(fromTabId: number, toTabId: number): Promise<void> {
  if (fromTabId === toTabId) return;
  const control = findRunningByTab(fromTabId);
  if (!control) return;
  const displaced = findRunningByTab(toTabId);
  if (displaced && displaced !== control) {
    let targetUrl = '';
    try {
      const tab = await browser.tabs.get(toTabId);
      targetUrl = tab?.url || '';
    } catch {
      // ignore
    }
    const hint = targetUrl ? `使用 tabs.create("${targetUrl}") 打开新标签页` : '使用 tabs.create 打开新标签页';
    throw new Error(
      `标签页 (tabId: ${toTabId}) 正在被另一个活跃的 Agent 任务占用。为避免冲突，已阻止切换到该标签页。建议${hint}以继续执行。`,
    );
  }
  const live = tabStores.get(fromTabId);
  running.delete(control.tabId);
  running.delete(fromTabId);
  control.tabId = toTabId;
  running.set(toTabId, control);

  if (live) {
    live.panelOpen = false;
  }
  void saveTabUi(fromTabId, { panelOpen: false }).catch(() => {});
  void sendToContent(fromTabId, 'ui.collapse', {}).catch(() => {});
  browser.tabs.sendMessage(fromTabId, {
    channel: CHANNEL,
    kind: 'agent-retarget',
    working: false,
    agentActive: running.size > 0,
  }).catch(() => {});

  if (live) {
    control.store = {
      ...adoptLiveStore(tabStores.get(toTabId), control.store, control.conversationId),
      panelOpen: true,
      sessionId: control.sessionId,
      revision: nextStoreRevision(tabStores.get(toTabId)),
    };
    await writeTabStore(toTabId, control.store);
  }
  void saveTabUi(toTabId, { panelOpen: true }).catch(() => {});

  try {
    await ensureContentScript(toTabId);
    void sendToContent(toTabId, 'ui.open', {}).catch(() => {});
    browser.tabs.sendMessage(toTabId, {
      channel: CHANNEL,
      kind: 'agent-event',
      event: { type: 'status', message: 'Agent 已就绪' },
      sessionId: control.sessionId,
      revision: control.store.revision ?? 0,
      conversationId: control.conversationId,
      store: control.store,
    }).catch(() => {});
  } catch {
    // protected destination
  }
  notifyIdle(fromTabId);
}

function broadcast(control: AgentControl, event: AgentEvent) {
  const includeStore =
    event.type !== 'token' &&
    event.type !== 'reasoning' &&
    event.type !== 'thinking' &&
    event.type !== 'status' &&
    event.type !== 'tool-start';
  browser.tabs.sendMessage(control.tabId, {
    channel: CHANNEL,
    kind: 'agent-event',
    event,
    sessionId: control.sessionId,
    revision: control.store.revision ?? 0,
    conversationId: control.conversationId,
    store: includeStore ? control.store : undefined,
  }).catch(() => {});
}

function stopControl(control: AgentControl, broadcastEvent: boolean) {
  running.delete(control.tabId);
  control.abort.abort();
  if (!control.conversationId) return;
  const event: AgentEvent = { type: 'error', message: '任务已停止' };
  control.store = applyAgentEventToStore(control.store, control.conversationId, event);
  tabStores.set(control.tabId, control.store);
  queueTabStoreWrite(control.tabId, control.store, true);
  if (broadcastEvent) broadcast(control, event);
}

export async function startAgent(
  tabId: number,
  prompt: string,
  conversationId?: string,
  history?: ChatMessage[],
  context?: string,
  imageDataUrl?: string,
  badges?: UserBadge[],
  references?: UserReference[],
  internal: AgentStartOptions = {},
): Promise<{ ok: true; tabId: number; sessionId: string; conversationId: string }> {
  if (isDirectBrowserBusy(tabId)) throw new Error('此页面有直接浏览器操作正在执行，请等它返回后再启动 Agent');
  if (isBossTaskRunning(tabId)) throw new Error('此页面的 BOSS 后台任务正在执行，请先在任务卡中停止');
  if (internal.ifBusy === 'reject' && isAgentBusy(tabId)) throw new AgentBusyError();
  const abort = new AbortController();
  preparing.get(tabId)?.abort();
  preparing.set(tabId, abort);
  let keptAlive = false;
  try {
  const previous = findRunningByTab(tabId) ?? running.get(tabId);
  running.delete(tabId);
  if (previous) stopControl(previous, false);
  const currentUrl = await resolveTabUrl(tabId);
  const existing =
    tabStores.get(tabId) ??
    (await readTabStore(tabId)) ??
    createPageStore(conversationVaultKey(currentUrl ?? '') ?? undefined);
  abort.signal.throwIfAborted();
  const settings = await loadSettings();
  abort.signal.throwIfAborted();
  if (isBossTaskRunning(tabId)) throw new Error('此页面的 BOSS 后台任务已恢复，请等待完成或先停止任务');
  const targetId = conversationId ?? existing.activeId;
  let conversations = existing.conversations;
  let target = conversations.find((item) => item.id === targetId);
  if (!target) {
    target = emptyConversation(internal.bossHandoff ? '投递异常处理' : '会话 1', tabDomains.get(tabId) ? [tabDomains.get(tabId)!] : []);
    target.id = targetId;
    target.messages = history ?? [];
    conversations = [...conversations, target];
  }
  const turnHistory = history ?? target.messages;
  const lastMessage = target.messages.at(-1);
  const hasPrompt =
    lastMessage?.role === 'user' &&
    lastMessage.content.trim() === prompt.trim() &&
    lastMessage.imageDataUrl === imageDataUrl;
  const revision = nextStoreRevision(existing);
  conversations = conversations.map((item) =>
    item.id === targetId
      ? {
          ...item,
          revision: (item.revision ?? 0) + 1,
          updatedAt: Date.now(),
          title: titleFromPrompt(item.title, prompt),
          messages: hasPrompt
            ? item.messages
            : [
                ...item.messages,
                {
                  id: nowId('m'),
                  role: 'user' as const,
                  content: prompt,
                  imageDataUrl,
                  badges,
                  references,
                },
              ],
          running: true,
          thinking: '正在调用模型…',
          startedAt: item.startedAt ?? Date.now(),
          error: '',
        }
      : item,
  );
  const sessionId = nowId('s');
  const store: PageConversationStore = {
    ...existing,
    activeId: targetId,
    conversations,
    panelOpen: true,
    sessionId,
    revision,
  };
  const control: AgentControl = { abort, conversationId: targetId, sessionId, store, tabId,
    ...(internal.bossHandoff ? { bossHandoff: internal.bossHandoff } : {}) };
  running.set(tabId, control);
  tabStores.set(tabId, store);
  await writeTabStore(tabId, store);
  abort.signal.throwIfAborted();
  preparing.delete(tabId);
  beginBusyKeepAlive();
  keptAlive = true;
  const isCurrent = () => findRunningByTab(control.tabId)?.abort === abort;
  let terminalError: string | undefined;
  inFlight.set(abort, control);
  const done = runAgent({
    prompt,
    context,
    tabId,
    url: currentUrl,
    getTabId: () => control.tabId,
    sessionId,
    conversationId: targetId,
    history: turnHistory,
    imageDataUrl,
    badges,
    references,
    bossHandoff: internal.bossHandoff,
    bridge: createBridge(control, settings, retargetAgent),
    emit: (event) => {
      if (!isCurrent()) return;
      if (event.type === 'error') terminalError = event.message;
      control.store = applyAgentEventToStore(control.store, targetId, event);
      tabStores.set(control.tabId, control.store);
      queueTabStoreWrite(
        control.tabId,
        control.store,
        event.type === 'done' || event.type === 'error',
      );
      broadcast(control, event);
    },
    signal: abort.signal,
  });
  const settled = async (status: AgentSettlement['status'], error?: unknown) => {
    if (isCurrent()) running.delete(control.tabId);
    inFlight.delete(abort);
    endBusyKeepAlive();
    try {
      await internal.onSettled?.({ status: abort.signal.aborted ? 'aborted' : status, tabId: control.tabId,
        conversationId: targetId, sessionId, ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) });
    } finally { notifyIdle(control.tabId); }
  };
  void done.then(() => settled(terminalError ? 'failed' : 'completed', terminalError), (error) => settled('failed', error)).catch(() => undefined);
  return { ok: true, tabId, sessionId, conversationId: targetId };
  } catch (error) {
    if (preparing.get(tabId) === abort) preparing.delete(tabId);
    if (running.get(tabId)?.abort === abort) running.delete(tabId);
    inFlight.delete(abort);
    if (keptAlive) endBusyKeepAlive();
    notifyIdle(tabId);
    throw error;
  }
}

export function stopAgent(tabId: number) {
  preparing.get(tabId)?.abort();
  const control = findRunningByTab(tabId) ?? running.get(tabId);
  running.delete(tabId);
  if (control) stopControl(control, true);
}

export function stopAgentForTab(tabId: number): void {
  preparing.get(tabId)?.abort();
  const control = findRunningByTab(tabId) ?? running.get(tabId);
  if (control) stopControl(control, true);
}
