import { pageObserver } from '../observer';
import { sleep } from './utils';

export async function waitFor(payload: {
  ms?: number;
  text?: string;
  elementId?: string;
  urlIncludes?: string;
}) {
  const timeout = payload.ms ?? 4000;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (payload.text && document.body.innerText.includes(payload.text)) return { ok: true };
    if (payload.urlIncludes && location.href.includes(payload.urlIncludes)) return { ok: true };
    if (payload.elementId) {
      try {
        pageObserver.getElement(payload.elementId);
        return { ok: true };
      } catch {
        // keep waiting
      }
    }
    if (!payload.text && !payload.elementId && !payload.urlIncludes) {
      await sleep(timeout);
      return { ok: true };
    }
    await sleep(200);
  }
  throw new Error('等待条件超时');
}
