import { settleAssistantMessages } from './messages';
import { nowId } from '@/shared/utils/utils';
import type { PageConversation, PageConversationStore } from '@/shared/contracts/session';

export function conversationPageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function conversationTabKey(tabId: number): string {
  return `tab:${tabId}`;
}

/** 会话标签页默认保留最近活跃的时间窗口 */
export const RECENT_TAB_WINDOW_MS = 3 * 60 * 60 * 1000;

/** 会话是否在最近活跃窗口内（用于决定是否作为标签页展示） */
export function isRecentConversation(
  item: { updatedAt?: number },
  now = Date.now(),
): boolean {
  return (item.updatedAt ?? 0) > now - RECENT_TAB_WINDOW_MS;
}

/** 选择最近活跃窗口内最后更新的会话。 */
export function latestRecentConversation<T extends { updatedAt?: number }>(
  items: T[],
  now = Date.now(),
): T | undefined {
  return items.reduce<T | undefined>((latest, item) => {
    if (!isRecentConversation(item, now)) return latest;
    return !latest || (item.updatedAt ?? 0) > (latest.updatedAt ?? 0) ? item : latest;
  }, undefined);
}

export function isSparseConversation(item: PageConversation | null | undefined): boolean {
  if (!item) return true;
  return item.messages.length === 0 && !item.running && !item.thinking && !item.error;
}

export function isSparseStore(store: PageConversationStore | null | undefined): boolean {
  if (!store?.conversations.length) return true;
  return store.conversations.every(isSparseConversation);
}

export function conversationContentLength(item: PageConversation): number {
  return item.messages.reduce((sum, message) => {
    const fromParts = (message.parts ?? []).reduce((partSum, part) => {
      if (part.type === 'text' || part.type === 'thinking') return partSum + part.text.length;
      if (part.type === 'tool') return partSum + (part.output?.length ?? 0);
      return partSum;
    }, 0);
    return sum + Math.max(message.content.length, fromParts, message.thinking?.length ?? 0);
  }, 0);
}

export function conversationItemWeight(item: PageConversation): number {
  return (
    conversationContentLength(item) +
    item.messages.length * 10 +
    item.tasks.length +
    (item.running ? 1 : 0) +
    item.updatedAt / 1e15
  );
}

export function conversationWeight(store: PageConversationStore): number {
  return store.conversations.reduce((sum, item) => sum + conversationItemWeight(item), 0);
}

export function uniqueVaults(values: Array<string | undefined>): string[] {
  const next = new Set<string>();
  for (const value of values) {
    const key = value?.trim().toLowerCase();
    if (key) next.add(key);
  }
  return [...next];
}

export function pickRicherConversation(left: PageConversation, right: PageConversation): PageConversation {
  const leftRevision = left.revision ?? 0;
  const rightRevision = right.revision ?? 0;
  if (leftRevision !== rightRevision) {
    return rightRevision > leftRevision ? right : left;
  }
  const richer = conversationItemWeight(right) >= conversationItemWeight(left) ? right : left;
  const older = richer === right ? left : right;
  const title =
    /^会话 \d+$/.test(richer.title) && older.title && !/^会话 \d+$/.test(older.title) ? older.title : richer.title;
  return {
    ...richer,
    title,
    vaults: uniqueVaults([...(left.vaults ?? []), ...(right.vaults ?? [])]),
    createdAt: Math.min(left.createdAt, right.createdAt),
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
  };
}

