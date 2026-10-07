const HISTORY_ORIGIN = 'https://www.zhipin.com';
const HISTORY_PATH = '/wapi/zpchat/geek/historyMsg';

export type BossHistoryRequest = {
  contactId: string;
  groupId: string;
  source?: string;
  page: number;
  maxMsgId: string;
  pageSize?: number;
};

export type BossHistoryEvidence = BossHistoryRequest & {
  minMsgId?: string;
  /** Raw IDs remain intact for pagination, including messages the web client hides. */
  messageIds: string[];
  hiddenMessageIds?: string[];
  /** Explicit epoch milliseconds only; missing or conflicting timestamps stay absent. */
  messageTimes?: Record<string, number>;
  endReached: boolean;
};

const HIDDEN_ACTION_IDS = new Set([33, 28, 52, 97, 75, 151]);

function isHiddenHistoryMessage(message: Record<string, unknown>): boolean {
  // v5543 app: raw body.type 4 -> messageType "action"; filterMessage drops these aids.
  // Do not generalize to unknown types or the component's context-dependent visibility.
  const body = record(message.body);
  // v5543 maps type 8 to jobDesc and renders only templateId === 3.
  if (body?.type === 8 && typeof body.templateId === 'number' && Number.isSafeInteger(body.templateId)) {
    return body.templateId !== 3;
  }
  const aid = record(body?.action)?.aid;
  return body?.type === 4 && typeof aid === 'number' && HIDDEN_ACTION_IDS.has(aid);
}

function messageTime(value: unknown): number | undefined {
  // The public client passes raw `time` to Date as milliseconds. Reject seconds,
  // strings and impossible dates instead of converting or guessing their units.
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 946_684_800_000 && value <= 8_640_000_000_000_000 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numericId(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{1,30}$/.test(value)) return value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
}

function positiveInteger(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Parse only naturally captured GET query parameters; no network or storage access. */
export function parseBossHistoryRequest(requestUrl: string): BossHistoryRequest | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.origin !== HISTORY_ORIGIN || url.pathname !== HISTORY_PATH || url.username || url.password) return null;
  const params = url.searchParams;
  for (const key of ['bossId', 'groupId', 'gid', 'src', 'page', 'maxMsgId', 'c']) {
    if (params.getAll(key).length > 1) return null;
  }
  const contactId = params.get('bossId');
  if (!contactId || contactId.length > 200 || /[\s\x00-\x1f\x7f]/.test(contactId)) return null;
  const groupId = params.get('groupId') ?? params.get('gid') ?? '';
  if (groupId.length > 200 || /[\s\x00-\x1f\x7f]/.test(groupId)) return null;
  if (params.has('groupId') && params.has('gid') && params.get('groupId') !== params.get('gid')) return null;
  const source = params.get('src');
  if (source !== null && !/^\d{1,10}$/.test(source)) return null;
  const page = positiveInteger(params.get('page'));
  const maxMsgId = numericId(params.get('maxMsgId'));
  const pageSize = params.has('c') ? positiveInteger(params.get('c')) : undefined;
  if (page === null || maxMsgId === null || pageSize === null) return null;
  return {
    contactId, groupId, page, maxMsgId,
    ...(source !== null ? { source } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
  };
}

/**
 * Public chat-new/v5543 source computes history = hasMore || messages.length >= 19.
 * Require explicit false, even for an empty page; missing/error responses never prove completion.
 * https://static.zhipin.com/fe-zhipin-geek/web/chat-new/v5543/static/js/chat.71252f3c.js
 */
