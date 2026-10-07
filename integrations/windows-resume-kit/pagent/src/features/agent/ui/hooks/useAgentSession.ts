import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rpc } from '@/shared/extension/rpc-client';
import { conversationVaultKey } from '@/features/agent/session/vault';
import { DEFAULT_SETTINGS, type AgentSettings } from '@/shared/contracts/settings';
import type { PageConversation } from '@/shared/contracts/session';
import { startClientKeepAlive } from '@/shared/extension/keepalive';
import { usePageContext } from './usePageContext';
import { useBackgroundSessionSync } from './useBackgroundSessionSync';
import { useAgentEventConsumer } from './useAgentEventConsumer';
import { useConversationActions } from './useConversationActions';

const STORE_SAVE_DEBOUNCE_MS = 400;

export function useAgentSession() {
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const { page, clearSelection } = usePageContext();
  const vaultKey = conversationVaultKey(page.url) ?? undefined;

  const runningIdRef = useRef<string | null>(null);
  const activeIdRef = useRef('');
  const conversationsRef = useRef<PageConversation[]>([]);
  const pageUrlRef = useRef(page.url);
  const revisionRef = useRef(0);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const deletedConversationIdsRef = useRef(new Set<string>());
  const closedTabIdsRef = useRef(new Set<string>());
  const [closedTabIds, setClosedTabIds] = useState<Set<string>>(() => new Set());
  pageUrlRef.current = page.url;

  const sync = useBackgroundSessionSync(vaultKey, page.url, {
    runningIdRef,
    activeIdRef,
    conversationsRef,
    pageUrlRef,
    revisionRef,
    sessionIdRef,
  });

  activeIdRef.current = sync.activeId;
  conversationsRef.current = sync.conversations;
  revisionRef.current = sync.revision;
  sessionIdRef.current = sync.sessionId;

  const bumpRevision = useCallback(() => {
    const next = revisionRef.current + 1;
    revisionRef.current = next;
    sync.setRevision(next);
    return next;
  }, [sync.setRevision]);

  useEffect(() => {
    void rpc('settings.get', {}).then((value) => setSettings(value as AgentSettings));
  }, []);

  useEffect(() => {
    if (!sync.readyKey || runningIdRef.current) return;
    const timer = window.setTimeout(() => {
      void rpc('session.saveStore', {
        activeId: sync.activeId,
        conversations: sync.conversations,
        url: pageUrlRef.current,
        revision: sync.revision,
        sessionId: sync.sessionId,
        deletedConversationIds: [...deletedConversationIdsRef.current],
      }).catch(() => {});
    }, STORE_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [sync.readyKey, sync.activeId, sync.conversations, sync.revision, sync.sessionId]);

  useEffect(() => {
    if (!sync.workingOnThisPage) return;
    return startClientKeepAlive();
  }, [sync.workingOnThisPage]);

  useEffect(() => {
    const flush = () => {
      if (!sync.readyKey) return;
      void rpc('session.saveStore', {
        activeId: activeIdRef.current,
        conversations: conversationsRef.current,
        url: pageUrlRef.current,
        revision: revisionRef.current,
        sessionId: sessionIdRef.current,
        deletedConversationIds: [...deletedConversationIdsRef.current],
      });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [sync.readyKey]);

  useAgentEventConsumer({
    runningIdRef,
    revisionRef,
    sessionIdRef,
    conversationsRef,
    setConversations: sync.setConversations,
    setActiveId: sync.setActiveId,
    setRevision: sync.setRevision,
    setSessionId: sync.setSessionId,
    setWorkingOnThisPage: sync.setWorkingOnThisPage,
    setAgentActive: sync.setAgentActive,
  });

  const actions = useConversationActions({
    runningIdRef,
    activeIdRef,
    conversationsRef,
    pageUrlRef,
    revisionRef,
    sessionIdRef,
    deletedConversationIdsRef,
    closedTabIdsRef,
    setClosedTabIds,
    setConversations: sync.setConversations,
    setActiveId: sync.setActiveId,
    setRevision: sync.setRevision,
    setWorkingOnThisPage: sync.setWorkingOnThisPage,
    setAgentActive: sync.setAgentActive,
    setView,
    bumpRevision,
  });

  const active = sync.conversations.find((item) => item.id === sync.activeId) ?? sync.conversations[0];

  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => setSystemDark(media.matches);
    syncTheme();
    media.addEventListener('change', syncTheme);
    return () => media.removeEventListener('change', syncTheme);
  }, []);

  const themeClass = useMemo(() => {
    if (settings.theme === 'dark') return 'dark';
    if (settings.theme === 'light') return '';
    return systemDark ? 'dark' : '';
  }, [settings.theme, systemDark]);

  return {
    view,
    setView,
    settings,
    setSettings,
    conversations: sync.conversations,
    closedTabIds,
    activeId: active?.id ?? sync.activeId,
    messages: active?.messages ?? [],
    tasks: active?.tasks ?? [],
    running: Boolean(active?.running),
    thinking: active?.thinking ?? '',
    error: active?.error ?? '',
    startedAt: active?.startedAt,
    page,
    clearSelection,
    send: actions.send,
    stop: actions.stop,
    createConversation: actions.createConversation,
    openInitialConversation: actions.openInitialConversation,
    selectConversation: actions.selectConversation,
    closeTab: actions.closeTab,
    deleteConversation: actions.deleteConversation,
    themeClass,
    ready: Boolean(sync.readyKey),
    restorePanel: sync.restorePanel,
    attachKey: sync.attachKey,
    workingOnThisPage: sync.workingOnThisPage,
    agentActive: sync.agentActive,
  };
}
