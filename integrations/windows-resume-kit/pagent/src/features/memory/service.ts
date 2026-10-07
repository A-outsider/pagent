import { embedTexts } from './api';
import { deleteMemory, getMemory, listMemoriesForDomain, putMemory } from './storage';
import { embeddingFingerprint, searchMemories, vectorBuffer } from './retrieval';
import { memoryView, type MemoryScope, type MemoryView } from '@/shared/contracts/memory';
import { redactText, sanitizeUrl } from '@/shared/contracts/policy';
import { conversationVaultKey } from '@/features/agent/session/vault';
import {
  loadMemorySecret,
  loadSettings,
} from '@/shared/storage/storage';
import { nowId } from '@/shared/utils/utils';

function domainOf(url?: string | null): string | null {
  return url ? conversationVaultKey(url) : null;
}

function assertVisible(memory: { scope: MemoryScope; domain?: string }, domain: string | null): void {
  if (memory.scope === 'local' && memory.domain !== domain) {
    throw new Error('不能访问其他域名的局部记忆');
  }
}

export async function queryMemory(query: string, url?: string | null, limit?: number) {
  const settings = await loadSettings();
  return searchMemories({
    query,
    domain: domainOf(url),
    settings: settings.memory,
    apiKey: await loadMemorySecret(),
    limit,
  });
}

export async function writeMemory(options: {
  content: string;
  scope: MemoryScope;
  url?: string | null;
  memoryId?: string;
}): Promise<MemoryView> {
  const content = redactText(options.content.trim());
  if (!content) throw new Error('记忆内容不能为空');
  const domain = domainOf(options.url);
  if (options.scope === 'local' && !domain) throw new Error('当前页面没有可用的 HTTP(S) 域名');
  const existing = options.memoryId ? await getMemory(options.memoryId) : null;
  if (options.memoryId && !existing) throw new Error(`记忆不存在：${options.memoryId}`);
  if (existing) assertVisible(existing, domain);

  const settings = await loadSettings();
  if (!settings.memory.enabled) throw new Error('Memory RAG 已在设置中关闭');
  const [embedding] = await embedTexts(
    settings.memory,
    await loadMemorySecret(),
    [content],
    'retrieval.passage',
  );
  const now = Date.now();
  const record = {
    id: existing?.id ?? nowId('mem'),
    content,
    scope: options.scope,
    domain: options.scope === 'local' ? domain! : undefined,
    sourceUrl: options.scope === 'local' && options.url ? sanitizeUrl(options.url) : undefined,
    embedding: vectorBuffer(embedding!),
    embeddingModel: embeddingFingerprint(settings.memory),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await putMemory(record);
  return memoryView(record);
}

export async function updateMemoryContent(
  id: string,
  content: string,
  url?: string | null,
): Promise<MemoryView> {
  const existing = await getMemory(id);
  if (!existing) throw new Error(`记忆不存在：${id}`);
  assertVisible(existing, domainOf(url));
  return writeMemory({ content, scope: existing.scope, url, memoryId: id });
}

export async function removeMemory(id: string, url?: string | null): Promise<void> {
  const existing = await getMemory(id);
  if (!existing) return;
  assertVisible(existing, domainOf(url));
  await deleteMemory(id);
}

export async function memoryViewsForPage(url?: string | null): Promise<{
  domain: string | null;
  global: MemoryView[];
  local: MemoryView[];
}> {
  const domain = domainOf(url);
  const memories = await listMemoriesForDomain(domain);
  return {
    domain,
    global: memories.filter((item) => item.scope === 'global').map(memoryView),
    local: memories.filter((item) => item.scope === 'local').map(memoryView),
  };
}

export async function testMemoryConnection(): Promise<{ dimensions: number }> {
  const settings = await loadSettings();
  const [embedding] = await embedTexts(
    settings.memory,
    await loadMemorySecret(),
    ['Pagent memory connection test'],
    'retrieval.query',
  );
  return { dimensions: embedding?.length ?? 0 };
}
