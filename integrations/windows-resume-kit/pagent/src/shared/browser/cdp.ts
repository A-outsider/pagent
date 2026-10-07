import { redactText } from '@/shared/contracts/policy';
import { truncate } from '@/shared/utils/utils';
import {
  applyCdpEvent,
  createDevtoolsStore,
  getNetworkEntry,
  isTextualMime,
  listConsole,
  listNetwork,
  summarizeNetwork,
  type ConsoleFilter,
  type DevtoolsStore,
  type NetworkFilter,
} from './devtools-log';

type Debuggee = { tabId: number };

type Session = {
  tabId: number;
  attached: boolean;
};

type ChromeDebugger = {
  attach(target: Debuggee, version: string): Promise<void> | void;
  detach(target: Debuggee): Promise<void> | void;
  sendCommand(
    target: Debuggee,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
  onDetach: {
    addListener(listener: (source: Debuggee) => void): void;
  };
  onEvent?: {
    addListener(
      listener: (source: Debuggee, method: string, params?: Record<string, unknown>) => void,
    ): void;
  };
};

const sessions = new Map<number, Session>();
const stores = new Map<number, DevtoolsStore>();
let debuggerHooked = false;

const JUST_ENABLED_NOTICE =
  '此前未开启调试，现已开启调试并开始采集。本次调用之前的事件不可见；请复现操作或刷新页面后再查询。';

type DebuggerHost = {
  chrome?: Record<string, unknown>;
  browser?: Record<string, unknown>;
};

export function resolveDebuggerApi(globals: DebuggerHost = globalThis as DebuggerHost): ChromeDebugger | undefined {
  const fromChrome = globals.chrome?.debugger;
  const fromBrowser = globals.browser?.debugger;
  if (fromChrome && typeof fromChrome === 'object') return fromChrome as ChromeDebugger;
  if (fromBrowser && typeof fromBrowser === 'object') return fromBrowser as ChromeDebugger;
  return undefined;
}

function hookDebugger(api: ChromeDebugger) {
  if (debuggerHooked) return;
  debuggerHooked = true;
  api.onDetach.addListener((source) => {
    if (source.tabId == null) return;
    sessions.delete(source.tabId);
    stores.delete(source.tabId);
  });
  api.onEvent?.addListener((source, method, params) => {
    if (source.tabId == null) return;
    const store = stores.get(source.tabId);
    if (!store?.capturing) return;
    applyCdpEvent(store, method, params ?? {});
  });
}

async function requireDebugger(): Promise<ChromeDebugger> {
  const api = resolveDebuggerApi();
  if (api) {
    hookDebugger(api);
    return api;
  }

  let granted = false;
  try {
    granted = await browser.permissions.contains({ permissions: ['debugger'] });
  } catch {
    granted = false;
  }

  if (!granted) {
    throw new Error('尚未授予调试器权限。请重新加载扩展并允许「调试器」权限，然后在设置中开启 CDP。');
  }

  throw new Error('已有调试器权限，但当前后台还未加载 chrome.debugger。请到 chrome://extensions 重新加载 Pagent。');
}

function target(tabId: number): Debuggee {
  return { tabId };
}

export async function attachDebugger(tabId: number): Promise<void> {
  const existing = sessions.get(tabId);
  if (existing?.attached) return;
  const api = await requireDebugger();
  try {
    await api.attach(target(tabId), '1.3');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already attached/i.test(message)) throw error;
  }
  sessions.set(tabId, { tabId, attached: true });
}

export async function detachDebugger(tabId: number): Promise<void> {
  try {
    await (await requireDebugger()).detach(target(tabId));
  } catch {
    // already detached
  }
  sessions.delete(tabId);
  stores.delete(tabId);
}

export async function startDevtoolsCapture(tabId: number): Promise<{ store: DevtoolsStore; justEnabled: boolean }> {
  const alreadyCapturing = Boolean(stores.get(tabId)?.capturing && sessions.get(tabId)?.attached);
  await attachDebugger(tabId);
  const existing = stores.get(tabId);
  if (existing?.capturing) return { store: existing, justEnabled: !alreadyCapturing };
  const store = existing ?? createDevtoolsStore();
  stores.set(tabId, store);
  const api = await requireDebugger();
  await api.sendCommand(target(tabId), 'Network.enable', {});
  await api.sendCommand(target(tabId), 'Runtime.enable', {});
  try {
    await api.sendCommand(target(tabId), 'Log.enable', {});
  } catch {
    // Log domain is optional
  }
  store.capturing = true;
  store.startedAt = Date.now();
  return { store, justEnabled: true };
}

