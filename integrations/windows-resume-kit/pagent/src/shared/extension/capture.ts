export const CAPTURE_TIMEOUT_MS = 10_000;
export const CAPTURE_PAINT_TIMEOUT_MS = 1_000;
export const CAPTURE_CLEANUP_TIMEOUT_MS = 1_000;

export interface CaptureRequest {
  captureId: string;
  deadline: number;
}

/** Rejects even when an underlying browser message/API does not settle. */
export async function withCaptureTimeout<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeoutMs = CAPTURE_TIMEOUT_MS,
  parentSignal?: AbortSignal,
): Promise<T> {
  parentSignal?.throwIfAborted();
  const controller = new AbortController();
  const relayAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('截图等待超时，请保持目标页面可见后重试')), timeoutMs);
  let rejectOnAbort: () => void = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        rejectOnAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
      }),
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return action(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', relayAbort);
    controller.signal.removeEventListener('abort', rejectOnAbort);
  }
}

/** Background tabs may never run rAF; a missing paint is a failure, not success. */
export async function waitForCapturePaint(signal?: AbortSignal): Promise<void> {
  let frame: number | undefined;
  try {
    await withCaptureTimeout((paintSignal) => new Promise<void>((resolve) => {
      frame = requestAnimationFrame(() => {
        if (paintSignal.aborted) return;
        frame = requestAnimationFrame(() => { if (!paintSignal.aborted) resolve(); });
      });
    }), CAPTURE_PAINT_TIMEOUT_MS, signal);
  } finally {
    if (frame !== undefined) cancelAnimationFrame(frame);
  }
}

export function createCaptureUiSession(dispatch: (name: 'ui.capture.start' | 'ui.capture.end') => void) {
  let active: { request: CaptureRequest; abort: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  const cancelled = new Map<string, number>();
  const prune = () => {
    for (const [id, deadline] of cancelled) if (deadline <= Date.now()) cancelled.delete(id);
  };
  const validate = (value: CaptureRequest) => {
    if (!value || typeof value.captureId !== 'string' || !value.captureId || !Number.isFinite(value.deadline)) {
      throw new Error('截图会话参数无效');
    }
  };
  const end = (request: CaptureRequest) => {
    validate(request);
    prune();
    // Keep cancellation until its deadline so a delayed start cannot hide the panel.
    if (request.deadline > Date.now()) cancelled.set(request.captureId, request.deadline);
    if (active?.request.captureId !== request.captureId) return;
    const previous = active;
    active = undefined;
    clearTimeout(previous.timer);
    previous.abort.abort(new Error('截图会话已结束'));
    dispatch('ui.capture.end');
  };
  return {
    async start(request: CaptureRequest) {
      validate(request);
      prune();
      if (request.deadline <= Date.now() || cancelled.has(request.captureId)) throw new Error('截图会话已过期或取消');
      if (active) throw new Error('已有截图正在进行');
      const abort = new AbortController();
      active = { request, abort, timer: setTimeout(() => end(request), Math.min(request.deadline - Date.now(), CAPTURE_TIMEOUT_MS)) };
      dispatch('ui.capture.start');
      try {
        await waitForCapturePaint(abort.signal);
        abort.signal.throwIfAborted();
      } catch (error) {
        end(request);
        throw error;
      }
    },
    end,
    dispose() {
      if (active) end(active.request);
      cancelled.clear();
    },
  };
}