export function parseBossHistoryEvidence(requestUrl: string, responseBody: unknown): BossHistoryEvidence | null {
  const request = parseBossHistoryRequest(requestUrl);
  if (!request) return null;
  let body = responseBody;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const response = record(body);
  if (response?.code !== 0) return null;
  const data = record(response.zpData);
  if (!data || !Array.isArray(data.messages)) return null;
  const messageIds: string[] = [];
  const hidden = new Set<string>();
  const requiresDom = new Set<string>();
  const messageTimes: Record<string, number> = {};
  const conflictingTimes = new Set<string>();
  for (const message of data.messages) {
    const raw = record(message);
    const mid = numericId(raw?.mid);
    if (!raw || mid === null) return null;
    messageIds.push(mid);
    if (isHiddenHistoryMessage(raw)) hidden.add(mid);
    else requiresDom.add(mid);
    const time = messageTime(raw.time);
    if (time !== undefined && !conflictingTimes.has(mid)) {
      if (messageTimes[mid] !== undefined && messageTimes[mid] !== time) {
        delete messageTimes[mid];
        conflictingTimes.add(mid);
      } else messageTimes[mid] = time;
    }
  }
  // A duplicate ID with any unknown/visible occurrence must still be observed.
  const hiddenMessageIds = [...hidden].filter((mid) => !requiresDom.has(mid));
  const minMsgId = data.minMsgId === undefined ? undefined : numericId(data.minMsgId);
  if (minMsgId === null) return null;
  return {
    ...request,
    ...(minMsgId !== undefined ? { minMsgId } : {}),
    messageIds,
    ...(hiddenMessageIds.length ? { hiddenMessageIds } : {}),
    ...(Object.keys(messageTimes).length ? { messageTimes } : {}),
    endReached: data.hasMore === false && data.messages.length < 19,
  };
}

function nextHistoryCursor(page: BossHistoryEvidence): string | null {
  // The public client uses minMsgId || Math.min(...messageIds). Keep large IDs exact.
  if (page.minMsgId !== undefined) {
    const id = numericId(page.minMsgId);
    if (id === null) return null;
    if (BigInt(id) > 0n) return BigInt(id).toString();
  }
  let minimum: bigint | undefined;
  for (const value of page.messageIds) {
    const id = numericId(value);
    if (id === null) return null;
    const current = BigInt(id);
    if (minimum === undefined || current < minimum) minimum = current;
  }
  return minimum?.toString() ?? null;
}

/** A final page alone is insufficient: require a complete, rendered chain from the first request. */
export function isBossHistoryComplete(evidence: readonly BossHistoryEvidence[], visibleIds: Iterable<string>): boolean {
  if (!evidence.length) return false;
  const ordered = [...evidence].sort((a, b) => a.page - b.page);
  const first = ordered[0]!;
  if (first.page !== 1 || numericId(first.maxMsgId) === null || BigInt(first.maxMsgId) !== 0n) return false;
  const visible = new Set(visibleIds);
  let previous: BossHistoryEvidence | undefined;
  for (const page of ordered) {
    if (page.contactId !== first.contactId || page.groupId !== first.groupId || page.source !== first.source) return false;
    const hidden = new Set(page.hiddenMessageIds ?? []);
    if ([...hidden].some((id) => !page.messageIds.includes(id))) return false;
    if (!page.messageIds.every((id) => hidden.has(id) || visible.has(id))) return false;
    if (previous) {
      if (page.page === previous.page) {
        // Identical captures are harmless; conflicting retries do not prove one continuous history.
        if (page.maxMsgId !== previous.maxMsgId || page.minMsgId !== previous.minMsgId
          || page.endReached !== previous.endReached || page.pageSize !== previous.pageSize
          || JSON.stringify(page.messageIds) !== JSON.stringify(previous.messageIds)
          || JSON.stringify(page.hiddenMessageIds ?? []) !== JSON.stringify(previous.hiddenMessageIds ?? [])
          || JSON.stringify(page.messageTimes ?? {}) !== JSON.stringify(previous.messageTimes ?? {})) return false;
        continue;
      }
      if (previous.endReached || page.page !== previous.page + 1) return false;
      const cursor = nextHistoryCursor(previous);
      if (cursor === null || numericId(page.maxMsgId) === null || BigInt(page.maxMsgId).toString() !== cursor) return false;
      if (BigInt(previous.maxMsgId) !== 0n && BigInt(cursor) >= BigInt(previous.maxMsgId)) return false;
    }
    previous = page;
  }
  return previous?.endReached === true;
}
