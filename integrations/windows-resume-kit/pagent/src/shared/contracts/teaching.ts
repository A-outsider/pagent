export type TeachingStatus = 'recording' | 'summarizing' | 'reviewing' | 'confirmed';

export type RecordedActionKind =
  | 'click'
  | 'double_click'
  | 'input'
  | 'select'
  | 'keypress'
  | 'scroll'
  | 'navigate'
  | 'reload'
  | 'tab_switch'
  | 'tab_open'
  | 'tab_close'
  | 'comment';

export type RecordedTarget = {
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  selector?: string;
  inputType?: string;
  placeholder?: string;
  href?: string;
};

export type RecordedAction = {
  id: string;
  at: number;
  kind: RecordedActionKind;
  tabId?: number;
  page: { url: string; title?: string };
  target?: RecordedTarget;
  value?: string;
  redacted?: boolean;
  detail?: string;
};

export type FlowStep = {
  id: string;
  title: string;
  detail: string;
};

export type FlowDraft = {
  id: string;
  sessionId: string;
  conversationId?: string;
  name: string;
  key: string;
  purpose: string;
  prerequisites: string[];
  steps: FlowStep[];
  prompt: string;
  revision: number;
  updatedAt: number;
  lastRequest?: string;
};

export type SavedCommand = {
  id: string;
  vaultDomain: string;
  originUrl: string;
  name: string;
  key: string;
  desc: string;
  prompt: string;
  steps: FlowStep[];
  createdAt: number;
  updatedAt: number;
};

export type TeachingSession = {
  id: string;
  status: TeachingStatus;
  originTabId: number;
  originUrl: string;
  originDomain: string;
  conversationId?: string;
  tabIds: number[];
  actions: RecordedAction[];
  startedAt: number;
  updatedAt: number;
  draft?: FlowDraft;
  error?: string;
};

export type TeachingContext = {
  session: TeachingSession | null;
};
