import { useEffect, useState } from 'react';
import { rpc } from '@/shared/extension/rpc-client';
import {
  conversationTabKey,
  createPageStore,
  mergeConversationStores,
  normalizePageStore,
  restoreConversationStore,
  settleFinishedConversation,
} from '@/features/agent/session/conversations';
import {
  SESSION_ACTIVE_POLL_MS,
  SESSION_HIDDEN_POLL_MS,
  SESSION_IDLE_POLL_MS,
  sessionIsOnTab,
  shouldRestoreLiveSession,
} from '@/features/agent/session/session-live';
import type { PageConversation, SessionContext } from '@/shared/contracts/session';

export type SessionSyncState = {
  conversations: PageConversation[];
  activeId: string;
  revision: number;
  sessionId?: string;
  readyKey: string | null;
  restorePanel: boolean;
  attachKey: number;
  workingOnThisPage: boolean;
  agentActive: boolean;
};

export type SessionSyncRefs = {
  runningIdRef: React.MutableRefObject<string | null>;
  activeIdRef: React.MutableRefObject<string>;
  conversationsRef: React.MutableRefObject<PageConversation[]>;
  pageUrlRef: React.MutableRefObject<string>;
  revisionRef: React.MutableRefObject<number>;
  sessionIdRef: React.MutableRefObject<string | undefined>;
};

export function useBackgroundSessionSync(
  vaultKey: string | undefined,
  pageUrl: string,
  refs: SessionSyncRefs,
) {
  const [conversations, setConversations] = useState<PageConversation[]>(() =>
    createPageStore(vaultKey).conversations,
  );
  const [activeId, setActiveId] = useState(() => createPageStore(vaultKey).activeId);
  const [revision, setRevision] = useState(() => createPageStore(vaultKey).revision ?? 0);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [restorePanel, setRestorePanel] = useState(false);
  const [attachKey, setAttachKey] = useState(0);
  const [workingOnThisPage, setWorkingOnThisPage] = useState(false);
  const [agentActive, setAgentActive] = useState(false);

  refs.activeIdRef.current = activeId;
  refs.conversationsRef.current = conversations;
  refs.pageUrlRef.current = pageUrl;
  refs.revisionRef.current = revision;
  refs.sessionIdRef.current = sessionId;

  useEffect(() => {
    let cancelled = false;
    let hydrated = false;
    let pulling = false;
    let timer: number | undefined;

    const applyContext = (context: SessionContext, initial: boolean) => {
      const onThisPage = sessionIsOnTab(context);
      setWorkingOnThisPage(onThisPage);
      setAgentActive(Boolean(context.agentActive ?? context.running));
      const contextRevision = context.store?.revision ?? context.revision ?? 0;

      if (
        shouldRestoreLiveSession({
          alreadyAttached: Boolean(refs.runningIdRef.current),
          attachedConversationId: refs.runningIdRef.current ?? undefined,
          context,
        })
      ) {
        const incoming = restoreConversationStore(normalizePageStore(context.store, vaultKey), {
          running: true,
          conversationId: context.conversationId,
        });
        const local = {
          activeId: refs.activeIdRef.current,
          conversations: refs.conversationsRef.current,
        };
        const next = hydrated ? mergeConversationStores(local, incoming) : incoming;
        refs.runningIdRef.current = next.activeId;
        refs.revisionRef.current = contextRevision;
        refs.sessionIdRef.current = context.sessionId ?? context.store?.sessionId;
        setConversations(next.conversations);
        setActiveId(next.activeId);
        setRevision(contextRevision);
        setSessionId(refs.sessionIdRef.current);
        setRestorePanel(true);
        if (!initial) setAttachKey((value) => value + 1);
        setReadyKey(`${conversationTabKey(context.tabId)}:${vaultKey ?? 'unknown'}`);
        hydrated = true;
        return;
      }

      if (hydrated && context.store && contextRevision > refs.revisionRef.current) {
        const next = restoreConversationStore(normalizePageStore(context.store, vaultKey), {
          running: context.running,
          conversationId: context.conversationId,
        });
        refs.revisionRef.current = contextRevision;
        refs.sessionIdRef.current = context.sessionId ?? context.store.sessionId;
        if (context.running) refs.runningIdRef.current = next.activeId;
        setConversations(next.conversations);
        setActiveId(next.activeId);
        setRevision(contextRevision);
        setSessionId(refs.sessionIdRef.current);
        return;
      }

      if (!context.running && refs.runningIdRef.current) {
        refs.runningIdRef.current = null;
        setConversations((current) =>
          current.map((item) => (item.running ? settleFinishedConversation(item) : item)),
        );
      }

      if (!hydrated) {
        const next = restoreConversationStore(normalizePageStore(context.store, vaultKey), {
          running: context.running,
          conversationId: context.conversationId,
        });
        if (context.running) refs.runningIdRef.current = next.activeId;
        refs.revisionRef.current = contextRevision;
        refs.sessionIdRef.current = context.sessionId ?? context.store?.sessionId;
        setConversations(next.conversations);
        setActiveId(next.activeId);
        setRevision(contextRevision);
        setSessionId(refs.sessionIdRef.current);
        setRestorePanel(Boolean(context.panelOpen || context.running));
        setReadyKey(`${conversationTabKey(context.tabId)}:${vaultKey ?? 'unknown'}`);
        hydrated = true;
      }
    };

    const pull = async (initial: boolean) => {
      if (pulling) return;
      pulling = true;
      try {
        const value = await rpc('session.context', { url: refs.pageUrlRef.current });
        if (cancelled) return;
        applyContext(value as SessionContext, initial);
      } catch {
        // background may be restarting
      } finally {
        pulling = false;
      }
    };

    const schedule = () => {
      if (cancelled) return;
      const delay =
        document.visibilityState !== 'visible'
          ? SESSION_HIDDEN_POLL_MS
          : refs.runningIdRef.current
            ? SESSION_ACTIVE_POLL_MS
            : SESSION_IDLE_POLL_MS;
      timer = window.setTimeout(async () => {
        await pull(false);
        schedule();
      }, delay);
    };

    void pull(true);
    schedule();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer != null) window.clearTimeout(timer);
      void pull(false).finally(schedule);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [vaultKey]);

  return {
    conversations,
    setConversations,
    activeId,
    setActiveId,
    revision,
    setRevision,
    sessionId,
    setSessionId,
    readyKey,
    restorePanel,
    attachKey,
    workingOnThisPage,
    setWorkingOnThisPage,
    agentActive,
    setAgentActive,
  };
}
