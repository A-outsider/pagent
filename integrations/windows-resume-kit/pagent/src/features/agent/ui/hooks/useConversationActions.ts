import { useCallback } from 'react';
import { rpc } from '@/shared/extension/rpc-client';
import {
  emptyConversation,
  isRecentConversation,
  latestRecentConversation,
  nextConversationTitle,
  settleFinishedConversation,
  titleFromPrompt,
} from '@/features/agent/session/conversations';
import { conversationVaultKey } from '@/features/agent/session/vault';
import type { PageConversation, UserBadge, UserReference } from '@/shared/contracts/session';
import { nowId } from '@/shared/utils/utils';
import { patchConversation } from './agent-session-reducer';

export function useConversationActions(options: {
  runningIdRef: React.MutableRefObject<string | null>;
  activeIdRef: React.MutableRefObject<string>;
  conversationsRef: React.MutableRefObject<PageConversation[]>;
  pageUrlRef: React.MutableRefObject<string>;
  revisionRef: React.MutableRefObject<number>;
  sessionIdRef: React.MutableRefObject<string | undefined>;
  deletedConversationIdsRef: React.MutableRefObject<Set<string>>;
  closedTabIdsRef: React.MutableRefObject<Set<string>>;
  setClosedTabIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setConversations: React.Dispatch<React.SetStateAction<PageConversation[]>>;
  setActiveId: React.Dispatch<React.SetStateAction<string>>;
  setRevision: React.Dispatch<React.SetStateAction<number>>;
  setWorkingOnThisPage: React.Dispatch<React.SetStateAction<boolean>>;
  setAgentActive: React.Dispatch<React.SetStateAction<boolean>>;
  setView: React.Dispatch<React.SetStateAction<'chat' | 'settings'>>;
  bumpRevision: () => number;
}) {
  const {
    runningIdRef,
    activeIdRef,
    conversationsRef,
    pageUrlRef,
    sessionIdRef,
    deletedConversationIdsRef,
    closedTabIdsRef,
    setClosedTabIds,
    setConversations,
    setActiveId,
    setWorkingOnThisPage,
    setAgentActive,
    setView,
    bumpRevision,
  } = options;

  const send = useCallback(async (
    prompt: string,
    context?: string,
    imageDataUrl?: string,
    badges?: UserBadge[],
    references?: UserReference[],
  ) => {
    const id = activeIdRef.current;
    runningIdRef.current = id;
    setWorkingOnThisPage(true);
    setAgentActive(true);
    setView('chat');
    const nextRevision = bumpRevision();
    const current = conversationsRef.current.find((item) => item.id === id);
    const history = current?.messages ?? [];
    const now = Date.now();
    const nextConversations = patchConversation(conversationsRef.current, id, (item) => ({
      ...item,
      error: '',
      running: true,
      thinking: '正在调用模型…',
      startedAt: item.startedAt ?? now,
      title: titleFromPrompt(item.title, prompt),
      messages: [
        ...item.messages,
        { id: nowId('m'), role: 'user', content: prompt, imageDataUrl, badges, references },
      ],
    }));
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    void rpc('session.saveStore', {
      activeId: id,
      conversations: nextConversations,
      url: pageUrlRef.current,
      revision: nextRevision,
      sessionId: sessionIdRef.current,
      deletedConversationIds: [...deletedConversationIdsRef.current],
    });
    await rpc('agent.start', {
      prompt,
      context,
      imageDataUrl,
      badges,
      references,
      conversationId: id,
      history,
    });
  }, [
    activeIdRef,
    bumpRevision,
    conversationsRef,
    deletedConversationIdsRef,
    pageUrlRef,
    runningIdRef,
    sessionIdRef,
    setAgentActive,
    setConversations,
    setView,
    setWorkingOnThisPage,
  ]);

  const stop = useCallback(async () => {
    // 本地立即结算，不等后台往返；后台会同步结算 store 并广播终止事件
    runningIdRef.current = null;
    setWorkingOnThisPage(false);
    setAgentActive(false);
    setConversations((current) =>
      current.map((item) => (item.running ? settleFinishedConversation(item) : item)),
    );
    await rpc('agent.stop', {});
  }, [runningIdRef, setAgentActive, setConversations, setWorkingOnThisPage]);

  const createConversation = useCallback(() => {
    const domain = conversationVaultKey(pageUrlRef.current);
    const nextRevision = bumpRevision();
    const current = conversationsRef.current;
    const next = emptyConversation(
      nextConversationTitle(current.map((item) => item.title)),
      domain ? [domain] : [],
    );
    const nextConversations = [...current, next];
    activeIdRef.current = next.id;
    conversationsRef.current = nextConversations;
    setActiveId(next.id);
    setConversations(nextConversations);
    setView('chat');
    void rpc('session.saveStore', {
      activeId: next.id,
      conversations: nextConversations,
      url: pageUrlRef.current,
      revision: nextRevision,
      sessionId: sessionIdRef.current,
      deletedConversationIds: [...deletedConversationIdsRef.current],
    }).catch(() => {});
  }, [activeIdRef, bumpRevision, conversationsRef, deletedConversationIdsRef, pageUrlRef, sessionIdRef, setActiveId, setConversations, setView]);

  const openInitialConversation = useCallback(async () => {
    const current = conversationsRef.current;
    const recent = latestRecentConversation(current);
    const nextClosedTabIds = new Set(
      current.filter((item) => item.id !== recent?.id).map((item) => item.id),
    );
    closedTabIdsRef.current = nextClosedTabIds;
    setClosedTabIds(nextClosedTabIds);
    if (!recent) {
      await createConversation();
      return;
    }
    bumpRevision();
    activeIdRef.current = recent.id;
    setActiveId(recent.id);
    setView('chat');
  }, [
    activeIdRef,
    bumpRevision,
    closedTabIdsRef,
    conversationsRef,
    createConversation,
    setActiveId,
    setClosedTabIds,
    setView,
  ]);

  const selectConversation = useCallback(
    (id: string) => {
      bumpRevision();
      setActiveId(id);
      setView('chat');
      // 从历史中打开一个已关闭的标签页 → 重新打开
      if (closedTabIdsRef.current.has(id)) {
        const next = new Set(closedTabIdsRef.current);
        next.delete(id);
        closedTabIdsRef.current = next;
        setClosedTabIds(next);
      }
      // 从历史中打开的旧会话也视为"打开"的标签页：触碰 updatedAt 使其进入最近窗口
      setConversations((current) =>
        current.some((item) => item.id === id && isRecentConversation(item))
          ? current
          : current.map((item) =>
              item.id === id ? { ...item, updatedAt: Date.now() } : item,
            ),
      );
    },
    [bumpRevision, closedTabIdsRef, setActiveId, setClosedTabIds, setConversations, setView],
  );

  /** 关闭标签页：仅从标签栏隐藏会话，不删除历史；关闭当前标签时切换到其他打开的标签页 */
  const closeTab = useCallback(
    (id: string) => {
      const openTabs = () =>
        conversationsRef.current.filter(
          (item) => item.id !== id && isRecentConversation(item) && !closedTabIdsRef.current.has(item.id),
        );
      if (id === activeIdRef.current) {
        const remaining = openTabs();
        if (remaining.length > 0) {
          const nextId = remaining.at(-1)!.id;
          bumpRevision();
          activeIdRef.current = nextId;
          setActiveId(nextId);
          setView('chat');
        } else {
          // 没有其他打开的标签页：保留至少一个会话标签，像浏览器一样新建一个
          void createConversation();
        }
      }
      const next = new Set(closedTabIdsRef.current);
      next.add(id);
      closedTabIdsRef.current = next;
      setClosedTabIds(next);
    },
    [
      activeIdRef,
      bumpRevision,
      closedTabIdsRef,
      conversationsRef,
      createConversation,
      setActiveId,
      setClosedTabIds,
      setView,
    ],
  );

  /** 删除会话：从存储与历史中彻底移除 */
  const deleteConversation = useCallback(
    (id: string) => {
      bumpRevision();
      deletedConversationIdsRef.current.add(id);
      closedTabIdsRef.current.delete(id);
      setClosedTabIds(new Set(closedTabIdsRef.current));
      setConversations((current) => {
        if (current.length <= 1) {
          const domain = conversationVaultKey(pageUrlRef.current);
          const reset = emptyConversation('会话 1', domain ? [domain] : []);
          setActiveId(reset.id);
          setView('chat');
          return [reset];
        }
        const next = current.filter((item) => item.id !== id);
        if (activeIdRef.current === id) {
          setActiveId(next.at(-1)!.id);
          setView('chat');
        }
        return next;
      });
    },
    [activeIdRef, bumpRevision, closedTabIdsRef, deletedConversationIdsRef, pageUrlRef, setActiveId, setClosedTabIds, setConversations, setView],
  );

  return {
    send,
    stop,
    createConversation,
    openInitialConversation,
    selectConversation,
    closeTab,
    deleteConversation,
  };
}
