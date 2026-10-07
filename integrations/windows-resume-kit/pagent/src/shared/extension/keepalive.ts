export const KEEPALIVE_PORT = 'pagent-keepalive';
export const KEEPALIVE_INTERVAL_MS = 20_000;
export const BUSY_INTERVAL_MS = 10_000;

let busyCount = 0;
let busyTimer: ReturnType<typeof setInterval> | undefined;

export function isTransientRuntimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|The message port closed|Could not establish connection/i.test(
    message,
  );
}

const NO_RETRY_RPC = new Set(['agent.start', 'agent.stop']);

export function shouldRetryRpc(name: string, error: unknown): boolean {
  if (NO_RETRY_RPC.has(name)) return false;
  return isTransientRuntimeError(error);
}

export async function touchServiceWorker(): Promise<void> {
  await browser.runtime.getPlatformInfo();
}

export function beginBusyKeepAlive() {
  busyCount += 1;
  if (busyTimer) return;
  busyTimer = setInterval(() => {
    void touchServiceWorker();
  }, BUSY_INTERVAL_MS);
  void touchServiceWorker();
}

export function endBusyKeepAlive() {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount > 0 || !busyTimer) return;
  clearInterval(busyTimer);
  busyTimer = undefined;
}

export function installServiceWorkerKeepAlive() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== KEEPALIVE_PORT) return;
    port.onMessage.addListener(() => {
      try {
        port.postMessage({ t: Date.now() });
      } catch {
        // port already closed
      }
    });
  });
}

export function startClientKeepAlive(): () => void {
  let stopped = false;
  let port: { postMessage: (message: unknown) => void; disconnect: () => void } | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (stopped || port) return;
    try {
      const next = browser.runtime.connect({ name: KEEPALIVE_PORT });
      port = next;
      next.onDisconnect.addListener(() => {
        if (port !== next) return;
        port = undefined;
        if (stopped || reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined;
          connect();
        }, 400);
      });
      next.postMessage({ t: Date.now() });
    } catch {
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, 1_000);
    }
  };

  connect();
  const heartbeat = setInterval(() => {
    try {
      port?.postMessage({ t: Date.now() });
    } catch {
      port = undefined;
      connect();
    }
  }, KEEPALIVE_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(heartbeat);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    try {
      port?.disconnect();
    } catch {
      // port already closed
    }
    port = undefined;
  };
}
