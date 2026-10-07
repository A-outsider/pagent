import type {
  AssistantPart,
  AssistantToolPart,
  ChatMessage,
  ChatToolCall,
  TaskStatus,
  TurnUsage,
  UserReference,
} from '@/shared/contracts/session-messages';
import { toolLabel } from './tool-display';
import { redactText, redactValue } from '@/shared/contracts/policy';

export type AssistantBlock =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tools'; tools: AssistantToolPart[] };

function asToolPart(tool: ChatToolCall): AssistantToolPart {
  return { type: 'tool', ...tool };
}

function hasToolId(parts: AssistantPart[], id: string): boolean {
  return parts.some((part) => part.type === 'tool' && part.id === id);
}

function syncDerived(message: ChatMessage, parts: AssistantPart[]): ChatMessage {
  return {
    ...message,
    parts,
    content: parts
      .filter((part): part is Extract<AssistantPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join(''),
    thinking: parts
      .filter((part): part is Extract<AssistantPart, { type: 'thinking' }> => part.type === 'thinking')
      .map((part) => part.text)
      .join(''),
    tools: parts.filter((part): part is AssistantToolPart => part.type === 'tool'),
  };
}

export function messageParts(message: ChatMessage): AssistantPart[] {
  if (message.parts?.length) return message.parts;
  return [
    ...(message.thinking ? [{ type: 'thinking' as const, text: message.thinking }] : []),
    ...(message.tools ?? []).map(asToolPart),
    ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
  ];
}

export function messageBlocks(message: ChatMessage): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  for (const part of messageParts(message)) {
    if (part.type === 'thinking') {
      if (part.text) blocks.push({ type: 'thinking', text: part.text });
      continue;
    }
    if (part.type === 'text') {
      if (part.text) blocks.push({ type: 'text', text: part.text });
      continue;
    }
    const last = blocks.at(-1);
    if (last?.type === 'tools') last.tools.push(part);
    else blocks.push({ type: 'tools', tools: [part] });
  }
  return blocks;
}

export function shouldHoldToolGroupOpen(streaming: boolean, followingBlocks: AssistantBlock[]): boolean {
  if (!streaming) return false;
  return !followingBlocks.some((block) => block.type === 'text' && Boolean(block.text.trim()));
}

export function appendAssistantToken(message: ChatMessage, text: string): ChatMessage {
  if (!text) return message;
  const parts = [...messageParts(message)];
  const last = parts.at(-1);
  if (last?.type === 'text') {
    parts[parts.length - 1] = { type: 'text', text: last.text + text };
  } else {
    parts.push({ type: 'text', text });
  }
  return syncDerived(message, parts);
}

export function appendAssistantThinking(message: ChatMessage, text: string): ChatMessage {
  if (!text) return message;
  const parts = [...messageParts(message)];
  const last = parts.at(-1);
  if (last?.type === 'thinking') {
    parts[parts.length - 1] = { type: 'thinking', text: last.text + text };
  } else {
    parts.push({ type: 'thinking', text });
  }
  return syncDerived(message, parts);
}

export function appendAssistantTool(message: ChatMessage, tool: ChatToolCall): ChatMessage {
  const parts = [...messageParts(message)];
  if (hasToolId(parts, tool.id)) return message;
  parts.push(asToolPart(tool));
  return syncDerived(message, parts);
}

export function updateAssistantTool(
  message: ChatMessage,
  id: string,
  patch: Partial<Pick<ChatToolCall, 'status' | 'output' | 'args' | 'name' | 'elapsedMs'>>,
): ChatMessage {
  const parts = messageParts(message);
  if (!hasToolId(parts, id)) return message;
  return syncDerived(
    message,
    parts.map((part) => (part.type === 'tool' && part.id === id ? { ...part, ...patch } : part)),
  );
}

