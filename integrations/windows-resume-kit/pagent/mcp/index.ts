import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  DEFAULT_MCP_HOST_PORT,
  MCP_HOST_POLL_MS,
  MCP_HOST_PROTOCOL,
  MCP_HOST_SERVICE,
  mcpHostPortRangeLabel,
  mcpHostPorts,
  type McpHostResponse,
} from '../src/shared/contracts/mcp-host.ts';
import { createExtensionRpc } from './extension-rpc.ts';
import { listenFirstFree } from './listen.ts';
import { mcpHostRequestError, pagentExtensionOrigin } from './request-access.ts';
import { createPagentMcpServer, SERVER_NAME, SERVER_VERSION } from './server.ts';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listenPorts(): number[] {
  const range = mcpHostPorts();
  const raw = argValue('--port') ?? process.env.PAGENT_MCP_PORT;
  if (raw == null) return process.argv.includes('--strict-port') ? [17344] : range;
  const preferred = Number(raw);
  if (!Number.isInteger(preferred) || !range.includes(preferred)) {
    throw new Error(`端口 ${raw} 不在发现范围 ${mcpHostPortRangeLabel(range)}`);
  }
  return process.argv.includes('--strict-port') ? [preferred] : [preferred, ...range.filter((port) => port !== preferred)];
}

async function handleExtensionHttp(
  rpc: ReturnType<typeof createExtensionRpc>,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  boundPort: number,
): Promise<boolean> {
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/extension')) {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    });
    res.end();
    return true;
  }

  if (url.pathname === '/health') {
    const address = req.socket.localPort;
    sendJson(res, 200, {
      ok: true,
      name: SERVER_NAME,
      service: MCP_HOST_SERVICE,
      version: SERVER_VERSION,
      protocol: MCP_HOST_PROTOCOL,
      extensionConnected: rpc.isExtensionConnected(),
      extensionState: rpc.extensionState(),
      directBrowser: true,
      port: typeof address === 'number' && address > 0 ? address : boundPort,
    });
    return true;
  }

  if (url.pathname === '/extension/hello' && req.method === 'POST') {
    const raw = await readBody(req);
    let busy: boolean | undefined;
    try {
      const payload = raw ? JSON.parse(raw) : {};
      if (typeof payload?.busy === 'boolean') busy = payload.busy;
    } catch {
      sendJson(res, 400, { ok: false, error: '无效 JSON' });
      return true;
    }
    rpc.touch(busy);
    sendJson(res, 200, { ok: true, protocol: MCP_HOST_PROTOCOL });
    return true;
  }

  if (url.pathname === '/extension/rpc' && req.method === 'GET') {
    rpc.touch();
    const wait = Number(url.searchParams.get('wait') ?? MCP_HOST_POLL_MS);
    const request = await rpc.takeRequest(Number.isFinite(wait) ? Math.min(Math.max(wait, 0), 60_000) : MCP_HOST_POLL_MS);
    if (!request) {
      res.writeHead(204).end();
      return true;
    }
    sendJson(res, 200, request);
    return true;
  }

  const replyMatch = url.pathname.match(/^\/extension\/rpc\/([^/]+)$/);
  if (replyMatch && req.method === 'POST') {
    rpc.touch();
    const id = decodeURIComponent(replyMatch[1] ?? '');
    const raw = await readBody(req);
    let payload: Partial<McpHostResponse> = {};
    try {
      payload = raw ? (JSON.parse(raw) as Partial<McpHostResponse>) : {};
    } catch {
      sendJson(res, 400, { ok: false, error: '无效 JSON' });
      return true;
    }
    rpc.complete({
      v: MCP_HOST_PROTOCOL,
      id,
      ok: payload.ok !== false,
      result: payload.result,
      error: payload.error,
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function handleMcpHttp(req: IncomingMessage, res: ServerResponse, url: URL, callExtension: ReturnType<typeof createExtensionRpc>['callExtension']) {
  if (req.method === 'OPTIONS' && url.pathname === '/mcp') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, mcp-session-id',
    });
    res.end();
    return;
  }
  if (url.pathname !== '/mcp') {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  const server = createPagentMcpServer(callExtension);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res);
  } finally {
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.error(`Pagent MCP 服务 ${SERVER_VERSION}
用法: pnpm mcp [--port ${DEFAULT_MCP_HOST_PORT}] [--stdio] [--http-only] [--strict-port]

在 127.0.0.1:${mcpHostPortRangeLabel()} 内寻找空闲端口并监听；扩展在同一范围内发现服务。
--port 必须落在该范围内，并作为优先尝试的端口。
--strict-port 仅监听指定端口（默认 17344），占用时直接报错。
运行前必须将 PAGENT_EXTENSION_ID 设置为已安装的 Pagent Chrome 扩展 ID。
由 MCP 客户端以管道方式拉起时同时启用 stdio。交互式终端下默认不占用 stdin；需要时可加 --stdio。
`);
    process.exit(0);
  }

  const extensionOrigin = pagentExtensionOrigin(process.env.PAGENT_EXTENSION_ID);
  const ports = listenPorts();
  const rpc = createExtensionRpc();
  let boundPort = ports[0]!;
  const httpServer = createServer((req, res) => {
    const denied = mcpHostRequestError(req.headers.host, req.headers.origin, boundPort, extensionOrigin);
    if (denied) {
      sendJson(res, 403, { error: denied });
      return;
    }
    if (req.headers.origin !== undefined) {
      res.setHeader('Access-Control-Allow-Origin', extensionOrigin);
      res.setHeader('Vary', 'Origin');
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${boundPort}`);
    void handleExtensionHttp(rpc, req, res, url, boundPort)
      .then(async (handled) => {
        if (handled) return;
        await handleMcpHttp(req, res, url, rpc.callExtension);
      })
      .catch((error) => {
        if (!res.headersSent) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
  });

  boundPort = await listenFirstFree(httpServer, ports);
  console.error(`Pagent MCP Host 监听 127.0.0.1:${boundPort}（范围 ${mcpHostPortRangeLabel()}），等待扩展连接`);

  const httpOnly = process.argv.includes('--http-only');
  const forceStdio = process.argv.includes('--stdio');
  const useStdio = !httpOnly && (forceStdio || !process.stdin.isTTY);
  let stdioServer: ReturnType<typeof createPagentMcpServer> | undefined;
  if (useStdio) {
    stdioServer = createPagentMcpServer(rpc.callExtension);
    await stdioServer.connect(new StdioServerTransport());
    console.error('已启用 MCP stdio');
  } else {
    console.error(`HTTP MCP：http://127.0.0.1:${boundPort}/mcp`);
  }

  const shutdown = async () => {
    await stdioServer?.close().catch(() => undefined);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
