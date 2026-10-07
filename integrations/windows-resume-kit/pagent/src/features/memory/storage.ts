import { idbDelete, idbGet, idbGetAll, idbSet, SESSION_STORES } from '@/shared/storage/idb';
import type { MemoryRecord } from '@/shared/contracts/memory';

let memoryWrite: Promise<unknown> = Promise.resolve();

function withMemoryLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = memoryWrite.then(fn, fn);
  memoryWrite = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function getMemory(id: string): Promise<MemoryRecord | null> {
  return (await idbGet<MemoryRecord>(SESSION_STORES.memories, id)) ?? null;
}

export async function listMemories(): Promise<MemoryRecord[]> {
  return Object.values(await idbGetAll<MemoryRecord>(SESSION_STORES.memories)).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export async function listMemoriesForDomain(domain?: string | null): Promise<MemoryRecord[]> {
  const records = await listMemories();
  return records.filter(
    (record) => record.scope === 'global' || (Boolean(domain) && record.domain === domain),
  );
}

export async function putMemory(record: MemoryRecord): Promise<void> {
  await withMemoryLock(() => idbSet(SESSION_STORES.memories, record.id, record));
}

export async function putMemories(records: MemoryRecord[]): Promise<void> {
  if (!records.length) return;
  await withMemoryLock(async () => {
    for (const record of records) {
      await idbSet(SESSION_STORES.memories, record.id, record);
    }
  });
}

export async function deleteMemory(id: string): Promise<void> {
  await withMemoryLock(() => idbDelete(SESSION_STORES.memories, id));
}

export function resetMemoryStorageForTests(): void {
  memoryWrite = Promise.resolve();
}