export function applyAssistantFinalText(messages: ChatMessage[], text: string, id: string): ChatMessage[] {
  if (!text) return messages;
  const last = messages.at(-1);
  if (last?.role !== 'assistant') {
    return [...messages, appendAssistantToken({ id, role: 'assistant', content: '' }, text)];
  }
  const parts = [...messageParts(last)];
  const currentText = parts
    .filter((part): part is Extract<AssistantPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
  if (currentText === text || (currentText.startsWith(text) && currentText.length > text.length)) {
    return messages;
  }
  let textIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === 'text') {
      textIndex = index;
      break;
    }
  }
  if (text.startsWith(currentText)) {
    const suffix = text.slice(currentText.length);
    if (!suffix) return messages;
    if (textIndex < 0) parts.push({ type: 'text', text: suffix });
    else {
      const current = (parts[textIndex] as Extract<AssistantPart, { type: 'text' }>).text;
      parts[textIndex] = { type: 'text', text: current + suffix };
    }
    return messages.map((item, index) =>
      index === messages.length - 1 ? syncDerived(item, parts) : item,
    );
  }
  if (textIndex < 0) {
    parts.push({ type: 'text', text });
  } else {
    const current = (parts[textIndex] as Extract<AssistantPart, { type: 'text' }>).text;
    if (current.startsWith(text) && current.length > text.length) return messages;
    if (text.length < current.length && !text.startsWith(current) && !current.startsWith(text)) {
      return messages;
    }
    if (text.length <= current.length) return messages;
    parts[textIndex] = { type: 'text', text };
  }
  return messages.map((item, index) =>
    index === messages.length - 1 ? syncDerived(item, parts) : item,
  );
}

export function applyAssistantToken(messages: ChatMessage[], text: string, id: string): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role === 'assistant') {
    return messages.map((item, index) =>
      index === messages.length - 1 ? appendAssistantToken(item, text) : item,
    );
  }
  return [...messages, appendAssistantToken({ id, role: 'assistant', content: '' }, text)];
}

export function applyAssistantThinking(messages: ChatMessage[], text: string, id: string): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role === 'assistant') {
    return messages.map((item, index) =>
      index === messages.length - 1 ? appendAssistantThinking(item, text) : item,
    );
  }
  return [...messages, appendAssistantThinking({ id, role: 'assistant', content: '' }, text)];
}

function isEmptyArgs(args: unknown): boolean {
  if (args == null) return true;
  if (typeof args === 'string') {
    const trimmed = args.trim();
    return !trimmed || trimmed === '{}' || trimmed === '[]' || trimmed === 'null';
  }
  if (Array.isArray(args)) return args.length === 0;
  if (typeof args === 'object') return Object.keys(args).length === 0;
  return false;
}

function mergeToolStatus(current?: TaskStatus, incoming?: TaskStatus): TaskStatus {
  if (current === 'done' || current === 'error') return current;
  if (incoming === 'done' || incoming === 'error') return incoming ?? current ?? 'running';
  if (current === 'running' || incoming === 'running') return 'running';
  return incoming ?? current ?? 'running';
}

export function applyAssistantToolStart(
  messages: ChatMessage[],
  tool: ChatToolCall,
  id: string,
): ChatMessage[] {
  tool = { ...tool, args: redactValue(tool.args) };
  const existing = messages.find((item) => hasToolId(messageParts(item), tool.id));
  if (existing) {
    const current = messageParts(existing).find(
      (part): part is AssistantToolPart => part.type === 'tool' && part.id === tool.id,
    );
    const args =
      current && !isEmptyArgs(current.args) && isEmptyArgs(tool.args) ? current.args : tool.args;
    return messages.map((item) =>
      hasToolId(messageParts(item), tool.id)
        ? updateAssistantTool(item, tool.id, {
            args,
            name: tool.name || current?.name,
            status: mergeToolStatus(current?.status, tool.status),
          })
        : item,
    );
  }
  const last = messages.at(-1);
  if (last?.role === 'assistant') {
    return messages.map((item, index) =>
      index === messages.length - 1 ? appendAssistantTool(item, tool) : item,
    );
  }
  return [...messages, appendAssistantTool({ id, role: 'assistant', content: '' }, tool)];
}

export function applyAssistantToolResult(
  messages: ChatMessage[],
  id: string,
  status: Extract<TaskStatus, 'done' | 'error'>,
  output: string,
  elapsedMs?: number,
): ChatMessage[] {
  return messages.map((item) =>
    updateAssistantTool(item, id, {
      status,
      output: redactText(output),
      ...(elapsedMs == null ? {} : { elapsedMs }),
    }),
  );
}

export function applyAssistantUsage(messages: ChatMessage[], usage: TurnUsage, id: string): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role === 'assistant') {
    return messages.map((item, index) => (index === messages.length - 1 ? { ...item, usage } : item));
  }
  return [...messages, { id, role: 'assistant', content: '', usage }];
}

export function settleAssistantTools(
  message: ChatMessage,
  status: Extract<TaskStatus, 'done' | 'error'> = 'done',
): ChatMessage {
  const parts = messageParts(message);
  if (!parts.some((part) => part.type === 'tool' && (part.status === 'running' || part.status === 'pending'))) {
    return message;
  }
  return syncDerived(
    message,
    parts.map((part) =>
      part.type === 'tool' && (part.status === 'running' || part.status === 'pending')
        ? { ...part, status }
        : part,
    ),
  );
}

