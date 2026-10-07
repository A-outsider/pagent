import { randomUUID } from 'node:crypto';
import { DEFAULT_MCP_HOST_PORT, MCP_HOST_CONNECTED_MS, MCP_HOST_POLL_MS, MCP_HOST_PROTOCOL, } from '../src/shared/contracts/mcp-host.js';
export function createExtensionRpc() {
    const queue = [];
    const waiters = [];
    const pending = new Map();
    const executing = new Set();
    let lastSeen = 0;
    const touch = (busy) => {
        lastSeen = Date.now();
        // An initial hello after an extension reload replaces the old execution session.
        if (busy === false)
            executing.clear();
    };
    const isExtensionConnected = () => lastSeen > 0 && Date.now() - lastSeen < MCP_HOST_CONNECTED_MS;
    const extensionState = () => !isExtensionConnected() ? 'offline' : executing.size ? 'busy' : 'idle';
    const takeRequest = (waitMs = MCP_HOST_POLL_MS) => new Promise((resolve) => {
        const next = queue.shift();
        if (next) {
            executing.add(next.id);
            resolve(next);
            return;
        }
        const timer = setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0)
                waiters.splice(index, 1);
            resolve(null);
        }, waitMs);
        const waiter = (request) => {
            clearTimeout(timer);
            if (request)
                executing.add(request.id);
            resolve(request);
        };
        waiters.push(waiter);
    });
    const complete = (response) => {
        executing.delete(response.id);
        const waiter = pending.get(response.id);
        if (!waiter)
            return;
        pending.delete(response.id);
        if (response.ok)
            waiter.resolve(response.result);
        else
            waiter.reject(new Error(response.error || '扩展执行失败'));
    };
    const callExtension = (method, params, timeoutMs = 20_000) => {
        if (!isExtensionConnected()) {
            return Promise.reject(new Error('Pagent 扩展未连接。请确认浏览器已加载 Pagent，并且本 MCP 服务正在运行。'));
        }
        const id = randomUUID();
        const request = { v: MCP_HOST_PROTOCOL, id, method, params };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                const queued = queue.findIndex((item) => item.id === id);
                if (queued >= 0)
                    queue.splice(queued, 1);
                reject(new Error(`等待扩展响应超时（${method}）：${queued >= 0
                    ? '请求尚未交给扩展，已移出队列，未执行。'
                    : '请求已交给扩展，仍可能正在执行；请先回读页面状态，不要盲目重复写入、上传或发送。'}`));
            }, timeoutMs);
            pending.set(id, {
                resolve: (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
            const waiter = waiters.shift();
            if (waiter)
                waiter(request);
            else
                queue.push(request);
        });
    };
    return { touch, isExtensionConnected, extensionState, takeRequest, complete, callExtension };
}
export { DEFAULT_MCP_HOST_PORT };
