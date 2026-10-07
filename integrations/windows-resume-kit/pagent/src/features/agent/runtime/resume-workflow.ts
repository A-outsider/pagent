/** Per-turn evidence ledger for resume filling; unrelated browsing keeps its normal tools. */
import type { ChatMessage } from '@/shared/contracts/session-messages';
import { isRedactedPlaceholder, resolveResumeExpectation, type ResumeSourceResolver, type ResumeSourceValue } from './tools/resume-source';

type Args = Record<string, unknown>;
type Field = { intent: string; value: unknown; sourcePath?: string; status: 'pending' | 'verified' | 'failed'; reason?: string };
type SourceRecord = { section: string; sourcePath: string; label: string; elementIds?: string[]; disposition?: 'attempted' | 'not_applicable'; reason?: string };
export type ResumeSourceFieldProgress = { sourcePath: string; elementIds?: string[]; disposition: 'mapped' | 'not_applicable' | 'deferred'; reason?: string };
export type ResumeRecordProgress = { sourcePath: string; elementIds?: string[]; disposition: 'attempted' | 'not_applicable'; reason?: string; fields?: ResumeSourceFieldProgress[] };
type SourceField = Omit<ResumeSourceFieldProgress, 'disposition'> & { recordSourcePath: string; disposition?: ResumeSourceFieldProgress['disposition'] };
type SourceFieldStatus = 'unmapped' | 'mapped_pending' | 'failed' | 'verified' | 'not_applicable';
const EDITS = new Set(['click_element', 'dblclick_element', 'type_text', 'clear_field', 'select_option',
  'interact_elements', 'drag_element', 'press_key', 'upload_attachment']);
const NAVIGATION = new Set(['navigate', 'go_back', 'go_forward', 'reload_page', 'switch_tab', 'open_tab', 'close_tab']);
const PREPARATION_REASONS: Record<string, string> = {
  preparation_tool_unavailable: '附件准备工具未启用',
  existing_pdf_receipt_missing: '尚未找到已有 PDF 的接收回执；用户明确不上传，本轮保留空缺',
  no_independent_resume_attachment: '未发现独立的正式简历附件区；解析入口状态另行报告',
  not_independent_resume_attachment: '目标不是独立正式简历附件，未上传；解析入口需要在牛客之前处理',
  file_assignment_failed: '文件尚未成功赋值，继续其他已知填写',
  existing_pdf_not_ready: '已有 PDF，但等待期间仍未确认回执持续存在且表单稳定',
  ambiguous_existing_pdf_receipt: '页面显示多个 PDF，需要确认简历附件区域',
  selected_file_receipt_mismatch: '本地待上传文件与网页已有附件回执不一致',
  attachment_changed_during_observation: '检查期间附件发生变化，需要重新核对',
  no_upload_control: '尚未找到 PDF 上传控件',
  ambiguous_upload_control: '有多个上传控件，需要定位简历上传区域',
  existing_attachment_unverified: '已有附件，但无法确认是本次授权的 PDF',
  upload_or_parsing_already_in_progress: '网站仍在上传或解析',
  parsing_or_stability_unconfirmed: '尚未确认解析后的表单已稳定',
  website_receipt_unconfirmed: '网站尚未显示附件接收回执',
  upload_or_parsing_failed: '网站报告上传或解析失败',
  preparation_failed_or_timed_out: '附件准备失败或超时',
  page_or_upload_region_changed: '页面或上传区域发生变化，需要重新检查',
};
const RAW_ACTIONS = new Set(['execute_cdp_script', 'execute_cdp_command', 'cdp_click_xy']);
const READ_ONLY_CDP = new Set(['DOM.getDocument', 'DOM.getOuterHTML', 'DOM.describeNode', 'DOM.querySelector',
  'DOM.querySelectorAll', 'DOM.resolveNode', 'DOM.getBoxModel', 'DOM.getAttributes', 'DOMSnapshot.captureSnapshot',
  'Runtime.getProperties', 'Runtime.releaseObject', 'Runtime.releaseObjectGroup', 'Runtime.enable', 'Runtime.disable',
  'Page.getLayoutMetrics', 'Page.captureScreenshot', 'Network.getResponseBody', 'Emulation.setFocusEmulationEnabled']);

