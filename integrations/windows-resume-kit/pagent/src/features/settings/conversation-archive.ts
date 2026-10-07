import { isSparseConversation, pickRicherConversation } from '@/features/agent/session/conversations';
import { messageBlocks } from '@/features/agent/session/messages';
import { toolLabel } from '@/features/agent/session/tool-display';
import type {
  ConversationSummary,
  DomainVault,
  PageConversation,
  PageConversationStore,
  VaultMap,
} from '@/shared/contracts/session';
import type { ChatMessage, ChatToolCall, TaskRow, TurnUsage, UserBadge } from '@/shared/contracts/session-messages';
import { redactText, redactValue } from '@/shared/contracts/policy';

export type ConversationTranscriptTurn = {
  id: string;
  role: ChatMessage['role'];
  text: string;
  thinking?: string;
  tools?: Array<{
    id: string;
    name: string;
    label: string;
    args?: unknown;
    output?: string;
    status: ChatToolCall['status'];
  }>;
  badges?: UserBadge[];
  usage?: TurnUsage;
  hasImage?: boolean;
  imageDataUrl?: string;
};

export type ExportedConversation = {
  id: string;
  title: string;
  vaults: string[];
  createdAt: number;
  updatedAt: number;
  createdAtISO: string;
  updatedAtISO: string;
  messageCount: number;
  budget: { modelCalls: number; toolCalls: number };
  error?: string;
  tasks: TaskRow[];
  transcript: ConversationTranscriptTurn[];
};

export type ConversationExportBundle = {
  exportedAt: string;
  source: 'pagent';
  version: 1;
  conversationCount: number;
  conversations: ExportedConversation[];
};

export type ConversationExportOptions = {
  includeImages?: boolean;
};

