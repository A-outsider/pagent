import { pageObserver } from '../observer';

export function nearestScroller(element: Element): HTMLElement | Window {
  let current = element.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY)
      && current.scrollHeight > current.clientHeight;
    const canScrollX = /(auto|scroll|overlay)/.test(style.overflowX)
      && current.scrollWidth > current.clientWidth;
    if (canScrollY || canScrollX) return current;
    current = current.parentElement;
  }
  return window;
}

export function activeScroller(): HTMLElement | Window {
  const focused = document.activeElement;
  if (focused) {
    const nearest = nearestScroller(focused);
    if (nearest !== window) return nearest;
  }
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('body *'))
    .filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll|overlay)/.test(`${style.overflowX} ${style.overflowY}`)
        && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);
    })
    .sort((left, right) =>
      (right.clientWidth * right.clientHeight) - (left.clientWidth * left.clientHeight));
  return candidates[0] ?? window;
}

export function scrollPosition(scroller: HTMLElement | Window) {
  if (scroller instanceof HTMLElement) {
    return { x: scroller.scrollLeft, y: scroller.scrollTop };
  }
  return { x: window.scrollX, y: window.scrollY };
}

export function describeScroller(scroller: HTMLElement | Window): string {
  if (!(scroller instanceof HTMLElement)) return 'window';
  return scroller.id ? `#${scroller.id}` : scroller.tagName.toLowerCase();
}

export function scrollPage(payload: {
  elementId?: string;
  direction?: 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom';
  amount?: number;
  revision?: number;
}) {
  const amount = payload.amount ?? 480;
  if (payload.elementId) {
    const element = pageObserver.getElement(payload.elementId, payload.revision);
    const scroller = nearestScroller(element);
    const before = scrollPosition(scroller);
    element.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
    const after = scrollPosition(scroller);
    return { ok: true, scroller: describeScroller(scroller), before, after };
  }
  const map = {
    up: [0, -amount],
    down: [0, amount],
    left: [-amount, 0],
    right: [amount, 0],
    top: [0, -document.body.scrollHeight],
    bottom: [0, document.body.scrollHeight],
  } as const;
  const [x, y] = map[payload.direction ?? 'down'];
  const scroller = activeScroller();
  const before = scrollPosition(scroller);
  if (scroller === window) {
    window.scrollBy({ left: x, top: y, behavior: 'smooth' });
  } else {
    scroller.scrollBy({ left: x, top: y, behavior: 'smooth' });
  }
  const after = scrollPosition(scroller);
  return {
    ok: true,
    changed: before.x !== after.x || before.y !== after.y,
    scroller: describeScroller(scroller),
    before,
    after,
  };
}
