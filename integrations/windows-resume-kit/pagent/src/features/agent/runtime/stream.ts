import type { AgentEvent } from '@/shared/contracts/agent';
import { extractTurnUsage } from './usage';

const SKIP_TEXT_TYPES = new Set([
  'reasoning',
  'thinking',
  'redacted_thinking',
  'tool_use',
  'tool_call',
  'tool_call_chunk',
  'image_url',
]);

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const type = 'type' in part ? String(part.type ?? '') : '';
        if (SKIP_TEXT_TYPES.has(type)) return '';
        if ('text' in part) return String(part.text ?? '');
        return '';
      })
      .join('');
  }
  return '';
}

export function extractReasoning(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map((part) => extractReasoningFromPart(part)).join('');
  }
  return extractReasoningFromPart(content);
}

function extractReasoningFromPart(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const record = part as Record<string, unknown>;
  const type = String(record.type ?? '');
  if (type !== 'reasoning' && type !== 'thinking' && type !== 'reasoning_content') return '';
  if (typeof record.reasoning === 'string') return record.reasoning;
  if (typeof record.thinking === 'string') return record.thinking;
  if (typeof record.text === 'string') return record.text;
  return '';
}

function extractReasoningKwargs(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const kwargs = value as Record<string, unknown>;
  if (typeof kwargs.reasoning_content === 'string') return kwargs.reasoning_content;
  const reasoning = kwargs.reasoning;
  if (!reasoning || typeof reasoning !== 'object') return '';
  const summary = (reasoning as { summary?: unknown }).summary;
  if (!Array.isArray(summary)) return '';
  return summary
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const text = (item as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

export function extractReasoningFromMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return (
    extractReasoning(record.contentBlocks) ||
    extractReasoning(record.content) ||
    extractReasoningKwargs(record.additional_kwargs) ||
    extractReasoningKwargs(record.additionalKwargs) ||
    extractReasoningKwargs(record)
  );
}

export function applyTokenDelta(previous: string, incoming: string): { next: string; delta: string } {
  if (!incoming) return { next: previous, delta: '' };
  if (incoming === previous) return { next: previous, delta: '' };
  if (incoming.startsWith(previous)) return { next: incoming, delta: incoming.slice(previous.length) };
  if (previous.endsWith(incoming)) return { next: previous, delta: '' };
  return { next: previous + incoming, delta: incoming };
}

export type StreamToolState = {
  pending: Map<string, { id?: string; name?: string; args: string }>;
  published: Map<string, string>;
};

export function createStreamToolState(): StreamToolState {
  return { pending: new Map(), published: new Map() };
}

export function interpretStreamChunk(chunk: unknown, state?: StreamToolState): AgentEvent[] {
  const events: AgentEvent[] = [];
  const { mode, data } = unwrapStreamChunk(chunk);
  if (mode === 'messages') {
    collectFromMessage(unwrapMessage(data), events, { tokens: true, tools: true }, state);
    return events;
  }
  if (mode === 'updates') {
    state?.pending.clear();
    // Recover terminal AIMessage text only. Replaying a tool-call preamble
    // after tool-start cleared it would make a later empty answer look complete.
    collectFromUnknown(data, events, { tokens: 'final', tools: true }, state);
    return events;
  }
  collectFromUnknown(data, events, { tokens: true, tools: true }, state);
  return events;
}

function unwrapStreamChunk(chunk: unknown): { mode?: string; data: unknown } {
  if (Array.isArray(chunk) && chunk.length >= 2 && typeof chunk[0] === 'string') {
    return { mode: chunk[0], data: chunk[1] };
  }
  return { data: chunk };
}

function unwrapMessage(data: unknown): unknown {
  if (Array.isArray(data) && data.length >= 1) return data[0];
  return data;
}

function collectFromUnknown(
  value: unknown,
  events: AgentEvent[],
  options: { tokens: boolean | 'final'; tools: boolean },
  state?: StreamToolState,
) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectFromUnknown(item, events, options, state);
    return;
  }
  const record = value as Record<string, unknown>;
  if (isMessageLike(record)) {
    collectFromMessage(record, events, options, state);
    return;
  }
  for (const item of Object.values(record)) collectFromUnknown(item, events, options, state);
}

function isMessageLike(value: Record<string, unknown>): boolean {
  const type = messageType(value);
  return (
    type === 'ai' ||
    type === 'tool' ||
    'tool_calls' in value ||
    'toolCalls' in value ||
    'tool_call_chunks' in value ||
    'toolCallChunks' in value
  );
}

function messageType(value: Record<string, unknown>): string {
  const raw = value.type ?? value.role;
  if (typeof raw === 'string') {
    if (raw === 'assistant' || raw === 'AIMessage' || raw === 'AIMessageChunk') return 'ai';
    if (raw === 'tool' || raw === 'ToolMessage' || raw === 'ToolMessageChunk') return 'tool';
    return raw;
  }
  try {
    const getter = (value as { getType?: () => string; _getType?: () => string }).getType
      ?? (value as { _getType?: () => string })._getType;
    if (typeof getter === 'function') return String(getter.call(value));
  } catch {
    // ignore
  }
  return '';
}

