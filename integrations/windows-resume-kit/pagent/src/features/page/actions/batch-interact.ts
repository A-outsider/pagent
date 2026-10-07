import { activeInteractionContext, pageObserver } from '../observer';
import { clickElement, selectOption, observedState } from './interactions';
import { verifyFormFields } from './verify-fields';
import {
  asHtml,
  dispatchPointerPrelude,
  nextPaint,
  rawElementValue,
  settleInteraction,
  sleep,
  visibleTextValue,
} from './utils';
import type { FormFieldExpectation, InteractionResult, InteractionStep } from '@/shared/contracts/page';
import { truncate } from '@/shared/utils/utils';
import { customSelectValue, formCheckedState, MOKA_SELECT, phoenixSelectActivation } from '../form-semantics';

const MOKA_MENU = '[class^="sd-Dropdown-dropdown-"], [class*=" sd-Dropdown-dropdown-"]';
const MOKA_OPTION = '[data-key="sugar.select.label"], [class^="option-label-"], [class*=" option-label-"]';
const PHOENIX_MENU = '.common-unmodeled-layer__layerContent > .phoenix-selectList';
const PHOENIX_OPTION = 'li.phoenix-selectList__listItem';
let activatedMokaMenu: { control: Element; menu: Element } | undefined;

function comparisonState(element: Element): string {
  return JSON.stringify([rawElementValue(element), 'checked' in element ? element.checked : undefined,
    observedState(pageObserver.describe(element))]);
}

export async function interactElements(steps: InteractionStep[]): Promise<InteractionResult[]> {
  const results: InteractionResult[] = [];
  const beforeComparisons: Array<string | undefined> = [];
  for (const step of steps) {
    let before: InteractionResult['before'];
    try {
      before = observedState(pageObserver.describe(pageObserver.getElement(step.elementId, step.revision)));
      beforeComparisons[results.length] = comparisonState(pageObserver.getElement(step.elementId));
      const activation = await applyInteraction(step);
      if (activation) {
        // A portal choice may unmount on click. Preserve the dispatched action's
        // result rather than re-resolving its removed ID as a failed write.
        results.push({ ...activation, intent: step.intent,
          satisfied: activation.ok && (activation.triggered || activation.alreadyExpanded === true) });
        continue;
      }
      await settleInteraction();
      const target = pageObserver.getElement(step.elementId);
      const afterElement = pageObserver.describe(target);
      const after = observedState(afterElement);
      results.push({
        elementId: step.elementId,
        intent: step.intent,
        ok: true,
        changed: beforeComparisons[results.length] !== comparisonState(target),
        satisfied: step.intent === 'activate',
        before,
        after,
      });
    } catch (error) {
      results.push({
        elementId: step.elementId,
        intent: step.intent,
        ok: false,
        changed: false,
        satisfied: false,
        before,
        error: truncate(error instanceof Error ? error.message : String(error), 240),
      });
    }
  }
  // A later edit can cause a controlled component to restore earlier fields.
  // Re-read the whole batch after all edits instead of trusting immediate setter results.
  const latest = new Map<string, number>();
  steps.forEach((step, index) => { if (step.intent !== 'activate') latest.set(step.elementId, index); });
  const pending = steps.flatMap((step, index) => {
    if (step.intent === 'activate' || !results[index]?.ok) return [];
    if (latest.get(step.elementId) !== index) {
      results[index]!.verificationStatus = 'superseded';
      return [];
    }
    return [{ index, field: { ...step, value: step.intent === 'set-checked' ? Boolean(step.value) : step.value ?? '' } as FormFieldExpectation }];
  });
  if (pending.length) {
    const verified = await verifyFormFields(pending.map(({ field }) => field));
    verified.forEach((verification, index) => {
      const result = results[pending[index]!.index]!;
      result.satisfied = verification.satisfied;
      result.stable = verification.stable;
      result.verificationStatus = verification.status;
      result.after = verification.actual;
      try { result.changed = beforeComparisons[pending[index]!.index] !== comparisonState(pageObserver.getElement(result.elementId)); }
      catch { result.changed = true; }
      if (!verification.ok) { result.ok = false; result.error = verification.error; }
    });
  }
  return results;
}

