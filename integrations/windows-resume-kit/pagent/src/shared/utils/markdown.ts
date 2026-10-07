import DOMPurify from 'dompurify';
import { Marked, Renderer } from 'marked';

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  return /^(https?:|mailto:|#)/i.test(trimmed) ? trimmed : null;
}

function tableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

function isFenceLine(line: string): boolean {
  return /^(```|~~~)/.test(line.trim());
}

function isDelimiterRow(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.replaceAll(' ', '')));
}

export function normalizeGfmTables(source: string): string {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  let inFence = false;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index]!;
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const delimiter = lines[index + 1]!;
    if (!line.includes('|') || !isDelimiterRow(delimiter)) continue;
    const columns = tableCells(line).length;
    if (columns === 0) continue;
    const cells = tableCells(delimiter);
    if (cells.length === columns) continue;
    while (cells.length < columns) cells.push('---');
    cells.length = columns;
    lines[index + 1] = `|${cells.map((cell) => cell || '---').join('|')}|`;
  }
  return lines.join('\n');
}

const defaultRenderer = new Renderer();

const marked = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  silent: true,
  renderer: {
    html({ text }) {
      return escapeAttr(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = safeHref(href);
      if (!url) return label;
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      return `<a href="${escapeAttr(url)}"${titleAttr} target="_blank" rel="noreferrer noopener">${label}</a>`;
    },
    image({ href, title, text }) {
      const url = safeHref(href);
      if (!url) return escapeAttr(text);
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      return `<img src="${escapeAttr(url)}" alt="${escapeAttr(text)}"${titleAttr} />`;
    },
    table(token) {
      return `<div class="pagent-md-table">${defaultRenderer.table.call(this, token)}</div>`;
    },
  },
});

export function renderMarkdown(source: string): string {
  const html = marked.parse(normalizeGfmTables(source ?? ''), { async: false });
  return DOMPurify.sanitize(typeof html === 'string' ? html : '', {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
}
