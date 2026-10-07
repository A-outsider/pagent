import { redactText } from '@/shared/contracts/policy';
import { truncate } from '@/shared/utils/utils';

export const MAX_NETWORK_ENTRIES = 200;
export const MAX_CONSOLE_ENTRIES = 200;
export const MAX_POST_DATA = 2000;
export const MAX_TEXT = 2000;

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
]);

const NOISY_URL = /^(data:|blob:|chrome-extension:|devtools:)/i;

export type NetworkEntry = {
  requestId: string;
  url: string;
  method: string;
  type?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  protocol?: string;
  encodedDataLength?: number;
  failed?: boolean;
  canceled?: boolean;
  errorText?: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  initiator?: string;
};

export type ConsoleEntry = {
  id: string;
  level: string;
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
  source: 'console' | 'exception' | 'browser';
};

export type NetworkFilter = {
  urlIncludes?: string;
  method?: string;
  resourceType?: string;
  failedOnly?: boolean;
  includeNoise?: boolean;
  limit?: number;
};

export type ConsoleFilter = {
  level?: string;
  textIncludes?: string;
  limit?: number;
};

export type DevtoolsStore = {
  network: Map<string, NetworkEntry>;
  networkOrder: string[];
  console: ConsoleEntry[];
  capturing: boolean;
  startedAt: number;
  nextConsoleId: number;
};

export function createDevtoolsStore(now = Date.now()): DevtoolsStore {
  return {
    network: new Map(),
    networkOrder: [],
    console: [],
    capturing: false,
    startedAt: now,
    nextConsoleId: 1,
  };
}

export function applyCdpEvent(
  store: DevtoolsStore,
  method: string,
  params: Record<string, unknown> = {},
  now = Date.now(),
): void {
  if (method === 'Network.requestWillBeSent') {
    applyRequestWillBeSent(store, params, now);
    return;
  }
  if (method === 'Network.responseReceived') {
    applyResponseReceived(store, params);
    return;
  }
  if (method === 'Network.loadingFinished') {
    applyLoadingFinished(store, params, now);
    return;
  }
  if (method === 'Network.loadingFailed') {
    applyLoadingFailed(store, params, now);
    return;
  }
  if (method === 'Runtime.consoleAPICalled') {
    applyConsoleApi(store, params, now);
    return;
  }
  if (method === 'Runtime.exceptionThrown') {
    applyException(store, params, now);
    return;
  }
  if (method === 'Log.entryAdded') {
    applyLogEntry(store, params, now);
  }
}

export function listNetwork(store: DevtoolsStore, filter: NetworkFilter = {}): NetworkEntry[] {
  const limit = filter.limit ?? 50;
  const urlNeedle = filter.urlIncludes?.toLowerCase();
  const method = filter.method?.toUpperCase();
  const type = filter.resourceType;
  const items: NetworkEntry[] = [];
  for (let i = store.networkOrder.length - 1; i >= 0 && items.length < limit; i -= 1) {
    const requestId = store.networkOrder[i];
    if (!requestId) continue;
    const entry = store.network.get(requestId);
    if (!entry) continue;
    if (!filter.includeNoise && NOISY_URL.test(entry.url)) continue;
    if (urlNeedle && !entry.url.toLowerCase().includes(urlNeedle)) continue;
    if (method && entry.method !== method) continue;
    if (type && entry.type !== type) continue;
    if (filter.failedOnly && !entry.failed) continue;
    items.push(entry);
  }
  return items.reverse();
}

export function summarizeNetwork(entry: NetworkEntry) {
  return {
    requestId: entry.requestId,
    method: entry.method,
    url: entry.url,
    status: entry.status,
    statusText: entry.statusText,
    type: entry.type,
    mimeType: entry.mimeType,
    durationMs: entry.durationMs,
    encodedDataLength: entry.encodedDataLength,
    failed: entry.failed,
    canceled: entry.canceled,
    errorText: entry.errorText,
  };
}

export function listConsole(store: DevtoolsStore, filter: ConsoleFilter = {}): ConsoleEntry[] {
  const limit = filter.limit ?? 50;
  const level = filter.level?.toLowerCase();
  const textNeedle = filter.textIncludes?.toLowerCase();
  const items: ConsoleEntry[] = [];
  for (let i = store.console.length - 1; i >= 0 && items.length < limit; i -= 1) {
    const entry = store.console[i];
    if (!entry) continue;
    if (level && entry.level.toLowerCase() !== level && entry.source !== level) continue;
    if (textNeedle && !entry.text.toLowerCase().includes(textNeedle)) continue;
    items.push(entry);
  }
  return items.reverse();
}

export function getNetworkEntry(store: DevtoolsStore, requestId: string): NetworkEntry | undefined {
  return store.network.get(requestId);
}

export function isTextualMime(mimeType?: string): boolean {
  if (!mimeType) return false;
  return /^(text\/|application\/(json|javascript|xml|graphql|x-www-form-urlencoded|ld\+json)|image\/svg)/i.test(
    mimeType,
  );
}

export function redactHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const next: Record<string, string> = {};
  if (!headers) return next;
  for (const [key, value] of Object.entries(headers)) {
    next[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : String(value ?? '');
  }
  return next;
}

