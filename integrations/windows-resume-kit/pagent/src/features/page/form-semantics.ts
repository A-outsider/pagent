function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const MODULE = '[class*="applyFormModuleWrapper__"]';
const RECORD = '[class*="apply-form-array-card__"]';
const PHOENIX_RECORD = '.ux-standard-form > .form[name]';
// Moka uses CSS-module hashes; keep the stable class prefix and the actual
// section/record boundaries instead of Nowcoder's repeated annotation groups.
const MOKA_MODULE = '[class^="apply-block-"], [class*=" apply-block-"]';
const MOKA_RECORD = '[class^="apply-fields-"], [class*=" apply-fields-"]';
const MOKA_FIELD = '[class^="apply-field-"], [class*=" apply-field-"]';
const FEISHU_LIST = '.createFormSection-formList.createFormSection-formList-mutiple';
const FEISHU_RECORD = '.resumeEditForm-item.resumeEditForm-education, .resumeEditForm-item.resumeEditForm-internship, .resumeEditForm-item.resumeEditForm-project';
export const FEISHU_PERIOD_LABEL = '.atsx-date-picker-period-month-label[data-cy$=".periodInputBegin"], .atsx-date-picker-period-month-label[data-cy$=".periodInputEnd"]';
const FEISHU_SECTIONS: Record<string, string> = { education: '教育经历', internship: '实习经历', project: '项目经历' };
export const MOKA_SELECT = '[class^="sd-Select-container-"], [class*=" sd-Select-container-"]';
const CUSTOM_SELECT = `.ud__select, .phoenix-select, ${MOKA_SELECT}`;

function feishuPath(element: Element): { kind: string; index: number; fieldPath: string; end?: string } | undefined {
  const record = element.closest(FEISHU_RECORD);
  if (!record || !record.parentElement?.matches(FEISHU_LIST)) return undefined;
  const paths = Array.from(record.querySelectorAll('[data-cy]')).flatMap(node => {
    const match = /^(\w+)\[(\d+)\]\.([\w]+)$/.exec(node.getAttribute('data-cy') ?? '');
    return match ? [match] : [];
  });
  const first = paths[0];
  if (!first || !FEISHU_SECTIONS[first[1]!] || !record.classList.contains(`resumeEditForm-${first[1]}`)
    || paths.some(path => path[1] !== first[1] || path[2] !== first[2])) return undefined;
  const raw = element.closest('[data-cy]')?.getAttribute('data-cy') || element.closest('.atsx-form-item')?.getAttribute('data-cy');
  const match = /^(\w+)\[(\d+)\]\.([\w]+?)(?:Input(Begin|End)?)?$/.exec(raw ?? '');
  if (!match || match[1] !== first[1] || match[2] !== first[2]) return undefined;
  return { kind: match[1]!, index: Number(match[2]), fieldPath: `${match[1]}[${match[2]}].${match[3]}${match[4] ? `.${match[4].toLowerCase()}` : ''}`, end: match[4] };
}

function sectionName(module: Element): string {
  if (module.matches(FEISHU_LIST)) {
    const kinds = formSectionRecords(module).map(record => Array.from(record.querySelectorAll('[data-cy]'))
      .map(node => feishuPath(node)?.kind).find(Boolean));
    return kinds.length && kinds.every(kind => kind === kinds[0]) ? FEISHU_SECTIONS[kinds[0]!] ?? '' : '';
  }
  if (module.matches(MODULE)) return text(module.querySelector('.applyFormModuleWrapper-title .applyFormModuleWrapper-text'));
  if (module.matches(MOKA_MODULE)) {
    const heading = Array.from(module.children).find(child => Array.from(child.classList).some(name => name.startsWith('blockTitle-')));
    // The heading also contains an “添加” button; read only its title span.
    return text(heading?.querySelector('[class^="text-"], [class*=" text-"]') ?? null);
  }
  return text(module.firstElementChild);
}

function phoenixModule(record: Element): Element | null {
  for (let parent = record.parentElement; parent && parent !== record.ownerDocument.body; parent = parent.parentElement) {
    const title = parent.firstElementChild;
    const name = text(title);
    if (!title || name.length === 0 || name.length > 40 || title.contains(record)
      || title.matches('input,textarea,select,button,[role="button"]')
      || title.querySelector('input,textarea,select,button,.form[name]')) continue;
    if (Array.from(parent.children).slice(1).some(child => child.contains(record))) return parent;
  }
  return null;
}

