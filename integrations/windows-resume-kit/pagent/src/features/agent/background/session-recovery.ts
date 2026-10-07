import { checkpointKey, clearCheckpoint, loadCheckpoints } from '@/features/agent/session/checkpoint';
import {
  createPageStore,
  emptyConversation,
} from '@/features/agent/session/conversations';
import { nextStoreRevision } from '@/features/agent/session/session-live';
import { conversationVaultKey } from '@/features/agent/session/vault';
import { readTabStore, resolveTabUrl, tabDomains, writeTabStore } from './tab-store';

export async function recoverInterruptedSessions(): Promise<void> {
  const checkpoints = await loadCheckpoints();
  for (const [key, checkpoint] of Object.entries(checkpoints)) {
    if (!checkpoint.running) {
      await clearCheckpoint(key);
      continue;
    }
    const current =
      (await readTabStore(checkpoint.tabId)) ??
      createPageStore(conversationVaultKey((await resolveTabUrl(checkpoint.tabId)) ?? '') ?? undefined);
    const conversationId = checkpoint.conversationId ?? current.activeId;
    let found = false;
    const conversations = current.conversations.map((item) => {
      if (item.id !== conversationId) return item;
      found = true;
      return {
        ...item,
        revision: (item.revision ?? 0) + 1,
        updatedAt: Date.now(),
        messages: checkpoint.messages,
        tasks: checkpoint.tasks.map((task) =>
          task.status === 'running' || task.status === 'pending'
            ? { ...task, status: 'error' as const }
            : task,
        ),
        budget: { modelCalls: checkpoint.modelCalls, toolCalls: checkpoint.toolCalls },
        running: false,
        thinking: '',
        error: '任务因扩展后台重启而中断，请重新发送消息继续。',
      };
    });
    if (!found) {
      const item = emptyConversation('中断的任务', tabDomains.get(checkpoint.tabId) ? [tabDomains.get(checkpoint.tabId)!] : []);
      item.id = conversationId;
      item.revision = 1;
      item.messages = checkpoint.messages;
      item.tasks = checkpoint.tasks.map((task) => ({ ...task, status: task.status === 'done' ? 'done' : 'error' }));
      item.budget = { modelCalls: checkpoint.modelCalls, toolCalls: checkpoint.toolCalls };
      item.error = '任务因扩展后台重启而中断，请重新发送消息继续。';
      conversations.push(item);
    }
    await writeTabStore(checkpoint.tabId, {
      ...current,
      activeId: conversationId,
      conversations,
      sessionId: checkpoint.sessionId,
      revision: nextStoreRevision(current),
    });
    await clearCheckpoint(checkpointKey(checkpoint));
  }
}