async function applyInteraction(step: InteractionStep): Promise<Awaited<ReturnType<typeof clickElement>> | undefined> {
  const element = pageObserver.getElement(step.elementId, step.revision);
  const moka = element.closest(MOKA_SELECT);
  if (step.intent !== 'choose-option' || activatedMokaMenu?.control !== moka) activatedMokaMenu = undefined;
  switch (step.intent) {
    case 'activate': {
      const before = new Set(moka ? visibleSelectMenus(element.ownerDocument, MOKA_MENU) : []);
      const activation = await clickElement(step.elementId, step.revision);
      const opened = moka ? visibleSelectMenus(element.ownerDocument, MOKA_MENU).filter(menu => !before.has(menu)) : [];
      if (moka && activation.ok && opened.length === 1) activatedMokaMenu = { control: moka, menu: opened[0]! };
      return activation;
    }
    case 'set-value':
      setElementValue(element, step.value);
      return;
    case 'set-checked':
      setElementChecked(element, Boolean(step.value));
      return;
    case 'choose-option':
      await chooseElementOption(element, String(step.value ?? ''));
      return;
  }
}

function setElementValue(element: Element, value: InteractionStep['value'], keepFocus = false): void {
  const text = String(value ?? '');
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.value === text || customSelectValue(element) === text) return;
    if (element.disabled || element.readOnly) throw new Error('目标输入框不可编辑');
    element.focus();
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, text);
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: text,
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (!keepFocus && element.getAttribute('role') !== 'combobox') element.blur();
    return;
  }
  if (asHtml(element).isContentEditable) {
    if (element.textContent === text) return;
    element.textContent = text;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    return;
  }
  if (element.getAttribute('role') === 'slider') {
    setAriaSlider(element, Number(value));
    return;
  }
  throw new Error('目标不支持设置值');
}

function setElementChecked(element: Element, checked: boolean): void {
  if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
    if (formCheckedState(element).checked !== checked) {
      dispatchPointerPrelude(element);
      element.click();
    }
    return;
  }
  const current = element.getAttribute('aria-checked') === 'true';
  if (current !== checked) {
    dispatchPointerPrelude(element);
    asHtml(element).click();
  }
}

async function chooseElementOption(element: Element, target: string): Promise<void> {
  if (element instanceof HTMLSelectElement) {
    const option = Array.from(element.options).find(item => !item.disabled && (item.value === target || visibleTextValue(item) === target));
    if (!option) throw new Error(`找不到选项：${target}`);
    if (element.value !== option.value) {
      if (element.disabled) throw new Error('目标下拉框不可编辑');
      selectOption(pageObserver.register(element), option.value);
    }
    return;
  }
  if (customSelectValue(element) === target || element.getAttribute('aria-valuetext') === target) return;
  if ((element instanceof HTMLInputElement && element.disabled) || element.getAttribute('aria-disabled') === 'true') throw new Error('目标下拉框不可编辑');
  const moka = element.closest(MOKA_SELECT);
  const phoenix = phoenixSelectActivation(element);
  if (element.matches('.phoenix-select__input--unText') && !phoenix) throw new Error('目标下拉框没有唯一可用的同控件触发器');
  const menuSelector = moka ? MOKA_MENU : phoenix ? PHOENIX_MENU : '';
  const optionSelector = moka ? MOKA_OPTION : phoenix ? PHOENIX_OPTION : '';
  // Phoenix has no portal owner attribute. Close only this control's arrow,
  // then use the closed baseline to bind its newly opened menu, including when
  // a prior activate call left it expanded. Never borrow an existing portal.
  if (phoenix?.expanded) await clickElement(pageObserver.register(phoenix.trigger));
  const beforeMenus = new Set(menuSelector ? visibleSelectMenus(element.ownerDocument, menuSelector) : []);
  const beforeContext = menuSelector ? null : activeInteractionContext(element.ownerDocument);
  // Only reuse a portal whose earlier explicit activation established this owner.
  const ownedMenu = moka && activatedMokaMenu?.control === moka
    && displayedMenu(activatedMokaMenu.menu) ? activatedMokaMenu.menu : undefined;
  if (!ownedMenu) await clickElement(pageObserver.register(element));
  await nextPaint();
  const controlled = element.getAttribute('aria-controls') ?? element.getAttribute('aria-owns');
  const openedMenus = () => visibleSelectMenus(element.ownerDocument, menuSelector).filter(menu => !beforeMenus.has(menu));
  const opened = menuSelector ? openedMenus() : [];
  const context = menuSelector ? null : activeInteractionContext(element.ownerDocument);
  // Custom portals have no ARIA owner. Bind only the unique menu opened by this
  // activation; an unrelated menu that was already visible is not this field's.
  let scope = controlled ? element.ownerDocument.getElementById(controlled)
    : ownedMenu ?? (menuSelector ? opened.length === 1 ? opened[0] : undefined
      : context !== beforeContext ? context : null);
  if (!scope) throw new Error('选项上下文未打开');
  if (moka) activatedMokaMenu = { control: moka, menu: scope };
  let option = exactOption(scope, target, optionSelector);
  const search = moka && element instanceof HTMLInputElement ? element
    : phoenix ? scope.querySelector<HTMLInputElement>('.phoenix-selectList__searchWrapper input.phoenix-input__input[placeholder="搜索"]') : null;
  if (!option && search && !search.readOnly && !search.disabled) {
    // Searchable school/major controls need the exact query committed through
    // the page's input event, followed by an actual result click, never a label.
    setElementValue(search, target, true);
    await settleInteraction();
    const deadline = Date.now() + 1500;
    while (!option && Date.now() < deadline) {
      const current = openedMenus();
      if (current.length > 1) throw new Error('选项上下文不唯一');
      if (current.length === 1) scope = current[0]!;
      option = displayedMenu(scope) ? exactOption(scope, target, optionSelector) : undefined;
      if (!option) await sleep(50);
    }
  }
  if (!option) throw new Error(`找不到选项：${target}`);
  const checkable = option instanceof HTMLInputElement && ['checkbox', 'radio'].includes(option.type)
    || ['checkbox', 'radio'].includes(option.getAttribute('role') ?? '');
  // Selecting an already checked choice must not toggle a checkbox off.
  if (checkable && formCheckedState(option).checked === true) return;
  dispatchPointerPrelude(option);
  asHtml(option).click();
  if (checkable) {
    await settleInteraction();
    // A removed portal is verified through the persistent field below. While
    // the choice remains mounted, a dispatched click alone proves nothing.
    if (option.isConnected && formCheckedState(option).checked !== true) {
      throw new Error(`选项未选中：${target}`);
    }
  }
}

