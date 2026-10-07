import { tool } from 'langchain';
import { z } from 'zod';
import { safeJson } from '@/shared/utils/utils';
import type { ToolBridge } from './types';

const HOST = '[id^="jsNowcoderChromeExtensionMenuContainer_"]';
const OPEN_TOOL = 'resume_open_nowcoder_panel';
type Stage = { text: string; status: string };
type Snapshot = { available: boolean; reason?: string; busy?: boolean; clicked?: boolean; stages?: Stage[]; error?: string };
type Identity = { url: string; timeOrigin: number };

// Runs synchronously on the resolved, closed shadow root. Never reads extension
// storage or framework state, and never escapes this known helper's DOM.
function inspectHelper(this: ShadowRoot, expected: Identity, deadline: number, click: boolean): Snapshot {
  const root = this;
  if (Date.now() >= deadline) return { available: false, reason: 'deadline_expired' };
  if (!root.host?.isConnected || root.ownerDocument !== document || location.href !== expected.url || performance.timeOrigin !== expected.timeOrigin) {
    return { available: false, reason: 'page_changed' };
  }
  if (!root.host.id.startsWith('jsNowcoderChromeExtensionMenuContainer_')) return { available: false, reason: 'unexpected_host' };
  const panel = root.querySelector('.nc-ext-overlay-panel');
  const buttons = panel?.querySelectorAll<HTMLElement>('.fill-increment-btn');
  if (!panel) return { available: false, reason: 'panel_closed' };
  if (!buttons?.length) return { available: false, reason: 'login_required_or_button_missing' };
  if (buttons.length !== 1) return { available: false, reason: 'ambiguous_button' };
  const button = buttons[0]!;
  const label = (button.textContent ?? '').trim();
  if (!/^补充填写(?:中)?$/.test(label)) return { available: false, reason: 'unexpected_button' };
  const style = getComputedStyle(button);
  if (!button.getClientRects().length || style.display === 'none' || style.visibility === 'hidden') return { available: false, reason: 'button_hidden' };
  const busy = button.classList.contains('loading') || label === '补充填写中';
  const stages = [...panel.querySelectorAll('.fill-status-card .status-item')].slice(0, 4).map(item => ({
    text: (item.querySelector('.status-text')?.textContent ?? '').trim().slice(0, 200),
    status: item.querySelector('.status-icon.is-loading') ? 'loading' : item.querySelector('.status-icon.is-success') ? 'success' : 'pending',
  }));
  const error = [...root.querySelectorAll('.el-message--error')].map(item => item.textContent?.trim() ?? '').join(' ').slice(0, 300);
  if (click && !busy) {
    if (button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled')) return { available: false, reason: 'button_disabled' };
    button.click();
    return { available: true, busy, clicked: true, stages };
  }
  return { available: true, busy, stages, ...(error ? { error } : {}) };
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error('任务已停止');
    error.name = 'AbortError';
    throw error;
  }
}

