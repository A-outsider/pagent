import { CHANNEL } from '@/shared/contracts/channel';
import { toErrorMessage } from '@/shared/contracts/errors';
import { isProtectedUrl } from '@/shared/contracts/errors';
import {
  attachDebugger,
  captureCdpScreenshot,
  dispatchClick,
  dispatchMove,
  evaluateExpression,
  getConsoleLog,
  getNetworkLog,
  getNetworkRequest,
  insertText,
  sendCdp,
} from '@/shared/browser/cdp';
import {
  closeTab,
  createTab,
  goBack,
  goForward,
  listTabs,
  navigateTab,
  reloadTab,
  switchTab,
} from '@/shared/browser/tabs';
import { captureVisibleTab, trimDataUrl } from '@/shared/browser/screenshot';
import { callMcpTool, downloadMcpAttachment, listMcpTools } from '@/features/mcp/background/mcp-manager';
import {
  attachmentMetadataSchema,
  assertAvatarAttachment,
  uploadAttachmentSchema,
  type AttachmentTarget,
  type UploadAttachmentRequest,
  type UploadAttachmentResult,
  type UploadAttachmentOptions,
} from '@/shared/contracts/attachments';
import type { AgentSettings } from '@/shared/contracts/settings';
import type { AgentControl } from './agent-controller';
import { queryMemory, writeMemory } from '@/features/memory/service';
import { createBossService } from '@/features/boss/service';
import { createBossTaskRunner } from '@/features/boss/tasks';
import { createBossFavoritesRunner } from '@/features/boss/favorites-runner';
import { createBossFavoritesOperations } from '@/features/boss/favorites-operations';
import { resolveBossFavoritesRequest } from '@/features/boss/favorites-preferences';
import { createBossExceptionHandoff } from './boss-exception-review';
import type { BossGetFavoritesTaskRequest, BossCancelFavoritesTaskRequest, BossStartFavoritesInput, BossStartFavoritesTaskRequest, BossFavoritesExceptionTaskRequest, BossResolveFavoritesTaskRequest } from '@/shared/contracts/boss-favorites';
import type { BossAuditResumeImagesRequest, BossGetResumeImageScanRequest, BossSendResumeImagesRequest } from '@/shared/contracts/boss';
import type { BossCancelTaskRequest, BossGetTaskRequest, BossStartTaskRequest } from '@/shared/contracts/boss-task';
import { CAPTURE_CLEANUP_TIMEOUT_MS, CAPTURE_TIMEOUT_MS, withCaptureTimeout } from '@/shared/extension/capture';

const CONTENT_FILE = '/content-scripts/content.js';

const LOAD_TIMEOUT_MS = 15_000;
// Release an unanswered direct RPC before the Host's 310s response wait; not a DOM cancellation.
const DIRECT_CONTENT_WAIT_MS = 300_000;
export const bossService = createBossService(sendToContent);
export const bossTasks = createBossTaskRunner(bossService, sendToContent);
const bossExceptionHandoff = createBossExceptionHandoff({
  getTask: (tabId, taskId) => bossFavoritesTasks.get(tabId, { taskId, includeRecipients: true }),
  applyDecision: async (tabId, request) => {
    const controller = await import('./agent-controller');
    return bossFavoritesTasks.applyDecision(tabId, request, () => {
      if (controller.isAgentBusy(tabId)) throw new controller.AgentBusyError();
    });
  },
});
export const bossFavoritesTasks = createBossFavoritesRunner(createBossFavoritesOperations(sendToContent), {
  onException: (snapshot, persist, tabId) => bossExceptionHandoff.enqueue({ tabId, snapshot, persist }),
});
export const isBossTaskRunning = (tabId: number) => bossTasks.isRunning(tabId) || bossFavoritesTasks.isRunning(tabId);
export const startBossFavoritesTask = async (
  tabId: number, input: BossStartFavoritesInput & Pick<BossStartFavoritesTaskRequest, 'targetJobId'>,
  executionOwner: 'pagent' | 'external' = 'pagent',
) => {
  const request = await resolveBossFavoritesRequest(input);
  return executionOwner === 'external'
    ? bossFavoritesTasks.start(tabId, request, 'external')
    : bossFavoritesTasks.start(tabId, request);
};

function waitForTabComplete(tabId: number, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') cleanup();
    };
    const timer = setTimeout(cleanup, timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await browser.tabs.sendMessage(tabId, { channel: CHANNEL, kind: 'ping' });
    return response?.ok === true;
  } catch {
    return false;
  }
}

