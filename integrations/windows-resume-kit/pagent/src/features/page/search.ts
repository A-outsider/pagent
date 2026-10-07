import { redactText } from '@/shared/contracts/policy';
import { truncate } from '@/shared/utils/utils';
import {
  activeInteractionContext,
  implicitRole,
  pageObserver,
  SKIP,
  visibleText,
} from './observer';
import type { ObservationScope } from '@/shared/contracts/page';

export type TextSearchHit = {
  elementId: string;
  match: string;
  snippet: string;
  tag: string;
  role: string;
  name: string;
  visible: boolean;
  clickable: boolean;
  box?: { x: number; y: number; width: number; height: number };
};

export type TextSearchResult = {
  query: string;
  revision: number;
  interactionContextId?: string;
  total: number;
  count: number;
  truncated: boolean;
  hits: TextSearchHit[];
};

const HOST = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  'p',
  'li',
  'td',
  'th',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'dt',
  'dd',
  'pre',
  'blockquote',
  'figcaption',
].join(',');

const MAX_SCAN = 8_000;

export function searchPageText(
  query: string,
  options: {
    caseSensitive?: boolean;
    maxResults?: number;
    scope?: ObservationScope;
  } = {},
): TextSearchResult {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query, revision: pageObserver.revision, total: 0, count: 0, truncated: false, hits: [] };
  }

  pageObserver.prune();
  const maxResults = options.maxResults ?? 30;
  const hits: TextSearchHit[] = [];
  let total = 0;
  let scanned = 0;
  const context = options.scope === 'page' ? null : activeInteractionContext();
  const scanRoot = context ?? document;

  const visitRoot = (root: Document | ShadowRoot | Element) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let current = walker.nextNode();
    while (current && scanned < MAX_SCAN) {
      scanned += 1;
      collectMatches(current.textContent ?? '', hostElement(current.parentElement), trimmed, options.caseSensitive);
      current = walker.nextNode();
    }

    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (scanned >= MAX_SCAN) break;
      if (el.closest(SKIP)) continue;
      if (el.shadowRoot) visitRoot(el.shadowRoot);
    }
  };

  const collectMatches = (source: string, el: Element | null, needle: string, caseSensitive?: boolean) => {
    if (!el || !source) return;
    const haystack = caseSensitive ? source : source.toLowerCase();
    const match = caseSensitive ? needle : needle.toLowerCase();
    let from = 0;
    while (scanned < MAX_SCAN) {
      const index = haystack.indexOf(match, from);
      if (index < 0) break;
      total += 1;
      if (hits.length < maxResults) {
        hits.push(toHit(el, source, index, needle.length));
      }
      from = index + Math.max(1, match.length);
    }
  };

  visitRoot(scanRoot);

  for (const el of Array.from(scanRoot.querySelectorAll(
    'input, textarea, select, [role], [alt], [title], [aria-label], [placeholder], [id], [name]',
  ))) {
    if (scanned >= MAX_SCAN) break;
    if (el.closest(SKIP)) continue;
    scanned += 1;
    const extras = [
      'value' in el ? String((el as HTMLInputElement).value ?? '') : '',
      el.getAttribute('placeholder') ?? '',
      el.getAttribute('aria-label') ?? '',
      el.getAttribute('alt') ?? '',
      el.getAttribute('title') ?? '',
      el.getAttribute('id') ?? '',
      el.getAttribute('name') ?? '',
    ].filter(Boolean);
    for (const extra of extras) {
      collectMatches(extra, el, trimmed, options.caseSensitive);
    }
  }

  return {
    query: trimmed,
    revision: pageObserver.revision,
    interactionContextId: context ? pageObserver.register(context) : undefined,
    total,
    count: hits.length,
    truncated: total > hits.length || scanned >= MAX_SCAN,
    hits,
  };
}

function hostElement(node: Element | null): Element | null {
  if (!node) return null;
  const preferred = node.closest(HOST);
  if (preferred && !preferred.closest(SKIP)) return preferred;
  return node.closest(SKIP) ? null : node;
}

function toHit(el: Element, source: string, index: number, matchLength: number): TextSearchHit {
  const described = pageObserver.describe(el);
  const rect = el.getBoundingClientRect();
  return {
    elementId: described?.id ?? pageObserver.register(el),
    match: source.slice(index, index + matchLength),
    snippet: redactText(makeSnippet(source, index, matchLength)),
    tag: described?.tag ?? el.tagName.toLowerCase(),
    role: described?.role || implicitRole(el),
    name: described?.name || redactText(truncate(visibleText(el), 120)),
    visible: described?.visible ?? (
      rect.width > 1
      && rect.height > 1
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth
    ),
    clickable: described?.clickable ?? false,
    box: described?.box ?? {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function makeSnippet(text: string, index: number, matchLength: number, radius = 42): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLength + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}
