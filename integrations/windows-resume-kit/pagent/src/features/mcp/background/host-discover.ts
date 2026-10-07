import {
  MCP_HOST_DISCOVER_TIMEOUT_MS,
  isMcpHostHealth,
  mcpHostPorts,
  preferMcpHost,
} from '@/shared/contracts/mcp-host';

export type DiscoveredHost = {
  port: number;
  extensionConnected: boolean;
  directBrowser?: boolean;
};

function probeSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!parent) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([timeout, parent]);
  return timeout;
}

export async function probeMcpHostPort(
  port: number,
  options?: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<DiscoveredHost | null> {
  const fetchImpl = options?.fetch ?? fetch;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: probeSignal(options?.timeoutMs ?? MCP_HOST_DISCOVER_TIMEOUT_MS, options?.signal),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isMcpHostHealth(body)) return null;
    return { port, extensionConnected: body.extensionConnected, directBrowser: body.directBrowser === true };
  } catch {
    return null;
  }
}

/** 在约定端口范围内并行探测 Pagent MCP Host。 */
export async function discoverMcpHost(options?: {
  fetch?: typeof fetch;
  ports?: number[];
  timeoutMs?: number;
  signal?: AbortSignal;
  preferPort?: number;
}): Promise<number | null> {
  const ports = options?.ports ?? mcpHostPorts();
  const found = (
    await Promise.all(ports.map((port) => probeMcpHostPort(port, options)))
  ).filter((item): item is DiscoveredHost => item != null);
  return preferMcpHost(found, options?.preferPort)?.port ?? null;
}
