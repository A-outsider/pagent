import { parseRpcPayload, type RpcName } from '@/shared/contracts/rpc';
import { assertNavigableUrl } from '@/shared/contracts/policy';
import {
  clearSecrets,
  loadSettings,
  loadSecrets,
  saveSecret,
  saveSettings,
  secretPresence,
  loadMemorySecret,
  saveMemorySecret,
  clearMemorySecret,
  loadTabUi,
  saveTabUi,
  saveVaultFromStore,
  getPersistedConversations,
  loadPersistedConversationSources,
} from '@/shared/storage/storage';
import { getPermissionState, requestPermissions } from '@/shared/browser/permissions';
import {
  closeTab,
  createTab,
  getActiveTab,
  goBack,
  goForward,
  listTabs,
  navigateTab,
  reloadTab,
  switchTab,
} from '@/shared/browser/tabs';
import { captureVisibleTab, trimDataUrl } from '@/shared/browser/screenshot';
import {
  attachDebugger,
  captureCdpScreenshot,
  detachDebugger,
  dispatchClick,
  dispatchMove,
  evaluateExpression,
  getConsoleLog,
  getNetworkLog,
  getNetworkRequest,
  insertText,
} from '@/shared/browser/cdp';
import { testModelConnection } from '@/features/agent/runtime/models';
import { fetchProviderModels } from '@/features/settings/model-list';
import { syncMcpServers } from '@/features/mcp/background/mcp-manager';
import { saveMcpConfig } from '@/shared/storage/storage';
import { isSparseStore } from '@/features/agent/session/conversations';
import { conversationVaultKey } from '@/features/agent/session/vault';
import {
  flattenStoredConversations,
  listVaultSummaries,
  toConversationSummary,
  toExportedConversation,
} from '@/features/settings/conversation-archive';
import type { AgentSettingsPatch } from '@/shared/contracts/settings';
import type { PageConversationStore } from '@/shared/contracts/session';
import type { RecordedAction } from '@/shared/contracts/teaching';
import { loadCommands } from '@/features/teaching/storage';
import {
  appendTeachingActions,
  cancelTeaching,
  confirmTeaching,
  finishTeaching,
  reviseTeaching,
  startTeaching,
  teachingContext,
} from '@/features/teaching/background/teaching-controller';
import {
  findRunningByTab,
  retargetAgent,
  running,
  startAgent,
  stopAgent,
} from './agent-controller';
import { bossTasks, bossFavoritesTasks, isBossTaskRunning, startBossFavoritesTask, sendToContent, snapshotMentionedTab, togglePanel, uploadAttachmentToTab } from './content-bridge';
import { getBossFavoritesPreferences, saveBossFavoritesPreferences } from '@/features/boss/favorites-preferences';
import { archiveTabNavigation, readTabStore, resolveTabUrl, tabDomains, tabStores, writeTabStore } from './tab-store';
import {
  memoryViewsForPage,
  removeMemory,
  testMemoryConnection,
  updateMemoryContent,
} from '@/features/memory/service';

const PERMANENTLY_HIDDEN_KEY = 'pagent:permanently-hidden';
const CURRENT_PAGE_HIDDEN_PREFIX = 'pagent:current-page-hidden:';
const PAGE_WRITES = new Set<RpcName>([
  'attachments.upload', 'dom.click', 'dom.dblclick', 'dom.hover', 'dom.focus', 'dom.type',
  'dom.clear', 'dom.select', 'dom.interact', 'dom.press', 'dom.drag', 'dom.scroll',
  'page.navigate', 'page.back', 'page.forward', 'page.reload', 'tabs.create', 'tabs.switch',
  'tabs.close', 'cdp.script', 'cdp.input',
]);

function currentPageHiddenKey(tabId: number) {
  return `${CURRENT_PAGE_HIDDEN_PREFIX}${tabId}`;
}

async function readCurrentPageHidden(tabId: number): Promise<boolean> {
  const key = currentPageHiddenKey(tabId);
  const [stored, tab] = await Promise.all([
    browser.storage.local.get(key),
    browser.tabs.get(tabId),
  ]);
  const state = stored[key] as { url?: string } | undefined;
  const hidden = Boolean(state?.url && state.url === tab.url);
  if (state && !hidden) await browser.storage.local.remove(key);
  return hidden;
}

export async function clearCurrentPageHidden(tabId: number) {
  await browser.storage.local.remove(currentPageHiddenKey(tabId));
}