async function bounded<T>(operation: () => Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
  aborted(signal);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('nowcoder_timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('nowcoder_timeout')), remaining);
        onAbort = () => { const error = new Error('任务已停止'); error.name = 'AbortError'; reject(error); };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export function createNowcoderTools(bridge: ToolBridge) {
  // One helper attempt per document/URL in this agent run, including uncertain
  // dispatches. Repeating a model call can only read/wait, never click again.
  const attempted = new Set<string>();
  const nativeAttempted = new Set<string>();
  let running: Promise<string> | undefined;
  return [tool(async ({ timeoutMs }, config) => {
    aborted(config.signal);
    if (running) return safeJson({ status: 'already_running', continue: true, clicked: false, reason: '本轮牛客补填已经启动，不要重复调用' });
    const execute = async () => {
      const deadline = Date.now() + timeoutMs;
      let clicked = false;
      let attemptStarted = false;
      let nativeStatus: string | undefined;
      let openedNatively = false;
      let objectId: string | undefined;
      let stages: Stage[] = [];
      const finish = (status: string, reason?: string) => safeJson({
        status, continue: true, clicked, attemptStarted, nativeAttempted: openedNatively,
        ...(nativeStatus ? { nativeStatus } : {}), ...(reason ? { reason } : {}), stages,
        next: '重新观察当前表单，按简历来源补齐并复查。牛客结果不是字段核验；不重复启动牛客，不提交申请。',
      });
      const command = <T>(method: string, params?: Record<string, unknown>, callDeadline = Math.min(deadline, Date.now() + 10_000)) => bounded(
        () => bridge.cdp.command(method, params) as Promise<T>, callDeadline, config.signal,
      );
      try {
        const identity = await bounded(() => bridge.cdp.script('({url:location.href,timeOrigin:performance.timeOrigin})', false), Math.min(deadline, Date.now() + 10_000), config.signal) as Identity;
        aborted(config.signal);
        if (!identity || !/^https?:\/\//.test(identity.url) || !Number.isFinite(identity.timeOrigin)) return finish('not_available', 'unsupported_page');
        const key = `${identity.timeOrigin}:${identity.url}`;
        if (attempted.has(key)) return finish('already_attempted', '本轮已经尝试或等待过牛客补填，不重复点击');
        const resolveRoot = async (): Promise<string | undefined> => {
          const doc = await command<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 });
          const hosts = await command<{ nodeIds: number[] }>('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: HOST });
          if (hosts.nodeIds.length !== 1) return hosts.nodeIds.length ? 'ambiguous_helper_host' : 'helper_not_injected';
          const host = await command<{ node: { shadowRoots?: { backendNodeId: number }[] } }>('DOM.describeNode', { nodeId: hosts.nodeIds[0], depth: 1, pierce: true });
          if (host.node.shadowRoots?.length !== 1) return 'helper_shadow_root_missing';
          const resolved = await command<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId: host.node.shadowRoots[0]!.backendNodeId });
          if (objectId && objectId !== resolved.object.objectId) void bridge.cdp.command('Runtime.releaseObject', { objectId }).catch(() => {});
          objectId = resolved.object.objectId;
          return objectId ? undefined : 'helper_shadow_root_unavailable';
        };
        const inspect = async (click: boolean) => {
          aborted(config.signal);
          const callDeadline = Math.min(deadline, Date.now() + 10_000);
          const result = await command<{ result?: { value?: Snapshot }; exceptionDetails?: unknown }>('Runtime.callFunctionOn', {
            objectId, functionDeclaration: inspectHelper.toString(),
            arguments: [{ value: identity }, { value: callDeadline }, { value: click }], returnByValue: true, userGesture: click,
          }, callDeadline);
          aborted(config.signal);
          if (result.exceptionDetails || !result.result?.value) throw new Error('helper_inspection_failed');
          return result.result.value;
        };
        const read = async (): Promise<Snapshot> => {
          const reason = await resolveRoot();
          return reason ? { available: false, reason } : inspect(false);
        };
        let state = await read();
        if (!state.available && ['helper_not_injected', 'panel_closed'].includes(state.reason ?? '')) {
          // The optional local MCP performs only the known native toolbar action.
          // Never pretend that another extension's action is a page DOM button.
          if (nativeAttempted.has(key)) return finish('not_available', 'native_open_already_attempted');
          const tools = await bounded(() => bridge.mcp.listTools(), Math.min(deadline, Date.now() + 10_000), config.signal);
          if (tools.filter(meta => meta.name === OPEN_TOOL).length !== 1) return finish('not_available', 'native_open_tool_unavailable');
          aborted(config.signal);
          nativeAttempted.add(key); openedNatively = true;
          const nativeDeadline = Math.min(deadline, Date.now() + 10_000);
          const raw = await bounded(() => bridge.mcp.callTool(OPEN_TOOL, { expectedUrl: identity.url, deadlineMs: nativeDeadline }), nativeDeadline, config.signal);
          aborted(config.signal);
          let result: { status?: string; reason?: string };
          try { result = JSON.parse(raw); } catch { result = JSON.parse(raw.split('\n')[0]!); }
          nativeStatus = result.status;
          if (nativeStatus !== 'pressed') return finish('not_available', result.reason ?? nativeStatus ?? 'native_open_unconfirmed');
          const mountedDeadline = Math.min(deadline, Date.now() + 5_000);
          do {
            state = await read();
            if (state.available || !['helper_not_injected', 'panel_closed'].includes(state.reason ?? '')) break;
            await bounded(() => new Promise<void>(resolve => setTimeout(resolve, 250)), deadline, config.signal);
          } while (Date.now() < mountedDeadline);
        }
        if (!state.available) return finish('not_available', state.reason);
        stages = state.stages ?? [];
        const initialStages = JSON.stringify(stages);
        let observedBusy = !!state.busy;
        attempted.add(key);
        attemptStarted = true;
        if (!state.busy) {
          // No asynchronous work follows the in-page deadline/identity check
          // before click. A command delivered after its timeout cannot click.
          state = await inspect(true);
          clicked = !!state.clicked;
          if (!state.available) return finish('not_available', state.reason);
        }
        const started = Date.now();
        while (Date.now() < deadline) {
          await bounded(() => new Promise<void>(resolve => setTimeout(resolve, 250)), deadline, config.signal);
          state = await inspect(false);
          if (!state.available) return finish('unconfirmed', state.reason);
          stages = state.stages ?? [];
          observedBusy ||= !!state.busy;
          if (state.busy) continue;
          if (state.error) return finish('failed', state.error);
          const completed = stages.some(stage => stage.status === 'success' && /填写已完成|0\s*个字段待填写/.test(stage.text));
          if (completed && (observedBusy || JSON.stringify(stages) !== initialStages)) return finish('completed');
          if (observedBusy || Date.now() - started >= 1_500) return finish('unconfirmed', '插件已空闲，未得到新的完成回执；继续检查真实表单');
        }
        return finish('still_running', '牛客仍未确认结束，可能还在运行；不要重复点击，继续观察表单');
      } catch (error) {
        aborted(config.signal);
        return finish(error instanceof Error && error.message === 'nowcoder_timeout' ? (attemptStarted ? 'still_running' : 'timed_out') : 'failed', '牛客补填不可用或未完成，继续 Pagent 补齐；不重复点击');
      } finally {
        // Read-only remote object cleanup must not delay the agent on a dead tab.
        if (objectId) void bridge.cdp.command('Runtime.releaseObject', { objectId }).catch(() => {});
      }
    };
    running = execute();
    try { return await running; } finally { running = undefined; }
  }, {
    name: 'run_nowcoder_fill',
    description: 'PDF准备后仅尝试一次牛客网申助手“补充填写”，有限等待并返回阶段摘要。面板未注入或已关闭时，仅通过可用的本地MCP固定入口尝试一次原生工具栏按钮；权限不足/页面不一致/不可用即继续Pagent。面板已开不触发工具栏，busy只等待；只点原补充填写按钮，不调用“一键填写”、不提交。失败/超时不阻断简历任务，不重复启动牛客。之后重新观察页面，按MCP简历核验全部已知字段、经历与遗漏；data-nc-filled和粉红标记均不是实际填写成功/失败证据。',
    schema: z.object({ timeoutMs: z.number().int().min(2_000).max(60_000).default(60_000) }),
  })];
}
