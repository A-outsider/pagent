import { CHANNEL, isRpcRequest } from '@/shared/contracts/rpc';
import { toErrorMessage } from '@/shared/contracts/errors';
import { clearTabUi } from '@/shared/storage/storage';
import { getActiveTab } from '@/shared/browser/tabs';
import { TOGGLE_PANEL_COMMAND } from '@/shared/extension/hotkey';
import { installServiceWorkerKeepAlive } from '@/shared/extension/keepalive';
import { archiveTabNavigation, clearTabStoreState } from '@/features/agent/background/tab-store';
import { running, stopAgentForTab } from '@/features/agent/background/agent-controller';
import { clearCurrentPageHidden, handleRpc } from '@/features/agent/background/rpc-router';
import { recoverInterruptedSessions } from '@/features/agent/background/session-recovery';
import { syncMcpServers } from '@/features/mcp/background/mcp-manager';
import { startMcpHostClient } from '@/features/mcp/background/host-client';
import { togglePanel } from '@/features/agent/background/content-bridge';
import { recordBrowserAction } from '@/features/teaching/background/teaching-controller';

export default defineBackground(() => {
  installServiceWorkerKeepAlive();
  void recoverInterruptedSessions().catch(() => {});
  void syncMcpServers().catch((error) => console.warn('MCP 连接失败', error));
  startMcpHostClient();

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      void archiveTabNavigation(tabId, changeInfo.url).catch(() => {});
      void recordBrowserAction(
        'navigate',
        tabId,
        { url: changeInfo.url, title: tab.title },
        '页面跳转',
      ).catch(() => {});
      return;
    }
    if (changeInfo.status === 'loading' && tab.url) {
      void recordBrowserAction('reload', tabId, { url: tab.url, title: tab.title }, '页面加载或刷新')
        .catch(() => {});
    }
  });

  browser.tabs.onActivated.addListener((activeInfo) => {
    void browser.tabs.get(activeInfo.tabId).then((tab) => {
      if (!tab.url) return;
      return recordBrowserAction(
        'tab_switch',
        activeInfo.tabId,
        { url: tab.url, title: tab.title },
        '切换标签页',
      );
    }).catch(() => {});
  });

  browser.tabs.onCreated.addListener((tab) => {
    if (!tab.id) return;
    void recordBrowserAction(
      'tab_open',
      tab.id,
      { url: tab.url ?? 'about:blank', title: tab.title },
      '打开标签页',
    ).catch(() => {});
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void recordBrowserAction('tab_close', tabId, { url: '', title: '' }, '关闭标签页').catch(() => {});
    stopAgentForTab(tabId);
    clearTabStoreState(tabId);
    running.delete(tabId);
    void clearCurrentPageHidden(tabId).catch(() => {});
    void clearTabUi(tabId).catch(() => {});
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.channel !== CHANNEL) return;
    if (message.kind === 'ping') {
      sendResponse({ ok: true });
      return;
    }
    if (!isRpcRequest(message)) return;
    const tabId = sender.tab?.id;
    handleRpc(message.name, message.payload, tabId)
      .then((result) => sendResponse({ channel: CHANNEL, kind: 'rpc-result', id: message.id, ok: true, result }))
      .catch((error) =>
        sendResponse({
          channel: CHANNEL,
          kind: 'rpc-result',
          id: message.id,
          ok: false,
          error: { code: 'rpc_error', message: toErrorMessage(error) },
        }),
      );
    return true;
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    try {
      await togglePanel(tab.id);
    } catch (error) {
      console.warn('Pagent inject failed', error);
    }
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== TOGGLE_PANEL_COMMAND) return;
    try {
      const tabId = tab?.id ?? (await getActiveTab()).id;
      if (!tabId) return;
      await togglePanel(tabId);
    } catch (error) {
      console.warn('Pagent shortcut failed', error);
    }
  });
});
