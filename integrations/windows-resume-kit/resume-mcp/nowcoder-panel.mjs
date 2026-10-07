import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./nowcoder-panel.applescript', import.meta.url));
const REASONS = Object.freeze({
  pressed: '已按一次牛客工具栏按钮；面板是否出现仍需页面观察确认。',
  url_mismatch: 'Chrome 当前标签页与本轮目标 URL 不一致，未操作。',
  chrome_not_frontmost: 'Google Chrome 当前不在前台，未切换应用。',
  browser_not_running: 'Google Chrome 未运行，未启动浏览器。',
  no_window: 'Google Chrome 当前没有可用窗口。',
  window_changed: '执行期间 Chrome 当前窗口或标签页已变化，未操作。',
  button_not_found: '当前 Chrome 工具栏中未找到牛客网申助手按钮。',
  ambiguous_button: '当前工具栏中有多个牛客网申助手按钮，未操作。',
  permission_required: '系统尚未允许本地进程访问 Chrome 或辅助功能；需要用户完成一次系统授权，本轮继续其他阶段。',
  timeout: '本次打开面板操作已超时或请求已过期，不自动重试。',
  unsupported: '当前平台不支持此本地 Chrome 工具栏操作。',
  invalid_url: 'expectedUrl 必须是有效的 HTTP 或 HTTPS 地址。',
  failed: '本次工具栏操作未确认，继续其他阶段。',
});

const STAGES = new Set(['starting', 'initial_frontmost', 'initial_tab', 'accessibility', 'toolbar_search', 'button_search',
  'final_frontmost', 'final_tab', 'press', 'completed']);

function lastStage(stderr) {
  let stage = 'starting';
  for (const line of (typeof stderr === 'string' ? stderr.slice(0, 1024) : '').split(/\r?\n/)) {
    const match = /^"?NCP_STAGE:([a-z_]+)"?$/.exec(line.trim());
    if (match && STAGES.has(match[1])) stage = match[1];
  }
  return stage;
}

function lookupCounts(stderr) {
  const counts = {};
  for (const line of (typeof stderr === 'string' ? stderr.slice(0, 1024) : '').split(/\r?\n/)) {
    const match = /^"?NCP_COUNT:(toolbarCount|buttonSearchNodes|namedCandidates|toolbarSearchDepth|toolbarSearchNodes|nextGroups):(\d{1,3})"?$/.exec(line.trim());
    if (match) counts[match[1]] = Number(match[2]);
  }
  return Object.keys(counts).length ? { lookup: counts } : {};
}

function result(status, diagnostics) {
  const detail = diagnostics && ['timeout', 'failed', 'permission_required', 'button_not_found'].includes(status)
    ? ` 阶段：${diagnostics.stage}；耗时：${diagnostics.elapsedMs}ms；结束方式：${diagnostics.termination}。` : '';
  return { status, continue: true, reason: REASONS[status] + detail, ...(diagnostics ? { diagnostics } : {}) };
}

function validUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)
    || !/^https?:\/\//i.test(value)) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

// The injectable runner is for tests. The public operation never accepts code,
// executable paths, script paths, shell options, or browser navigation commands.
export function createNowcoderPanelOpener({ platform = process.platform, runner = execFile, now = Date.now } = {}) {
  return async function openPanel({ expectedUrl, deadlineMs } = {}) {
    if (!validUrl(expectedUrl)) return result('invalid_url');
    if (platform !== 'darwin') return result('unsupported');
    if (deadlineMs !== undefined && (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0)) return result('failed');
    const startedAt = now();
    const deadline = Math.min(startedAt + 8000, deadlineMs ?? Infinity);
    const timeout = deadline - now();
    if (timeout <= 0) return result('timeout');
    return new Promise((resolve) => {
      try {
        const child = runner('/usr/bin/osascript', [SCRIPT, expectedUrl, String(deadline)], {
          encoding: 'utf8', timeout, maxBuffer: 1024, killSignal: 'SIGKILL', shell: false,
        }, (error, stdout, stderr) => {
          const diagnostics = { stage: lastStage(stderr), elapsedMs: Math.max(0, now() - startedAt), termination: 'script', ...lookupCounts(stderr) };
          if (error) {
            const overflow = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
            const timedOut = !overflow && error.killed && error.signal === 'SIGKILL';
            diagnostics.termination = overflow ? 'output_limit' : timedOut ? 'process_timeout' : 'process_error';
            resolve(result(timedOut ? 'timeout' : 'failed', diagnostics));
            return;
          }
          const status = typeof stdout === 'string' ? stdout.trim() : '';
          resolve(result(Object.hasOwn(REASONS, status) ? status : 'failed', diagnostics));
        });
        child.stdin?.end();
      } catch { resolve(result('failed')); }
    });
  };
}

export const openNowcoderPanel = createNowcoderPanelOpener();