function collectFromMessage(
  value: unknown,
  events: AgentEvent[],
  options: { tokens: boolean | 'final'; tools: boolean },
  state?: StreamToolState,
) {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const type = messageType(record);

  if (options.tokens && type === 'ai' && (options.tokens !== 'final' || !hasToolCalls(record))) {
    const reasoning = extractReasoningFromMessage(record);
    if (reasoning) events.push({ type: 'reasoning', text: reasoning });
    const text = extractText(record.content) || extractText(record.contentBlocks);
    if (text) events.push({ type: 'token', text });
    const usage = extractTurnUsage(record);
    if (usage) events.push({ type: 'usage', usage });
  }

  if (options.tools && type !== 'tool') {
    collectToolStarts(record, events, state);
  }

  if (options.tools && (type === 'tool' || record.tool_call_id || record.toolCallId)) {
    const id = record.tool_call_id ?? record.toolCallId;
    if (!id) return;
    const failed = record.status === 'error';
    events.push({
      type: failed ? 'tool-error' : 'tool-end',
      id: String(id),
      name: String(record.name ?? 'tool'),
      output: extractText(record.content) || (failed ? '调用失败' : ''),
    });
  }
}

type ToolCallLike = {
  id?: unknown;
  name?: unknown;
  args?: unknown;
  input?: unknown;
  index?: unknown;
  type?: unknown;
  callId?: unknown;
};

function asToolCallList(value: unknown): ToolCallLike[] {
  return Array.isArray(value) ? value.filter((item): item is ToolCallLike => Boolean(item) && typeof item === 'object') : [];
}

function hasToolCalls(record: Record<string, unknown>): boolean {
  return ['tool_calls', 'toolCalls', 'tool_call_chunks', 'toolCallChunks', 'invalid_tool_calls', 'invalidToolCalls']
    .some((key) => asToolCallList(record[key]).length > 0)
    || [record.content, record.contentBlocks].some((content) => asToolCallList(content)
      .some((part) => ['tool_use', 'tool_call', 'tool_call_chunk'].includes(String(part.type ?? ''))));
}

function normalizeToolArgs(args: unknown): unknown {
  if (args == null) return {};
  if (typeof args !== 'string') return args;
  const trimmed = args.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return args;
  }
}

function argsFingerprint(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function isConcreteArgs(args: unknown): boolean {
  if (args == null) return false;
  if (typeof args === 'string') {
    const trimmed = args.trim();
    if (!trimmed) return false;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return typeof args === 'object';
}

function collectToolStarts(record: Record<string, unknown>, events: AgentEvent[], state?: StreamToolState) {
  const emitted = new Set<string>();
  const emit = (id?: unknown, name?: unknown, args?: unknown, replace = false) => {
    if (id == null || name == null || name === '') return;
    const sid = String(id);
    const sname = String(name);
    if (!sid || !sname || (!replace && emitted.has(sid))) return;
    const normalized = normalizeToolArgs(args);
    if (state) {
      const fingerprint = `${sname}\0${argsFingerprint(normalized)}`;
      const prev = state.published.get(sid);
      if (prev === fingerprint) return;
      // 参数流式拼接过程中只在「首次亮相」和「JSON 拼完整」时对外发事件，
      // 避免每个 token 都走一遍 runtime / store / UI。
      if (prev != null && !isConcreteArgs(normalized)) return;
      state.published.set(sid, fingerprint);
    }
    emitted.add(sid);
    events.push({ type: 'tool-start', id: sid, name: sname, args: normalized });
  };

  const chunks = [...asToolCallList(record.tool_call_chunks), ...asToolCallList(record.toolCallChunks)];
  if (state) {
    for (const chunk of chunks) {
      const key =
        typeof chunk.index === 'number'
          ? `i:${chunk.index}`
          : chunk.id != null
            ? `id:${String(chunk.id)}`
            : undefined;
      if (!key) continue;
      const prev = state.pending.get(key);
      if (prev && chunk.id && prev.id && String(chunk.id) !== prev.id) {
        state.pending.delete(key);
      }
      const current = state.pending.get(key) ?? { args: '' };
      const id = chunk.id != null ? String(chunk.id) : current.id;
      const name = chunk.name != null && chunk.name !== '' ? String(chunk.name) : current.name;
      const incomingArgs = typeof chunk.args === 'string' ? chunk.args : '';
      const args = applyTokenDelta(current.args, incomingArgs).next;
      state.pending.set(key, { id, name, args });
      emit(id, name, args);
    }
  } else {
    for (const chunk of chunks) emit(chunk.id, chunk.name, chunk.args);
  }

  for (const call of [
    ...asToolCallList(record.invalid_tool_calls),
    ...asToolCallList(record.invalidToolCalls),
  ]) {
    emit(call.id, call.name, call.args);
  }

  for (const content of [record.content, record.contentBlocks]) {
    if (!Array.isArray(content)) continue;
    for (const part of asToolCallList(content)) {
      const type = String(part.type ?? '');
      if (type !== 'tool_use' && type !== 'tool_call' && type !== 'tool_call_chunk') continue;
      emit(part.id ?? part.callId, part.name, part.input ?? part.args);
    }
  }

  for (const call of [...asToolCallList(record.tool_calls), ...asToolCallList(record.toolCalls)]) {
    emit(call.id, call.name, call.args, true);
  }
}