export async function sendToContent<T>(tabId: number, name: string, payload: unknown = {}, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  signal?.throwIfAborted();
  const deadline = timeoutMs === undefined ? undefined : new AbortController();
  const timer = deadline && setTimeout(() => deadline.abort(new Error('内容脚本响应等待超时')), timeoutMs);
  const waiting = deadline ? AbortSignal.any(signal ? [signal, deadline.signal] : [deadline.signal]) : signal;
  let dispatched = false;
  let onAbort: (() => void) | undefined;
  const operation = async () => {
    await ensureContentScript(tabId);
    waiting?.throwIfAborted();
    dispatched = true;
    const response = await browser.tabs.sendMessage(tabId, {
      channel: CHANNEL,
      kind: 'content-command',
      name,
      payload,
    });
    if (!response?.ok) throw new Error(response?.error?.message ?? `内容脚本命令失败：${name}`);
    return response.result as T;
  };
  try {
    if (!waiting) return await operation();
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(dispatched
        ? new Error(`内容脚本回执等待已中止（${name}）：${toErrorMessage(waiting.reason)}；命令已派发，页面动作结果未知，可能仍在执行；请先回读页面状态，不要盲目重发。`, { cause: waiting.reason })
        : waiting.reason);
      waiting.addEventListener('abort', onAbort, { once: true });
      if (waiting.aborted) { onAbort(); return; }
      // Both handlers remain attached after cancellation, consuming late resolves/rejections.
      operation().then(resolve, reject);
    });
  } finally {
    if (onAbort) waiting?.removeEventListener('abort', onAbort);
    if (timer !== undefined) clearTimeout(timer);
  }
}

const pendingContentScripts = new Map<number, Promise<void>>();

export function ensureContentScript(tabId: number): Promise<void> {
  const pending = pendingContentScripts.get(tabId);
  if (pending) return pending;
  const next = installContentScript(tabId).finally(() => pendingContentScripts.delete(tabId));
  pendingContentScripts.set(tabId, next);
  return next;
}

async function installContentScript(tabId: number): Promise<void> {
  if (await pingContentScript(tabId)) return;
  const tab = await browser.tabs.get(tabId);
  if (!tab.url || isProtectedUrl(tab.url)) {
    throw new Error('当前页面受浏览器保护，无法注入 Agent');
  }
  // 页面仍在加载时，manifest 注册的 content script 会在 document_idle 自动注入。
  // 此时强行 executeScript 会造成双注入，先等加载完成后再次 ping。
  if (tab.status !== 'complete') {
    await waitForTabComplete(tabId);
    if (await pingContentScript(tabId)) return;
  }
  await browser.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_FILE],
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (!await pingContentScript(tabId)) {
    throw new Error('内容脚本注入后未响应，无法在当前页面建立连接');
  }
}

export async function uploadAttachmentToTab(
  tabId: number,
  request: UploadAttachmentRequest,
  signal?: AbortSignal,
  requiredMimeType?: 'application/pdf',
  expiresAt?: number,
  avatarOnly = false,
): Promise<UploadAttachmentResult> {
  signal?.throwIfAborted();
  const parsed = uploadAttachmentSchema.safeParse(request);
  if (!parsed.success) throw new Error('附件上传参数无效');
  const { serverName, attachmentId, elementId, revision } = parsed.data;
  const target = await sendToContent<AttachmentTarget>(tabId, 'dom.attachmentTarget', { elementId, revision, ...(avatarOnly ? { avatarOnly: true } : {}) }, signal);
  signal?.throwIfAborted();
  const { attachment, bytes } = await downloadMcpAttachment(serverName, attachmentId, signal);
  signal?.throwIfAborted();
  if (requiredMimeType && attachment.mimeType !== requiredMimeType) throw new Error('简历准备阶段只允许 PDF 附件');
  if (avatarOnly) assertAvatarAttachment(attachment, bytes);
  // Chrome extension messaging uses JSON serialization: base64 stays entirely inside the extension.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  }
  return sendToContent<UploadAttachmentResult>(tabId, 'dom.assignAttachment', {
    elementId,
    ...target,
    attachment: attachmentMetadataSchema.parse(attachment),
    base64: btoa(chunks.join('')),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(avatarOnly ? { avatarOnly: true } : {}),
  }, signal);
}

export async function togglePanel(tabId: number) {
  await sendToContent(tabId, 'ui.toggle', {});
  return { ok: true };
}

export async function snapshotMentionedTab(tabId: number) {
  let tab: { title?: string; url?: string; active?: boolean };
  try {
    tab = (await browser.tabs.get(tabId)) as typeof tab;
  } catch (error) {
    return { tabId, title: '未知标签页', url: '', error: toErrorMessage(error) };
  }
  const base = {
    tabId,
    title: tab.title?.trim() || '无标题',
    url: tab.url ?? '',
    active: Boolean(tab.active),
  };
  if (!tab.url || isProtectedUrl(tab.url)) {
    return { ...base, error: '该页面受浏览器保护，无法读取内容。' };
  }
  try {
    const source = await sendToContent<{
      content?: string;
      truncated?: boolean;
      hasMore?: boolean;
    }>(tabId, 'page.source', { type: 'text', limit: 4_000 });
    return {
      ...base,
      content: source.content ?? '',
      truncated: Boolean(source.truncated || source.hasMore),
    };
  } catch (error) {
    return { ...base, error: toErrorMessage(error) };
  }
}

