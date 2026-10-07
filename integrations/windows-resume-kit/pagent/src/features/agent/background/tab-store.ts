import {
  loadConversationsForPage,
  loadTabConversations,
  loadTabUi,
  savePageConversations,
  saveTabUi,
  saveVaultFromStore,
} from '@/shared/storage/storage';
import {
  adoptTabStore,
  conversationTabKey,
  isSparseStore,
} from '@/features/agent/session/conversations';
import { conversationVaultKey } from '@/features/agent/session/vault';
import type { PageConversationStore } from '@/shared/contracts/session';

export const tabStores = new Map<number, PageConversationStore>();
export const tabDomains = new Map<number, string>();
const tabStoreWrites = new Map<number, Promise<unknown>>();
const pendingTabStores = new Map<number, PageConversationStore>();
const tabStoreWriteTimers = new Map<number, ReturnType<typeof setTimeout>>();
const TAB_STORE_WRITE_DEBOUNCE_MS = 300;

function flushTabStoreWrite(tabId: number): void {
  const timer = tabStoreWriteTimers.get(tabId);
  if (timer) clearTimeout(timer);
  tabStoreWriteTimers.delete(tabId);
  const store = pendingTabStores.get(tabId);
  if (!store) return;
  pendingTabStores.delete(tabId);
  const previous = tabStoreWrites.get(tabId) ?? Promise.resolve();
  const write = previous
    .catch(() => undefined)
    .then(() => writeTabStore(tabId, store, undefined, { deleteMissing: false }));
  tabStoreWrites.set(tabId, write);
  void write.finally(() => {
    if (tabStoreWrites.get(tabId) === write) tabStoreWrites.delete(tabId);
  });
}

export function queueTabStoreWrite(
  tabId: number,
  store: PageConversationStore,
  immediate = false,
): void {
  pendingTabStores.set(tabId, store);
  const timer = tabStoreWriteTimers.get(tabId);
  if (timer) clearTimeout(timer);
  if (immediate) {
    flushTabStoreWrite(tabId);
    return;
  }
  tabStoreWriteTimers.set(
    tabId,
    setTimeout(() => flushTabStoreWrite(tabId), TAB_STORE_WRITE_DEBOUNCE_MS),
  );
}

export function clearTabStoreState(tabId: number): void {
  const timer = tabStoreWriteTimers.get(tabId);
  if (timer) clearTimeout(timer);
  tabStoreWriteTimers.delete(tabId);
  pendingTabStores.delete(tabId);
  tabStores.delete(tabId);
  tabDomains.delete(tabId);
}

export async function resolveTabUrl(tabId: number, fallback?: string): Promise<string | undefined> {
  try {
    return (await browser.tabs.get(tabId)).url ?? fallback;
  } catch {
    return fallback;
  }
}

export async function readTabStore(tabId: number, url?: string): Promise<PageConversationStore | null> {
  const resolvedUrl = await resolveTabUrl(tabId, url);
  const domain = resolvedUrl ? conversationVaultKey(resolvedUrl) : null;
  const stored = await loadConversationsForPage(tabId, resolvedUrl, tabStores.get(tabId));
  if (stored) {
    const previous = tabStores.get(tabId);
    const tabUi = await loadTabUi(tabId);
    tabStores.set(tabId, {
      ...stored,
      panelOpen: stored.panelOpen ?? previous?.panelOpen ?? tabUi?.panelOpen,
    });
    if (domain) tabDomains.set(tabId, domain);
    return tabStores.get(tabId) ?? stored;
  }
  return tabStores.get(tabId) ?? null;
}

export async function writeTabStore(
  tabId: number,
  store: PageConversationStore,
  url?: string,
  options?: { deleteMissing?: boolean; persistVault?: boolean },
): Promise<PageConversationStore> {
  const resolvedUrl = await resolveTabUrl(tabId, url);
  const domain = resolvedUrl ? conversationVaultKey(resolvedUrl) : tabDomains.get(tabId);
  const previous = tabStores.get(tabId) ?? (await loadTabConversations(tabId, resolvedUrl));
  const nextStore = adoptTabStore(store, previous);
  tabStores.set(tabId, nextStore);
  if (domain) tabDomains.set(tabId, domain);
  await savePageConversations(conversationTabKey(tabId), nextStore);
  if (typeof nextStore.panelOpen === 'boolean') {
    await saveTabUi(tabId, { panelOpen: nextStore.panelOpen });
  }
  if (options?.persistVault !== false && domain && !isSparseStore(nextStore)) {
    await saveVaultFromStore(domain, nextStore, { deleteMissing: options?.deleteMissing ?? true });
  }
  return nextStore;
}

export async function archiveTabNavigation(tabId: number, url: string): Promise<void> {
  const domain = conversationVaultKey(url);
  if (!domain) return;
  const live = tabStores.get(tabId) ?? (await loadTabConversations(tabId, url));
  if (!live || isSparseStore(live)) {
    tabDomains.set(tabId, domain);
    return;
  }
  const viewed = await loadConversationsForPage(tabId, url, live);
  if (!viewed) {
    tabDomains.set(tabId, domain);
    return;
  }
  const next = adoptTabStore(viewed, live);
  tabStores.set(tabId, next);
  tabDomains.set(tabId, domain);
  await savePageConversations(conversationTabKey(tabId), next);
  if (!isSparseStore(next)) {
    await saveVaultFromStore(domain, next, { deleteMissing: false });
  }
}