function applyRequestWillBeSent(store: DevtoolsStore, params: Record<string, unknown>, now: number) {
  const requestId = asString(params.requestId);
  if (!requestId) return;
  const request = asRecord(params.request);
  const redirect = asRecord(params.redirectResponse);
  const existing = store.network.get(requestId);
  const url = asString(request.url, existing?.url ?? '');
  const startedAt = existing?.startedAt ?? now;
  const entry: NetworkEntry = {
    ...existing,
    requestId,
    url,
    method: asString(request.method, existing?.method ?? 'GET').toUpperCase(),
    type: asString(params.type, existing?.type),
    startedAt,
    requestHeaders: redactHeaders(asRecord(request.headers)),
    postData: sanitizePostData(request.postData),
    initiator: initiatorOf(params.initiator),
  };
  if (redirect.url || redirect.status) {
    entry.status = asNumber(redirect.status) ?? entry.status;
    entry.statusText = asString(redirect.statusText, entry.statusText);
    entry.mimeType = asString(redirect.mimeType, entry.mimeType);
  }
  upsertNetwork(store, entry);
}

function applyResponseReceived(store: DevtoolsStore, params: Record<string, unknown>) {
  const requestId = asString(params.requestId);
  const current = store.network.get(requestId);
  if (!current) return;
  const response = asRecord(params.response);
  current.status = asNumber(response.status);
  current.statusText = asString(response.statusText);
  current.mimeType = asString(response.mimeType);
  current.protocol = asString(response.protocol);
  current.type = asString(params.type, current.type);
  current.responseHeaders = redactHeaders(asRecord(response.headers));
  if (!current.url) current.url = asString(response.url);
}

function applyLoadingFinished(store: DevtoolsStore, params: Record<string, unknown>, now: number) {
  const current = store.network.get(asString(params.requestId));
  if (!current) return;
  current.finishedAt = now;
  current.durationMs = Math.max(0, now - current.startedAt);
  current.encodedDataLength = asNumber(params.encodedDataLength);
}

function applyLoadingFailed(store: DevtoolsStore, params: Record<string, unknown>, now: number) {
  const current = store.network.get(asString(params.requestId));
  if (!current) return;
  current.failed = true;
  current.canceled = params.canceled === true;
  current.errorText = asString(params.errorText);
  current.finishedAt = now;
  current.durationMs = Math.max(0, now - current.startedAt);
}

function applyConsoleApi(store: DevtoolsStore, params: Record<string, unknown>, now: number) {
  const stack = asRecord(params.stackTrace);
  const frame = firstFrame(stack.callFrames);
  pushConsole(store, {
    id: nextConsoleId(store),
    level: asString(params.type, 'log'),
    text: formatRemoteArgs(params.args),
    timestamp: now,
    url: asString(frame.url) || undefined,
    lineNumber: asNumber(frame.lineNumber),
    source: 'console',
  });
}

function applyException(store: DevtoolsStore, params: Record<string, unknown>, now: number) {
  const details = asRecord(params.exceptionDetails);
  const exception = asRecord(details.exception);
  const text = [asString(details.text), asString(exception.description), asString(exception.value)]
    .filter(Boolean)
    .join(' ');
  pushConsole(store, {
    id: nextConsoleId(store),
    level: 'error',
    text: sanitizeText(text || 'Uncaught exception'),
    timestamp: now,
    url: asString(details.url) || undefined,
    lineNumber: asNumber(details.lineNumber),
    source: 'exception',
  });
}

function applyLogEntry(store: DevtoolsStore, params: Record<string, unknown>, now: number) {
  const entry = asRecord(params.entry);
  pushConsole(store, {
    id: nextConsoleId(store),
    level: asString(entry.level, 'info'),
    text: sanitizeText(asString(entry.text)),
    timestamp: now,
    url: asString(entry.url) || undefined,
    lineNumber: asNumber(entry.lineNumber),
    source: 'browser',
  });
}

function upsertNetwork(store: DevtoolsStore, entry: NetworkEntry) {
  if (!store.network.has(entry.requestId)) {
    store.networkOrder.push(entry.requestId);
  }
  store.network.set(entry.requestId, entry);
  while (store.networkOrder.length > MAX_NETWORK_ENTRIES) {
    const oldest = store.networkOrder.shift();
    if (oldest) store.network.delete(oldest);
  }
}

function pushConsole(store: DevtoolsStore, entry: ConsoleEntry) {
  if (!entry.text) return;
  store.console.push(entry);
  if (store.console.length > MAX_CONSOLE_ENTRIES) {
    store.console.splice(0, store.console.length - MAX_CONSOLE_ENTRIES);
  }
}

function nextConsoleId(store: DevtoolsStore): string {
  const id = `c${store.nextConsoleId}`;
  store.nextConsoleId += 1;
  return id;
}

function sanitizePostData(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  return sanitizeText(value, MAX_POST_DATA);
}

function sanitizeText(text: string, max = MAX_TEXT): string {
  return truncate(redactText(text), max);
}

function formatRemoteArgs(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return sanitizeText(
    value
      .map((item) => {
        const object = asRecord(item);
        if (object.value !== undefined) {
          try {
            return typeof object.value === 'string' ? object.value : JSON.stringify(object.value);
          } catch {
            return String(object.value);
          }
        }
        return asString(object.description) || asString(object.type);
      })
      .filter(Boolean)
      .join(' '),
  );
}

function initiatorOf(value: unknown): string | undefined {
  const initiator = asRecord(value);
  const type = asString(initiator.type);
  if (!type) return undefined;
  const frame = firstFrame(asRecord(initiator.stack).callFrames);
  const loc = frame.url ? `${asString(frame.url)}:${asNumber(frame.lineNumber) ?? 0}` : '';
  return loc ? `${type} ${loc}` : type;
}

function firstFrame(value: unknown): Record<string, unknown> {
  return Array.isArray(value) && value[0] ? asRecord(value[0]) : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