type BridgeExecution = {
  getTabId: () => number;
  signal: AbortSignal;
  executionOwner: 'pagent' | 'external';
  retargetTab?: (targetTabId: number) => Promise<void>;
  assertHandoff?: (request: BossFavoritesExceptionTaskRequest) => void;
};

export function createBridge(
  control: AgentControl,
  settings: AgentSettings,
  retargetAgent: (fromTabId: number, toTabId: number) => Promise<void>,
) {
  return createToolBridge({
    getTabId: () => control.tabId,
    signal: control.abort.signal,
    executionOwner: 'pagent',
    retargetTab: (targetTabId) => retargetAgent(control.tabId, targetTabId),
    assertHandoff: (request) => {
      if (!control.bossHandoff || control.bossHandoff.taskId !== request.taskId
        || control.bossHandoff.exceptionId !== request.exceptionId) {
        throw new Error('只能处理当前 Pagent 异常接管任务，不能决定其他任务或已过期异常');
      }
    },
  }, settings);
}

/** Executes against an explicit tab without an Agent session or implicit retargeting. */
export function createDirectBridge(tabId: number, settings: AgentSettings, signal = new AbortController().signal) {
  return createToolBridge({ getTabId: () => tabId, signal, executionOwner: 'external' }, settings);
}

function createToolBridge(execution: BridgeExecution, settings: AgentSettings) {
  const tabId = execution.getTabId;
  const assertHandoff = (request: BossFavoritesExceptionTaskRequest) => {
    execution.signal.throwIfAborted();
    execution.assertHandoff?.(request);
  };
  const withPage = <T,>(action: () => T, targetTabId = tabId()): T => {
    if (isBossTaskRunning(targetTabId)) {
      throw new Error('此标签页的 BOSS 后台任务正在运行，请等待完成或先停止任务');
    }
    return action();
  };
  const currentUrl = async () => (await browser.tabs.get(tabId())).url;
  const captureWithHiddenPanel = async <T>(capture: (targetTabId: number) => Promise<T>): Promise<T> => {
    const targetTabId = tabId();
    const request = { captureId: crypto.randomUUID(), deadline: Date.now() + CAPTURE_TIMEOUT_MS };
    try {
      return await withCaptureTimeout(async (signal) => {
        await sendToContent(targetTabId, 'ui.capture.start', request, signal);
        signal.throwIfAborted();
        return capture(targetTabId);
      }, CAPTURE_TIMEOUT_MS, execution.signal);
    } finally {
      await withCaptureTimeout(
        (signal) => sendToContent(targetTabId, 'ui.capture.end', request, signal),
        CAPTURE_CLEANUP_TIMEOUT_MS,
      ).catch(() => {});
    }
  };
  return {
    get tabId() {
      return tabId();
    },
    settings,
    content: <T,>(name: string, payload?: unknown, options?: { signal?: AbortSignal }) => withPage(() => sendToContent<T>(
      tabId(), name, payload,
      options?.signal ? AbortSignal.any([options.signal, execution.signal]) : execution.signal,
      execution.executionOwner === 'external' ? DIRECT_CONTENT_WAIT_MS : undefined,
    )),
    uploadAttachment: (request: UploadAttachmentRequest, options?: UploadAttachmentOptions) => withPage(async () => {
      if (!options) return uploadAttachmentToTab(tabId(), request, execution.signal);
      const timeout = new AbortController();
      const timeoutMs = options.timeoutMs ?? 30_000;
      const expiresAt = Date.now() + timeoutMs;
      const timer = setTimeout(() => timeout.abort(new Error('附件准备上传超时')), timeoutMs);
      const signal = AbortSignal.any([execution.signal, timeout.signal]);
      try {
        return await new Promise<UploadAttachmentResult>((resolve, reject) => {
          const aborted = () => reject(signal.reason);
          if (signal.aborted) return aborted();
          signal.addEventListener('abort', aborted, { once: true });
          uploadAttachmentToTab(tabId(), request, signal, options.mimeType, expiresAt, options.avatarOnly === true)
            .then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
        });
      } finally { clearTimeout(timer); }
    }),
    boss: {
      startFavoritesTask: (request: BossStartFavoritesInput) => startBossFavoritesTask(tabId(), request, execution.executionOwner),
      getFavoritesTask: (request: BossGetFavoritesTaskRequest) => bossFavoritesTasks.get(tabId(), request),
      cancelFavoritesTask: (request: BossCancelFavoritesTaskRequest) => bossFavoritesTasks.cancel(tabId(), request),
      inspectFavoritesException: (request: BossFavoritesExceptionTaskRequest) => {
        assertHandoff(request);
        return execution.executionOwner === 'external'
          ? bossFavoritesTasks.inspect(tabId(), request, 'external')
          : bossFavoritesTasks.inspect(tabId(), request);
      },
      resolveFavoritesException: (request: BossResolveFavoritesTaskRequest) => {
        assertHandoff(request);
        if (execution.executionOwner === 'pagent') return bossFavoritesTasks.resolve(tabId(), request);
        return (async () => {
          await bossFavoritesTasks.resolve(tabId(), request, 'external');
          const controller = await import('./agent-controller');
          return bossFavoritesTasks.applyDecision(tabId(), request, () => {
            execution.signal.throwIfAborted();
            if (controller.isAgentBusy(tabId())) throw new controller.AgentBusyError();
            if (isBossTaskRunning(tabId())) throw new Error('此标签页的 BOSS 后台任务正在运行，请等待完成或先停止任务');
          }, 'external');
        })();
      },
      startTask: (request: BossStartTaskRequest) => bossTasks.start(tabId(), request),
      getTask: (request: BossGetTaskRequest) => bossTasks.get(tabId(), request),
      cancelTask: (request: BossCancelTaskRequest) => bossTasks.cancel(tabId(), request),
      getResumeImageScan: (request: BossGetResumeImageScanRequest) => bossService.getResumeImageScan(tabId(), request, execution.signal),
      auditResumeImages: (request: BossAuditResumeImagesRequest) => bossService.auditResumeImages(tabId(), request, execution.signal),
      sendResumeImages: (request: BossSendResumeImagesRequest) => bossService.sendResumeImages(tabId(), request, execution.signal),
    },
    screenshot: async (fullPage?: boolean, raw?: boolean) =>
      withPage(() => captureWithHiddenPanel(async (targetTabId) => {
        if (fullPage) {
          const data = await captureCdpScreenshot(targetTabId, true);
          return raw ? data : trimDataUrl(data);
        }
        const tab = await browser.tabs.get(targetTabId);
        if (!tab.active) throw new Error('目标标签页不在窗口前台，无法截取其可见区域；请使用全页截图或手动切换后重试');
        const data = await captureVisibleTab(tab.windowId);
        if (!(await browser.tabs.get(targetTabId)).active) throw new Error('截图期间活动标签页已变化，截图已丢弃');
        return raw ? data : trimDataUrl(data);
      })),
    navigate: (url: string) => withPage(() => navigateTab(tabId(), url)),
    back: () => withPage(() => goBack(tabId())),
    forward: () => withPage(() => goForward(tabId())),
    reload: () => withPage(() => reloadTab(tabId())),
    tabs: {
      query: listTabs,
      create: async (url?: string) => {
        const tab = await withPage(() => createTab(url));
        if (tab.id) await execution.retargetTab?.(tab.id);
        return tab;
      },
      switch: async (targetId: number) => {
        const tab = await withPage(() => withPage(() => switchTab(targetId), targetId));
        await execution.retargetTab?.(targetId);
        return tab;
      },
      close: (targetId: number) => withPage(() => closeTab(targetId), targetId),
    },
    cdp: {
      script: (expression: string, awaitPromise?: boolean) =>
        withPage(() => evaluateExpression(tabId(), expression, awaitPromise)),
      command: (method: string, params?: Record<string, unknown>) =>
        withPage(() => sendCdp(tabId(), method, params)),
      input: async (payload: { x: number; y: number; type?: string; text?: string }) => {
        await withPage(() => attachDebugger(tabId()));
        if (payload.type === 'move') await dispatchMove(tabId(), payload.x, payload.y);
        else await dispatchClick(tabId(), payload.x, payload.y);
        if (payload.text) await insertText(tabId(), payload.text);
        return { ok: true };
      },
      network: (filter?: Parameters<typeof getNetworkLog>[1]) => withPage(() => getNetworkLog(tabId(), filter)),
      console: (filter?: Parameters<typeof getConsoleLog>[1]) => withPage(() => getConsoleLog(tabId(), filter)),
      request: (requestId: string, includeBody?: boolean) =>
        withPage(() => getNetworkRequest(tabId(), requestId, includeBody)),
    },
    mcp: {
      listTools: listMcpTools,
      callTool: (name: string, args: unknown) => callMcpTool(name, args),
    },
    memory: {
      search: async (query: string, limit?: number) => queryMemory(query, await currentUrl(), limit),
      write: async (content: string, scope: 'global' | 'local', memoryId?: string) =>
        writeMemory({ content, scope, memoryId, url: await currentUrl() }),
    },
  };
}