export function mergeConversationLists(
  current: PageConversation[],
  incoming: PageConversation[],
): PageConversation[] {
  const map = new Map<string, PageConversation>();
  for (const item of current) map.set(item.id, item);
  for (const item of incoming) {
    const previous = map.get(item.id);
    map.set(item.id, previous ? pickRicherConversation(previous, item) : item);
  }
  return [...map.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

export function adoptTabStore(
  incoming: PageConversationStore,
  persisted?: PageConversationStore | null,
): PageConversationStore {
  const panelOpen = incoming.panelOpen ?? persisted?.panelOpen;
  if (!persisted) return { ...incoming, panelOpen };
  const incomingRevision = incoming.revision ?? 0;
  const persistedRevision = persisted.revision ?? 0;
  if (incomingRevision !== persistedRevision) {
    return incomingRevision > persistedRevision
      ? { ...incoming, panelOpen }
      : { ...persisted, panelOpen };
  }
  if (isSparseStore(incoming) && !isSparseStore(persisted)) {
    return { ...persisted, panelOpen };
  }
  return { ...mergeConversationStores(persisted, incoming), panelOpen };
}

export function mergeConversationStores(
  current: PageConversationStore | null | undefined,
  incoming: PageConversationStore,
): PageConversationStore {
  if (!current || isSparseStore(current)) {
    return { ...incoming, panelOpen: incoming.panelOpen ?? current?.panelOpen };
  }
  if (isSparseStore(incoming)) {
    return { ...current, panelOpen: incoming.panelOpen ?? current.panelOpen };
  }
  const conversations = mergeConversationLists(current.conversations, incoming.conversations);
  const activeId = conversations.some((item) => item.id === incoming.activeId)
    ? incoming.activeId
    : conversations.some((item) => item.id === current.activeId)
      ? current.activeId
      : conversations[0]!.id;
  return {
    activeId,
    conversations,
    panelOpen: incoming.panelOpen ?? current.panelOpen,
    sessionId: incoming.sessionId ?? current.sessionId,
    revision: Math.max(incoming.revision ?? 0, current.revision ?? 0),
  };
}

export function pickConversationStore(
  all: Record<string, PageConversationStore>,
  tabId: number,
  url?: string,
): PageConversationStore | null {
  const tabStore = all[conversationTabKey(tabId)];
  if (tabStore) return tabStore;
  if (url) {
    const pageStore = all[conversationPageKey(url)];
    if (pageStore && !isSparseStore(pageStore)) return pageStore;
  }
  return null;
}

export function nextConversationTitle(titles: string[]): string {
  const used = new Set(
    titles.map((title) => {
      const match = /^会话 (\d+)$/.exec(title);
      return match ? Number(match[1]) : 0;
    }),
  );
  let index = 1;
  while (used.has(index)) index += 1;
  return `会话 ${index}`;
}

export function titleFromPrompt(current: string, prompt: string): string {
  if (!/^会话 \d+$/.test(current)) return current;
  const text = prompt.replace(/\s+/g, ' ').trim();
  return text || current;
}

const DAY_MS = 86_400_000;

export function startOfLocalDay(now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function conversationTimeGroup(
  updatedAt: number,
  now = Date.now(),
): { key: 'today' | 'yesterday' | 'week' | 'older'; label: string } {
  const today = startOfLocalDay(now);
  if (updatedAt >= today) return { key: 'today', label: '今天' };
  if (updatedAt >= today - DAY_MS) return { key: 'yesterday', label: '昨天' };
  if (updatedAt >= today - 6 * DAY_MS) return { key: 'week', label: '过去 7 天' };
  return { key: 'older', label: '更早' };
}

export function groupConversationsByTime<T extends { updatedAt?: number }>(
  items: T[],
  now = Date.now(),
): Array<{ key: string; label: string; items: T[] }> {
  const groups: Array<{ key: string; label: string; items: T[] }> = [];
  const index = new Map<string, number>();
  for (const item of [...items].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))) {
    const group = conversationTimeGroup(item.updatedAt ?? 0, now);
    const existing = index.get(group.key);
    if (existing == null) {
      index.set(group.key, groups.length);
      groups.push({ ...group, items: [item] });
      continue;
    }
    groups[existing]!.items.push(item);
  }
  return groups;
}

export function formatConversationTime(value: number, now = Date.now()): string {
  if (!value) return '';
  const today = startOfLocalDay(now);
  const time = new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  if (value >= today - DAY_MS) return time;
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function emptyConversation(title: string, vaults: string[] = []): PageConversation {
  return {
    id: nowId('c'),
    revision: 0,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    tasks: [],
    error: '',
    thinking: '',
    running: false,
    budget: { modelCalls: 0, toolCalls: 0 },
    vaults: uniqueVaults(vaults),
  };
}

export function createPageStore(domain?: string): PageConversationStore {
  const first = emptyConversation('会话 1', domain ? [domain] : []);
  return { activeId: first.id, conversations: [first] };
}

export function normalizePageStore(
  value: PageConversationStore | null | undefined,
  domain?: string,
): PageConversationStore {
  if (!value?.conversations.length) return createPageStore(domain);
  const conversations = value.conversations.map((item) => ({
    ...item,
    vaults: uniqueVaults([...(item.vaults ?? []), domain]),
  }));
  const activeId = conversations.some((item) => item.id === value.activeId)
    ? value.activeId
    : conversations[0]!.id;
  return { activeId, conversations, panelOpen: value.panelOpen };
}

export function settleFinishedConversation(item: PageConversation): PageConversation {
  const messages = settleAssistantMessages(item.messages);
  const tasks = item.tasks.map((task) =>
    task.status === 'running' || task.status === 'pending' ? { ...task, status: 'done' as const } : task,
  );
  const tasksChanged = tasks.some((task, index) => task !== item.tasks[index]);
  if (!item.running && !item.thinking && messages === item.messages && !tasksChanged) {
    return item;
  }
  return {
    ...item,
    running: false,
    thinking: '',
    startedAt: undefined,
    messages,
    tasks,
  };
}

export function restoreConversationStore(
  store: PageConversationStore,
  live: { running: boolean; conversationId?: string },
): PageConversationStore {
  const liveId =
    live.running && live.conversationId && store.conversations.some((item) => item.id === live.conversationId)
      ? live.conversationId
      : live.running
        ? store.activeId
        : null;
  return {
    ...store,
    activeId: liveId ?? store.activeId,
    conversations: store.conversations.map((item) =>
      item.id === liveId
        ? { ...item, running: true, thinking: item.thinking || '正在继续当前任务…' }
        : settleFinishedConversation(item),
    ),
  };
}
