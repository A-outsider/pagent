import {
  MCP_HOST_METHODS,
  MCP_HOST_HEARTBEAT_MS,
  MCP_HOST_POLL_MS,
  MCP_HOST_PROTOCOL,
  type McpHostMethod,
  type McpHostRequest,
  type McpHostResponse,
} from '@/shared/contracts/mcp-host';
import { beginBusyKeepAlive, endBusyKeepAlive } from '@/shared/extension/keepalive';
import { discoverMcpHost } from './host-discover';
import { handleHostMethod, hostMethodError } from './host-handlers';

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5_000;

type LiveHost = { port: number; base: string };

function hostBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function isHostMethod(value: unknown): value is McpHostMethod {
  return typeof value === 'string' && (MCP_HOST_METHODS as readonly string[]).includes(value);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`MCP Host 返回了无法解析的 JSON（HTTP ${response.status}）`);
  }
}

async function hello(host: LiveHost, signal: AbortSignal, busy = false): Promise<void> {
  const response = await fetch(`${host.base}/extension/hello`, {
    method: 'POST',
    signal,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: MCP_HOST_PROTOCOL, busy }),
  });
  if (!response.ok) throw new Error(`MCP Host hello 失败：HTTP ${response.status}`);
}

async function poll(host: LiveHost, signal: AbortSignal): Promise<McpHostRequest | null> {
  const response = await fetch(`${host.base}/extension/rpc?wait=${MCP_HOST_POLL_MS}`, {
    method: 'GET',
    signal,
    cache: 'no-store',
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`MCP Host 拉取任务失败：HTTP ${response.status}`);
  const payload = await readJson(response);
  if (!payload || typeof payload !== 'object') return null;
  const item = payload as Partial<McpHostRequest>;
  if (typeof item.id !== 'string' || !isHostMethod(item.method)) {
    throw new Error('MCP Host 返回了无效的任务');
  }
  return { v: MCP_HOST_PROTOCOL, id: item.id, method: item.method, params: item.params };
}

async function reply(host: LiveHost, id: string, body: McpHostResponse, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${host.base}/extension/rpc/${encodeURIComponent(id)}`, {
    method: 'POST',
    signal,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`MCP Host 回写失败：HTTP ${response.status}`);
}

async function runRequest(host: LiveHost, request: McpHostRequest, signal: AbortSignal): Promise<void> {
  // Dispatch stays serial; a long tool must not suspend the host's liveness signal.
  const heartbeat = setInterval(() => {
    void hello(host, AbortSignal.any([signal, AbortSignal.timeout(5_000)]), true).catch(() => {});
  }, MCP_HOST_HEARTBEAT_MS);
  try {
    const result = await handleHostMethod(request.method, request.params);
    await reply(
      host,
      request.id,
      { v: MCP_HOST_PROTOCOL, id: request.id, ok: true, result },
      signal,
    );
  } catch (error) {
    await reply(
      host,
      request.id,
      { v: MCP_HOST_PROTOCOL, id: request.id, ok: false, error: hostMethodError(error) },
      signal,
    );
  } finally {
    clearInterval(heartbeat);
  }
}

async function runSession(
  signal: AbortSignal,
  preferPort: number | undefined,
  onConnected: (port: number) => void,
): Promise<void> {
  const port = await discoverMcpHost({ signal, preferPort });
  if (port == null) throw new Error('未在端口范围内发现 Pagent MCP Host');
  const host: LiveHost = { port, base: hostBase(port) };
  await hello(host, signal);
  onConnected(port);
  beginBusyKeepAlive();
  try {
    while (!signal.aborted) {
      const request = await poll(host, signal);
      if (!request) continue;
      await runRequest(host, request, signal);
    }
  } finally {
    endBusyKeepAlive();
  }
}

/** 在约定端口范围内发现并连接 MCP 服务；未找到时静默重试。 */
export function startMcpHostClient(): () => void {
  const abort = new AbortController();
  let backoff = MIN_BACKOFF_MS;
  let connected = false;
  let lastPort: number | undefined;

  const loop = async () => {
    while (!abort.signal.aborted) {
      try {
        await runSession(abort.signal, lastPort, (port) => {
          lastPort = port;
          connected = true;
          backoff = MIN_BACKOFF_MS;
        });
      } catch (error) {
        if (abort.signal.aborted) return;
        if (connected) console.warn('Pagent MCP Host 已断开', error);
        connected = false;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  };

  void loop();
  return () => abort.abort();
}
