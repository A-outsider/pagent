import { SKIP } from '../observer';
import { formFieldContainer, formFieldLabel } from '../form-semantics';
import type { ResumeUploadInfo } from '@/shared/contracts/resume-form';

export const RESUME_UPLOAD_LABEL = /^(?:(?:上传|选择|添加|更新|附加|附件|个人|我的|upload|attach|select|your)\s*)*(?:简历|resume|résumé|cv)(?:\s*(?:附件|文件|上传|attachment|file))?\s*[*:：]?$/i;
const FILE_NAME = /^[^\s<>/\\*?][^<>/\\*?]*\.(?:pdf|docx?|png|jpe?g|webp)$/i;
const FORMAT_HINT = /支持|格式|文件类型|\*\.|accept|support|extensions?/i;
const PARSER = /解析|pars(?:e|ed|ing)|auto[ -]?fill/i;
const AVATAR = /头像|证件照|上传照片|个人照片|avatar|portrait/i;
const ATTACHMENT = /简历附件|附件简历|resume\s*attachment|attach(?:ed)?\s*(?:your\s*)?(?:resume|cv)/i;
const UPLOAD_PENDING = /上传中|正在上传|处理中|\buploading\b|\bprocessing\b/i;

export function uploadRendered(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.matches(SKIP) || current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}

export function uploadTextLines(root: Element): string[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const lines: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim();
    if (text && node.parentElement && uploadRendered(node.parentElement)) lines.push(text);
  }
  return lines;
}

/** Stay inside one upload field. A neighbouring parser's hint never labels an attachment. */
export function resumeUploadScope(input: HTMLInputElement): Element {
  const field = formFieldContainer(input);
  if (field && field.querySelectorAll('input[type="file"]').length === 1) return field;
  let scope: Element = input.parentElement ?? input;
  for (let parent = input.parentElement; parent && parent !== input.ownerDocument.body; parent = parent.parentElement) {
    if (parent.querySelectorAll('input:not([type="file"]),textarea,select').length > 2
      || parent.querySelectorAll('input[type="file"]').length > 1 || (parent.textContent?.length ?? 0) > 3_000) break;
    scope = parent;
    if (parent.matches('section,[class*="apply-field-"],[class*="form-item"],[role="group"]')) break;
  }
  return scope;
}

export function uploadReceiptName(line: string): string | undefined {
  if (FORMAT_HINT.test(line)) return undefined;
  // Some frameworks render filename and status in one text node. Keep the
  // filename boundary, rather than accepting arbitrary substring mentions.
  const value = line.replace(/\s*(?:上传成功|上传完成|已上传|删除|下载|预览|uploaded(?:\s*successfully)?|upload\s*(?:successfully|complete)|remove|download|preview)\s*$/i, '').trim();
  return FILE_NAME.test(value) ? value : undefined;
}

export function uploadReceiptNames(scope: Element): string[] {
  const lines = uploadTextLines(scope);
  if (lines.some(line => UPLOAD_PENDING.test(line))) return [];
  return [...new Set(lines.flatMap(line => {
    const name = uploadReceiptName(line); return name ? [name] : [];
  }))];
}

export function describeResumeUploadScope(scope: Element, input?: HTMLInputElement) {
  const lines = uploadTextLines(scope);
  const labels = [input?.getAttribute('aria-label'), input ? formFieldLabel(input) : '',
    ...Array.from(input?.labels ?? []).filter(uploadRendered).map(label => label.textContent), ...lines]
    .map(value => value?.trim().replace(/^\*\s*/, '') ?? '').filter(Boolean);
  const resumeLabel = labels.find(label => RESUME_UPLOAD_LABEL.test(label));
  const context = lines.join(' ');
  const semantic = labels.filter(label => !FILE_NAME.test(label) && !FORMAT_HINT.test(label)).join(' ');
  const autoParse = PARSER.test(context);
  const purpose: ResumeUploadInfo['purpose'] = AVATAR.test(semantic) ? 'avatar'
    : autoParse && /简历|resume|\bcv\b/i.test(semantic + context) ? 'resume_parse'
      : ATTACHMENT.test(semantic) && !autoParse ? 'resume_attachment'
        : resumeLabel ? (autoParse ? 'resume_parse' : 'unknown')
          : /附件|attachment|作品|成绩单|证书/i.test(semantic) ? 'other' : 'unknown';
  const upload: ResumeUploadInfo = { purpose, autoParse, receiptNames: uploadReceiptNames(scope), inProgress: UPLOAD_PENDING.test(context),
    assignedFileNames: Array.from(input?.files ?? []).map(file => file.name) };
  return { scope, resumeLabel, label: (resumeLabel ?? labels[0] ?? input?.name ?? '').slice(0, 120),
    context: context.slice(0, 500), upload };
}

export function describeResumeUpload(input: HTMLInputElement) {
  return { ...describeResumeUploadScope(resumeUploadScope(input), input), input };
}
