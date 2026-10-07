import { pageObserver } from '../observer';
import { observedState } from './interactions';
import { rawElementValue, settleInteraction, sleep, visibleTextValue } from './utils';
import type { FormFieldExpectation, FormFieldVerification } from '@/shared/contracts/page';
import { truncate } from '@/shared/utils/utils';
import { redactText } from '@/shared/contracts/policy';
import { customSelectValue, formCheckedState, formFieldContainer, formFieldLabel, isCustomSelectControl } from '../form-semantics';

/** Only associated selected options count; typed search text is not a committed selection. */
function selectedValues(element: Element): string[] {
  if (element instanceof HTMLSelectElement) {
    return [element.value, ...Array.from(element.options).filter((option) => option.selected)
      .flatMap((option) => [option.value, visibleTextValue(option)])];
  }
  const committed = customSelectValue(element);
  if (committed) return [committed];
  const controls = element.getAttribute('aria-controls') ?? element.getAttribute('aria-owns');
  if (!controls && !element.hasAttribute('aria-valuetext')) {
    throw new Error('控件没有可关联的选中值证据，请重新观测选中状态。');
  }
  const menus = controls?.split(/\s+/).map(id => element.ownerDocument.getElementById(id)).filter((menu): menu is HTMLElement => Boolean(menu)) ?? [];
  const selected = menus.flatMap(menu => Array.from(menu.querySelectorAll('[role="option"][aria-selected="true"]')));
  const explicit = element.getAttribute('aria-valuetext');
  return [...(explicit ? [explicit] : []), ...selected.flatMap((option) =>
    [option.getAttribute('data-value') ?? '', visibleTextValue(option)]).filter(Boolean), ...menus.flatMap(selectedCheckableValues)];
}

function selectedCheckableValues(menu: HTMLElement): string[] {
  if (!isDisplayedWithin(menu, menu.ownerDocument.documentElement)) return [];
  return Array.from(menu.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"][aria-checked="true"],[role="checkbox"][aria-checked="true"]'))
    .filter(option => !option.closest('a[href]'))
    .flatMap(option => {
      if (option instanceof HTMLInputElement && ['radio', 'checkbox'].includes(option.type)) {
        if (!option.checked) return [];
        const labels = Array.from(option.labels ?? []).filter(label => menu.contains(label)
          && !label.closest('a[href]') && isDisplayedWithin(label, menu));
        if (!isDisplayedWithin(option, menu) && !labels.length) return [];
        return [...(option.hasAttribute('value') ? [option.value] : []), ...labels.map(visibleTextValue)].filter(Boolean);
      }
      return isDisplayedWithin(option, menu)
        ? [option.getAttribute('data-value') ?? '', visibleTextValue(option)].filter(Boolean) : [];
    });
}

export function fieldValidationError(element: Element): string | undefined {
  const field = formFieldContainer(element);
  const errorHelp = field ? Array.from(field.querySelectorAll('.ud-formily-item-error-help'))
    .find((help) => formFieldContainer(help) === field && visibleTextValue(help) && isDisplayedWithin(help, field)) : undefined;
  const dateError = element.closest('.throne-biz-date-range-picker-error');
  if (field?.classList.contains('ud-formily-item-error') || errorHelp
    || (dateError && (!field || field.contains(dateError)))) {
    return errorHelp ? visibleTextValue(errorHelp) : '当前字段或日期范围显示校验错误。';
  }
  if (element.getAttribute('aria-invalid') === 'true'
    || element.closest('.el-form-item')?.classList.contains('is-error')) return '当前字段显示校验错误。';
  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
    && !element.validity.valid) return element.validationMessage || '当前字段未通过浏览器校验。';
  return undefined;
}

function isDisplayedWithin(element: Element, container: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true'
      || style?.display === 'none' || style?.visibility === 'hidden') return false;
    if (node === container) return true;
  }
  return false;
}