function displayedMenu(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true'
      || style?.display === 'none' || style?.visibility === 'hidden'
      || Array.from(node.classList).some(name => /^sugar-popup-move-leave(?:-|$)/.test(name))) return false;
  }
  return element.isConnected;
}

function visibleSelectMenus(root: Document, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector)).filter(displayedMenu);
}

function exactOption(scope: Element, target: string, extraSelector: string): Element | undefined {
  const options = Array.from(scope.querySelectorAll(`option,[role="option"],input[type="radio"],input[type="checkbox"],[role="radio"][aria-checked],[role="checkbox"][aria-checked]${extraSelector ? `,${extraSelector}` : ''}`))
    .filter(item => !item.closest('[disabled],[aria-disabled="true"]') && !item.closest('a[href]'))
    .filter(item => {
      if (item instanceof HTMLInputElement && ['checkbox', 'radio'].includes(item.type)) {
        const labels = Array.from(item.labels ?? []).filter(label => scope.contains(label) && displayedMenu(label));
        // Hidden backing inputs are usable only through a visible associated
        // label inside this menu. The implicit default value "on" is no match.
        return (displayedMenu(item) || labels.length > 0)
          && ((item.hasAttribute('value') && item.value === target)
            || labels.some(label => visibleTextValue(label) === target));
      }
      if (['checkbox', 'radio'].includes(item.getAttribute('role') ?? '')
        && !['true', 'false'].includes(item.getAttribute('aria-checked') ?? '')) return false;
      return displayedMenu(item) && ((item instanceof HTMLOptionElement ? item.value : item.getAttribute('data-value')) === target
        || visibleTextValue(item) === target);
    });
  // A role=option wrapper and its label are one choice, not two candidates.
  const leaves = options.filter(item => !options.some(other => other !== item && item.contains(other)));
  if (leaves.length > 1) throw new Error(`选项不唯一：${target}`);
  return leaves[0];
}

function setAriaSlider(element: Element, target: number): void {
  if (!Number.isFinite(target)) throw new Error('滑块目标值无效');
  const min = Number(element.getAttribute('aria-valuemin') ?? 0);
  const max = Number(element.getAttribute('aria-valuemax') ?? 100);
  const current = Number(element.getAttribute('aria-valuenow') ?? min);
  const clamped = Math.max(min, Math.min(max, target));
  const direction = clamped >= current ? 'ArrowRight' : 'ArrowLeft';
  const inferredStep = Number(element.getAttribute('step') ?? 1) || 1;
  const count = Math.min(200, Math.round(Math.abs(clamped - current) / inferredStep));
  asHtml(element).focus();
  for (let index = 0; index < count; index += 1) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: direction, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: direction, bubbles: true }));
  }
}