export async function handleRpc(name: RpcName, payload: unknown, senderTabId?: number) {
  const tabId = senderTabId ?? (await getActiveTab()).id!;
  if (PAGE_WRITES.has(name) || (name === 'screenshot.capture' && parseRpcPayload(name, payload).fullPage)) {
    const target = name === 'tabs.switch' || name === 'tabs.close' ? parseRpcPayload(name, payload).tabId : undefined;
    if (isBossTaskRunning(tabId) || (target !== undefined && isBossTaskRunning(target))) {
      throw new Error('BOSS 后台任务正在使用此页面，请先停止任务再操作页面');
    }
  }
  const settings = await loadSettings();

  switch (name) {
    case 'boss.favorites.start':
      if (findRunningByTab(tabId)) throw new Error('此页面的 Agent 正在工作，请等它结束后再启动投递');
      return startBossFavoritesTask(tabId, parseRpcPayload(name, payload));
    case 'boss.favorites.get':
      return bossFavoritesTasks.get(tabId, parseRpcPayload(name, payload));
    case 'boss.favorites.cancel':
      return bossFavoritesTasks.cancel(tabId, parseRpcPayload(name, payload));
    case 'boss.favorites.preferences.get':
      parseRpcPayload(name, payload);
      return getBossFavoritesPreferences();
    case 'boss.favorites.preferences.set':
      return saveBossFavoritesPreferences(parseRpcPayload(name, payload));
    case 'boss.task.get':
      return bossTasks.get(tabId, parseRpcPayload('boss.task.get', payload));
    case 'boss.task.cancel':
      return bossTasks.cancel(tabId, parseRpcPayload('boss.task.cancel', payload));
    case 'attachments.upload':
      return uploadAttachmentToTab(tabId, parseRpcPayload('attachments.upload', payload));
    case 'dom.observe':
    case 'dom.changes.start':
    case 'dom.changes.read':
    case 'dom.search':
    case 'dom.click':
    case 'dom.dblclick':
    case 'dom.hover':
    case 'dom.focus':
    case 'dom.type':
    case 'dom.clear':
    case 'dom.select':
    case 'dom.interact':
    case 'dom.verifyFields':
    case 'dom.press':
    case 'dom.drag':
    case 'dom.scroll':
    case 'dom.wait':
    case 'dom.script':
    case 'dom.elementTree':
    case 'dom.commonAncestor':
    case 'page.info':
    case 'page.source':
      return sendToContent(tabId, name, parseRpcPayload(name, payload));
    case 'page.navigate': {
      const data = parseRpcPayload('page.navigate', payload);
      assertNavigableUrl(data.url, settings);
      return navigateTab(tabId, data.url);
    }
    case 'page.back':
      return goBack(tabId);
    case 'page.forward':
      return goForward(tabId);
    case 'page.reload':
      return reloadTab(tabId);
    case 'tabs.query':
      return listTabs();
    case 'tabs.snapshot': {
      const data = parseRpcPayload('tabs.snapshot', payload);
      return Promise.all(data.tabIds.map(snapshotMentionedTab));
    }
    case 'tabs.create': {
      const data = parseRpcPayload('tabs.create', payload);
      if (data.url) assertNavigableUrl(data.url, settings);
      return createTab(data.url);
    }
    case 'tabs.switch': {
      const data = parseRpcPayload('tabs.switch', payload);
      const target = data.tabId ?? tabId;
      const result = await switchTab(target);
      await retargetAgent(tabId, target);
      return result;
    }
    case 'tabs.close': {
      const data = parseRpcPayload('tabs.close', payload);
      return closeTab(data.tabId ?? tabId);
    }
    case 'screenshot.capture': {
      const data = parseRpcPayload('screenshot.capture', payload);
      const screenshot = data.fullPage
        ? await captureCdpScreenshot(tabId, true)
        : await captureVisibleTab((await browser.tabs.get(tabId)).windowId);
      return data.raw ? screenshot : trimDataUrl(screenshot);
    }
    case 'permissions.get':
      return getPermissionState();
    case 'permissions.request':
      return requestPermissions(parseRpcPayload('permissions.request', payload));
    case 'cdp.attach':
      await attachDebugger(tabId);
      return { ok: true };
    case 'cdp.detach':
      await detachDebugger(tabId);
      return { ok: true };
    case 'cdp.script': {
      const data = parseRpcPayload('cdp.script', payload);
      return evaluateExpression(tabId, data.expression, data.awaitPromise);
    }
    case 'cdp.input': {
      const data = parseRpcPayload('cdp.input', payload);
      await attachDebugger(tabId);
      if (data.type === 'move') await dispatchMove(tabId, data.x, data.y);
      else await dispatchClick(tabId, data.x, data.y);
      if (data.text) await insertText(tabId, data.text);
      return { ok: true };
    }
    case 'cdp.network':
      if (!settings.captureDevtools) return { error: '用户已关闭网络/控制台采集。' };
      return getNetworkLog(tabId, parseRpcPayload('cdp.network', payload));
    case 'cdp.console':
      if (!settings.captureDevtools) return { error: '用户已关闭网络/控制台采集。' };
      return getConsoleLog(tabId, parseRpcPayload('cdp.console', payload));
    case 'cdp.networkRequest': {
      if (!settings.captureDevtools) return { error: '用户已关闭网络/控制台采集。' };
      const data = parseRpcPayload('cdp.networkRequest', payload);
      return getNetworkRequest(tabId, data.requestId, data.includeBody);
    }
    case 'settings.get':
      return settings;
    case 'settings.set':
      return saveSettings(parseRpcPayload('settings.set', payload) as AgentSettingsPatch);
    case 'mcp.getState':
      return syncMcpServers(false);
    case 'mcp.setConfig': {
      const data = parseRpcPayload('mcp.setConfig', payload);
      await saveMcpConfig(data.config);
      return syncMcpServers(true);
    }
    case 'mcp.sync':
      return syncMcpServers(true);
    case 'secrets.set': {
      const data = parseRpcPayload('secrets.set', payload);
      await saveSecret(data.provider, data.apiKey);
      return { ok: true };
    }
    case 'secrets.clear':
      await clearSecrets(parseRpcPayload('secrets.clear', payload).provider);
      return { ok: true };
    case 'secrets.has':
      return secretPresence();
    case 'models.list': {
      const data = parseRpcPayload('models.list', payload);
      const secrets = await loadSecrets();
      return fetchProviderModels(data.provider, {
        apiKey: secrets[data.provider],
        baseURL: data.baseURL,
        force: data.force,
      });
    }
    case 'llm.test': {
      const data = parseRpcPayload('llm.test', payload);
      const next = await saveSettings({
        model: {
          ...settings.model,
          provider: data.provider,
          model: data.model,
          baseURL: data.baseURL,
          apiProtocol: data.apiProtocol ?? settings.model.apiProtocol,
        },
      });
      return testModelConnection(next, await loadSecrets());
    }
    case 'memory.list':
      return memoryViewsForPage(await resolveTabUrl(tabId));
    case 'memory.update': {
      const data = parseRpcPayload('memory.update', payload);
      return updateMemoryContent(data.id, data.content, await resolveTabUrl(tabId));
    }
    case 'memory.delete': {
      const data = parseRpcPayload('memory.delete', payload);
      await removeMemory(data.id, await resolveTabUrl(tabId));
      return { ok: true };
    }
    case 'memory.secret.set': {
      const data = parseRpcPayload('memory.secret.set', payload);
      await saveMemorySecret(data.apiKey.trim());
      return { ok: true };
    }
    case 'memory.secret.clear':
      await clearMemorySecret();
      return { ok: true };
    case 'memory.secret.has':
      return { present: Boolean(await loadMemorySecret()) };
    case 'memory.test':
      return testMemoryConnection();
    case 'agent.start': {
      const data = parseRpcPayload('agent.start', payload);
      return startAgent(
        data.tabId ?? tabId,
        data.prompt,
        data.conversationId,
        data.history,
        data.context,
        data.imageDataUrl,
        data.badges,
        data.references,
      );
    }
    case 'session.context': {
      const data = parseRpcPayload('session.context', payload);
      const control = findRunningByTab(tabId);
      const url = await resolveTabUrl(tabId, data.url);
      if (url) await archiveTabNavigation(tabId, url);
      const stored = await readTabStore(tabId, url);
      const store = control?.store ?? stored;
      const tabUi = await loadTabUi(tabId);
      const tabOpen = store?.panelOpen ?? tabUi?.panelOpen ?? tabStores.get(tabId)?.panelOpen ?? false;
      return {
        tabId,
        sessionTabId: control?.tabId ?? tabId,
        sessionId: control?.sessionId ?? store?.sessionId,
        revision: store?.revision ?? 0,
        running: Boolean(control),
        agentActive: running.size > 0,
        conversationId: control?.conversationId ?? store?.activeId,
        panelOpen: Boolean(control) || Boolean(tabOpen),
        store,
      };
    }
    case 'session.setUi': {
      const data = parseRpcPayload('session.setUi', payload);
      const url = await resolveTabUrl(tabId);
      await saveTabUi(tabId, { panelOpen: data.panelOpen });
      const store = await readTabStore(tabId, url);
      if (!store) return { ok: true };
      await writeTabStore(tabId, { ...store, panelOpen: data.panelOpen }, url, { deleteMissing: false });
      return { ok: true };
    }
    case 'session.saveStore': {
      const data = parseRpcPayload('session.saveStore', payload);
      const senderUrl = data.url;
      const currentUrl = await resolveTabUrl(tabId);
      const senderDomain = senderUrl ? conversationVaultKey(senderUrl) : null;
      const currentDomain = currentUrl ? conversationVaultKey(currentUrl) : tabDomains.get(tabId);
      const deleted = new Set(data.deletedConversationIds ?? []);
      const incoming: PageConversationStore = {
        activeId: data.activeId,
        conversations: data.conversations.filter((item) => !deleted.has(item.id)),
        panelOpen: data.panelOpen,
        sessionId: data.sessionId,
        revision: data.revision,
      };
      const control = findRunningByTab(tabId);
      if (
        control &&
        (incoming.revision ?? 0) > (control.store.revision ?? 0) &&
        incoming.conversations.some((item) => item.id === control.conversationId)
      ) {
        control.store = incoming;
      }
      let vaultSaved = false;
      if (senderDomain && !isSparseStore(incoming)) {
        await saveVaultFromStore(senderDomain, incoming, {
          deleteMissing: !currentDomain || currentDomain === senderDomain,
        });
        vaultSaved = true;
      }
      if (!currentDomain || !senderDomain || currentDomain === senderDomain) {
        await writeTabStore(tabId, incoming, senderUrl ?? currentUrl, {
          persistVault: !vaultSaved,
        });
      }
      return { ok: true };
    }
    case 'conversations.list': {
      const sources = await loadPersistedConversationSources();
      const items = flattenStoredConversations(sources.vaults, sources.stores);
      return {
        conversations: items.map(toConversationSummary),
        vaults: listVaultSummaries(sources.vaults),
      };
    }
    case 'conversations.get': {
      const data = parseRpcPayload('conversations.get', payload);
      const items = await getPersistedConversations(data.ids);
      return {
        conversations: items.map((item) => toExportedConversation(item, { includeImages: data.includeImages })),
      };
    }
    case 'teaching.start': {
      const data = parseRpcPayload('teaching.start', payload);
      return startTeaching({ tabId, url: data.url, conversationId: data.conversationId });
    }
    case 'teaching.context':
      return { session: await teachingContext() };
    case 'teaching.append': {
      const data = parseRpcPayload('teaching.append', payload);
      return appendTeachingActions((data.actions as RecordedAction[]).map((action) => ({
        ...action,
        tabId: action.tabId ?? tabId,
      })));
    }
    case 'teaching.finish':
      return finishTeaching();
    case 'teaching.cancel':
      await cancelTeaching();
      return { ok: true };
    case 'teaching.revise':
      return reviseTeaching(parseRpcPayload('teaching.revise', payload).request);
    case 'teaching.confirm':
      return confirmTeaching();
    case 'commands.list': {
      const data = parseRpcPayload('commands.list', payload);
      const url = data.url ?? await resolveTabUrl(tabId);
      const domain = url ? conversationVaultKey(url) : null;
      return domain ? loadCommands(domain) : [];
    }
    case 'agent.stop':
      stopAgent(parseRpcPayload('agent.stop', payload).tabId ?? tabId);
      return { ok: true };
    case 'agent.toggle':
      return togglePanel(tabId);
    case 'menu.getState': {
      const stored = await browser.storage.local.get(PERMANENTLY_HIDDEN_KEY);
      return {
        permanentlyHidden: stored[PERMANENTLY_HIDDEN_KEY] === true,
        currentHidden: await readCurrentPageHidden(tabId),
      };
    }
    case 'menu.openCurrent':
      await clearCurrentPageHidden(tabId);
      await sendToContent(tabId, 'ui.open', {});
      return { ok: true };
    case 'menu.hideCurrent': {
      const tab = await browser.tabs.get(tabId);
      await browser.storage.local.set({
        [currentPageHiddenKey(tabId)]: { url: tab.url ?? '' },
      });
      await sendToContent(tabId, 'ui.hide', {});
      return { ok: true };
    }
    case 'menu.setPermanentlyHidden': {
      const { hidden } = parseRpcPayload('menu.setPermanentlyHidden', payload);
      await browser.storage.local.set({ [PERMANENTLY_HIDDEN_KEY]: hidden });
      return { permanentlyHidden: hidden };
    }
    default:
      throw new Error(`未知命令 ${name}`);
  }
}