export function settleAssistantMessages(
  messages: ChatMessage[],
  status: Extract<TaskStatus, 'done' | 'error'> = 'done',
): ChatMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    const settled = settleAssistantTools(message, status);
    if (settled !== message) changed = true;
    return settled;
  });
  return changed ? next : messages;
}

export function formatReferencesPrompt(references?: UserReference[]): string {
  if (!references || references.length === 0) return '';
  const blocks: string[] = [];

  for (const ref of references) {
    if (ref.type === 'page') {
      const parts: string[] = [];
      parts.push(`- tabId: ${ref.tabId}`);
      parts.push(`- title: ${ref.title}`);
      parts.push(`- url: ${ref.url || '未知 URL'}`);
      if (ref.active) parts.push('- active: true');
      if (ref.error) parts.push(`- error: ${ref.error}`);
      if (ref.content) {
        parts.push(`- content:\n${ref.content}`);
      }
      blocks.push(`<reference_page>\n${parts.join('\n')}\n</reference_page>`);
    } else if (ref.type === 'command') {
      const parts: string[] = [];
      parts.push(`用户明确选择了命令 /${ref.key}（${ref.name}）。`);
      if (ref.desc) parts.push(`说明：${ref.desc}`);
      parts.push('必须结合用户当前补充要求，按照以下命令说明执行；不要向用户复述整段说明。');
      parts.push('<command_instructions>');
      parts.push(ref.prompt);
      parts.push('</command_instructions>');
      blocks.push(`<reference_command>\n${parts.join('\n')}\n</reference_command>`);
    } else if (ref.type === 'element') {
      const parts: string[] = [];
      if (ref.name) parts.push(`- name: ${ref.name}`);
      if (ref.tag) parts.push(`- tag: ${ref.tag}`);
      if (ref.element != null) {
        parts.push(`- detail:\n${typeof ref.element === 'string' ? ref.element : JSON.stringify(ref.element, null, 2)}`);
      }
      blocks.push(`<reference_element>\n${parts.join('\n')}\n</reference_element>`);
    }
  }

  if (blocks.length === 0) return '';
  return `<runtime_context>\n${blocks.join('\n')}\n</runtime_context>`;
}

export function formatUserMessageContent(
  content: string,
  references?: UserReference[],
  rawContext?: string,
): string {
  const runtimeContext = formatReferencesPrompt(references);
  const extraContext = rawContext?.trim() ? `<runtime_context>\n${rawContext.trim()}\n</runtime_context>` : '';
  const prefix = runtimeContext || extraContext;
  if (!prefix) return content;
  return content ? `${prefix}\n${content}` : prefix;
}

export function toModelMessages(
  history: ChatMessage[],
  prompt?: string,
): Array<{
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}> {
  const converted: Array<{
    role: 'user' | 'assistant';
    content:
      | string
      | Array<
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } }
        >;
  }> = [];
  for (const message of history) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    let content = message.content.trim();
    if (!content && message.role === 'assistant') {
      const tools = messageParts(message).filter(
        (part): part is AssistantToolPart => part.type === 'tool',
      );
      if (tools.length) content = `已执行：${tools.map((tool) => toolLabel(tool.name)).join('、')}`;
    }
    if (!content && message.role === 'user' && message.references?.length) {
      content = '';
    } else if (!content) {
      continue;
    }

    const formattedContent =
      message.role === 'user'
        ? formatUserMessageContent(content, message.references)
        : content;

    converted.push({
      role: message.role,
      content:
        message.role === 'user' && message.imageDataUrl
          ? modelUserContent(formattedContent, message.imageDataUrl)
          : formattedContent,
    });
  }
  const last = converted.at(-1);
  const lastText =
    typeof last?.content === 'string'
      ? last.content
      : last?.content.find(
          (part): part is { type: 'text'; text: string } => part.type === 'text',
        )?.text;
  if (prompt && last?.role === 'user' && lastText === prompt.trim()) {
    converted.pop();
  }
  return converted;
}

export function modelUserContent(
  prompt: string,
  imageDataUrl?: string,
  references?: UserReference[],
  rawContext?: string,
) {
  const formattedPrompt = formatUserMessageContent(prompt, references, rawContext);
  if (!imageDataUrl) return formattedPrompt;
  return [
    { type: 'text' as const, text: formattedPrompt },
    {
      type: 'image_url' as const,
      image_url: { url: imageDataUrl },
    },
  ];
}
