import { redactText } from '@/shared/contracts/policy';
import type { SourceType } from '@/shared/contracts/page';
import { truncate } from '@/shared/utils/utils';
import { pageObserver, SKIP } from './observer';

export type SourceQuery = {
  type?: SourceType;
  grep?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  limit?: number;
  offset?: number;
};

export type SourceMatch = {
  line: number;
  column: number;
  match: string;
  snippet: string;
};

export type SourceLink = {
  href: string;
  text: string;
  rel?: string;
};

export type SourceAsset = {
  href?: string;
  inline: boolean;
  type?: string;
  preview?: string;
  body?: string;
};

export type SourceResult = {
  type: SourceType;
  url: string;
  title: string;
  revision: number;
  grep?: string;
  total: number;
  offset: number;
  limit: number;
  count: number;
  hasMore: boolean;
  nextOffset?: number;
  truncated: boolean;
  hint?: string;
  value?: string;
  content?: string;
  matches?: SourceMatch[];
  items?: Array<string | SourceLink | SourceAsset>;
};

const DEFAULT_TEXT_LIMIT = 4_000;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_MATCH_LIMIT = 40;
const MAX_TEXT_LIMIT = 12_000;
const MAX_LIST_LIMIT = 200;
const MAX_MATCH_LIMIT = 80;
const SNIPPET_RADIUS = 80;
const INLINE_PREVIEW = 240;

type Matcher = (value: string) => boolean;

export async function getPageSource(
  query: SourceQuery = {},
  root: Document = document,
): Promise<SourceResult> {
  const type = query.type ?? 'dom';
  const header = {
    type,
    url: root.defaultView?.location.href ?? location.href,
    title: root.title,
    revision: pageObserver.revision,
    grep: query.grep?.trim() || undefined,
  };

  switch (type) {
    case 'url':
      return finishScalar(header, header.url, query);
    case 'title':
      return finishScalar(header, header.title, query);
    case 'text':
      return finishText(header, visiblePageText(root), query);
    case 'dom':
      return finishText(header, serializeLiveDom(root), query);
    case 'page':
      return finishText(header, await readOriginalHtml(root), query);
    case 'links':
      return finishList(header, collectLinks(root), query, stringifyLink);
    case 'scripts':
      return finishList(header, collectScripts(root), query, stringifyAsset);
    case 'stylesheets':
      return finishList(header, collectStylesheets(root), query, stringifyAsset);
    default:
      throw new Error(`未知源码类型：${String(type)}`);
  }
}

export function serializeLiveDom(root: Document = document): string {
  const clone = root.documentElement.cloneNode(true) as HTMLElement;
  for (const node of Array.from(clone.querySelectorAll('pagent-root, [data-pagent-ui]'))) {
    node.remove();
  }
  for (const node of Array.from(clone.querySelectorAll('script, style, svg'))) {
    node.replaceChildren();
  }
  const doctype = root.doctype ? `<!DOCTYPE ${root.doctype.name}>\n` : '';
  return `${doctype}${clone.outerHTML}`;
}

export function visiblePageText(root: Document = document): string {
  const body = root.body;
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;
  for (const node of Array.from(clone.querySelectorAll(SKIP))) {
    node.remove();
  }
  return (clone.innerText || clone.textContent || '').replace(/\s+\n/g, '\n').trim();
}

export async function readOriginalHtml(root: Document = document): Promise<string> {
  const href = root.defaultView?.location.href ?? '';
  if (href && /^https?:/i.test(href)) {
    try {
      const response = await fetch(href, { credentials: 'same-origin' });
      if (response.ok) {
        const html = await response.text();
        if (html.trim()) return html;
      }
    } catch {
      // fall through to live DOM
    }
  }
  return serializeLiveDom(root);
}

function finishScalar(
  header: Pick<SourceResult, 'type' | 'url' | 'title' | 'revision' | 'grep'>,
  value: string,
  query: SourceQuery,
): SourceResult {
  const matcher = compileMatcher(query);
  const text = redactText(value);
  const matched = !matcher || matcher(text);
  return {
    ...header,
    total: matched ? 1 : 0,
    offset: 0,
    limit: 1,
    count: matched ? 1 : 0,
    hasMore: false,
    truncated: false,
    value: matched ? text : '',
  };
}

