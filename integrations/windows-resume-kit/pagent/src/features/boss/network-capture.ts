import { parseBossHistoryEvidence } from './history-evidence';

export type HistoryEvidence = NonNullable<ReturnType<typeof parseBossHistoryEvidence>>;
export type BossHistoryCapture = {
  evidence: HistoryEvidence[];
  failed: boolean;
  refresh(): Promise<void>;
  close(): void;
};

/** Self-contained: Chrome serializes this function into the page's MAIN world. */
function observeHistoryInPage(operation: 'start' | 'read' | 'close', captureId: string) {
  const namespace = '__pagentBossHistoryObserverV2';
  const origin = 'https://www.zhipin.com';
  const path = '/wapi/zpchat/geek/historyMsg';
  type Entry = { url: string; body: unknown };
  type Capture = { id: string; records: Entry[]; count: number; failed: boolean };
  type Snapshot = { id: string; records: Entry[]; failed: boolean };
  type Observer = { version: 2; control(action: typeof operation, id: string): Snapshot };
  const scope = globalThis as typeof globalThis & { [namespace]?: Observer };
  const unavailable = (): Snapshot => ({ id: captureId, records: [], failed: true });
  if (location.origin !== origin) return unavailable();

  if (!scope[namespace]) {
    if (operation !== 'start') return unavailable();
    let active: Capture | undefined;
    const nativeFetch = globalThis.fetch;
    const NativeXHR = globalThis.XMLHttpRequest;
    const pending = new WeakMap<XMLHttpRequest, { capture: Capture; url: string }>();
    const listened = new WeakSet<XMLHttpRequest>();
    const matches = (capture: Capture) => active === capture;
    const fail = (capture: Capture) => { if (matches(capture)) capture.failed = true; };
    const idValue = (value: unknown) => typeof value === 'string' && /^\d{1,30}$/.test(value)
      || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

    function sanitizedUrl(raw: string | URL, method: string): string | null {
      try {
        const url = new URL(String(raw), location.href);
        if (method.toUpperCase() !== 'GET' || url.origin !== origin || url.pathname !== path || url.username || url.password) return null;
        const safe = new URL(path, origin);
        for (const key of ['bossId', 'groupId', 'gid', 'maxMsgId', 'c', 'page', 'src']) {
          for (const value of url.searchParams.getAll(key)) safe.searchParams.append(key, value);
        }
        return safe.href;
      } catch { return null; }
    }

    function record(capture: Capture, url: string, raw: unknown) {
      if (!matches(capture)) return;
      try {
        if (typeof raw === 'string' && raw.length > 4_000_000) throw new Error('Oversized history');
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!body || typeof body !== 'object' || body.code !== 0) throw new Error('Failed history');
        const data = body.zpData;
        if (!data || !Array.isArray(data.messages) || data.messages.some((message: { mid?: unknown } | null) => !message || !idValue(message.mid))) throw new Error('Invalid history');
        if (data.minMsgId !== undefined && !idValue(data.minMsgId)) throw new Error('Invalid cursor');
        if (capture.count >= 100) throw new Error('History capture limit');
        capture.count++;
        // Discard message text, attachment URLs, securityId and all other payload fields in MAIN.
        capture.records.push({ url, body: { code: 0, zpData: {
          messages: data.messages.map((message: { mid: string | number; time?: unknown; body?: { type?: unknown; templateId?: unknown; action?: { aid?: unknown } } }) => ({
            mid: message.mid,
            ...(typeof message.time === 'number' && Number.isSafeInteger(message.time) && message.time >= 0 ? { time: message.time } : {}),
            ...(typeof message.body?.type === 'number' && Number.isSafeInteger(message.body.type) ? { body: {
              type: message.body.type,
              ...(typeof message.body.templateId === 'number' && Number.isSafeInteger(message.body.templateId)
                ? { templateId: message.body.templateId } : {}),
              ...(typeof message.body.action?.aid === 'number' && Number.isSafeInteger(message.body.action.aid)
                ? { action: { aid: message.body.action.aid } } : {}),
            } } : {}),
          })),
          ...(typeof data.hasMore === 'boolean' ? { hasMore: data.hasMore } : {}),
          ...(data.minMsgId !== undefined ? { minMsgId: data.minMsgId } : {}),
        } } });
      } catch { fail(capture); }
    }

    const wrappedFetch: typeof fetch = function (this: typeof globalThis, input, init) {
      const capture = active;
      let url: string | null = null;
      if (capture) {
        try {
          const request = typeof input === 'object' && 'url' in input ? input : undefined;
          url = sanitizedUrl(request ? request.url : input as string | URL, init?.method ?? request?.method ?? 'GET');
        } catch { /* Invalid requests retain the native fetch behavior. */ }
      }
      const response = nativeFetch.apply(this, [input, init]);
      if (!capture || !url) return response;
      const safeUrl = url;
      return response.then((result) => {
        if (matches(capture)) {
          if (!result.ok) fail(capture);
          else {
            try { void result.clone().text().then((body) => record(capture, safeUrl, body), () => fail(capture)); }
            catch { fail(capture); }
          }
        }
        return result;
      }, (error: unknown) => { fail(capture); throw error; });
    };

    // BOSS's transport wrapper installs open as an own method on each XHR instance,
    // so patching only XMLHttpRequest.prototype.open misses its requests.
    const WrappedXHR = new Proxy(NativeXHR, {
      construct(target, args, newTarget) {
        const xhr = Reflect.construct(target, args, newTarget) as XMLHttpRequest;
        try {
          const originalOpen = xhr.open;
          const descriptor = Object.getOwnPropertyDescriptor(xhr, 'open');
          const wrappedOpen = function (this: XMLHttpRequest, ...openArgs: Parameters<XMLHttpRequest['open']>) {
            // Preserve the original call, including any prior request's abort event.
            const result = originalOpen.apply(this, openArgs);
            const observed = this;
            pending.delete(observed);
            const capture = active;
            const url = capture ? sanitizedUrl(openArgs[1], openArgs[0]) : null;
            if (capture && url) {
              pending.set(observed, { capture, url });
              if (!listened.has(observed)) {
                listened.add(observed);
                observed.addEventListener('loadend', () => {
                  // Wrapped XHR may bind event callbacks to an underlying native XHR.
                  const request = pending.get(observed);
                  pending.delete(observed);
                  if (!request || !matches(request.capture)) return;
                  try {
                    if (observed.status < 200 || observed.status >= 300) return fail(request.capture);
                    if (observed.responseType === 'json') record(request.capture, request.url, observed.response);
                    else if (observed.responseType === '' || observed.responseType === 'text') record(request.capture, request.url, observed.responseText);
                    else fail(request.capture);
                  } catch { fail(request.capture); }
                });
              }
            }
            return result;
          } as XMLHttpRequest['open'];
          // Leave accessors and unpatchable instances untouched rather than alter transport behavior.
          if (descriptor && !('value' in descriptor)) throw new Error('Unsupported XHR open accessor');
          Object.defineProperty(xhr, 'open', descriptor
            ? { ...descriptor, value: wrappedOpen }
            : { value: wrappedOpen, writable: true, configurable: true });
        } catch { if (active) fail(active); }
        return xhr;
      },
    });

    globalThis.fetch = wrappedFetch;
    globalThis.XMLHttpRequest = WrappedXHR;
    scope[namespace] = {
      version: 2,
      control(action, id) {
        if (action === 'start') active = { id, records: [], count: 0, failed: false };
        if (!active || active.id !== id) return { id, records: [], failed: true };
        if (globalThis.fetch !== wrappedFetch || globalThis.XMLHttpRequest !== WrappedXHR) active.failed = true;
        const result = { id, records: action === 'read' ? active.records.splice(0) : [], failed: active.failed };
        if (action === 'close') active = undefined;
        return result;
      },
    };
  }
  const observer = scope[namespace];
  if (!observer || observer.version !== 2 || typeof observer.control !== 'function') return unavailable();
  return observer.control(operation, captureId);
}

