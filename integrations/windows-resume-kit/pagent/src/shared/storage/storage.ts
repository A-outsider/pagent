import { storage } from 'wxt/utils/storage';
import {
  adoptTabStore,
  conversationPageKey,
  conversationTabKey,
  isSparseStore,
} from '@/features/agent/session/conversations';
import { flattenStoredConversations } from '@/features/settings/conversation-archive';
import {
  idbDelete,
  idbDeleteKeys,
  idbGet,
  idbGetAll,
  idbReplaceAll,
  idbSet,
  resetSessionDbForTests,
  SESSION_STORES,
} from './idb';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  PROVIDER_IDS,
  snapshotProviderProfile,
  type AgentSettings,
  type AgentSettingsPatch,
  type SecretMap,
} from '@/shared/contracts/settings';
import { EMPTY_MCP_CONFIG, mcpConfigSchema, type McpConfig } from '@/shared/contracts/mcp';
import type {
  Checkpoint,
  DomainVault,
  PageConversation,
  PageConversationStore,
  VaultMap,
} from '@/shared/contracts/session';
import { applyVaultStoreUpdate, conversationVaultKey, viewForVault } from '@/features/agent/session/vault';

export const settingsItem = storage.defineItem<AgentSettings>('local:pagent-settings', {
  fallback: DEFAULT_SETTINGS,
});

export const mcpConfigItem = storage.defineItem<McpConfig>('local:pagent-mcp-config', {
  fallback: EMPTY_MCP_CONFIG,
});

export const checkpointsItem = storage.defineItem<Record<string, Checkpoint>>(
  'local:pagent-checkpoints',
  { fallback: {} },
);

export const secretsItem = storage.defineItem<SecretMap>('session:pagent-secrets', {
  fallback: {},
});

export const persistedSecretsItem = storage.defineItem<SecretMap>('local:pagent-secrets', {
  fallback: {},
});

export const memorySecretItem = storage.defineItem<string>('local:pagent-memory-secret', {
  fallback: '',
});

const pageConversationsItem = storage.defineItem<Record<string, PageConversationStore>>(
  'session:pagent-page-conversations',
  { fallback: {} },
);

const vaultsItem = storage.defineItem<VaultMap>('local:pagent-vaults', {
  fallback: {},
});

const tabUiItem = storage.defineItem<Record<string, { panelOpen?: boolean }>>('session:pagent-tab-ui', {
  fallback: {},
});

const sessionScopeItem = storage.defineItem<string>('session:pagent-session-scope', {
  fallback: '',
});

let vaultWrite: Promise<unknown> = Promise.resolve();
const conversationWrites = new Map<string, Promise<unknown>>();
let ready: Promise<void> | null = null;

function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = vaultWrite.then(fn, fn);
  vaultWrite = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensureSessionStorage(): Promise<void> {
  if (!ready) {
    ready = migrateChromeSessionIfNeeded()
      .then(() => reconcileTabScopedSession())
      .catch((error) => {
        ready = null;
        throw error;
      });
  }
  await ready;
}

async function migrateChromeSessionIfNeeded(): Promise<void> {
  if (await idbGet<boolean>(SESSION_STORES.meta, 'chrome-migrated')) return;

  const [conversations, vaults, tabUi] = await Promise.all([
    pageConversationsItem.getValue(),
    vaultsItem.getValue(),
    tabUiItem.getValue(),
  ]);

  if (Object.keys(conversations).length) {
    await idbReplaceAll(SESSION_STORES.conversations, conversations);
  }
  if (Object.keys(vaults).length) {
    await idbReplaceAll(SESSION_STORES.vaults, vaults);
  }
  if (Object.keys(tabUi).length) {
    await idbReplaceAll(SESSION_STORES.tabUi, tabUi);
  }

  await idbSet(SESSION_STORES.meta, 'chrome-migrated', true);
  await Promise.all([
    pageConversationsItem.setValue({}),
    vaultsItem.setValue({}),
    tabUiItem.setValue({}),
  ]);
}

async function reconcileTabScopedSession(): Promise<void> {
  let scope = await sessionScopeItem.getValue();
  if (!scope) {
    scope = `s_${crypto.randomUUID()}`;
    await sessionScopeItem.setValue(scope);
  }

  const previous = await idbGet<string>(SESSION_STORES.meta, 'session-scope');
  if (previous && previous !== scope) {
    const conversations = await idbGetAll<PageConversationStore>(SESSION_STORES.conversations);
    const tabKeys = Object.keys(conversations).filter((key) => key.startsWith('tab:'));
    await Promise.all([
      idbDeleteKeys(SESSION_STORES.conversations, tabKeys),
      idbReplaceAll(SESSION_STORES.tabUi, {}),
    ]);
  }
  await idbSet(SESSION_STORES.meta, 'session-scope', scope);
}