/** Compare decimal representations exactly, without rounding through JavaScript numbers. */
function decimalValue(value: string): string | undefined {
  const match = /^(-?)(?:(0|[1-9]\d*)(?:\.(\d+))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return undefined;
  const fraction = match[3] ?? match[4] ?? '';
  const digits = `${match[2] ?? ''}${fraction}`.replace(/^0+/, '');
  if (!digits) return '0';
  const significant = digits.replace(/0+$/, '');
  const exponent = BigInt(match[5] ?? '0') - BigInt(fraction.length) + BigInt(digits.length - significant.length);
  return `${match[1]}${significant}e${exponent}`;
}

function numericValuesMatch(element: Element, actual: string, expected: string): boolean {
  if (!(element instanceof HTMLInputElement) || element.type !== 'number') return false;
  const normalized = decimalValue(actual);
  return normalized !== undefined && normalized === decimalValue(expected);
}

function readField(field: FormFieldExpectation) {
  const element = pageObserver.getElement(field.elementId, field.revision);
  const nativeCheckable = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type);
  if (field.intent === 'set-checked' && !(
    nativeCheckable
    || ['checkbox', 'radio', 'switch'].includes(element.getAttribute('role') ?? '')
  )) throw new Error('目标不是可核验选中状态的复选框、单选框或开关。');
  if (field.intent === 'set-checked' && !nativeCheckable
    && !['true', 'false'].includes(element.getAttribute('aria-checked') ?? '')) {
    throw new Error('控件没有明确的 aria-checked 布尔状态，无法核验。');
  }
  const checked = formCheckedState(element);
  if (field.intent === 'set-checked' && checked.checkedConflict) {
    const container = formFieldContainer(element);
    const currentUntilNow = checked.checked && /至今|目前|present|current/i.test(formFieldLabel(element));
    const linkedDisabledEnd = container && Array.from(container.querySelectorAll<HTMLInputElement>('input:disabled'))
      .some(input => input !== element && input.type !== 'checkbox'
        && /结束|终止|截止|end/i.test([input.placeholder, input.getAttribute('data-nc-label'), formFieldLabel(input)].join(' ')));
    if (!currentUntilNow || !linkedDisabledEnd) throw new Error('复选框可见状态与原生状态不同，缺少同字段关联状态确认；本项待核对，继续其他字段。');
  }
  const value = field.intent === 'set-checked'
    ? checked.checked
    : field.intent === 'choose-option' || element.getAttribute('role') === 'combobox' || isCustomSelectControl(element)
      ? selectedValues(element) : rawElementValue(element);
  const validationError = fieldValidationError(element);
  const invalid = Boolean(validationError);
  const matches = Array.isArray(value) ? value.includes(String(field.value))
    : field.intent === 'set-checked' ? value === field.value
      : value === String(field.value) || (typeof value === 'string' && numericValuesMatch(element, value, String(field.value)));
  return { fingerprint: JSON.stringify([value, validationError]), matches, invalid, validationError,
    actual: observedState(pageObserver.describe(element)) };
}

/** Two independent reads after rendering, with a bounded 250ms observation window; no DOM writes. */
export async function verifyFormFields(fields: FormFieldExpectation[]): Promise<FormFieldVerification[]> {
  await settleInteraction();
  const read = (field: FormFieldExpectation) => {
    try { return { state: readField(field) }; }
    catch (error) { return { error: truncate(error instanceof Error ? error.message : String(error), 240) }; }
  };
  const before = fields.map(read);
  await sleep(250);
  await settleInteraction();
  return fields.map((field, index) => {
    const first = before[index]!;
    const second = read(field);
    const base = { elementId: field.elementId, intent: field.intent };
    if (!first.state || !second.state) return { ...base, ok: false, stable: false, satisfied: false,
      status: 'unavailable', error: second.error ?? first.error };
    const stable = first.state.fingerprint === second.state.fingerprint;
    const satisfied = stable && second.state.matches && !second.state.invalid;
    return { ...base, ok: true, stable, satisfied, actual: second.state.actual,
      ...(second.state.validationError ? { error: redactText(truncate(second.state.validationError, 240)) } : {}),
      status: !stable ? 'unstable' : second.state.invalid ? 'invalid' : satisfied ? 'verified' : 'mismatch' };
  });
}
