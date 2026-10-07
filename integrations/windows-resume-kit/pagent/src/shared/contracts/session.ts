import type { ChatMessage, TaskRow } from './session-messages';

export type { ChatMessage, TaskRow, TaskStatus, ChatRole, ChatToolCall, AssistantPart, TurnUsage, UserBadge, UserReference, PageReference, CommandReference, ElementReference } from './session-messages';

export type PageConversation = {
  id: string;
  revision?: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  messages: ChatMessage[];
  tasks: TaskRow[];
  error: string;
  thinking: string;
  running: boolean;
  budget: { modelCalls: number; toolCalls: number };
  vaults: string[];
};

export type PageConversationStore = {
  activeId: string;
  conversations: PageConversation[];
  panelOpen?: boolean;
  sessionId?: string;
  revision?: number;
};

export type DomainVault = {
  domain: string;
  updatedAt: number;
  panelOpen?: boolean;
  activeId?: string;
  conversations: PageConversation[];
};

export type VaultMap = Record<string, DomainVault>;

export type ConversationSummary = {
  id: string;
  title: string;
  vaults: string[];
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
};

export type SessionContext = {
  tabId: number;
  sessionTabId?: number;
  sessionId?: string;
  revision?: number;
  running: boolean;
  agentActive?: boolean;
  conversationId?: string;
  panelOpen: boolean;
  store?: PageConversationStore | null;
};

export type Checkpoint = {
  tabId: number;
  sessionId?: string;
  updatedAt: number;
  running: boolean;
  prompt?: string;
  conversationId?: string;
  messages: ChatMessage[];
  tasks: TaskRow[];
  revision?: number;
  modelCalls: number;
  toolCalls: number;
};