export async function loadPageConversations(pageKey: string): Promise<PageConversationStore | null> {
  await ensureSessionStorage();
  return (await idbGet<PageConversationStore>(SESSION_STORES.conversations, pageKey)) ?? null;
}

export async function loadTabConversations(
  tabId: number,
  url?: string,
): Promise<PageConversationStore | null> {
  await ensureSessionStorage();
  const tabStore = await idbGet<PageConversationStore>(
    SESSION_STORES.conversations,
    conversationTabKey(tabId),
  );
  if (tabStore) return tabStore;
  if (!url) return null;
  const pageStore = await idbGet<PageConversationStore>(
    SESSION_STORES.conversations,
    conversationPageKey(url),
  );
  return pageStore && !isSparseStore(pageStore) ? pageStore : null;
}

export async function savePageConversations(
  pageKey: string,
  store: PageConversationStore,
): Promise<void> {
  const previous = conversationWrites.get(pageKey) ?? Promise.resolve();
  const write = previous.then(async () => {
    await ensureSessionStorage();
    const current = await idbGet<PageConversationStore>(SESSION_STORES.conversations, pageKey);
    await idbSet(
      SESSION_STORES.conversations,
      pageKey,
      current ? adoptTabStore(store, current) : store,
    );
  });
  conversationWrites.set(pageKey, write);
  try {
    await write;
  } finally {
    if (conversationWrites.get(pageKey) === write) conversationWrites.delete(pageKey);
  }
}

export async function loadTabUi(tabId: number): Promise<{ panelOpen?: boolean } | null> {
  await ensureSessionStorage();
  return (await idbGet<{ panelOpen?: boolean }>(SESSION_STORES.tabUi, conversationTabKey(tabId))) ?? null;
}

export async function saveTabUi(tabId: number, ui: { panelOpen?: boolean }): Promise<void> {
  await ensureSessionStorage();
  const key = conversationTabKey(tabId);
  const current = (await idbGet<{ panelOpen?: boolean }>(SESSION_STORES.tabUi, key)) ?? {};
  await idbSet(SESSION_STORES.tabUi, key, { ...current, ...ui });
}

export async function clearTabUi(tabId: number): Promise<void> {
  await ensureSessionStorage();
  await idbDelete(SESSION_STORES.tabUi, conversationTabKey(tabId));
}

export async function loadVault(domain: string): Promise<DomainVault | null> {
  await ensureSessionStorage();
  return (await idbGet<DomainVault>(SESSION_STORES.vaults, domain)) ?? null;
}

export async function loadPersistedConversationSources(): Promise<{
  vaults: VaultMap;
  stores: Record<string, PageConversationStore>;
}> {
  await ensureSessionStorage();
  const [vaults, stores] = await Promise.all([
    idbGetAll<DomainVault>(SESSION_STORES.vaults),
    idbGetAll<PageConversationStore>(SESSION_STORES.conversations),
  ]);
  return { vaults, stores };
}

export async function listPersistedConversations(): Promise<PageConversation[]> {
  const { vaults, stores } = await loadPersistedConversationSources();
  return flattenStoredConversations(vaults, stores);
}

export async function getPersistedConversations(ids: string[]): Promise<PageConversation[]> {
  const wanted = new Set(ids);
  return (await listPersistedConversations()).filter((item) => wanted.has(item.id));
}

export async function saveVaultFromStore(
  urlOrDomain: string,
  store: PageConversationStore,
  options?: { deleteMissing?: boolean },
): Promise<DomainVault | null> {
  const domain = conversationVaultKey(urlOrDomain) ?? (/^[a-z0-9.-]+(?::\d+)?$/i.test(urlOrDomain) ? urlOrDomain.toLowerCase() : null);
  if (!domain) return null;
  return withVaultLock(async () => {
    await ensureSessionStorage();
    const all = await idbGetAll<DomainVault>(SESSION_STORES.vaults);
    const next = applyVaultStoreUpdate(all, domain, store, options);
    if (!next[domain]?.conversations.length) delete next[domain];
    await idbReplaceAll(SESSION_STORES.vaults, next);
    return next[domain] ?? null;
  });
}

