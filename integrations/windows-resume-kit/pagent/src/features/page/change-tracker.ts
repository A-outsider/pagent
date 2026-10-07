import { redactText, sanitizeUrl } from '@/shared/contracts/policy';
import { nowId, truncate } from '@/shared/utils/utils';
import { pageObserver, SKIP, visibleText } from './observer';

const CHANGE_CANDIDATES = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'summary',
  'label',
  '[role]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
  'h1',
  'h2',
  'h3',
  'p',
  'li',
  'td',
  'th',
].join(',');

const CONTAINER_CANDIDATES = [
  'div',
  'span',
  'img',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
].join(',');

export type PageChangeNode = {
  id: string;
  tag: string;
  role: string;
  name: string;
  value?: string;
  href?: string;
  visible: boolean;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
};

export type PageChangeSnapshot = {
  watchId: string;
  documentId: string;
  cursor: number;
  mutationCount: number;
  maxNodes: number;
  url: string;
  title: string;
  viewport: { scrollX: number; scrollY: number };
  nodes: PageChangeNode[];
};

export type PageChange = {
  kind:
    | 'added'
    | 'removed'
    | 'text_changed'
    | 'state_changed'
    | 'visibility_changed'
    | 'navigation'
    | 'title_changed'
    | 'viewport_changed';
  target?: Pick<PageChangeNode, 'id' | 'tag' | 'role' | 'name'>;
  before?: unknown;
  after?: unknown;
};

