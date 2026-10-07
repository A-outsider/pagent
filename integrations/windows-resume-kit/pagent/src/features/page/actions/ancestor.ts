import { implicitRole, pageObserver, visibleText } from '../observer';
import { asHtml } from './utils';
import { redactText } from '@/shared/contracts/policy';
import { truncate } from '@/shared/utils/utils';

export type CommonAncestorResult = {
  ok: true;
  elementId: string;
  sameElement: boolean;
  tag: string;
  role: string;
  name?: string;
  /** 与入参 elementIds 一一对应：每个元素到共同祖先的层级距离（自身为 0） */
  depths: number[];
  box: { x: number; y: number; width: number; height: number };
};

export function findCommonAncestor(
  elementIds: string[],
  revision?: number,
): CommonAncestorResult {
  if (elementIds.length < 2) throw new Error('至少需要两个元素才能计算共同祖先');
  const chains = elementIds.map((id) => ancestorChain(pageObserver.getElement(id, revision)));
  const firstChain = chains[0]!;
  const restSets = chains.slice(1).map((chain) => new Set(chain));
  const ancestor = firstChain.find((node) => restSets.every((set) => set.has(node)));
  if (!ancestor) throw new Error('这些元素没有共同祖先（可能位于不同的文档）');

  const html = asHtml(ancestor);
  const rect = ancestor.getBoundingClientRect();
  const role = html.getAttribute('role') || implicitRole(ancestor);
  const name = redactText(truncate(
    html.getAttribute('aria-label') || visibleText(ancestor),
    120,
  ));

  return {
    ok: true,
    elementId: pageObserver.register(ancestor),
    sameElement: chains.every((chain) => chain[0] === firstChain[0]),
    tag: ancestor.tagName.toLowerCase(),
    role,
    name: name || undefined,
    depths: chains.map((chain) => chain.indexOf(ancestor)),
    box: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function ancestorChain(element: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current) {
    chain.push(current);
    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return chain;
}