function requireStore(tabId: number): DevtoolsStore {
  return stores.get(tabId) ?? createDevtoolsStore();
}

function withCaptureMeta<T extends Record<string, unknown>>(payload: T, justEnabled: boolean) {
  return justEnabled ? { justEnabled, notice: JUST_ENABLED_NOTICE, ...payload } : { justEnabled, ...payload };
}

export async function getNetworkLog(tabId: number, filter: NetworkFilter = {}) {
  const { store, justEnabled } = await startDevtoolsCapture(tabId);
  const entries = listNetwork(store, filter).map(summarizeNetwork);
  return withCaptureMeta({
    capturing: store.capturing,
    startedAt: store.startedAt,
    total: store.networkOrder.length,
    count: entries.length,
    entries,
  }, justEnabled);
}

export async function getConsoleLog(tabId: number, filter: ConsoleFilter = {}) {
  const { store, justEnabled } = await startDevtoolsCapture(tabId);
  const entries = listConsole(store, filter);
  return withCaptureMeta({
    capturing: store.capturing,
    startedAt: store.startedAt,
    total: store.console.length,
    count: entries.length,
    entries,
  }, justEnabled);
}

export async function getNetworkRequest(
  tabId: number,
  requestId: string,
  includeBody = false,
) {
  const { justEnabled } = await startDevtoolsCapture(tabId);
  const entry = getNetworkEntry(requireStore(tabId), requestId);
  if (!entry) {
    return withCaptureMeta({ error: '未找到该请求。requestId 来自 get_network_log。' }, justEnabled);
  }

  if (!includeBody) return withCaptureMeta({ ...entry }, justEnabled);

  if (!isTextualMime(entry.mimeType)) {
    return withCaptureMeta({ ...entry, bodyNote: '非文本响应，已省略正文' }, justEnabled);
  }

  try {
    const result = await sendCdp<{ body?: string; base64Encoded?: boolean }>(
      tabId,
      'Network.getResponseBody',
      { requestId },
    );
    let text = result.body ?? '';
    if (result.base64Encoded && text) {
      try {
        text = atob(text);
      } catch {
        return withCaptureMeta({ ...entry, bodyNote: '无法解码 base64 正文' }, justEnabled);
      }
    }
    return withCaptureMeta({ ...entry, body: truncate(redactText(text), 6000) }, justEnabled);
  } catch {
    return withCaptureMeta({ ...entry, bodyNote: '无法读取响应体（可能已丢弃、跨源或过大）' }, justEnabled);
  }
}

export async function sendCdp<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  await attachDebugger(tabId);
  const api = await requireDebugger();
  return api.sendCommand(target(tabId), method, params) as Promise<T>;
}

export async function evaluateExpression(
  tabId: number,
  expression: string,
  awaitPromise = true,
): Promise<unknown> {
  const result = await sendCdp<{
    result?: { value?: unknown; description?: string };
    exceptionDetails?: { text?: string };
  }>(tabId, 'Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails?.text) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result?.value ?? result.result?.description ?? null;
}

export async function dispatchClick(tabId: number, x: number, y: number): Promise<void> {
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
}

export async function dispatchMove(tabId: number, x: number, y: number): Promise<void> {
  await sendCdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
}

export async function insertText(tabId: number, text: string): Promise<void> {
  await sendCdp(tabId, 'Input.insertText', { text });
}

export async function captureCdpScreenshot(tabId: number, fullPage = false): Promise<string> {
  if (fullPage) {
    const metrics = await sendCdp<{ contentSize?: { width: number; height: number } }>(
      tabId,
      'Page.getLayoutMetrics',
    );
    const width = Math.ceil(metrics.contentSize?.width ?? 1280);
    const height = Math.min(Math.ceil(metrics.contentSize?.height ?? 720), 8000);
    await sendCdp(tabId, 'Emulation.setDeviceMetricsOverride', {
      mobile: false,
      width,
      height,
      deviceScaleFactor: 1,
    });
  }
  const shot = await sendCdp<{ data: string }>(tabId, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: fullPage,
  });
  if (fullPage) {
    try {
      await sendCdp(tabId, 'Emulation.clearDeviceMetricsOverride');
    } catch {
      // ignore
    }
  }
  return `data:image/png;base64,${shot.data}`;
}
