import {
  createPageStore,
  isSparseStore,
  mergeConversationLists,
  mergeConversationStores,
  normalizePageStore,
  pickRicherConversation,
} from './conversations';
import type { DomainVault, PageConversation, PageConversationStore, VaultMap } from '@/shared/contracts/session';

export function conversationVaultKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) return null;
    const port = parsed.port;
    const isDefault =
      !port ||
      (parsed.protocol === 'http:' && port === '80') ||
      (parsed.protocol === 'https:' && port === '443');
    return isDefault ? hostname : `${hostname}:${port}`;
  } catch {
    return null;
  }
}

export function normalizeVaults(vaults: string[] | undefined, domain?: string): string[] {
  const values = new Set<string>();
  for (const item of vaults ?? []) {
    const key = item.trim().toLowerCase();
    if (key) values.add(key);
  }
  if (domain) values.add(domain);
  return [...values];
}

export function ensureConversationVault(item: PageConversation, domain: string): PageConversation {
  const vaults = normalizeVaults(item.vaults, domain);
  if (vaults.length === item.vaults.length && item.vaults.every((value, index) => value === vaults[index])) {
    return item;
  }
  return { ...item, vaults };
}

export function conversationInVault(item: PageConversation, domain: string): boolean {
  return normalizeVaults(item.vaults).includes(domain);
}

export function assignDomainToStore(store: PageConversationStore, domain: string): PageConversationStore {
  return {
    ...store,
    conversations: store.conversations.map((item) => ensureConversationVault(item, domain)),
  };
}

export function archiveActiveConversations(
  store: PageConversationStore,
  domain: string,
): PageConversationStore {
  return {
    ...store,
    conversations: store.conversations.map((item) => {
      const shouldArchive = item.id === store.activeId || item.running || conversationInVault(item, domain);
      return shouldArchive ? ensureConversationVault(item, domain) : item;
    }),
  };
}

export function filterStoreForVault(store: PageConversationStore, domain: string): PageConversationStore {
  const conversations = store.conversations.filter((item) => conversationInVault(item, domain));
  if (!conversations.length) return createPageStore(domain);
  const activeId = conversations.some((item) => item.id === store.activeId)
    ? store.activeId
    : conversations[0]!.id;
  return { activeId, conversations };
}

export function vaultToStore(vault: DomainVault | null | undefined, domain: string): PageConversationStore {
  if (!vault?.conversations.length) return createPageStore(domain);
  return normalizePageStore(
    {
      activeId: vault.activeId ?? vault.conversations[0]!.id,
      conversations: vault.conversations,
      panelOpen: undefined,
    },
    domain,
  );
}

export function projectStoreToVault(store: PageConversationStore, domain: string): DomainVault {
  const conversations = store.conversations
    .filter((item) => conversationInVault(item, domain))
    .map((item) => ensureConversationVault(item, domain));
  return {
    domain,
    updatedAt: Date.now(),
    panelOpen: undefined,
    activeId: conversations.some((item) => item.id === store.activeId) ? store.activeId : conversations[0]?.id,
    conversations,
  };
}

export function upsertConversationIntoVault(vault: DomainVault, item: PageConversation): DomainVault {
  const next = ensureConversationVault(item, vault.domain);
  const index = vault.conversations.findIndex((current) => current.id === next.id);
  const conversations =
    index >= 0
      ? vault.conversations.map((current, currentIndex) =>
          currentIndex === index ? pickRicherConversation(current, next) : current,
        )
      : [...vault.conversations, next];
  return {
    ...vault,
    updatedAt: Date.now(),
    conversations,
    activeId: vault.activeId === next.id || !vault.activeId ? next.id : vault.activeId,
  };
}

export function removeConversationFromVaults(
  all: VaultMap,
  domain: string,
  conversationId: string,
): VaultMap {
  const vault = all[domain];
  if (!vault) return all;
  const removed = vault.conversations.find((item) => item.id === conversationId);
  const next: VaultMap = {
    ...all,
    [domain]: {
      ...vault,
      updatedAt: Date.now(),
      conversations: vault.conversations.filter((item) => item.id !== conversationId),
      activeId: vault.activeId === conversationId ? undefined : vault.activeId,
    },
  };
  if (!removed) return next;
  for (const otherDomain of normalizeVaults(removed.vaults)) {
    if (otherDomain === domain) continue;
    const other = next[otherDomain];
    if (!other) continue;
    next[otherDomain] = {
      ...other,
      updatedAt: Date.now(),
      conversations: other.conversations.map((item) =>
        item.id === conversationId
          ? { ...item, vaults: normalizeVaults(item.vaults).filter((value) => value !== domain) }
          : item,
      ),
    };
  }
  return next;
}

export function applyVaultStoreUpdate(
  all: VaultMap,
  domain: string,
  store: PageConversationStore,
  options?: { deleteMissing?: boolean },
): VaultMap {
  const deleteMissing = options?.deleteMissing ?? true;
  const archived = assignDomainToStore(filterStoreForVault(archiveActiveConversations(store, domain), domain), domain);
  let next: VaultMap = { ...all };
  const previous = next[domain];
  if (deleteMissing && previous) {
    const incomingIds = new Set(archived.conversations.map((item) => item.id));
    for (const item of previous.conversations) {
      if (!incomingIds.has(item.id)) {
        next = removeConversationFromVaults(next, domain, item.id);
      }
    }
  }

  const projected = projectStoreToVault(archived, domain);
  const mergedConversations = mergeConversationLists(next[domain]?.conversations ?? [], projected.conversations);
  next[domain] = {
    ...projected,
    conversations: mergedConversations,
    activeId: projected.activeId ?? next[domain]?.activeId,
    panelOpen: undefined,
  };

  for (const item of mergedConversations) {
    for (const otherDomain of normalizeVaults(item.vaults)) {
      if (otherDomain === domain) continue;
      const other = next[otherDomain] ?? {
        domain: otherDomain,
        updatedAt: Date.now(),
        conversations: [],
      };
      next[otherDomain] = upsertConversationIntoVault(other, item);
    }
  }
  return next;
}

export function viewForVault(
  domain: string,
  vault: DomainVault | null | undefined,
  live?: PageConversationStore | null,
): PageConversationStore {
  const fromVault = vaultToStore(vault, domain);
  if (!live || (isSparseStore(live) && live.conversations.length <= 1)) {
    return { ...fromVault, panelOpen: live?.panelOpen };
  }
  const archived = archiveActiveConversations(live, domain);
  const viewed = filterStoreForVault(
    mergeConversationStores({ ...fromVault, panelOpen: undefined }, { ...archived, panelOpen: undefined }),
    domain,
  );
  return { ...viewed, panelOpen: live.panelOpen };
}
