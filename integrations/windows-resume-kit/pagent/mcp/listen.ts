import type { Server } from 'node:http';
import { mcpHostPortRangeLabel } from '../src/shared/contracts/mcp-host.ts';

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** 按顺序尝试端口，跳过 EADDRINUSE，绑定第一个空闲端口。 */
export async function listenFirstFree(
  server: Server,
  ports: number[],
  host = '127.0.0.1',
): Promise<number> {
  if (!ports.length) throw new Error('没有可监听的端口');
  for (const port of ports) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          reject(error);
        };
        server.once('error', onError);
        server.listen(port, host, () => {
          server.off('error', onError);
          resolve();
        });
      });
      return port;
    } catch (error) {
      if (errorCode(error) !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`127.0.0.1:${mcpHostPortRangeLabel(ports)} 范围内没有空闲端口`);
}
