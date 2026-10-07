import { mergeConversationStores, settleFinishedConversation } from './conversations';
import {
  applyAssistantFinalText,
  applyAssistantThinking,
  applyAssistantToken,
  applyAssistantToolResult,
  applyAssistantToolStart,
  applyAssistantUsage,
} from './messages';
import type { AgentEvent } from '@/shared/contracts/agent';
import type { PageConversation, PageConversationStore, SessionContext } from '@/shared/contracts/session';
import { nowId } from '@/shared/utils/utils';

export const SESSION_ACTIVE_POLL_MS = 2_000;
export const SESSION_IDLE_POLL_MS = 15_000;
export const SESSION_HIDDEN_POLL_MS = 60_000;

export function sessionIsOnTab(
  context: Pick<SessionContext, 'tabId' | 'running'> & { sessionTabId?: number },
): boolean {
  if (!context.running) return false;
  return (context.sessionTabId ?? context.tabId) === context.tabId;
}

export function shouldRestoreLiveSession(input: {
  alreadyAttached: boolean;
  attachedConversationId?: string;
  context: Pick<SessionContext, 'tabId' | 'running' | 'conversationId'> & { sessionTabId?: number };
}): boolean {
  if (!sessionIsOnTab(input.context) || !input.context.conversationId) return false;
  if (!input.alreadyAttached) return true;
  return input.attachedConversationId !== input.context.conversationId;
}

export function adoptLiveStore(
  destination: PageConversationStore | null | undefined,
  live: PageConversationStore,
  conversationId?: string,
): PageConversationStore {
  const merged = mergeConversationStores(destination, { ...live, panelOpen: true });
  const activeId =
    conversationId && merged.conversations.some((item) => item.id === conversationId)
      ? conversationId
      : merged.activeId;
  return { ...merged, activeId, panelOpen: true };
}

function lastAssistantId(item: PageConversation): string | undefined {
  return [...item.messages].reverse().find((message) => message.role === 'assistant')?.id;
}

export function nextStoreRevision(store: PageConversationStore | null | undefined): number {
  return (store?.revision ?? 0) + 1;
}

export function applyAgentEventToStore(
  store: PageConversationStore,
  conversationId: string,
  event: AgentEvent,
): PageConversationStore {
  const revision = nextStoreRevision(store);
  const conversations = store.conversations.map((item) => {
    if (item.id !== conversationId) return item;
    let next = item;
    if (event.type === 'token') {
      next = { ...item, messages: applyAssistantToken(item.messages, event.text, nowId('m')) };
    } else if (event.type === 'reasoning') {
      next = {
        ...item,
        thinking: '正在思考…',
        messages: applyAssistantThinking(item.messages, event.text, nowId('m')),
      };
    } else if (event.type === 'thinking' || event.type === 'status') {
      next = { ...item, thinking: event.text };
    } else if (event.type === 'tool-start') {
      const detail =
        event.args == null
          ? undefined
          : typeof event.args === 'string'
            ? event.args
            : JSON.stringify(event.args);
      const task = {
        id: event.id,
        title: event.name,
        detail: detail && detail !== '{}' && detail !== '[]' ? detail : undefined,
        status: 'running' as const,
      };
      next = {
        ...item,
        messages: applyAssistantToolStart(
          item.messages,
          { id: event.id, name: event.name, args: event.args, status: 'running' },
          nowId('m'),
        ),
        tasks: item.tasks.some((current) => current.id === event.id)
          ? item.tasks.map((current) => (current.id === event.id ? { ...current, ...task } : current))
          : [...item.tasks, task],
      };
    } else if (event.type === 'tool-end' || event.type === 'tool-error') {
      const status = event.type === 'tool-end' ? 'done' : 'error';
      next = {
        ...item,
        messages: applyAssistantToolResult(item.messages, event.id, status, event.output, event.elapsedMs),
        tasks: item.tasks.map((task) =>
          task.id === event.id ? { ...task, status, detail: event.output } : task,
        ),
      };
    } else if (event.type === 'budget') {
      next = { ...item, budget: { modelCalls: event.modelCalls, toolCalls: event.toolCalls } };
    } else if (event.type === 'message') {
      next = {
        ...item,
        messages: applyAssistantFinalText(
          item.messages,
          event.content,
          lastAssistantId(item) ?? nowId('m'),
        ),
      };
    } else if (event.type === 'usage') {
      next = {
        ...item,
        messages: applyAssistantUsage(item.messages, event.usage, lastAssistantId(item) ?? nowId('m')),
      };
    } else if (event.type === 'error') {
      next = { ...settleFinishedConversation(item), error: event.message };
    } else if (event.type === 'done') {
      next = settleFinishedConversation(item);
    }
    return {
      ...next,
      revision: (item.revision ?? 0) + 1,
      updatedAt: Date.now(),
    };
  });
  return { ...store, conversations, revision };
}