export type PageChangeResult = {
  changed: boolean;
  settled: boolean;
  overflow: boolean;
  mutationCount: number;
  summary: string;
  watchId: string;
  cursor: number;
  changes: PageChange[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isIgnored(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(SKIP));
}

function nodeState(node: PageChangeNode) {
  return {
    value: node.value,
    href: node.href,
    disabled: node.disabled,
    checked: node.checked,
    selected: node.selected,
    expanded: node.expanded,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function targetOf(node: PageChangeNode) {
  return { id: node.id, tag: node.tag, role: node.role, name: node.name };
}

function formValue(element: Element): string | undefined {
  if (!('value' in element)) return undefined;
  const input = element as HTMLInputElement;
  if (input.type === 'password') return input.value ? '[redacted-present]' : '';
  return redactText(truncate(String(input.value ?? ''), 120));
}

function summarize(changes: PageChange[]): string {
  if (!changes.length) return '未发现有意义的页面变化';
  const counts = new Map<PageChange['kind'], number>();
  for (const change of changes) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
  const labels: Record<PageChange['kind'], string> = {
    added: '新增',
    removed: '移除',
    text_changed: '文本更新',
    state_changed: '状态更新',
    visibility_changed: '可见性更新',
    navigation: '页面导航',
    title_changed: '标题更新',
    viewport_changed: '视口移动',
  };
  const parts = [...counts].map(([kind, count]) => `${labels[kind]} ${count} 处`);
  const important = changes.find((item) => item.target?.name)?.target?.name;
  return `${parts.join('，')}${important ? `；主要涉及「${truncate(important, 60)}」` : ''}`;
}

export function diffPageChanges(
  baseline: PageChangeSnapshot,
  current: PageChangeSnapshot,
  maxChanges = 50,
  settled = true,
): PageChangeResult {
  const changes: PageChange[] = [];
  if (baseline.documentId !== current.documentId || baseline.url !== current.url) {
    changes.push({
      kind: 'navigation',
      before: { url: baseline.url, title: baseline.title },
      after: { url: current.url, title: current.title },
    });
  } else if (baseline.title !== current.title) {
    changes.push({
      kind: 'title_changed',
      before: baseline.title,
      after: current.title,
    });
  }

  const before = new Map(baseline.nodes.map((node) => [node.id, node]));
  const after = new Map(current.nodes.map((node) => [node.id, node]));
  for (const node of baseline.nodes) {
    if (!after.has(node.id)) changes.push({ kind: 'removed', target: targetOf(node) });
  }
  for (const node of current.nodes) {
    const previous = before.get(node.id);
    if (!previous) {
      changes.push({ kind: 'added', target: targetOf(node) });
      continue;
    }
    if (previous.name !== node.name) {
      changes.push({
        kind: 'text_changed',
        target: targetOf(node),
        before: previous.name,
        after: node.name,
      });
    }
    if (previous.visible !== node.visible) {
      changes.push({
        kind: 'visibility_changed',
        target: targetOf(node),
        before: previous.visible,
        after: node.visible,
      });
    }
    const previousState = nodeState(previous);
    const nextState = nodeState(node);
    if (!sameValue(previousState, nextState)) {
      changes.push({
        kind: 'state_changed',
        target: targetOf(node),
        before: previousState,
        after: nextState,
      });
    }
  }
  if (
    baseline.viewport.scrollX !== current.viewport.scrollX ||
    baseline.viewport.scrollY !== current.viewport.scrollY
  ) {
    changes.push({
      kind: 'viewport_changed',
      before: baseline.viewport,
      after: current.viewport,
    });
  }

  const overflow = changes.length > maxChanges;
  const limited = changes.slice(0, maxChanges);
  return {
    changed: changes.length > 0,
    settled,
    overflow,
    mutationCount: Math.max(0, current.mutationCount - baseline.mutationCount),
    summary: summarize(limited),
    watchId: baseline.watchId,
    cursor: current.cursor,
    changes: limited,
  };
}

export class PageChangeTracker {
  private observer?: MutationObserver;
  private cursor = 0;
  private mutationCount = 0;
  private lastChangedAt = 0;

  install(root: Document = document): () => void {
    if (this.observer) return () => this.disconnect();
    this.observer = new MutationObserver((records) => {
      const relevant = records.filter((record) => !isIgnored(record.target));
      if (relevant.length) this.signal(relevant.length);
    });
    this.observer.observe(root.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const signal = (event: Event) => {
      if (!isIgnored(event.target as Node)) this.signal();
    };
    root.addEventListener('input', signal, true);
    root.addEventListener('change', signal, true);
    root.defaultView?.addEventListener('scroll', signal, true);
    return () => {
      root.removeEventListener('input', signal, true);
      root.removeEventListener('change', signal, true);
      root.defaultView?.removeEventListener('scroll', signal, true);
      this.disconnect();
    };
  }

  signal(count = 1): void {
    this.cursor += 1;
    this.mutationCount += count;
    this.lastChangedAt = Date.now();
  }

  snapshot(maxNodes = 400, root: Document = document): PageChangeSnapshot {
    const nodes: PageChangeNode[] = [];
    const seen = new Set<Element>();
    scan: for (const selector of [CHANGE_CANDIDATES, CONTAINER_CANDIDATES]) {
      for (const element of Array.from(root.querySelectorAll(selector))) {
        if (seen.has(element) || element.closest(SKIP)) continue;
        seen.add(element);
        const described = pageObserver.describe(element);
        if (!described) continue;
        const html = element as HTMLElement;
        nodes.push({
          id: described.id,
          tag: described.tag,
          role: described.role,
          name: redactText(truncate(visibleText(element) || described.name, 160)),
          value: formValue(element),
          href: described.href ? truncate(sanitizeUrl(described.href), 300) : undefined,
          visible: described.visible,
          disabled: described.disabled,
          checked: described.checked,
          selected: element instanceof HTMLOptionElement ? element.selected : undefined,
          expanded:
            html.getAttribute('aria-expanded') == null
              ? undefined
              : html.getAttribute('aria-expanded') === 'true',
        });
        if (nodes.length >= maxNodes) break scan;
      }
    }
    return {
      watchId: nowId('watch'),
      documentId: pageObserver.documentId,
      cursor: this.cursor,
      mutationCount: this.mutationCount,
      maxNodes,
      url: sanitizeUrl(root.defaultView?.location.href ?? location.href),
      title: redactText(root.title),
      viewport: {
        scrollX: root.defaultView?.scrollX ?? 0,
        scrollY: root.defaultView?.scrollY ?? 0,
      },
      nodes,
    };
  }

  async read(
    baseline: PageChangeSnapshot,
    options: { timeoutMs?: number; quietMs?: number; maxChanges?: number } = {},
  ): Promise<PageChangeResult> {
    const timeoutMs = Math.min(10_000, Math.max(0, options.timeoutMs ?? 4_000));
    const quietMs = Math.min(2_000, Math.max(50, options.quietMs ?? 350));
    const deadline = Date.now() + timeoutMs;
    let settled = false;
    while (Date.now() < deadline) {
      const changed = this.cursor > baseline.cursor || pageObserver.documentId !== baseline.documentId;
      if (changed && Date.now() - this.lastChangedAt >= quietMs) {
        settled = true;
        break;
      }
      await sleep(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    const current = this.snapshot(baseline.maxNodes);
    current.watchId = baseline.watchId;
    return diffPageChanges(baseline, current, options.maxChanges, settled);
  }

  private disconnect(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }
}

export const pageChangeTracker = new PageChangeTracker();
