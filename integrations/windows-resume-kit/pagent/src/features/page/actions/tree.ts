import { implicitRole, pageObserver } from '../observer';
import { redactText } from '@/shared/contracts/policy';
import { truncate } from '@/shared/utils/utils';
import type { ElementTreeOptions, LightweightElementTree } from '@/shared/contracts/page';

type TreeLabel = {
  depth: number;
  value: string;
};

const ELEMENT_TREE_SKIP = 'script,style,noscript,pagent-root,[data-pagent-ui]';
const ELEMENT_TREE_ATOMIC = 'svg,canvas,video,audio,iframe';

export function inspectElementTree(
  elementId: string,
  options: ElementTreeOptions = {},
): LightweightElementTree {
  const root = pageObserver.getElement(elementId, options.revision);
  const maxDepth = Math.max(0, Math.min(20, Math.trunc(options.maxDepth ?? 4)));
  const maxLength = Math.max(2, Math.min(2_000, Math.trunc(options.maxLength ?? 120)));
  const labels: TreeLabel[] = [];

  const visit = (element: Element, depth: number) => {
    labels.push({
      depth,
      value: elementTreeLabel(element, options.fields),
    });
    const children = elementTreeChildren(element);
    if (children.length === 0) return;
    if (depth >= maxDepth) {
      labels.push({
        depth: depth + 1,
        value: `more-level remaining-levels=${maxDescendantLevels(element)}`,
      });
      return;
    }
    for (const child of children) visit(child, depth + 1);
  };

  visit(root, 0);
  const totalLabels = labels.length;
  let emitted = labels;
  if (totalLabels > maxLength) {
    const kept = labels.slice(0, maxLength - 1);
    const firstOmitted = labels[kept.length];
    emitted = [
      ...kept,
      {
        depth: firstOmitted?.depth ?? 0,
        value: `more-label remaining-labels=${totalLabels - kept.length}`,
      },
    ];
  }

  return {
    rootElementId: elementId,
    totalLabels,
    emittedLabels: emitted.length,
    truncated: totalLabels > emitted.length || labels.some((label) => label.value.startsWith('more-level ')),
    tree: emitted.map((label) => `${'  '.repeat(label.depth)}${label.value}`).join('\n'),
  };
}

function elementTreeLabel(
  element: Element,
  fields: ElementTreeOptions['fields'],
): string {
  const tag = element.tagName.toLowerCase();
  const parts = [tag];
  const explicitRole = element.getAttribute('role');
  const role = explicitRole || implicitRole(element);
  if (explicitRole || (role && role !== tag)) parts.push(`role=${quoteTreeValue(role)}`);

  if (fields?.text) {
    const text = directElementText(element);
    if (text) parts.push(`text=${quoteTreeValue(text)}`);
  }
  if (fields?.coordinates) {
    const rect = element.getBoundingClientRect();
    parts.push(
      `box=${quoteTreeValue([
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.width),
        Math.round(rect.height),
      ].join(','))}`,
    );
  }
  for (const name of fields?.attributes ?? []) {
    const value = element.getAttribute(name);
    if (value != null) parts.push(`${name}=${quoteTreeValue(value)}`);
  }
  return parts.join(' ');
}

function directElementText(element: Element): string {
  const direct = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const text = direct || (elementTreeChildren(element).length === 0 ? element.textContent ?? '' : '');
  return redactText(truncate(text.replace(/\s+/g, ' ').trim(), 160));
}

function quoteTreeValue(value: string): string {
  return JSON.stringify(redactText(truncate(value, 160)));
}

function elementTreeChildren(element: Element): Element[] {
  if (element.matches(ELEMENT_TREE_ATOMIC)) return [];
  const children = [
    ...Array.from(element.children),
    ...Array.from(element.shadowRoot?.children ?? []),
  ];
  return children.filter((child) => !child.matches(ELEMENT_TREE_SKIP));
}

function maxDescendantLevels(root: Element): number {
  let maximum = 0;
  const pending = elementTreeChildren(root).map((element) => ({ element, level: 1 }));
  while (pending.length > 0) {
    const current = pending.pop()!;
    maximum = Math.max(maximum, current.level);
    for (const child of elementTreeChildren(current.element)) {
      pending.push({ element: child, level: current.level + 1 });
    }
  }
  return maximum;
}
