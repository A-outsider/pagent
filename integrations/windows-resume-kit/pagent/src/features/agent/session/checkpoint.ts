import { checkpointsItem } from '@/shared/storage/storage';
import type { ChatMessage, Checkpoint, TaskRow } from '@/shared/contracts/session';

let checkpointWrite: Promise<unknown> = Promise.resolve();

export function checkpointKey(value: Pick<Checkpoint, 'tabId' | 'conversationId' | 'sessionId'>): string {
  if (value.sessionId) return value.sessionId;
  return value.conversationId ? `${value.tabId}:${value.conversationId}` : `${value.tabId}:active`;
}

export async function saveCheckpoint(partial: Checkpoint): Promise<Checkpoint> {
  const next: Checkpoint = {
    ...partial,
    updatedAt: Date.now(),
  };
  const write = checkpointWrite.then(async () => {
    const all = await checkpointsItem.getValue();
    all[checkpointKey(next)] = next;
    await checkpointsItem.setValue(all);
  });
  checkpointWrite = write.catch(() => undefined);
  await write;
  return next;
}

export async function loadCheckpoint(): Promise<Checkpoint | null> {
  const all = await checkpointsItem.getValue();
  return Object.values(all).sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

export async function loadCheckpoints(): Promise<Record<string, Checkpoint>> {
  return checkpointsItem.getValue();
}

export async function clearCheckpoint(key?: string): Promise<void> {
  const write = checkpointWrite.then(async () => {
    if (key) {
      const all = await checkpointsItem.getValue();
      delete all[key];
      await checkpointsItem.setValue(all);
    } else {
      await checkpointsItem.setValue({});
    }
  });
  checkpointWrite = write.catch(() => undefined);
  await write;
}

export function upsertAssistantMessage(
  messages: ChatMessage[],
  content: string,
  extras: Partial<ChatMessage> = {},
): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role === 'assistant') {
    return messages.map((item, index) =>
      index === messages.length - 1 ? { ...item, content, ...extras } : item,
    );
  }
  return [...messages, { id: `m_${Date.now()}`, role: 'assistant', content, ...extras }];
}

export function upsertTask(tasks: TaskRow[], task: TaskRow): TaskRow[] {
  const index = tasks.findIndex((item) => item.id === task.id);
  if (index === -1) return [...tasks, task];
  return tasks.map((item) => (item.id === task.id ? { ...item, ...task } : item));
}