export async function loadConversationsForPage(
  tabId: number,
  url?: string,
  live?: PageConversationStore | null,
): Promise<PageConversationStore | null> {
  const domain = url ? conversationVaultKey(url) : null;
  const sessionStore = await loadTabConversations(tabId, url);
  if (!domain) {
    return live ?? sessionStore;
  }
  const vault = await loadVault(domain);
  return viewForVault(domain, vault, live ?? sessionStore);
}

export async function loadSettings(): Promise<AgentSettings> {
  const stored = await settingsItem.getValue();
  const settings: AgentSettings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    model: { ...DEFAULT_SETTINGS.model, ...stored.model },
    memory: { ...DEFAULT_SETTINGS.memory, ...stored.memory },
    providerProfiles: { ...DEFAULT_SETTINGS.providerProfiles, ...stored.providerProfiles },
  };
  // @langchain/openai 1.5 only recognizes OpenAI reasoning-summary events,
  // while DeepSeek Responses streams response.reasoning_text.delta.
  // Use Chat Completions so reasoning_content reaches the thinking UI.
  if (settings.model.provider === 'deepseek' && settings.model.apiProtocol === 'responses') {
    settings.model.apiProtocol = 'chat-completions';
  }
  if (!settings.providerProfiles[settings.model.provider]) {
    settings.providerProfiles = {
      ...settings.providerProfiles,
      [settings.model.provider]: snapshotProviderProfile(settings.model),
    };
  }
  return settings;
}

export async function saveSettings(patch: AgentSettingsPatch): Promise<AgentSettings> {
  const next = applySettingsPatch(await loadSettings(), patch);
  await settingsItem.setValue(next);
  return next;
}

export async function loadMcpConfig(): Promise<McpConfig> {
  const stored = await mcpConfigItem.getValue();
  const parsed = mcpConfigSchema.safeParse(stored);
  return parsed.success ? parsed.data : EMPTY_MCP_CONFIG;
}

export async function saveMcpConfig(config: McpConfig): Promise<McpConfig> {
  const parsed = mcpConfigSchema.parse(config);
  await mcpConfigItem.setValue(parsed);
  return parsed;
}

export async function loadSecrets(): Promise<SecretMap> {
  const persisted = await persistedSecretsItem.getValue();
  const session = await secretsItem.getValue();
  const merged = { ...persisted, ...session };
  if (Object.values(session).some(Boolean)) {
    await persistedSecretsItem.setValue(merged);
    await secretsItem.setValue({});
  }
  return merged;
}

export async function saveSecret(provider: keyof SecretMap, apiKey: string): Promise<void> {
  const persisted = await persistedSecretsItem.getValue();
  persisted[provider] = apiKey;
  await persistedSecretsItem.setValue(persisted);
  const session = await secretsItem.getValue();
  if (session[provider]) {
    delete session[provider];
    await secretsItem.setValue(session);
  }
}

export async function clearSecrets(provider?: keyof SecretMap): Promise<void> {
  if (!provider) {
    await secretsItem.setValue({});
    await persistedSecretsItem.setValue({});
    return;
  }
  const session = await loadSecrets();
  delete session[provider];
  await secretsItem.setValue(session);
  const persisted = await persistedSecretsItem.getValue();
  delete persisted[provider];
  await persistedSecretsItem.setValue(persisted);
}

export async function secretPresence(): Promise<Record<string, boolean>> {
  const secrets = await loadSecrets();
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, Boolean(secrets[id])]));
}

export async function loadMemorySecret(): Promise<string> {
  return memorySecretItem.getValue();
}

export async function saveMemorySecret(apiKey: string): Promise<void> {
  await memorySecretItem.setValue(apiKey);
}

export async function clearMemorySecret(): Promise<void> {
  await memorySecretItem.setValue('');
}

export function resetSessionReadyForTests(): void {
  ready = null;
  vaultWrite = Promise.resolve();
  conversationWrites.clear();
}

export async function resetSessionStorageForTests(): Promise<void> {
  resetSessionReadyForTests();
  await resetSessionDbForTests();
  await Promise.all([
    pageConversationsItem.setValue({}),
    vaultsItem.setValue({}),
    tabUiItem.setValue({}),
    sessionScopeItem.setValue(''),
    checkpointsItem.setValue({}),
  ]);
}

export const chromeSessionItemsForTests = {
  pageConversationsItem,
  vaultsItem,
  tabUiItem,
  sessionScopeItem,
};