export function flattenStoredConversations(
  vaults: VaultMap,
  stores: Record<string, PageConversationStore> = {},
): PageConversation[] {
  const map = new Map<string, PageConversation>();
  const add = (item: PageConversation) => {
    if (isSparseConversation(item)) return;
    const previous = map.get(item.id);
    map.set(item.id, previous ? pickRicherConversation(previous, item) : item);
  };
  for (const vault of Object.values(vaults)) {
    for (const item of vault.conversations) add(item);
  }
  for (const store of Object.values(stores)) {
    for (const item of store.conversations) add(item);
  }
  return [...map.values()].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

export function conversationPreview(item: PageConversation): string {
  const firstUser = item.messages.find((message) => message.role === 'user' && message.content.trim());
  const text = (firstUser?.content || item.messages.find((message) => message.content.trim())?.content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function toConversationSummary(item: PageConversation): ConversationSummary {
  return {
    id: item.id,
    title: item.title,
    vaults: item.vaults,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messageCount: item.messages.length,
    preview: conversationPreview(item),
  };
}

export function listVaultSummaries(vaults: VaultMap): Array<{
  domain: string;
  conversationCount: number;
  updatedAt: number;
}> {
  return Object.values(vaults)
    .map((vault: DomainVault) => ({
      domain: vault.domain,
      conversationCount: vault.conversations.filter((item) => !isSparseConversation(item)).length,
      updatedAt: vault.updatedAt,
    }))
    .filter((item) => item.conversationCount > 0)
    .sort((left, right) => left.domain.localeCompare(right.domain, 'zh-CN'));
}

function toIso(value: number): string {
  return value ? new Date(value).toISOString() : '';
}

export function toTranscriptTurn(
  message: ChatMessage,
  options: ConversationExportOptions = {},
): ConversationTranscriptTurn {
  const blocks = messageBlocks(message);
  const thinking = blocks
    .filter((block) => block.type === 'thinking')
    .map((block) => block.text)
    .join('\n\n')
    .trim();
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim() || message.content;
  const tools = blocks.flatMap((block) => (block.type === 'tools' ? block.tools : [])).map((tool) => ({
    id: tool.id,
    name: tool.name,
    label: toolLabel(tool.name),
    args: redactValue(tool.args),
    output: tool.output ? redactText(tool.output) : undefined,
    status: tool.status,
  }));
  return {
    id: message.id,
    role: message.role,
    text: redactText(text),
    thinking: thinking ? redactText(thinking) : undefined,
    tools: tools.length ? tools : undefined,
    badges: message.badges,
    usage: message.usage,
    hasImage: Boolean(message.imageDataUrl),
    imageDataUrl: options.includeImages ? message.imageDataUrl : undefined,
  };
}

export function toExportedConversation(
  item: PageConversation,
  options: ConversationExportOptions = {},
): ExportedConversation {
  return {
    id: item.id,
    title: item.title,
    vaults: item.vaults,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdAtISO: toIso(item.createdAt),
    updatedAtISO: toIso(item.updatedAt),
    messageCount: item.messages.length,
    budget: conversationBudget(item),
    error: item.error || undefined,
    tasks: item.tasks.map((task) => ({
      ...task,
      detail: task.detail ? redactText(task.detail) : task.detail,
    })),
    transcript: item.messages.map((message) => toTranscriptTurn(message, options)),
  };
}

function conversationBudget(item: PageConversation): { modelCalls: number; toolCalls: number } {
  const turns = item.messages
    .map((message) => message.usage)
    .filter((usage): usage is TurnUsage => Boolean(usage));
  if (!turns.length) return item.budget;
  return {
    modelCalls: turns.reduce((sum, usage) => sum + usage.modelCalls, 0),
    toolCalls: turns.reduce((sum, usage) => sum + usage.toolCalls, 0),
  };
}

export function buildExportBundle(
  items: PageConversation[],
  options: ConversationExportOptions = {},
): ConversationExportBundle {
  return {
    exportedAt: new Date().toISOString(),
    source: 'pagent',
    version: 1,
    conversationCount: items.length,
    conversations: items.map((item) => toExportedConversation(item, options)),
  };
}

function formatStamp(value: number): string {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function fence(value: string): string {
  return `\`\`\`\n${value.replace(/```/g, '\\`\\`\\`')}\n\`\`\``;
}

export function exportedConversationToMarkdown(exported: ExportedConversation): string {
  const lines = [
    `# ${exported.title || '未命名会话'}`,
    '',
    `- 站点：${exported.vaults.join('、') || '未知'}`,
    `- 会话 ID：${exported.id}`,
    `- 创建：${formatStamp(exported.createdAt)}`,
    `- 更新：${formatStamp(exported.updatedAt)}`,
    `- 消息：${exported.messageCount}`,
  ];
  if (exported.budget.modelCalls || exported.budget.toolCalls) {
    lines.push(`- 用量：模型 ${exported.budget.modelCalls} 次 · 工具 ${exported.budget.toolCalls} 次`);
  }
  if (exported.error) lines.push(`- 错误：${exported.error}`);
  lines.push('');

  for (const turn of exported.transcript) {
    const role = turn.role === 'user' ? '用户' : turn.role === 'assistant' ? '助手' : '系统';
    lines.push(`## ${role}`);
    lines.push('');
    if (turn.hasImage) lines.push(turn.imageDataUrl ? `![附件](${turn.imageDataUrl})` : '*含截图附件*');
    if (turn.badges && turn.badges.length > 0) {
      const badgeLabels = turn.badges.map((b) => {
        if (b.type === 'tab') return `[@${b.title}]`;
        if (b.type === 'command') return `[/${b.key} ${b.name}]`;
        if (b.type === 'element') return `[元素: ${b.name || (b.tag ? `<${b.tag}>` : '未知')}]`;
        return '';
      }).filter(Boolean);
      if (badgeLabels.length > 0) {
        lines.push(`*标签: ${badgeLabels.join(' ')}*`);
      }
    }
    if (turn.thinking) {
      lines.push('> 思考');
      for (const line of turn.thinking.split('\n')) lines.push(`> ${line}`);
      lines.push('');
    }
    for (const tool of turn.tools ?? []) {
      lines.push(`**工具 · ${tool.label}** (\`${tool.name}\`)`);
      if (tool.args != null) {
        try {
          lines.push(fence(JSON.stringify(tool.args, null, 2)));
        } catch {
          lines.push(fence(String(tool.args)));
        }
      }
      if (tool.output) {
        lines.push('输出：');
        lines.push(fence(tool.output));
      }
      lines.push('');
    }
    if (turn.text) {
      lines.push(turn.text);
      lines.push('');
    }
    if (turn.usage) {
      lines.push(
        `用量：输入 ${turn.usage.inputTokens} · 输出 ${turn.usage.outputTokens} · 共 ${turn.usage.totalTokens} tokens`,
      );
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export function conversationToMarkdown(item: PageConversation, options: ConversationExportOptions = {}): string {
  return exportedConversationToMarkdown(toExportedConversation(item, options));
}

export function conversationsToMarkdown(items: PageConversation[], options: ConversationExportOptions = {}): string {
  return items.map((item) => conversationToMarkdown(item, options)).join('\n---\n\n');
}

export function exportedConversationsToMarkdown(items: ExportedConversation[]): string {
  return items.map(exportedConversationToMarkdown).join('\n---\n\n');
}

export function conversationsToJsonl(items: PageConversation[], options: ConversationExportOptions = {}): string {
  return `${items.map((item) => JSON.stringify(toExportedConversation(item, options))).join('\n')}\n`;
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportFilename(kind: 'json' | 'jsonl' | 'md', now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  return `pagent-conversations-${stamp}.${kind}`;
}
