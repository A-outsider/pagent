export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export type TaskRow = {
  id: string;
  title: string;
  detail?: string;
  status: TaskStatus;
};

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatToolCall = {
  id: string;
  name: string;
  args?: unknown;
  output?: string;
  status: TaskStatus;
  /** 从任务开始到本次调用结束的累计耗时（毫秒）。 */
  elapsedMs?: number;
};

export type AssistantTextPart = { type: 'text'; text: string };
export type AssistantThinkingPart = { type: 'thinking'; text: string };
export type AssistantToolPart = { type: 'tool' } & ChatToolCall;
export type AssistantPart = AssistantTextPart | AssistantThinkingPart | AssistantToolPart;

export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens?: number;
  durationMs: number;
  startedAt?: number;
  modelCalls: number;
  toolCalls: number;
};

export type UserBadge =
  | { type: 'tab'; id: number; title: string }
  | { type: 'command'; key: string; name: string }
  | { type: 'element'; name?: string; tag?: string };

export type PageReference = {
  type: 'page';
  tabId: number;
  title: string;
  url: string;
  active?: boolean;
  content?: string;
  truncated?: boolean;
  error?: string;
};

export type CommandReference = {
  type: 'command';
  key: string;
  name: string;
  desc?: string;
  prompt: string;
};

export type ElementReference = {
  type: 'element';
  name?: string;
  tag?: string;
  element?: unknown;
};

export type UserReference = PageReference | CommandReference | ElementReference;

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  imageDataUrl?: string;
  badges?: UserBadge[];
  references?: UserReference[];
  thinking?: string;
  tools?: ChatToolCall[];
  parts?: AssistantPart[];
  usage?: TurnUsage;
};
