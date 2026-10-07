import { pageObserver, SKIP } from '../observer';
import { customSelectValue, formCheckedState, formFieldContainer, formFieldContext, formFieldLabel,
  formFieldRequired, formSectionRecords, formSections, isCustomSelectControl, nowcoderHint, phoenixSelectActivation, FEISHU_PERIOD_LABEL } from '../form-semantics';
import { fieldValidationError } from './verify-fields';
import { redactText } from '@/shared/contracts/policy';
import { truncate } from '@/shared/utils/utils';
import type { ResumeFormScan, ResumeScanField } from '@/shared/contracts/page';
import { describeResumeUpload } from './resume-upload-regions';

const CONTROLS = `input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]),textarea,select,[role="combobox"],[role="textbox"],[role="checkbox"],[role="radio"],[role="switch"],[contenteditable="true"],${FEISHU_PERIOD_LABEL}`;
const EMPTY_OPTION = /^(?:请选择|请选择.*|请填写|请填写.*|select(?:\s+.*)?|choose(?:\s+.*)?)$/i;
const IDENTITY_LABEL = /^(?:姓名|(?:公司|单位|学校|院校|项目|职位|岗位)(?:名称)?|(?:项目|工作|实习)?(?:职务|角色)|(?:所学)?专业(?:名称)?|学历|学位|(?:开始|结束|起始|起止|入职|离职|毕业|入学)(?:日期|时间|年月)|至今)$/;
const DELETE_LABEL = /^(?:(?:删除|移除)(?:(?:此|本|该|这)(?:条|段|项))?(?:(?:工作|实习|项目|教育|培训|获奖)?(?:经历|经验|记录))?|(?:delete|remove)(?:\s+(?:this\s+)?(?:entry|record|experience))?)$/i;
const compact = (value: string, length = 120) => redactText(truncate(value.replace(/\s+/g, ' ').trim(), length));

function displayed(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches(SKIP) || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}

function isNowcoderWarning(element: Element): boolean {
  if (!nowcoderHint(element)) return false;
  const field = formFieldContainer(element);
  const pink = (node: Element) => /^rgba\(255,0,0,0?\.3\)$/.test(node.ownerDocument.defaultView?.getComputedStyle(node).backgroundColor?.replace(/\s/g, '') ?? '');
  // Nowcoder marks Phoenix's sibling label, rather than necessarily the input itself.
  if (field && Array.from(field.querySelectorAll('label, .form-item__text, [class^="title-"], [class*=" title-"]'))
    .some(label => formFieldContainer(label) === field && displayed(label) && pink(label))) return true;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (pink(node)) return true;
    if (node === field) break;
  }
  return false;
}

