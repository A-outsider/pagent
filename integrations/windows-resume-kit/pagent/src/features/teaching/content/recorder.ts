import { PAGE_NAVIGATION_EVENT } from '@/features/page/navigation';
import { redactText, sanitizeUrl } from '@/shared/contracts/policy';
import type { RecordedAction, RecordedActionKind, RecordedTarget } from '@/shared/contracts/teaching';

type Emit = (actions: RecordedAction[]) => void;

function id(): string {
  return `action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeRecordedUrl(raw: string): string {
  return sanitizeUrl(raw);
}

function fromPagentUi(event: Event): boolean {
  return event.composedPath().some((node) => {
    if (!(node instanceof Element)) return false;
    return node.localName === 'pagent-root' || node.hasAttribute('data-pagent-ui');
  });
}

function targetElement(event: Event): HTMLElement | null {
  const candidate = event.composedPath().find((node) => node instanceof HTMLElement);
  if (!(candidate instanceof HTMLElement)) return null;
  return candidate.closest<HTMLElement>(
    'button, a, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [contenteditable="true"]',
  ) ?? candidate;
}

function cssEscape(value: string): string {
  return CSS.escape(value);
}

export function stableSelector(element: Element): string {
  if (element.id) return `#${cssEscape(element.id)}`;
  for (const attr of ['data-testid', 'data-test', 'name', 'aria-label']) {
    const value = element.getAttribute(attr);
    if (value) return `${element.localName}[${attr}="${cssEscape(value)}"]`;
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement && parts.length < 4) {
    let part = current.localName;
    const parentElement: Element | null = current.parentElement;
    if (parentElement) {
      const siblings = [...parentElement.children].filter((item) => item.localName === current!.localName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parentElement;
  }
  return parts.join(' > ');
}

function accessibleName(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby');
  const labelledText = labelledBy
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');
  const htmlLabel =
    element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
      ? [...(element.labels ?? [])].map((label) => label.textContent?.trim()).filter(Boolean).join(' ')
      : '';
  return redactText(
    element.getAttribute('aria-label')
      || labelledText
      || htmlLabel
      || element.getAttribute('title')
      || (element instanceof HTMLInputElement ? element.placeholder : '')
      || element.innerText?.trim().slice(0, 120)
      || '',
  );
}

function describeTarget(element: HTMLElement): RecordedTarget {
  const text = redactText(element.innerText?.trim().replace(/\s+/g, ' ').slice(0, 180) || '');
  return {
    tag: element.localName,
    role: element.getAttribute('role') || undefined,
    name: accessibleName(element) || undefined,
    text: text || undefined,
    selector: stableSelector(element),
    inputType: element instanceof HTMLInputElement ? element.type : undefined,
    placeholder: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? redactText(element.placeholder)
      : undefined,
    href: element instanceof HTMLAnchorElement ? sanitizeRecordedUrl(element.href) : undefined,
  };
}

function sensitiveInput(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && element.type === 'password') return true;
  const fingerprint = [
    element.getAttribute('autocomplete'),
    element.getAttribute('name'),
    element.getAttribute('id'),
    element.getAttribute('aria-label'),
  ].filter(Boolean).join(' ');
  return /(password|passwd|secret|token|otp|one-time|cc-|credit|card|cvc|cvv|bank)/i.test(fingerprint);
}

function inputValue(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement) {
    return element.selectedOptions[0]?.text || element.value;
  }
  return element.isContentEditable ? element.innerText : '';
}

function page() {
  return { url: sanitizeRecordedUrl(location.href), title: redactText(document.title) };
}

export function createTeachingRecorder(emit: Emit) {
  let active = false;
  let batch: RecordedAction[] = [];
  let batchTimer: number | undefined;
  let clickTimer: number | undefined;
  let scrollTimer: number | undefined;
  const inputTimers = new WeakMap<HTMLElement, number>();

  const flush = () => {
    if (batchTimer) window.clearTimeout(batchTimer);
    batchTimer = undefined;
    if (!batch.length) return;
    const actions = batch;
    batch = [];
    emit(actions);
  };

  const recordComment = (comment: string, element?: HTMLElement | null) => {
    if (!active) return;
    const trimmed = redactText(comment.trim());
    if (!trimmed) return;
    batch.push({
      id: id(),
      at: Date.now(),
      kind: 'comment',
      page: page(),
      target: element ? describeTarget(element) : undefined,
      value: trimmed,
      detail: trimmed,
    });
    flush();
  };

  const queue = (
    kind: RecordedActionKind,
    element?: HTMLElement | null,
    extra: Partial<RecordedAction> = {},
  ) => {
    if (!active) return;
    batch.push({
      id: id(),
      at: Date.now(),
      kind,
      page: page(),
      target: element ? describeTarget(element) : undefined,
      ...extra,
    });
    if (!batchTimer) batchTimer = window.setTimeout(flush, 120);
  };

  const onClick = (event: MouseEvent) => {
    if (fromPagentUi(event)) return;
    const element = targetElement(event);
    if (!element) return;
    if (clickTimer) window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      const state = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
        ? `${element.checked ? '选中' : '取消选中'} ${accessibleName(element) || element.value}`
        : undefined;
      queue('click', element, { detail: state });
    }, 220);
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (fromPagentUi(event)) return;
    if (clickTimer) window.clearTimeout(clickTimer);
    clickTimer = undefined;
    queue('double_click', targetElement(event));
  };

  const onInput = (event: Event) => {
    if (fromPagentUi(event)) return;
    const element = targetElement(event);
    if (!element) return;
    const previous = inputTimers.get(element);
    if (previous) window.clearTimeout(previous);
    inputTimers.set(element, window.setTimeout(() => {
      const redacted = sensitiveInput(element);
      queue(element instanceof HTMLSelectElement ? 'select' : 'input', element, {
        value: redacted ? '[redacted]' : redactText(inputValue(element)).slice(0, 1000),
        redacted,
      });
    }, 350));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (fromPagentUi(event) || !['Enter', 'Tab', 'Escape'].includes(event.key)) return;
    queue('keypress', targetElement(event), { value: event.key });
  };

  const onScroll = () => {
    if (scrollTimer) window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      queue('scroll', null, { detail: `页面滚动到 (${Math.round(scrollX)}, ${Math.round(scrollY)})` });
    }, 400);
  };

  let previousUrl = sanitizeRecordedUrl(location.href);
  const onNavigation = () => {
    const nextUrl = sanitizeRecordedUrl(location.href);
    queue('navigate', null, { detail: `页面内路由从 ${previousUrl} 切换到 ${nextUrl}` });
    previousUrl = nextUrl;
  };

  const start = () => {
    if (active) return;
    active = true;
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDoubleClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener(PAGE_NAVIGATION_EVENT, onNavigation);
    window.addEventListener('popstate', onNavigation);
    window.addEventListener('hashchange', onNavigation);
  };

  const stop = () => {
    if (!active) return;
    active = false;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('dblclick', onDoubleClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onInput, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener(PAGE_NAVIGATION_EVENT, onNavigation);
    window.removeEventListener('popstate', onNavigation);
    window.removeEventListener('hashchange', onNavigation);
    flush();
  };

  return { start, stop, flush, recordComment };
}