export function isResumeFillRequest(prompt: string, url = '', previousPrompts: string | string[] = []): boolean {
  if (/zhipin\.com\/web\/geek\/chat/.test(url)) return false;
  const history = typeof previousPrompts === 'string' ? [previousPrompts] : previousPrompts;
  for (const request of [prompt, ...history.slice().reverse()]) {
    if (/为什么|分析|原因|怎么|如何/.test(request) && !/帮我.*填|请.*填|开始填|继续填|填吧/.test(request)) return false;
    const filling = /填(?:写|一下|吧|好|完|上|简历|表)|补填|完善.*简历|完整.*简历/.test(request);
    if (filling && (/简历|网申|申请表/.test(request) || /resume|\/apply(?:[/?#]|$)/i.test(url))) return true;
    const compact = request.replace(/[，,。.!！\s]/g, '');
    const continuation = /^(?:继续(?:吧|呀|啊)?|好(?:的|了)?|可以(?:了)?|开始吧|嗯)+$/.test(compact);
    const attachmentConfirmation = /^(?:(?:pdf|附件|简历)(?:(?:已|已经)(?:上传|传)(?:过)?(?:了)?|上传(?:好|完)(?:了)?)|(?:已|已经)上传(?:了)?(?:pdf|附件|简历))(?:不用再传|不用重传|不要重复上传)?$/i.test(compact);
    // Only short continuations and upload acknowledgements bridge back to a fill request.
    // An intervening analysis or other task ends that intent rather than reviving old work.
    if (compact.length > 60 || (!continuation && !attachmentConfirmation)) return false;
  }
  return false;
}

export type ResumePreparationMode = 'existing_only' | 'upload_if_missing';

/** Keep upload restrictions on the application where the user gave them. */
export function resumeUserPromptsForPage(history: ChatMessage[], url = ''): string[] {
  const result: string[] = [];
  for (const message of history.slice().reverse()) {
    if (message.role !== 'user') continue;
    const pages = message.references?.filter(reference => reference.type === 'page') ?? [];
    if (url && pages.length && !pages.some(page => page.url === url)) break;
    result.unshift(message.content);
  }
  return result;
}

/** Only an explicit no-upload instruction disables missing-attachment recovery. */
export function resumePreparationMode(prompt: string, previousUserPrompts: string[] = []): ResumePreparationMode {
  for (const message of [...previousUserPrompts, prompt].reverse()) {
    // “先上传 …，不要重复上传” authorizes the first upload; receipts prevent duplicates.
    const withoutRepeatWarning = message.replace(/(?:不用|不要|别|无需|不需要)\s*(?:再次|重复|反复|再)\s*(?:上传|重传)/gi, '');
    if (/(?:先|首先|第一步).{0,30}上传.{0,30}(?:pdf|附件|简历)/i.test(withoutRepeatWarning)
      && !/(?:不用|不要|别|无需|不需要).{0,10}(?:上传|重传)/i.test(withoutRepeatWarning)) return 'upload_if_missing';
    if (/(?:不用|不要|别|无需|不需要).{0,10}(?:上传|重传)/i.test(message)) return 'existing_only';
    if (/(?:重新|再次|更换|替换).{0,10}(?:上传|pdf|附件)|(?:新建|全新|从头).{0,8}(?:填写|网申|申请)/i.test(message)) return 'upload_if_missing';
    // “补充填写” and “已上传” do not prove that this page's separate attachment is present.
    // Keep looking back for an explicit same-page restriction; otherwise inspect real receipts.
  }
  return 'upload_if_missing';
}

function data(result: unknown): any {
  if (typeof result === 'string') {
    const wrapped = /```untrusted-page\n([\s\S]*)\n```/.exec(result);
    const text = (wrapped?.[1] ?? result).trim();
    try { return data(JSON.parse(text)); } catch { /* MCP appends filling guidance after its JSON text. */ }
    const start = text.search(/[\[{]/);
    let depth = 0; let quoted = false; let escaped = false;
    for (let index = start; start >= 0 && index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if ((char === '}' || char === ']') && --depth === 0) {
        try { return data(JSON.parse(text.slice(start, index + 1))); } catch { return undefined; }
      }
    }
    return undefined;
  }
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content: unknown }).content;
    if (Array.isArray(content)) return content.filter((part) => part?.type === 'text').map((part) => data(part.text)).find((value) => value !== undefined);
    return data(content);
  }
  return result;
}

function writtenFields(name: string, args: Args, sourceValue: ResumeSourceResolver): Array<Args> {
  if (name === 'interact_elements') return (args.steps as Args[] ?? []).flatMap((step) => {
    if (step.intent === 'activate') return [];
    const resolved = resolveResumeExpectation({ intent: String(step.intent), value: step.value as ResumeSourceValue | undefined,
      sourcePath: typeof step.sourcePath === 'string' ? step.sourcePath : undefined }, sourceValue);
    // The interaction tool rejects these before dispatch. They must not replace a real write's expectation.
    return 'error' in resolved ? [] : [{ ...step, value: resolved.value }];
  });
  if (name === 'type_text') return isRedactedPlaceholder(args.text) ? [] : [{ ...args, intent: 'set-value', value: args.mode === 'append' ? undefined : args.text }];
  if (name === 'clear_field') return [{ ...args, intent: 'set-value', value: '' }];
  if (name === 'select_option') return [{ ...args, intent: 'choose-option' }];
  return [];
}

export class ResumeWorkflow {
  enabled: boolean;
  private ready = false;
  private queue: Promise<unknown> = Promise.resolve();
  private labels = new Map<string, string>();
  private controls = new Map<string, { role: string; fieldId?: string }>();
  private menuField?: string;
  private formStructure?: string;
  private documentId?: string;
  private preparation = '尚未检查 PDF 上传和解析状态';
  private fields = new Map<string, Field>();
  private uploaded = new Set<string>();
  private independentAttachmentCheck?: string;
  private attachmentRegions = new Map<string, { label: string; purpose: string; status: string; reason?: string }>();
  private records = new Map<string, SourceRecord>();
  private sourceCounts = new Map<string, number>();
  private inventoryRead = false;
  private inventoryComplete = false;
  private sourceFacts = new Map<string, string | number | boolean>();
  private redactionFacts = new Set<string>();
  private sourceFields = new Map<string, SourceField>();
  private pageCoverage: unknown;
  private nowcoder = '尚未执行牛客补充填写';

  constructor(enabled: boolean, readonly preparationMode: ResumePreparationMode = 'upload_if_missing') { this.enabled = enabled; }

  get attachmentReady(): boolean { return this.ready; }

  sourceValue(path: string): string | number | boolean | undefined { return this.sourceFacts.get(path); }

  serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  beginTool(name: string): void {
    if (name === 'prepare_resume_form') this.enabled = true;
  }

  before(name: string, args: Args): void {
    if (!this.enabled) return;
    if (name === 'prepare_resume_form' || name === 'ensure_resume_attachment') {
      if (this.preparationMode === 'existing_only') args.mode = 'existing_only';
      return;
    }
    if (EDITS.has(name) || RAW_ACTIONS.has(name)) {
      if (name === 'upload_attachment' && this.uploaded.has(this.uploadKey(args))) {
        throw new Error('本轮已赋值该附件，请核对网页回执，不要重复上传；继续填写其他已知字段。');
      }
      const fields = writtenFields(name, args, (path) => this.sourceValue(path));
      if (name === 'interact_elements') {
        for (const step of args.steps as Args[] ?? []) if (step.intent === 'activate') this.activate(String(step.elementId));
      } else if (name === 'click_element') this.activate(String(args.elementId));
      else if (name === 'press_key' && args.key === 'Escape') this.menuField = undefined;
      else if (name === 'execute_cdp_command') {
        const method = String(args.method);
        const params = args.params as Args | undefined;
        // Protocol-enforced read-only evaluation; never guess from JavaScript text.
        if (!READ_ONLY_CDP.has(method) && !(['Runtime.evaluate', 'Runtime.callFunctionOn'].includes(method)
          && params?.throwOnSideEffect === true)) this.invalidateFields();
      } else if ((!fields.length && name !== 'type_text') || args.submit === true) this.invalidateFields();
      for (const field of fields) {
        const id = String(field.elementId);
        const sourcePath = typeof field.sourcePath === 'string' ? field.sourcePath : undefined;
        this.fields.set(id, { intent: String(field.intent), value: field.value ?? (sourcePath ? this.sourceValue(sourcePath) : undefined), sourcePath, status: 'pending' });
        if (field.intent === 'choose-option') this.menuField = id;
        if (sourcePath) this.bindSourceField(sourcePath, id);
      }
    }
    if (NAVIGATION.has(name)) {
      this.ready = false;
      this.uploaded.clear();
      this.attachmentRegions.clear();
      this.independentAttachmentCheck = undefined;
      this.preparation = '页面已切换，PDF 与解析状态待核对，不阻断其他填写';
      this.invalidateFields();
      this.controls.clear(); this.menuField = undefined;
      this.formStructure = undefined; this.documentId = undefined;
    }
  }

  after(name: string, args: Args, result: unknown): void {
    if (!this.enabled) return;
    const value = data(result);
    if (typeof value?.documentId === 'string') {
      if (this.documentId && this.documentId !== value.documentId) {
        this.invalidateFields();
        this.controls.clear(); this.menuField = undefined; this.formStructure = undefined;
      }
      this.documentId = value.documentId;
    }
    if (/(?:^|_)get_resume$|(?:^|_)lookup_resume_fields$/.test(name)) this.readInventory(value, args, /(?:^|_)get_resume$/.test(name));
    if (name === 'scan_resume_form') {
      this.pageCoverage = value ?? { ok: false, reason: '扫描结果不可读取，全部页面覆盖仍待检查' };
      if (Array.isArray(value?.fields)) {
        const structure = JSON.stringify(value.fields.map((field: any) => [field.elementId, field.section, field.recordIndex, field.role, field.disabled]));
        if (this.formStructure && this.formStructure !== structure) this.invalidateFields();
        this.formStructure = structure;
        for (const field of value.fields) {
          this.controls.set(String(field.elementId), { role: String(field.role) });
          if (field.triggerElementId) this.controls.set(String(field.triggerElementId), { role: String(field.role), fieldId: String(field.elementId) });
        }
      }
      for (const field of value?.fields ?? []) {
        if (!field.upload || !['resume_parse', 'resume_attachment'].includes(field.upload.purpose)) continue;
        const received = field.upload.receiptNames?.length > 0;
        const assigned = field.upload.assignedFileNames?.length > 0;
        this.attachmentRegions.set(String(field.elementId), { label: field.label ?? field.upload.purpose,
          purpose: field.upload.purpose, status: received ? '网页已显示文件回执' : assigned ? '已赋值，网页接收回执待确认' : '未上传',
          ...(!received && this.attachmentRegions.get(String(field.elementId))?.reason ? { reason: this.attachmentRegions.get(String(field.elementId))!.reason } : {}),
        });
      }
    }
    if (name === 'run_nowcoder_fill') {
      if (value?.attemptStarted === true || value?.clicked === true || value?.status === 'completed') this.invalidateFields();
      const reason = String(value?.reason ?? value?.error ?? value?.status ?? '未获得执行证据');
      this.nowcoder = value?.status === 'completed'
        ? '已执行牛客补充填写，插件已返回完成回执；实际字段仍需独立核验'
        : value?.ok === true && !value?.status ? '已执行牛客补充填写，实际字段仍需独立核验'
          : value?.attemptStarted === true || value?.clicked === true
            ? `已启动或等待牛客补充填写，完成状态未确认：${reason}；继续模型检查补齐`
            : `牛客补充填写未确认：${reason}；继续模型检查补齐`;
    }
    if (['observe_page', 'extract_interactions', 'inspect_element_tree', 'search_page_text'].includes(name)) {
      const collect = (item: any, depth = 0): void => {
        if (!item || typeof item !== 'object' || depth > 10) return;
        const id = item.elementId ?? item.id;
        const label = item.label || item.name;
        if (typeof id === 'string' && typeof label === 'string') this.labels.set(id, label.slice(0, 80));
        if (typeof id === 'string' && typeof item.role === 'string') {
          this.controls.set(id, { ...this.controls.get(id), role: item.role });
          for (const option of Array.isArray(item.options) ? item.options : []) if (typeof option.elementId === 'string') {
            this.controls.set(option.elementId, { role: 'option', fieldId: id });
          }
          if (item.role === 'option' && this.menuField) this.controls.set(id, { role: item.role, fieldId: this.menuField });
        }
        for (const child of Object.values(item)) collect(child, depth + 1);
      };
      collect(value);
    }
    if (name === 'prepare_resume_form') {
      this.ready = value?.ready === true;
      this.preparation = value?.ready === true ? (value.parsing === 'existing_form_stable' ? '沿用网页已有 PDF，表单已稳定；本轮未上传、未重新解析，未校验附件字节身份' : value.parsing === 'form_repopulation_observed' ? '已观察到 PDF 回执和表单回填，页面已稳定' : 'PDF 回执和表单稳定性检查通过；未确认网站已解析回填') : value?.reason === 'no_upload_control'
        ? '未找到 PDF 上传控件，附件仍未上传，继续填写其他已知信息' : `PDF 准备未通过：${PREPARATION_REASONS[value?.reason] ?? '未获得可靠的接收和解析证据'}，继续填写其他已知信息`;
    }
    if (name === 'prepare_resume_form' || name === 'ensure_resume_attachment') {
      // Receipt status may be reused from an earlier upload; only this call's mutation invalidates field evidence.
      if (value?.filesAssigned === true || value?.formChanged === true) {
        this.invalidateFields();
      }
      if (name === 'ensure_resume_attachment') this.independentAttachmentCheck = value?.ready ? '独立附件回执检查通过'
        : PREPARATION_REASONS[value?.reason] ?? String(value?.reason ?? '独立附件检查结果未确认');
      const target = value?.target;
      if (target?.elementId) this.attachmentRegions.set(String(target.elementId), {
        label: target.label ?? target.purpose, purpose: target.purpose,
        status: value?.ready ? '网页回执检查通过' : target.receiptNames?.length || ['page_receipt_observed', 'receipt_existing'].includes(value?.attachment?.status) ? '网页已显示文件，稳定性待确认'
          : !target.assignedFileNames?.length && value?.filesAssigned === false && value?.attachment?.status === 'assigned_unverified' && value?.reason === 'preparation_failed_or_timed_out'
            ? '已发起上传，是否赋值及接收待确认'
            : target.assignedFileNames?.length || value?.attachment?.status === 'assigned_unverified' ? '已赋值，网页接收回执待确认' : '未上传',
        ...(!value?.ready && value?.reason ? { reason: PREPARATION_REASONS[value.reason] ?? String(value.reason) } : {}),
      });
    }
    if (name === 'upload_attachment' && value?.filesAssigned === true) this.uploaded.add(this.uploadKey(args, value?.target?.elementId));
    if (name === 'verify_form_fields' && Array.isArray(value)) {
      const expected = args.fields as Args[] ?? [];
      for (const check of value) {
        const request = expected.find((field) => field.elementId === check.elementId);
        if (!request) continue;
        const sourcePath = typeof request.sourcePath === 'string' ? request.sourcePath : typeof check.expectedSourcePath === 'string' ? check.expectedSourcePath : undefined;
        const resolved = resolveResumeExpectation({ intent: String(request.intent), sourcePath,
          value: request.value as ResumeSourceValue | undefined }, path => this.sourceValue(path));
        const expectedValue = 'error' in resolved ? undefined : resolved.value;
        const field = this.fields.get(check.elementId);
        // A new expectation must not redefine a failed write as success.
        const same = (check.expectedSourcePath === undefined || check.expectedSourcePath === sourcePath) && (!field || (field.value !== undefined && expectedValue !== undefined
          && (!field.sourcePath || !sourcePath || field.sourcePath === sourcePath)
          && (field.intent === 'set-checked' || request.intent === 'set-checked'
            ? field.intent === request.intent && typeof field.value === 'boolean' && field.value === expectedValue
            : String(field.value) === String(expectedValue))));
        if (same && sourcePath) this.bindSourceField(sourcePath, check.elementId);
        this.fields.set(check.elementId, {
          intent: same ? String(request.intent) : field?.intent ?? String(request.intent), value: field?.value ?? expectedValue,
          sourcePath: field?.sourcePath ?? sourcePath,
          status: same && expectedValue !== undefined && check.ok === true && check.stable === true && check.satisfied === true && check.status === 'verified'
            ? 'verified' : 'failed',
          reason: same ? String(check.error ?? check.status ?? '未确认').slice(0, 160) : '核验预期与原写入值或来源不同',
        });
      }
    }
    if (EDITS.has(name)) {
      const results = Array.isArray(value) ? value : [value];
      const dispatched = writtenFields(name, args, (path) => this.sourceValue(path));
      for (const item of results) {
        if (['interact_elements', 'type_text'].includes(name)
          && !dispatched.some((field) => field.elementId === item?.elementId)) continue;
        const field = this.fields.get(item?.elementId);
        if (item?.elementId === this.menuField && item?.satisfied === true) this.menuField = undefined;
        if (field && (item.ok === false || item.satisfied === false)) {
          field.status = 'failed';
          field.reason = String(item.error ?? item.verificationStatus ?? '写入后未保留预期值').slice(0, 160);
        }
      }
    }
  }

  failure(name: string): void {
    if (this.enabled && ['prepare_resume_form', 'ensure_resume_attachment', 'run_nowcoder_fill'].includes(name)) this.invalidateFields();
    if (this.enabled && name === 'prepare_resume_form') {
      this.ready = false;
      this.preparation = '附件准备工具失败，附件状态未确认，继续填写其他已知信息';
    }
    if (this.enabled && name === 'ensure_resume_attachment') this.independentAttachmentCheck = '独立附件工具失败，仍需按区核对；继续其他已知填写';
    if (this.enabled && name === 'run_nowcoder_fill') this.nowcoder = '牛客补充填写工具失败；继续模型检查补齐';
    if (this.enabled && name === 'scan_resume_form') this.pageCoverage = { ok: false, reason: '整表扫描失败，页面覆盖仍待检查；继续可操作字段' };
  }

  private invalidateFields(elementId?: string): void {
    for (const [id, field] of this.fields) if (!elementId || id === elementId) {
      if (field.status === 'verified') field.status = 'pending';
    }
  }

  private activate(elementId: string): void {
    const control = this.controls.get(elementId);
    if (control?.role === 'combobox') { this.menuField = control.fieldId ?? elementId; return; }
    if (control?.role === 'textbox') { this.menuField = undefined; return; }
    if (control?.role === 'option' && control.fieldId) this.invalidateFields(control.fieldId);
    else this.invalidateFields(); // Unknown buttons can add/delete records or repopulate a form.
    this.menuField = undefined;
  }

  private uploadKey(args: Args, target?: string): string {
    return JSON.stringify([args.serverName ?? 'resume', args.attachmentId, target ?? args.elementId]);
  }

  private recordForSource(sourcePath: string): SourceRecord | undefined {
    return [...this.records.values()].filter(item => sourcePath === item.sourcePath || sourcePath.startsWith(`${item.sourcePath}.`) || sourcePath.startsWith(`${item.sourcePath}[`))
      .sort((left, right) => right.sourcePath.length - left.sourcePath.length)[0];
  }

  private bindSourceField(sourcePath: string, elementId: string): void {
    if (this.sourceValue(sourcePath) === undefined) return;
    const record = this.recordForSource(sourcePath);
    if (!record) return;
    record.elementIds = [...new Set([...(record.elementIds ?? []), elementId])];
    record.disposition = 'attempted';
    this.sourceFields.set(sourcePath, { sourcePath, recordSourcePath: record.sourcePath, disposition: 'mapped', elementIds: [elementId] });
  }

  private readInventory(value: any, args: Args, isFullResume: boolean): void {
    if (!value || typeof value !== 'object') return;
    const hasContent = (item: unknown): boolean => item !== null && item !== undefined && item !== ''
      && (typeof item !== 'object' || Object.values(item).some(hasContent));
    const add = (section: string, sourcePath: string, label: string) => {
      const previous = this.records.get(sourcePath);
      this.records.set(sourcePath, { ...previous, section, sourcePath, label });
    };
    const collect = (path: string, item: unknown, facts: Map<string, string | number | boolean>): void => {
      if (typeof item === 'string' && item.trim() && !isRedactedPlaceholder(item) || typeof item === 'number' || typeof item === 'boolean') facts.set(path, item as string | number | boolean);
      else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) collect(Array.isArray(item) ? `${path}[${key}]` : `${path}.${key}`, child, facts);
    };
    const inside = (path: string, root: string) => path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`);
    const replaceFacts = (root: string, facts: Map<string, string | number | boolean>): void => {
      const changed = new Set<string>();
      for (const [path, oldValue] of this.sourceFacts) if (inside(path, root) && (!facts.has(path) || facts.get(path) !== oldValue)) changed.add(path);
      for (const [path, newValue] of facts) if (this.sourceFacts.get(path) !== newValue) changed.add(path);
      const affected = new Set([...changed].map(path => this.recordForSource(path)?.sourcePath).filter((path): path is string => !!path));
      // A record changed or moved at this index: its previous identity and exclusions must be reviewed again.
      for (const recordPath of affected) {
        const record = this.records.get(recordPath)!;
        for (const id of record.elementIds ?? []) this.invalidateFields(id);
        for (const [path, mapping] of this.sourceFields) if (mapping.recordSourcePath === recordPath) {
          for (const id of mapping.elementIds ?? []) this.invalidateFields(id);
          this.sourceFields.delete(path);
        }
        delete record.elementIds; delete record.disposition; delete record.reason;
      }
      for (const path of [...this.sourceFacts.keys()]) if (inside(path, root)) this.sourceFacts.delete(path);
      for (const [path, fact] of facts) { this.sourceFacts.set(path, fact); if (String(fact).length > 1) this.redactionFacts.add(String(fact)); }
      for (const [path] of this.sourceFields) if (inside(path, root) && !facts.has(path)) this.sourceFields.delete(path);
    };
    if (value.sections && typeof value.sections === 'object') {
      this.inventoryRead = true;
      const full = isFullResume && (!Array.isArray(args.sections) || args.sections.length === 0);
      if (full) {
        this.inventoryComplete = true;
        for (const section of this.sourceCounts.keys()) if (!(section in value.sections)) {
          replaceFacts(`sections.${section}`, new Map());
          this.sourceCounts.delete(section);
          for (const [path, record] of this.records) if (record.section === section) this.records.delete(path);
        }
      }
      for (const [section, contents] of Object.entries(value.sections)) {
        const facts = new Map<string, string | number | boolean>();
        collect(`sections.${section}`, contents, facts);
        replaceFacts(`sections.${section}`, facts);
        const activePaths = new Set<string>();
        if (Array.isArray(contents)) {
          const active = contents.flatMap((entry, index) => hasContent(entry) ? [index] : []);
          if (active.length) this.sourceCounts.set(section, active.length); else this.sourceCounts.delete(section);
          for (const index of active) { const path = `sections.${section}[${index}]`; activePaths.add(path); add(section, path, `${section}第 ${index + 1} 条`); }
        } else {
          if (hasContent(contents)) this.sourceCounts.set(section, 1); else this.sourceCounts.delete(section);
          if (hasContent(contents)) { const path = `sections.${section}`; activePaths.add(path); add(section, path, section); }
        }
        for (const [path, record] of this.records) if (record.section === section && !activePaths.has(path)) this.records.delete(path);
      }
    }
    if (Array.isArray(value.fields)) for (const field of value.fields) {
      if (typeof field?.sourcePath !== 'string' || !field.sourcePath.startsWith('sections.') || field.action !== 'fill') continue;
      const facts = new Map<string, string | number | boolean>();
      collect(field.sourcePath, field.value, facts);
      replaceFacts(field.sourcePath, facts);
    }
    if (Array.isArray(value.recordInventory)) {
      this.inventoryRead = true;
      for (const group of value.recordInventory) {
        if (typeof group?.section !== 'string' || !Number.isInteger(group.count) || group.count < 0) continue;
        this.sourceCounts.set(group.section, group.count);
        for (const record of group.records ?? []) {
          if (typeof record?.sourcePath !== 'string' || !record.sourcePath.startsWith(`sections.${group.section}[`)) continue;
          // Identifiers can contain personal facts; the ledger exposes structural paths only.
          add(group.section, record.sourcePath, record.sourcePath);
        }
      }
    }
    for (const sourcePath of this.sourceFacts.keys()) {
      let record = this.recordForSource(sourcePath);
      if (!record) {
        const identity = /^(sections\.([^.[\]]+)(?:\[\d+\])?)(?:\.|\[|$)/.exec(sourcePath);
        if (identity) {
          const section = identity[2]!;
          add(section, identity[1]!, identity[1]!);
          record = this.records.get(identity[1]!);
          this.sourceCounts.set(section, Math.max(this.sourceCounts.get(section) ?? 0, [...this.records.values()].filter(item => item.section === section).length));
          this.inventoryRead = true;
        }
      }
      if (record && !this.sourceFields.has(sourcePath)) this.sourceFields.set(sourcePath, { sourcePath, recordSourcePath: record.sourcePath });
    }
  }

  private unavailableSection(record: SourceRecord): boolean {
    const sections = (this.pageCoverage as { sections?: Array<{ name?: string; collapsed?: boolean; recordCount?: number }> } | undefined)?.sections ?? [];
    return sections.some(section => section.name === record.section && (section.collapsed === true || section.recordCount === 0));
  }

  recordProgress(entries: ResumeRecordProgress[]): unknown {
    return this.redactFacts(entries.map(entry => {
      const record = this.records.get(entry.sourcePath);
      if (!record) return { sourcePath: entry.sourcePath, accepted: false, reason: '来源未读取，请读取包含此记录的 get_resume；继续处理其他记录' };
      if (!['attempted', 'not_applicable'].includes(entry.disposition)) return { sourcePath: entry.sourcePath, accepted: false, reason: '模型只能登记映射或不适用，核验状态由独立工具提供' };
      if (entry.disposition === 'not_applicable' && !entry.reason?.trim()) return { sourcePath: entry.sourcePath, accepted: false, reason: '不适用需要具体页面依据' };
      if (entry.disposition === 'not_applicable' && this.unavailableSection(record)) return { sourcePath: entry.sourcePath, accepted: false, reason: '栏目折叠或尚未挂载经历，需展开或添加记录后检查，不能据空控件判不适用' };
      const elementIds = [...new Set(entry.elementIds ?? (entry.fields ? record.elementIds ?? [] : []))];
      if (entry.disposition === 'attempted' && !elementIds.length && !entry.reason?.trim() && !entry.fields?.length) return { sourcePath: entry.sourcePath, accepted: false, reason: '请登记目标字段 IDs 或本条无法填写的具体原因' };
      const previousIds = record.elementIds ?? [];
      Object.assign(record, { elementIds, disposition: entry.disposition, reason: entry.reason });
      if (!entry.fields && entry.disposition === 'not_applicable') for (const field of this.sourceFields.values()) if (field.recordSourcePath === record.sourcePath) {
        Object.assign(field, { disposition: 'not_applicable', elementIds: [], reason: entry.reason });
      }
      const fieldResults = (entry.fields ?? []).map(mapping => {
        const field = this.sourceFields.get(mapping.sourcePath);
        if (!field || field.recordSourcePath !== record.sourcePath) return { sourcePath: mapping.sourcePath, accepted: false, reason: '来源叶子尚未读取或属于其他记录' };
        if (!['mapped', 'not_applicable', 'deferred'].includes(mapping.disposition)) return { sourcePath: mapping.sourcePath, accepted: false, reason: '模型不能声明来源已核验' };
        const ids = [...new Set(mapping.elementIds ?? [])];
        if (mapping.disposition !== 'mapped' && !mapping.reason?.trim()) return { sourcePath: mapping.sourcePath, accepted: false, reason: '不适用或延期需要具体依据' };
        if (mapping.disposition === 'not_applicable' && this.unavailableSection(record)) return { sourcePath: mapping.sourcePath, accepted: false, reason: '栏目折叠或记录未挂载，尚不能判定无对应字段' };
        if (mapping.disposition === 'mapped' && !ids.length) return { sourcePath: mapping.sourcePath, accepted: false, reason: '已映射来源需要目标字段 IDs' };
        if (ids.some(id => {
          const source = this.fields.get(id)?.sourcePath;
          return (!!source && this.recordForSource(source)?.sourcePath !== record.sourcePath) || [...this.sourceFields.values()].some(other =>
            other.recordSourcePath !== record.sourcePath && other.disposition === 'mapped' && other.elementIds?.includes(id));
        })) return { sourcePath: mapping.sourcePath, accepted: false, reason: '目标字段来源属于其他记录，不能冒用已有核验' };
        Object.assign(field, { disposition: mapping.disposition, elementIds: ids, reason: mapping.reason });
        record.elementIds = [...new Set([...(record.elementIds ?? []), ...ids])];
        return { sourcePath: mapping.sourcePath, accepted: true, status: this.sourceFieldStatus(field) };
      });
      // Legacy record-level IDs describe a mapped subset. Only an unambiguous single leaf can inherit them.
      const leaves = [...this.sourceFields.values()].filter(field => field.recordSourcePath === record.sourcePath);
      if (!entry.fields && entry.disposition === 'attempted' && leaves.length === 1 && !leaves[0]!.disposition) {
        Object.assign(leaves[0]!, { disposition: 'mapped', elementIds, reason: entry.reason });
      } else if (!entry.fields && entry.disposition === 'attempted' && leaves.length === 1 && previousIds.some(id => !elementIds.includes(id))) {
        Object.assign(leaves[0]!, { disposition: 'mapped', elementIds, reason: entry.reason });
      }
      return { sourcePath: entry.sourcePath, accepted: true, status: this.recordStatus(record),
        ...(this.recordReason(record) ? { reason: this.recordReason(record) } : {}), ...(entry.fields ? { fields: fieldResults } : {}) };
    }));
  }

  private sourceFieldStatus(source: SourceField): SourceFieldStatus {
    if (source.disposition === 'not_applicable' && source.reason?.trim()) return 'not_applicable';
    if (source.disposition !== 'mapped' || !source.elementIds?.length) return 'unmapped';
    const record = this.records.get(source.recordSourcePath);
    if (!record || this.hasConflictingMapping(record)) return 'mapped_pending';
    const evidence = source.elementIds.map(id => this.fields.get(id));
    if (evidence.some(field => field?.sourcePath && this.recordForSource(field.sourcePath)?.sourcePath !== source.recordSourcePath)) return 'mapped_pending';
    if (evidence.some(field => field?.status === 'failed')) return 'failed';
    const matches = (field: Field | undefined) => {
      if (!field || field.status !== 'verified') return false;
      const fact = this.sourceValue(source.sourcePath);
      if (fact === undefined) return false;
      if (field.sourcePath === source.sourcePath) return true;
      if (typeof fact === 'boolean') return field.intent === 'set-checked' && field.value === fact;
      if (field.sourcePath === undefined && String(field.value) === String(fact)) return true;
      return !!source.reason?.trim() && typeof fact === 'string' && typeof field.value === 'string' && field.value.includes(fact);
    };
    if (evidence.some(field => field?.status === 'verified' && !matches(field))) return 'failed';
    return evidence.every(matches) ? 'verified' : 'mapped_pending';
  }

  private recordSourceCoverage(record: SourceRecord) {
    const fields = [...this.sourceFields.values()].filter(field => field.recordSourcePath === record.sourcePath);
    const verified = fields.filter(field => this.sourceFieldStatus(field) === 'verified').length;
    const notApplicable = fields.filter(field => this.sourceFieldStatus(field) === 'not_applicable').length;
    return { total: fields.length, verified, notApplicable, unresolved: fields.length - verified - notApplicable,
      complete: fields.length > 0 && verified + notApplicable === fields.length };
  }

  private recordStatus(record: SourceRecord): string {
    if (!record.disposition) return 'unprocessed';
    if (record.disposition === 'not_applicable') return 'not_applicable';
    if (this.hasConflictingMapping(record)) return 'unverified';
    const fields = (record.elementIds ?? []).map((id) => this.fields.get(id));
    if (fields.some(field => field?.sourcePath && this.recordForSource(field.sourcePath)?.sourcePath !== record.sourcePath)) return 'unverified';
    if (fields.some((field) => field?.status === 'failed')) return 'failed';
    if (fields.length && fields.every((field) => field?.status === 'verified')) return 'mapped_fields_verified';
    return 'unverified';
  }

  private hasConflictingMapping(record: SourceRecord): boolean {
    const ids = (item: SourceRecord) => [...new Set([...(item.elementIds ?? []), ...[...this.sourceFields.values()]
      .filter(field => field.recordSourcePath === item.sourcePath && field.disposition === 'mapped').flatMap(field => field.elementIds ?? [])])];
    const targetIds = ids(record);
    return record.disposition === 'attempted' && [...this.records.values()].some((other) => other.sourcePath !== record.sourcePath
      && other.disposition === 'attempted' && ids(other).some(id => targetIds.includes(id)));
  }

  private recordReason(record: SourceRecord): string | undefined {
    if (record.elementIds?.some(id => {
      const path = this.fields.get(id)?.sourcePath;
      return !!path && this.recordForSource(path)?.sourcePath !== record.sourcePath;
    })) return '目标字段核验来自其他来源记录，记录身份映射待核对；继续处理其他记录';
    return this.hasConflictingMapping(record) ? '目标字段同时登记到了其他来源记录，记录身份映射待核对；继续处理其他记录' : record.reason;
  }

  private publicSourceFields() {
    return [...this.sourceFields.values()].map(field => ({ ...field, status: this.sourceFieldStatus(field) }));
  }

  private coverageSummary() {
    const sources = this.publicSourceFields();
    const count = (status: SourceFieldStatus) => sources.filter(field => field.status === status).length;
    const recordsWithoutFacts = Math.max(0, [...this.sourceCounts.values()].reduce((total, count) => total + count, 0) - [...this.records.values()].filter(record => this.recordSourceCoverage(record).total > 0).length);
    const valueFields = [...this.fields.values()];
    const unresolved = count('unmapped') + count('mapped_pending') + count('failed');
    return {
      sourceReading: { inventoryRead: this.inventoryRead, inventoryComplete: this.inventoryComplete, knownFields: sources.length, recordsWithoutFacts },
      recordFieldCoverage: { total: sources.length, mapped: sources.filter(field => field.disposition === 'mapped').length,
        verified: count('verified'), notApplicable: count('not_applicable'), unmapped: count('unmapped'), mappedPending: count('mapped_pending'), failed: count('failed'),
        deferred: sources.filter(field => field.disposition === 'deferred').length, unresolved,
        complete: this.inventoryComplete && recordsWithoutFacts === 0 && sources.length > 0 && unresolved === 0 },
      valueVerification: { total: valueFields.length, verified: valueFields.filter(field => field.status === 'verified').length,
        pending: valueFields.filter(field => field.status === 'pending').length, failed: valueFields.filter(field => field.status === 'failed').length },
    };
  }

  private redactFacts(value: unknown): unknown {
    if (typeof value === 'string') {
      for (const fact of this.redactionFacts) value = (value as string).split(fact).join('[source-value]');
      return value;
    }
    if (Array.isArray(value)) return value.map(item => this.redactFacts(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['value', 'actual', 'expected', 'identifiers'].includes(key))
      .map(([key, item]) => [key, ['sourcePath', 'recordSourcePath', 'elementId', 'elementIds'].includes(key) ? item : this.redactFacts(item)]));
    return value;
  }

  reviewContext(): string {
    const sources = this.publicSourceFields();
    const nextFields = sources.filter(field => field.disposition !== 'deferred' && !['verified', 'not_applicable'].includes(field.status)).map(field => ({ ...field,
      nextAction: field.status === 'failed' ? 'recover_once' : field.status === 'mapped_pending' ? 'read_back' : 'locate_and_fill' }));
    const priority = (field: typeof nextFields[number]) => {
      if (field.nextAction === 'read_back') return 2;
      if (field.nextAction === 'recover_once') return 3;
      const key = field.sourcePath.split('.').pop() ?? '';
      const fact = this.sourceValue(field.sourcePath);
      return /公司|学校|项目名称|职位|角色|正文|职责|工作内容|描述/.test(key) || (typeof fact === 'string' && fact.length >= 80) ? 0 : 1;
    };
    nextFields.sort((left, right) => priority(left) - priority(right));
    return JSON.stringify(this.redactFacts({
      inventoryRead: this.inventoryRead, inventoryComplete: this.inventoryComplete,
      sections: [...this.sourceCounts].map(([section, count]) => ({ section, count })),
      records: [...this.records.values()].map((record) => ({ ...record, status: this.recordStatus(record), reason: this.recordReason(record), sourceCoverage: this.recordSourceCoverage(record) })),
      sourceFields: sources,
      nextFields,
      deferredFields: sources.filter(field => field.disposition === 'deferred'),
      coverageSummary: this.coverageSummary(),
      fieldEvidence: [...this.fields].map(([elementId, field]) => ({ elementId, intent: field.intent, sourcePath: field.sourcePath, status: field.status, reason: field.reason })),
      attachment: this.preparation,
      attachmentRegions: [...this.attachmentRegions.values()],
      independentAttachmentCheck: this.independentAttachmentCheck,
      nowcoder: this.nowcoder,
      pageCoverage: this.pageCoverage ?? { ok: false, reason: '尚未取得页面覆盖清单' },
    }));
  }

  private coverageReport(): string[] {
    if (!this.inventoryRead) return ['- 来源清单尚未读取，无法核对遗漏；不能据字段失败数为 0 判断完整。'];
    const lines = [...this.sourceCounts].map(([section, count]) => {
      const records = [...this.records.values()].filter((record) => record.section === section);
      const countStatus = (status: string) => records.filter((record) => this.recordStatus(record) === status).length;
      const processed = records.filter((record) => record.disposition).length;
      return `- ${section}：来源 ${count} 条；已登记字段核验通过 ${countStatus('mapped_fields_verified')} 条，失败 ${countStatus('failed')} 条，待核验 ${countStatus('unverified')} 条，模型标记不适用 ${countStatus('not_applicable')} 条，未处理 ${Math.max(0, count - processed)} 条。`;
    });
    if (!this.inventoryComplete) lines.push('- 尚未读取全部简历栏目；以上来源清单可能不完整。');
    const coverage = this.coverageSummary();
    const source = coverage.recordFieldCoverage;
    lines.push(`- 来源字段覆盖：已读取 ${source.total} 个非空字段；逐项核验通过 ${source.verified} 个，模型标记不适用 ${source.notApplicable} 个，未映射 ${source.unmapped} 个，已映射待核验 ${source.mappedPending} 个，核验失败 ${source.failed} 个；其中延期 ${source.deferred} 个，仍计未完成。`);
    if (coverage.sourceReading.recordsWithoutFacts) lines.push(`- 另有 ${coverage.sourceReading.recordsWithoutFacts} 条来源记录尚未读取具体字段，不能据已登记字段推断完整。`);
    for (const field of this.publicSourceFields().filter(field => !['verified', 'not_applicable'].includes(field.status)).slice(0, 8)) lines.push(`  - ${field.sourcePath}：${field.disposition === 'deferred' ? '已延期，仍未覆盖' : field.status === 'unmapped' ? '待定位补填' : field.status === 'failed' ? '核验失败，待局部恢复' : '已映射，待独立回读'}。`);
    for (const record of [...this.records.values()].filter((item) => this.hasConflictingMapping(item)).slice(0, 8)) lines.push(`- ${record.sourcePath}：${this.recordReason(record)}。`);
    lines.push('经历状态仅覆盖已登记字段；“模型标记不适用”及登记范围由模型提供，不能证明整条经历完整。');
    return lines;
  }

  report(modelReview?: string): string {
    const fields = [...this.fields.values()];
    const count = (status: Field['status']) => fields.filter((field) => field.status === status).length;
    const unresolved = [...this.fields.entries()].filter(([, field]) => field.status !== 'verified');
    const details = unresolved.slice(0, 8).map(([id, field]) =>
      `  - ${this.labels.get(id) ?? id}：${field.status === 'pending' ? '待最终回读' : field.reason ?? '核验失败'}`);
    return this.redactFacts([
      '本轮简历填写核验结果：',
      ...(modelReview ? [`模型复查说明（模型判断）：${modelReview}`, ''] : []),
      `- 附件：${this.preparation}。`,
      ...[...this.attachmentRegions.values()].map(region => `- ${region.purpose === 'resume_attachment' ? '正式简历附件' : '简历解析/主上传'}（${region.label}）：${region.status}${region.reason ? `；${region.reason}` : ''}。`),
      ...(this.independentAttachmentCheck && ![...this.attachmentRegions.values()].some(region => region.purpose === 'resume_attachment') ? [`- 独立附件检查：${this.independentAttachmentCheck}。`] : []),
      `- 牛客：${this.nowcoder}。`,
      `- 最后一次修改后独立核验通过：${count('verified')} 个字段；核验失败：${count('failed')} 个；写入后尚未独立核验：${count('pending')} 个。`,
      ...details,
      ...(unresolved.length > 8 ? [`  - 另有 ${unresolved.length - 8} 个字段待核对，详见工具结果。`] : []),
      ...this.coverageReport(),
      '以上为独立工具证据，不代表整份简历已填完；未处理的经历、未知信息及特殊控件需继续核对。页面保存和投递状态未确认。',
    ].join('\n')) as string;
  }
}
