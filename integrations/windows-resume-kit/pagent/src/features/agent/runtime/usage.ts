import type { TurnUsage } from '@/shared/contracts/session-messages';

export function emptyTurnUsage(): TurnUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    durationMs: 0,
    modelCalls: 0,
    toolCalls: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown> | undefined, keys: string[]): number {
  if (!record) return 0;
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value != null) return value;
  }
  return 0;
}

function firstRecord(
  record: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, unknown> | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const next = asRecord(record[key]);
    if (next) return next;
  }
  return undefined;
}

function fromUsageFields(record: Record<string, unknown> | undefined): TurnUsage | undefined {
  if (!record) return undefined;
  const details =
    firstRecord(record, ['input_token_details', 'inputTokenDetails']) ??
    firstRecord(record, ['prompt_tokens_details', 'promptTokensDetails']) ??
    firstRecord(record, ['prompt_token_details']);
  const outputDetails =
    firstRecord(record, ['output_token_details', 'outputTokenDetails']) ??
    firstRecord(record, ['completion_tokens_details', 'completionTokensDetails']);
  const inputTokens = pickNumber(record, [
    'input_tokens',
    'inputTokens',
    'prompt_tokens',
    'promptTokens',
    'prompt_token_count',
    'promptTokenCount',
  ]);
  const outputTokens = pickNumber(record, [
    'output_tokens',
    'outputTokens',
    'completion_tokens',
    'completionTokens',
    'candidates_token_count',
    'candidatesTokenCount',
  ]);
  const totalTokens =
    pickNumber(record, ['total_tokens', 'totalTokens', 'total_token_count', 'totalTokenCount']) ||
    (inputTokens + outputTokens > 0 ? inputTokens + outputTokens : 0);
  const cachedTokens = pickNumber(details, ['cache_read', 'cacheRead', 'cached_tokens', 'cachedTokens']) ||
    pickNumber(record, [
      'cache_read',
      'cacheRead',
      'cached_tokens',
      'cachedTokens',
      'cache_read_input_tokens',
      'cacheReadInputTokens',
      'prompt_cache_hit_tokens',
      'promptCacheHitTokens',
      'cached_content_token_count',
      'cachedContentTokenCount',
    ]);
  const reasoningTokens =
    pickNumber(outputDetails, ['reasoning', 'reasoning_tokens', 'reasoningTokens']) ||
    pickNumber(record, ['reasoning_tokens', 'reasoningTokens', 'thoughts_token_count', 'thoughtsTokenCount']);
  if (!inputTokens && !outputTokens && !totalTokens && !cachedTokens && !reasoningTokens) return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    reasoningTokens,
    durationMs: 0,
    modelCalls: 0,
    toolCalls: 0,
  };
}

function extractFromMessage(record: Record<string, unknown>): TurnUsage | undefined {
  const metadata = firstRecord(record, ['usage_metadata', 'usageMetadata']);
  const fromMeta = fromUsageFields(metadata);
  if (fromMeta) return fromMeta;
  const response = firstRecord(record, ['response_metadata', 'responseMetadata']);
  const fromResponse = fromUsageFields(
    firstRecord(response, ['tokenUsage', 'token_usage', 'usage', 'usageMetadata', 'usage_metadata']) ?? response,
  );
  if (fromResponse) return fromResponse;
  return fromUsageFields(firstRecord(record, ['usage', 'tokenUsage', 'token_usage']) ?? record);
}

export function extractTurnUsage(value: unknown): TurnUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractTurnUsage(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const direct = extractFromMessage(record);
  if (direct) return direct;
  for (const key of ['message', 'output', 'result']) {
    if (!(key in record)) continue;
    const found = extractTurnUsage(record[key]);
    if (found) return found;
  }
  return undefined;
}

export function mergeTurnUsage(left?: TurnUsage, right?: TurnUsage): TurnUsage {
  const a = left ?? emptyTurnUsage();
  const b = right ?? emptyTurnUsage();
  const inputTokens = a.inputTokens + b.inputTokens;
  const outputTokens = a.outputTokens + b.outputTokens;
  const totalTokens = a.totalTokens + b.totalTokens || inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
    durationMs: Math.max(a.durationMs, b.durationMs),
    startedAt: a.startedAt ?? b.startedAt,
    modelCalls: Math.max(a.modelCalls, b.modelCalls),
    toolCalls: Math.max(a.toolCalls, b.toolCalls),
  };
}

export function preferRicherUsage(left?: TurnUsage, right?: TurnUsage): TurnUsage {
  const a = left ?? emptyTurnUsage();
  const b = right ?? emptyTurnUsage();
  return b.totalTokens >= a.totalTokens ? { ...a, ...b, durationMs: Math.max(a.durationMs, b.durationMs) } : a;
}

export function withTurnTiming(
  usage: TurnUsage,
  extras: { startedAt: number; now?: number; modelCalls: number; toolCalls: number },
): TurnUsage {
  const now = extras.now ?? Date.now();
  return {
    ...usage,
    durationMs: Math.max(0, now - extras.startedAt),
    startedAt: extras.startedAt,
    modelCalls: extras.modelCalls,
    toolCalls: extras.toolCalls,
  };
}

export function hasTurnUsage(usage?: TurnUsage): boolean {
  if (!usage) return false;
  return (
    usage.totalTokens > 0 ||
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cachedTokens > 0 ||
    (usage.reasoningTokens ?? 0) > 0 ||
    usage.durationMs > 0 ||
    usage.modelCalls > 0 ||
    usage.toolCalls > 0
  );
}

export function formatTokenCount(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  if (rounded < 1_000) return rounded.toLocaleString('zh-CN');
  const divisor = rounded >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = divisor === 1_000_000 ? 'M' : 'K';
  const scaled = rounded / divisor;
  const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${Number(scaled.toFixed(digits))}${suffix}`;
}

export function formatDuration(ms: number): string {
  const value = Math.max(0, ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) {
    const seconds = value / 1000;
    return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatInputTokens(usage: TurnUsage): string {
  const cache = usage.cachedTokens > 0 ? ` (缓存 ${formatTokenCount(usage.cachedTokens)})` : '';
  return `输入 ${formatTokenCount(usage.inputTokens)}${cache}`;
}

export function formatCacheHitRate(usage: TurnUsage): string | undefined {
  if (usage.inputTokens <= 0) return undefined;
  const rate = Math.min(100, Math.max(0, Math.round((usage.cachedTokens / usage.inputTokens) * 100)));
  return `缓存命中率 ${rate}%`;
}

export function formatTurnUsageParts(usage: TurnUsage): string[] {
  const parts: string[] = [];
  if (usage.inputTokens > 0 || usage.cachedTokens > 0) parts.push(formatInputTokens(usage));
  if (usage.outputTokens > 0) parts.push(`输出 ${formatTokenCount(usage.outputTokens)}`);
  if (!usage.inputTokens && !usage.outputTokens && !usage.cachedTokens && usage.totalTokens > 0) {
    parts.push(`${formatTokenCount(usage.totalTokens)} token`);
  }
  const cacheHit = formatCacheHitRate(usage);
  if (cacheHit) parts.push(cacheHit);
  if (usage.durationMs > 0) parts.push(formatDuration(usage.durationMs));
  if (usage.modelCalls > 1) parts.push(`${usage.modelCalls} 次模型`);
  if (usage.toolCalls > 0) parts.push(`${usage.toolCalls} 次工具`);
  return parts;
}