/** Observe natural page requests without attaching a debugger, replaying APIs or retaining bodies. */
export async function captureBossHistory(tabId: number): Promise<BossHistoryCapture> {
  const id = crypto.randomUUID();
  let closed = false;
  const execute = async (operation: 'start' | 'read' | 'close') => {
    const results = await browser.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: observeHistoryInPage, args: [operation, id],
    });
    const result = results[0]?.result;
    if (!result || result.id !== id) throw new Error('无法读取页面历史观察结果');
    return result;
  };
  try {
    const initial = await execute('start');
    if (initial.failed) throw new Error('当前页面无法观察聊天历史加载状态');
  } catch (error) {
    // MAIN may have activated the capture even if its acknowledgement failed.
    await execute('close').catch(() => {});
    throw error;
  }
  const capture: BossHistoryCapture = {
    evidence: [], failed: false,
    async refresh() {
      if (closed) return;
      try {
        const snapshot = await execute('read');
        if (closed) return;
        capture.failed ||= snapshot.failed;
        for (const entry of snapshot.records) {
          const evidence = parseBossHistoryEvidence(entry.url, entry.body);
          if (!evidence || capture.evidence.length >= 100) capture.failed = true;
          else capture.evidence.push(evidence);
        }
      } catch { capture.failed = true; }
    },
    close() {
      if (closed) return;
      closed = true;
      void execute('close').catch(() => {});
    },
  };
  return capture;
}