function finishText(
  header: Pick<SourceResult, 'type' | 'url' | 'title' | 'revision' | 'grep'>,
  source: string,
  query: SourceQuery,
): SourceResult {
  const matcher = compileMatcher(query);
  if (matcher) {
    const matches = findMatches(source, matcher, query);
    const limit = clamp(query.limit ?? DEFAULT_MATCH_LIMIT, 1, MAX_MATCH_LIMIT);
    const offset = Math.max(0, query.offset ?? 0);
    const page = matches.slice(offset, offset + limit);
    return {
      ...header,
      total: matches.length,
      offset,
      limit,
      count: page.length,
      hasMore: offset + page.length < matches.length,
      nextOffset: offset + page.length < matches.length ? offset + page.length : undefined,
      truncated: offset + page.length < matches.length,
      hint: matches.length === 0 && !query.regex && /[|()[\]{}+*?^$\\]/.test(query.grep ?? '')
        ? 'grep 当前按普通子串匹配；如果这是正则表达式，请设置 regex=true'
        : undefined,
      matches: page,
    };
  }

  const limit = clamp(query.limit ?? DEFAULT_TEXT_LIMIT, 1, MAX_TEXT_LIMIT);
  const offset = Math.max(0, query.offset ?? 0);
  const content = redactText(source.slice(offset, offset + limit));
  const total = source.length;
  const hasMore = offset + content.length < total;
  return {
    ...header,
    total,
    offset,
    limit,
    count: content.length,
    hasMore,
    nextOffset: hasMore ? offset + content.length : undefined,
    truncated: hasMore,
    content,
  };
}

function finishList<T>(
  header: Pick<SourceResult, 'type' | 'url' | 'title' | 'revision' | 'grep'>,
  items: T[],
  query: SourceQuery,
  stringify: (item: T) => string,
): SourceResult {
  const matcher = compileMatcher(query);
  const filtered = matcher ? items.filter((item) => matcher(stringify(item))) : items;
  const limit = clamp(query.limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  const offset = Math.max(0, query.offset ?? 0);
  const page = filtered.slice(offset, offset + limit).map((item) => redactItem(publicItem(item)));
  const hasMore = offset + page.length < filtered.length;
  return {
    ...header,
    total: filtered.length,
    offset,
    limit,
    count: page.length,
    hasMore,
    nextOffset: hasMore ? offset + page.length : undefined,
    truncated: hasMore,
    items: page as Array<string | SourceLink | SourceAsset>,
  };
}

export function compileMatcher(query: SourceQuery): Matcher | null {
  const pattern = query.grep?.trim();
  if (!pattern) return null;
  if (query.regex) {
    try {
      const flags = query.caseSensitive ? '' : 'i';
      const re = new RegExp(pattern, flags);
      return (value) => re.test(value);
    } catch {
      throw new Error(`非法正则：${pattern}`);
    }
  }
  if (query.caseSensitive) return (value) => value.includes(pattern);
  const needle = pattern.toLowerCase();
  return (value) => value.toLowerCase().includes(needle);
}

function findMatches(source: string, matcher: Matcher, query: SourceQuery): SourceMatch[] {
  const matches: SourceMatch[] = [];
  const lines = source.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.length <= 2_000) {
      if (matcher(line)) {
        const column = matchColumn(line, query);
        matches.push({
          line: index + 1,
          column,
          match: redactText(extractMatch(line, query, column)),
          snippet: redactText(makeSnippet(line, Math.max(0, column - 1), SNIPPET_RADIUS)),
        });
      }
      continue;
    }
    for (const hit of scanLongLine(line, matcher, query)) {
      matches.push({
        line: index + 1,
        column: hit.column,
        match: redactText(hit.match),
        snippet: redactText(hit.snippet),
      });
    }
  }

  return matches;
}

function scanLongLine(
  line: string,
  matcher: Matcher,
  query: SourceQuery,
): Array<{ column: number; match: string; snippet: string }> {
  const hits: Array<{ column: number; match: string; snippet: string }> = [];
  const step = 400;
  for (let start = 0; start < line.length && hits.length < 200; start += step) {
    const chunk = line.slice(start, start + step + SNIPPET_RADIUS);
    if (!matcher(chunk)) continue;
    const column = start + matchColumn(chunk, query);
    hits.push({
      column: column + 1,
      match: extractMatch(line, query, column),
      snippet: makeSnippet(line, column, SNIPPET_RADIUS),
    });
    start = Math.max(start, column);
  }
  return hits;
}