function recordDelete(record: Element, section: Element, records: Element[]): string | undefined {
  // Phoenix places a form inside wrappers; an adjacent title action may belong
  // to that same wrapper. Never cross a wrapper shared by two records or the
  // section boundary, and never infer deletion from an unlabeled icon.
  const wrapper = record.matches('.ux-standard-form > .form[name]') ? record.parentElement?.parentElement : record;
  for (let scope: Element | null = record; scope && scope !== section; scope = scope === wrapper ? null : scope.parentElement) {
    if (records.filter(other => scope!.contains(other)).length !== 1) break;
    const candidates = Array.from(scope.querySelectorAll('button,[role="button"],input[type="button"],a[href]')).filter(button => {
      if (!displayed(button) || button.closest(SKIP) || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;
      const field = formFieldContainer(button);
      if (field && record.contains(field)) return false; // e.g. delete an attachment, not this record
      const label = button.getAttribute('aria-label') || button.getAttribute('title')
        || (button instanceof HTMLInputElement ? button.value : button.textContent) || '';
      return DELETE_LABEL.test(label.trim());
    });
    if (candidates.length) return candidates.length === 1 ? pageObserver.register(candidates[0]!) : undefined;
  }
  return undefined;
}

/** Current DOM only: no clicks, mutations, validation events, submission, or inferred source mapping. */
export function scanResumeForm(root: Document = document): ResumeFormScan {
  const result: ResumeFormScan = {
    url: root.location.href, title: root.title, revision: pageObserver.revision, documentId: pageObserver.documentId,
    coverage: 'current-dom', summary: { fields: 0, present: 0, empty: 0, disabled: 0, invalid: 0, nowcoderWarnings: 0 },
    sections: [], fields: [], issues: [], navigationHints: [],
  };
  const nodes = new Map<string, Element>();
  for (const element of root.querySelectorAll(CONTROLS)) {
    const file = element instanceof HTMLInputElement && element.type === 'file';
    if (element.closest(SKIP) || !displayed(file ? element.parentElement ?? element : element)) continue;
    // Native controls carry the actionable target; don't count their role-bearing wrapper twice.
    if (element.matches('input') && element.closest('.atsx-date-picker-period-month')?.querySelector(FEISHU_PERIOD_LABEL)) continue;
    if (!element.matches(`input,textarea,select,${FEISHU_PERIOD_LABEL}`) && element.querySelector('input,textarea,select')) continue;
    const observed = pageObserver.describe(element);
    const elementId = pageObserver.register(element);
    nodes.set(elementId, element);
    const context = formFieldContext(element);
    const label = compact(observed?.label || formFieldLabel(element) || observed?.name || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '未命名字段');
    const disabled = 'disabled' in element ? Boolean((element as HTMLInputElement).disabled) : element.getAttribute('aria-disabled') === 'true';
    const item: ResumeScanField = { elementId, label, ...context,
      section: context.section ? compact(context.section) : undefined, fieldPath: context.fieldPath ? compact(context.fieldPath) : undefined,
      role: observed?.role ?? element.getAttribute('role') ?? element.tagName.toLowerCase(),
      type: element.getAttribute('type') ?? undefined, state: 'unknown', required: formFieldRequired(element), disabled,
      visible: observed?.visible ?? false, nowcoderHint: observed?.nowcoderHint };
    const activation = phoenixSelectActivation(element);
    if (activation) {
      item.triggerElementId = pageObserver.register(activation.trigger);
      item.expanded = activation.expanded;
    }
    const issue = (kind: ResumeFormScan['issues'][number]['kind'], severity: 'error' | 'warning' | 'info', message: string) =>
      result.issues.push({ elementId, kind, severity, message: compact(message, 200) });
    const checked = formCheckedState(element);
    if (file) {
      const { upload, label: uploadLabel } = describeResumeUpload(element as HTMLInputElement);
      item.upload = { ...upload, receiptNames: upload.receiptNames.map(name => compact(name)),
        assignedFileNames: upload.assignedFileNames.map(name => compact(name)) };
      if (item.label === '未命名字段' && uploadLabel) item.label = compact(uploadLabel);
      const names = item.upload.receiptNames;
      item.state = names.length ? 'file_receipt' : 'unknown';
      item.valueText = names.length ? names.join(' / ') : undefined;
      if (!names.length) issue('file_receipt_unconfirmed', 'warning', upload.assignedFileNames.length ? '本上传区已有本地文件赋值，网站接收未确认；先观察本区回执，不重复赋值。' : '本上传区尚未观察到网站文件回执；核对本区用途和已有状态，解析区成功不代表独立简历附件已上传。');
    } else if (checked.checked !== undefined) {
      item.state = 'present'; item.valueText = checked.checked ? '已勾选' : '未勾选';
      if (checked.checkedConflict) issue('checked_conflict', 'warning', '组件可见勾选状态与原生 input 状态不同；结合至今/结束日期等关联状态核对，不依据原生值重复点击。');
    } else {
      let value: string | undefined;
      if (element.matches(FEISHU_PERIOD_LABEL)) {
        const displayedDate = element.textContent?.trim() ?? '';
        value = /^(?:\d{4}-(?:0[1-9]|1[0-2])|至今)$/.test(displayedDate) ? displayedDate : '';
      } else if (isCustomSelectControl(element)) value = customSelectValue(element);
      else if (element instanceof HTMLSelectElement) value = element.value ? Array.from(element.selectedOptions).map(option => option.textContent?.trim() || option.value).join(' / ') : '';
      else if (element.getAttribute('role') === 'combobox') value = observed?.valueText;
      else value = 'value' in element ? String((element as HTMLInputElement).value ?? '') : element.textContent ?? '';
      item.valueText = value ? compact(value) : undefined;
      item.state = value?.trim() && !EMPTY_OPTION.test(value.trim()) ? 'present' : 'empty';
      if (item.state === 'empty' && (isCustomSelectControl(element) || element.getAttribute('role') === 'combobox')
        && 'value' in element && String((element as HTMLInputElement).value ?? '').trim()) {
        item.state = 'unknown'; issue('selection_unconfirmed', 'warning', '仅看到下拉输入文字，尚未看到已提交选中值；不要把搜索文字当成填写成功。');
      }
    }
    if (disabled) {
      item.state = 'disabled'; issue('disabled_dependency', 'info', '字段当前禁用，可能受至今或其他字段控制；先核对依赖，不计为待补空白。');
    } else {
      const error = fieldValidationError(element);
      if (error) { issue('site_validation', 'error', error); result.summary.invalid++; }
      if (item.state === 'empty') issue('empty', 'info', '当前字段为空；与简历来源匹配后，仅补有依据的值。');
    }
    if (isNowcoderWarning(element)) {
      result.summary.nowcoderWarnings++;
      issue('nowcoder_warning', 'warning', item.state === 'empty'
        ? '牛客粉红标记，当前也为空；标记仅是待检查提示。'
        : '牛客粉红标记仍在，但当前不为空或不可编辑；不能据颜色判定填写失败。');
    }
    result.fields.push(item);
  }
  const sections = formSections(root);
  for (const section of sections) {
    const records = formSectionRecords(section.element);
    result.sections.push({ name: compact(section.name), elementId: pageObserver.register(section.element), recordCount: section.recordCount,
      records: records.map((record, index) => {
        const fields = result.fields.filter(field => record.contains(nodes.get(field.elementId)!));
        const deleteElementId = /经历|经验|教育|项目|工作|实习|培训|获奖/.test(section.name)
          ? recordDelete(record, section.element, records) : undefined;
        return {
          recordIndex: fields[0]?.recordIndex ?? index + 1, elementId: pageObserver.register(record), fieldIds: fields.map(field => field.elementId),
          identity: fields.filter(field => IDENTITY_LABEL.test(field.label) && field.valueText
            && (field.state === 'present' || field.state === 'disabled')
            && !(field.label === '至今' && field.valueText !== '已勾选')).slice(0, 12)
            .map(field => ({ elementId: field.elementId, label: field.label, valueText: field.valueText! })),
          ...(deleteElementId ? { deleteElementId } : {}),
        };
      }) });
  }
  const navigation = new Set(root.querySelectorAll('button,a,[role="button"],[role="tab"],[aria-expanded],summary,[id$="_addButton"]'));
  for (const section of sections) for (const element of section.element.querySelectorAll('div')) {
    const directText = Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
    if (/^(?:\+\s*)?(?:添加|新增|增加)(?:.*经历|.*记录)?$/.test(directText)
      && root.defaultView?.getComputedStyle(element).cursor === 'pointer') navigation.add(element);
  }
  for (const element of navigation) {
    if (element.closest(SKIP) || !displayed(element)) continue;
    const label = compact(element.getAttribute('aria-label') || element.textContent || '');
    if (!label) continue;
    let kind: ResumeFormScan['navigationHints'][number]['kind'] | undefined;
    if (element.getAttribute('aria-expanded') === 'false' || (element.tagName === 'SUMMARY' && !element.parentElement?.hasAttribute('open'))) kind = 'collapsed';
    else if (/^(?:\+\s*)?(?:添加|新增|增加)(?:.*经历|.*记录)?$/.test(label)) kind = 'add_record';
    else if (/^(?:下一页|上一页|next page|previous page|\d+)$/i.test(label) && element.closest('[role="navigation"],nav,[class*="pagination"],[class*="pager"]')) kind = 'pagination';
    else if (/^(?:下一步|继续填写|next step)$/i.test(label)) kind = 'next_step';
    if (kind) result.navigationHints.push({ elementId: pageObserver.register(element), label, kind });
  }
  result.summary.fields = result.fields.length;
  result.summary.present = result.fields.filter(field => field.state === 'present' || field.state === 'file_receipt').length;
  result.summary.empty = result.fields.filter(field => field.state === 'empty').length;
  result.summary.disabled = result.fields.filter(field => field.state === 'disabled').length;
  return result;
}