export function formSectionRecords(section: Element): Element[] {
  if (section.matches(FEISHU_LIST)) return Array.from(section.querySelectorAll(FEISHU_RECORD))
    .filter(record => record.parentElement === section && Array.from(record.querySelectorAll('[data-cy]')).some(node => feishuPath(node)));
  if (section.matches(MOKA_MODULE)) return Array.from(section.querySelectorAll(MOKA_RECORD))
    .filter(record => record.closest(MOKA_MODULE) === section && Array.from(record.classList).some(name => name.startsWith('multi-')));
  return Array.from(section.querySelectorAll(section.matches(MODULE) ? RECORD : PHOENIX_RECORD));
}

export function formSections(root: ParentNode): Array<{ element: Element; name: string; recordCount: number }> {
  const sections = Array.from(root.querySelectorAll(`${MODULE}, ${MOKA_MODULE}`)).map((element) => ({
    element,
    name: sectionName(element),
    recordCount: formSectionRecords(element).length,
  }));
  const known = new Set(sections.map(section => section.element));
  for (const record of root.querySelectorAll(PHOENIX_RECORD)) {
    const element = phoenixModule(record);
    if (!element || known.has(element)) continue;
    known.add(element);
    sections.push({ element, name: text(element.firstElementChild), recordCount: formSectionRecords(element).length });
  }
  for (const element of root.querySelectorAll(FEISHU_LIST)) {
    const name = sectionName(element);
    if (name) sections.push({ element, name, recordCount: formSectionRecords(element).length });
  }
  return sections.filter(({ name }) => Boolean(name));
}

export function formFieldContext(element: Element): {
  section?: string; recordIndex?: number; recordCount?: number; fieldPath?: string;
} {
  const feishu = feishuPath(element);
  if (feishu) return { section: FEISHU_SECTIONS[feishu.kind], recordIndex: feishu.index + 1,
    recordCount: formSectionRecords(element.closest(FEISHU_RECORD)!.parentElement!).length, fieldPath: feishu.fieldPath };
  const phoenixRecord = element.closest(PHOENIX_RECORD);
  const module = element.closest(`${MODULE}, ${MOKA_MODULE}`) ?? (phoenixRecord ? phoenixModule(phoenixRecord) : null);
  if (!module) return {};
  const section = sectionName(module);
  const records = formSectionRecords(module);
  const record = element.closest(RECORD) ?? element.closest(MOKA_RECORD) ?? phoenixRecord;
  const fieldId = formFieldContainer(element)?.id;
  return {
    section: section || undefined,
    recordIndex: record && records.includes(record) ? records.indexOf(record) + 1 : undefined,
    recordCount: records.length,
    fieldPath: fieldId?.startsWith('formily-item-') ? fieldId.slice('formily-item-'.length) : undefined,
  };
}

/** Keep fallback semantics inside the actual field, never a neighbouring field. */
export function formFieldContainer(element: Element): Element | null {
  return element.closest(`.ud-formily-item, .form-item, .atsx-form-item, .fx-field, ${MOKA_FIELD}`);
}

/** Third-party annotations describe this page; they are never source-record indices. */
export function nowcoderHint(element: Element): { className?: string; label?: string; group?: string } | undefined {
  const read = (attribute: string) => element.getAttribute(attribute)?.trim()
    || formFieldContainer(element)?.getAttribute(attribute)?.trim() || undefined;
  const className = read('data-nc-cls');
  const label = read('data-nc-label');
  const group = read('data-nc-group');
  return className || label || group ? { className, label, group } : undefined;
}