function matchColumn(text: string, query: SourceQuery): number {
  const pattern = query.grep?.trim() ?? '';
  if (!pattern) return 1;
  if (query.regex) {
    try {
      const flags = query.caseSensitive ? '' : 'i';
      const found = text.match(new RegExp(pattern, flags));
      return found?.index != null ? found.index + 1 : 1;
    } catch {
      return 1;
    }
  }
  const haystack = query.caseSensitive ? text : text.toLowerCase();
  const needle = query.caseSensitive ? pattern : pattern.toLowerCase();
  const index = haystack.indexOf(needle);
  return index >= 0 ? index + 1 : 1;
}

function extractMatch(text: string, query: SourceQuery, column: number): string {
  const pattern = query.grep?.trim() ?? '';
  if (query.regex) {
    try {
      const flags = query.caseSensitive ? '' : 'i';
      return text.match(new RegExp(pattern, flags))?.[0] ?? pattern;
    } catch {
      return pattern;
    }
  }
  return text.slice(Math.max(0, column - 1), Math.max(0, column - 1) + pattern.length) || pattern;
}

function makeSnippet(text: string, index: number, radius: number): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function collectLinks(root: Document): SourceLink[] {
  return Array.from(root.querySelectorAll('a[href]'))
    .filter((el) => !el.closest(SKIP))
    .map((el) => {
      const anchor = el as HTMLAnchorElement;
      return {
        href: anchor.href || anchor.getAttribute('href') || '',
        text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
        rel: anchor.rel || undefined,
      };
    })
    .filter((item) => item.href);
}

function collectScripts(root: Document): SourceAsset[] {
  return Array.from(root.querySelectorAll('script'))
    .filter((el) => !el.closest('pagent-root, [data-pagent-ui]'))
    .map((el) => {
      const script = el as HTMLScriptElement;
      const src = script.src || script.getAttribute('src') || '';
      const text = script.textContent?.trim() ?? '';
      return {
        href: src || undefined,
        inline: !src,
        type: script.type || undefined,
        preview: text ? truncate(text, INLINE_PREVIEW) : undefined,
        body: text || undefined,
      };
    });
}

function collectStylesheets(root: Document): SourceAsset[] {
  const links = Array.from(root.querySelectorAll('link[rel~="stylesheet"]'))
    .filter((el) => !el.closest(SKIP))
    .map((el) => {
      const link = el as HTMLLinkElement;
      return {
        href: link.href || link.getAttribute('href') || undefined,
        inline: false,
        type: link.media && link.media !== 'all' ? link.media : undefined,
      };
    });
  const styles = Array.from(root.querySelectorAll('style'))
    .filter((el) => !el.closest('pagent-root, [data-pagent-ui]'))
    .map((el) => {
      const text = el.textContent?.trim() ?? '';
      return {
        href: undefined,
        inline: true,
        type: el.getAttribute('media') || undefined,
        preview: text ? truncate(text, INLINE_PREVIEW) : undefined,
        body: text || undefined,
      };
    });
  return [...links, ...styles];
}

function stringifyLink(item: SourceLink): string {
  return `${item.href} ${item.text} ${item.rel ?? ''}`;
}

function stringifyAsset(item: SourceAsset): string {
  return `${item.href ?? ''} ${item.type ?? ''} ${item.body ?? item.preview ?? ''}`;
}

function publicItem<T>(item: T): T {
  if (!item || typeof item !== 'object' || !('body' in item)) return item;
  const next = { ...(item as Record<string, unknown>) };
  delete next.body;
  return next as T;
}

function redactItem<T>(item: T): T {
  if (typeof item === 'string') return redactText(item) as T;
  if (!item || typeof item !== 'object') return item;
  const next = { ...(item as Record<string, unknown>) };
  for (const key of Object.keys(next)) {
    if (typeof next[key] === 'string') next[key] = redactText(next[key] as string);
  }
  return next as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
