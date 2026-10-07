export function asHtml(el: Element): HTMLElement {
  return el as HTMLElement;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let frame: number;
    const done = () => { window.clearTimeout(timer); cancelAnimationFrame(frame); resolve(); };
    // Animation frames may be suspended in background tabs.
    const timer = window.setTimeout(done, 100);
    frame = requestAnimationFrame(done);
  });
}

export async function settleInteraction(): Promise<void> {
  await Promise.resolve();
  await nextPaint();
  await nextPaint();
}

export function highlight(el: Element) {
  const html = asHtml(el);
  const previous = html.style.outline;
  html.style.outline = '2px solid #1f6b57';
  html.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  window.setTimeout(() => {
    html.style.outline = previous;
  }, 1200);
}

export function dispatchPointerPrelude(element: Element): void {
  const rect = element.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  if (typeof PointerEvent !== 'undefined') {
    element.dispatchEvent(new PointerEvent('pointerdown', init));
    element.dispatchEvent(new PointerEvent('pointerup', init));
  }
  element.dispatchEvent(new MouseEvent('mousedown', init));
  element.dispatchEvent(new MouseEvent('mouseup', init));
}

/**
 * 派发完整 hover 事件序列（pointerover/pointerenter/pointermove +
 * mouseover/mouseenter/mousemove），使依赖悬停展开的菜单、提示等
 * 在点击前先进入 hover 状态。
 */
export function dispatchHoverPrelude(element: Element): void {
  const rect = element.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  if (typeof PointerEvent !== 'undefined') {
    element.dispatchEvent(new PointerEvent('pointerover', { ...init, pointerType: 'mouse' }));
    element.dispatchEvent(new PointerEvent('pointerenter', { ...init, bubbles: false, pointerType: 'mouse' }));
    element.dispatchEvent(new PointerEvent('pointermove', { ...init, pointerType: 'mouse' }));
  }
  element.dispatchEvent(new MouseEvent('mouseover', init));
  element.dispatchEvent(new MouseEvent('mouseenter', { ...init, bubbles: false }));
  element.dispatchEvent(new MouseEvent('mousemove', init));
}

export function rawElementValue(element: Element): string {
  if ('value' in element) return String((element as HTMLInputElement).value ?? '');
  return element.getAttribute('aria-valuenow')
    ?? element.getAttribute('aria-valuetext')
    ?? element.textContent
    ?? '';
}

export function visibleTextValue(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}
