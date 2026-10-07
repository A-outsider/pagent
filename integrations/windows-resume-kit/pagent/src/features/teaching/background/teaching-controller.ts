import type {
  RecordedAction,
  RecordedActionKind,
  SavedCommand,
  TeachingSession,
} from '@/shared/contracts/teaching';
import { conversationVaultKey } from '@/features/agent/session/vault';
import { redactText } from '@/shared/contracts/policy';
import {
  clearTeachingSession,
  loadCommands,
  loadTeachingSession,
  saveCommand,
  saveTeachingSession,
} from '../storage';
import { commandKey, reviseFlow, summarizeTeaching } from './flow-summarizer';

let writeQueue: Promise<unknown> = Promise.resolve();

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safePage(page: { url: string; title?: string }): { url: string; title?: string } {
  let url = page.url;
  try {
    const parsed = new URL(page.url);
    parsed.username = '';
    parsed.password = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/(token|secret|password|passwd|key|auth|code|session|email)/i.test(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    url = parsed.toString();
  } catch {
    url = redactText(page.url);
  }
  return { url, title: page.title ? redactText(page.title) : undefined };
}

function locked<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function teachingContext(): Promise<TeachingSession | null> {
  return loadTeachingSession();
}

export async function startTeaching(input: {
  tabId: number;
  url: string;
  conversationId?: string;
}): Promise<TeachingSession> {
  const domain = conversationVaultKey(input.url);
  if (!domain) throw new Error('当前页面不支持示教');
  return locked(async () => {
    const current = await loadTeachingSession();
    if (current && current.status !== 'confirmed') {
      throw new Error('已有示教正在进行，请先结束或取消');
    }
    const now = Date.now();
    const originUrl = safePage({ url: input.url }).url;
    const session: TeachingSession = {
      id: id('teach'),
      status: 'recording',
      originTabId: input.tabId,
      originUrl,
      originDomain: domain,
      conversationId: input.conversationId,
      tabIds: [input.tabId],
      actions: [],
      startedAt: now,
      updatedAt: now,
    };
    await saveTeachingSession(session);
    return session;
  });
}

export async function appendTeachingActions(actions: RecordedAction[]): Promise<TeachingSession | null> {
  if (!actions.length) return loadTeachingSession();
  return locked(async () => {
    const session = await loadTeachingSession();
    if (!session || session.status !== 'recording') return session;
    const known = new Set(session.actions.map((item) => item.id));
    const additions = actions.filter((item) => !known.has(item.id));
    if (!additions.length) return session;
    const tabIds = new Set(session.tabIds);
    additions.forEach((item) => {
      if (item.tabId != null) tabIds.add(item.tabId);
    });
    const next = {
      ...session,
      tabIds: [...tabIds],
      actions: [...session.actions, ...additions].slice(-2000),
      updatedAt: Date.now(),
    };
    await saveTeachingSession(next);
    return next;
  });
}

export async function recordBrowserAction(
  kind: RecordedActionKind,
  tabId: number,
  page: { url: string; title?: string },
  detail?: string,
): Promise<void> {
  const session = await loadTeachingSession();
  if (!session || session.status !== 'recording') return;
  await appendTeachingActions([{
    id: id('action'),
    at: Date.now(),
    kind,
    tabId,
    page: safePage(page),
    detail,
  }]);
}

export async function finishTeaching(): Promise<TeachingSession> {
  const session = await locked(async () => {
    const current = await loadTeachingSession();
    if (!current) throw new Error('没有正在进行的示教');
    if (current.status !== 'recording') return current;
    const next: TeachingSession = { ...current, status: 'summarizing', updatedAt: Date.now() };
    await saveTeachingSession(next);
    return next;
  });
  if (session.status !== 'summarizing') return session;
  try {
    const draft = await summarizeTeaching(session);
    const next: TeachingSession = {
      ...session,
      status: 'reviewing',
      draft,
      updatedAt: Date.now(),
    };
    await saveTeachingSession(next);
    return next;
  } catch (error) {
    const next: TeachingSession = {
      ...session,
      status: 'reviewing',
      error: error instanceof Error ? error.message : '流程总结失败',
      updatedAt: Date.now(),
    };
    await saveTeachingSession(next);
    return next;
  }
}

export async function reviseTeaching(request: string): Promise<TeachingSession> {
  const session = await loadTeachingSession();
  if (!session?.draft || session.status !== 'reviewing') throw new Error('没有待修改的流程总结');
  const draft = await reviseFlow(session.draft, request);
  const next = { ...session, draft, error: undefined, updatedAt: Date.now() };
  await saveTeachingSession(next);
  return next;
}

function uniqueKey(wanted: string, commands: SavedCommand[]): string {
  const base = commandKey(wanted);
  const used = new Set(commands.map((item) => item.key));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export async function confirmTeaching(): Promise<SavedCommand> {
  const session = await loadTeachingSession();
  if (!session?.draft || session.status !== 'reviewing') throw new Error('没有可确认的流程');
  const commands = await loadCommands(session.originDomain);
  const now = Date.now();
  const command: SavedCommand = {
    id: id('command'),
    vaultDomain: session.originDomain,
    originUrl: session.originUrl,
    name: session.draft.name,
    key: uniqueKey(session.draft.key, commands),
    desc: session.draft.purpose,
    prompt: session.draft.prompt,
    steps: session.draft.steps,
    createdAt: now,
    updatedAt: now,
  };
  await saveCommand(command);
  await clearTeachingSession();
  return command;
}

export async function cancelTeaching(): Promise<void> {
  await clearTeachingSession();
}
