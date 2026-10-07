import { useEffect } from 'react';
import { CHANNEL } from '@/shared/contracts/channel';
import type { AgentEvent } from '@/shared/contracts/agent';
import type { PageConversationStore } from '@/shared/contracts/session';
import { settleFinishedConversation } from '@/features/agent/session/conversations';
import {
  applyAgentEventToConversations,
  applyStreamPending,
  type StreamPending,
} from './agent-session-reducer';

const STREAM_RENDER_INTERVAL_MS = 50;

export function useAgentEventConsumer(options: {
  runningIdRef: React.MutableRefObject<string | null>;
  revisionRef: React.MutableRefObject<number>;
  sessionIdRef: React.MutableRefObject<string | undefined>;
  conversationsRef: React.MutableRefObject<import('@/shared/contracts/session').PageConversation[]>;
  setConversations: React.Dispatch<
    React.SetStateAction<import('@/shared/contracts/session').PageConversation[]>
  >;
  setActiveId: React.Dispatch<React.SetStateAction<string>>;
  setRevision: React.Dispatch<React.SetStateAction<number>>;
  setSessionId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setWorkingOnThisPage: React.Dispatch<React.SetStateAction<boolean>>;
  setAgentActive: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const {
    runningIdRef,
    revisionRef,
    sessionIdRef,
    conversationsRef,
    setConversations,
    setActiveId,
    setRevision,
    setSessionId,
    setWorkingOnThisPage,
    setAgentActive,
  } = options;

  useEffect(() => {
    let streamTimer: number | undefined;
    let pendingStream: StreamPending | undefined;

    const flushPendingStream = () => {
      if (streamTimer != null) {
        window.clearTimeout(streamTimer);
        streamTimer = undefined;
      }
      const pending = pendingStream;
      pendingStream = undefined;
      if (!pending) return;
      setConversations((current) => applyStreamPending(current, pending));
    };

    const scheduleFlush = () => {
      if (streamTimer == null) {
        streamTimer = window.setTimeout(flushPendingStream, STREAM_RENDER_INTERVAL_MS);
      }
    };

    const ensurePending = (targetId: string) => {
      if (pendingStream && pendingStream.targetId !== targetId) flushPendingStream();
      pendingStream ??= { targetId, token: '', reasoning: '', tools: [] };
      return pendingStream;
    };

    const enqueueStream = (targetId: string, type: 'token' | 'reasoning', text: string) => {
      const pending = ensurePending(targetId);
      pending[type] += text;
      scheduleFlush();
    };

    const enqueueToolStart = (targetId: string, event: Extract<AgentEvent, { type: 'tool-start' }>) => {
      const pending = ensurePending(targetId);
      const index = pending.tools.findIndex((item) => item.id === event.id);
      if (index >= 0) pending.tools[index] = event;
      else pending.tools.push(event);
      scheduleFlush();
    };

    const onMessage = (message: {
      channel?: string;
      kind?: string;
      event?: AgentEvent;
      revision?: number;
      sessionId?: string;
      conversationId?: string;
      store?: PageConversationStore;
      working?: boolean;
      agentActive?: boolean;
    }) => {
      if (message.channel !== CHANNEL) return;
      if (message.kind === 'agent-retarget') {
        flushPendingStream();
        if (message.working === false) {
          runningIdRef.current = null;
          setWorkingOnThisPage(false);
          setAgentActive(Boolean(message.agentActive));
        }
        return;
      }
      if (message.kind !== 'agent-event' || !message.event) return;
      const event = message.event;
      const targetId = runningIdRef.current;
      if ((event.type === 'token' || event.type === 'reasoning') && targetId) {
        enqueueStream(targetId, event.type, event.text);
        return;
      }
      if (event.type === 'tool-start' && targetId) {
        enqueueToolStart(targetId, event);
        return;
      }
      flushPendingStream();
      if (event.type === 'error' || event.type === 'done') {
        runningIdRef.current = null;
      }
      if (message.store && (message.revision ?? 0) > revisionRef.current) {
        const incoming = message.store;
        revisionRef.current = incoming.revision ?? message.revision ?? 0;
        sessionIdRef.current = message.sessionId ?? incoming.sessionId;
        runningIdRef.current = message.conversationId ?? incoming.activeId;
        conversationsRef.current = incoming.conversations;
        setConversations(incoming.conversations);
        setActiveId(incoming.activeId);
        setRevision(revisionRef.current);
        setSessionId(sessionIdRef.current);
        const liveHere = incoming.conversations.some(
          (item) => item.id === runningIdRef.current && item.running,
        );
        setWorkingOnThisPage(liveHere);
        setAgentActive(liveHere);
        return;
      }
      if (!targetId) return;

      if (event.type === 'error') {
        runningIdRef.current = null;
        setWorkingOnThisPage(false);
        setAgentActive(false);
        setConversations((current) =>
          current.map((item) =>
            item.id === targetId
              ? { ...settleFinishedConversation(item), error: event.message }
              : item,
          ),
        );
        return;
      }
      if (event.type === 'done') {
        runningIdRef.current = null;
        setWorkingOnThisPage(false);
        setAgentActive(false);
        setConversations((current) =>
          current.map((item) => (item.id === targetId ? settleFinishedConversation(item) : item)),
        );
        return;
      }

      setConversations((current) => applyAgentEventToConversations(current, targetId, event));
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      if (streamTimer != null) window.clearTimeout(streamTimer);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, [
    runningIdRef,
    revisionRef,
    sessionIdRef,
    conversationsRef,
    setConversations,
    setActiveId,
    setRevision,
    setSessionId,
    setWorkingOnThisPage,
    setAgentActive,
  ]);
}