export function formFieldLabel(element: Element): string {
  if (!element.matches(`input,textarea,select,[role="combobox"],[role="textbox"],[role="checkbox"],[role="radio"],[role="switch"],[contenteditable="true"],${FEISHU_PERIOD_LABEL}`)) return '';
  const feishu = feishuPath(element);
  if (feishu?.end) return feishu.end === 'Begin' ? '开始时间' : '结束时间';
  if (element.matches('input[type="checkbox"]')) {
    const checkboxLabel = text(element.closest('.phoenix-checkbox')?.querySelector('.phoenix-checkbox__text') ?? null);
    if (checkboxLabel) return checkboxLabel;
  }
  const named = element.closest('[data-form-field-i18n-name]');
  const explicit = named?.getAttribute('data-form-field-i18n-name')?.trim();
  if (explicit) return explicit;
  const field = formFieldContainer(element);
  if (field?.matches('.fx-field')) return text(field.querySelector(':scope > .field-label > .field-name'));
  const label = Array.from(field?.querySelectorAll('.ud-formily-item-label label, .ud-formily-item-label-content, .form-item__text, label .customResumeForm-fieldName, [class^="title-"], [class*=" title-"]') ?? [])
    .find((node) => formFieldContainer(node) === field);
  return text(label ?? null).replace(/^\*\s*|\s*\*$/g, '') || nowcoderHint(element)?.label || '';
}

export function formFieldRequired(element: Element): boolean {
  if (element.getAttribute('aria-required') === 'true') return true;
  if ('required' in element && Boolean((element as HTMLInputElement).required)) return true;
  const field = formFieldContainer(element);
  if (field?.matches('.fx-field')) return Boolean(field.querySelector(':scope > .field-label > .field-required'));
  return Array.from(field?.querySelectorAll('.ud-formily-item-asterisk, .form-item__required') ?? [])
    .some((node) => formFieldContainer(node) === field);
}

/** Read the component's displayed checkbox state as well as its native backing input. */
export function formCheckedState(element: Element): {
  checked?: boolean; nativeChecked?: boolean; checkedSource?: 'native' | 'aria' | 'phoenix'; checkedConflict?: boolean;
} {
  const native = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? element : null;
  const phoenix = element.closest('.phoenix-checkbox')?.querySelector('.phoenix-checkbox__realInput');
  if (phoenix) {
    const checked = phoenix.classList.contains('phoenix-checkbox__realInput--checked');
    return { checked, nativeChecked: native?.checked, checkedSource: 'phoenix',
      checkedConflict: native ? native.checked !== checked : undefined };
  }
  if (native) return { checked: native.checked, nativeChecked: native.checked, checkedSource: 'native' };
  const aria = element.getAttribute('aria-checked');
  return aria === 'true' || aria === 'false' ? { checked: aria === 'true', checkedSource: 'aria' } : {};
}

export function isCustomSelectControl(element: Element): boolean {
  return element.matches('input') && Boolean(element.closest(CUSTOM_SELECT));
}

/** Phoenix's non-text input is a value handle; its sibling arrow opens the selector. */
export function phoenixSelectActivation(element: Element): { trigger: Element; expanded: boolean } | undefined {
  if (!(element instanceof HTMLInputElement) || !element.matches('.phoenix-select__input--unText') || element.disabled) return undefined;
  const select = element.closest('.phoenix-select');
  if (!select || select.classList.contains('phoenix-select--disabled') || select.getAttribute('aria-disabled') === 'true') return undefined;
  const arrows = Array.from(select.querySelectorAll('.phoenix-select__switchArrow'))
    .filter(arrow => arrow.closest('.phoenix-select') === select);
  if (arrows.length !== 1) return undefined;
  return { trigger: arrows[0]!, expanded: select.classList.contains('phoenix-select--active') };
}

/** Search input text is not a committed choice; read the component's selected display. */
export function customSelectValue(element: Element): string | undefined {
  if (!isCustomSelectControl(element)) return undefined;
  const select = element.closest(CUSTOM_SELECT)!;
  const selected = Array.from(select.querySelectorAll(select.matches('.phoenix-select')
    ? '.phoenix-select__tipWrapper--visible .phoenix-select__tipEle'
    : select.matches(MOKA_SELECT) ? '[class^="sd-Input-display-value-"], [class*=" sd-Input-display-value-"]'
      : '.ud__select__selector__selectItem'))
    .filter((node) => node.closest(CUSTOM_SELECT) === select)
    .filter(node => !select.matches(MOKA_SELECT) || Array.from(node.classList).some(name => /^sd-Input-display-value-[A-Za-z0-9_]+$/.test(name)))
    .map(text).filter(Boolean);
  return selected.length ? selected.join(', ') : undefined;
}
