import { pageObserver, SKIP } from '../observer';
import { inspectAttachmentTarget } from './attachments';
import type { AttachmentMetadata } from '@/shared/contracts/attachments';
import type { ResumePreparationResult, ResumeUploadTarget } from '@/shared/contracts/resume-form';
import { describeResumeUpload as describeUpload, describeResumeUploadScope, uploadReceiptNames, uploadReceiptName, resumeUploadScope as uploadScope, RESUME_UPLOAD_LABEL, uploadRendered as rendered, uploadTextLines as textLines } from './resume-upload-regions';

const TIMEOUT_MS = 30_000;
const QUIET_MS = 2_000;
const MIN_OBSERVATION_MS = 3_000;
const PDF_FILE_NAME = /^[^\s<>/\\*?][^<>/\\*?]*\.pdf$/i;
const PARSING_BUSY = /(?:正在|开始|简历)?解析中|正在解析|parsing(?:\s+resume)?[.…]*$/i;
const UPLOAD_BUSY = /正在上传|上传中|uploading|处理中|processing/i;
const FAILURE = /上传失败|解析失败|文件格式(?:不支持|错误)|upload failed|parsing failed/i;
const PARSING_DONE = /^(?:简历)?解析(?:成功|完成)[！!。.]?$|^resume pars(?:ed|ing completed)(?: successfully)?[.!]?$/i;
type UploadAnchor = { resumeLabel?: string; inputId?: string; inputName?: string; purpose?: ResumeUploadTarget['purpose'] };

type Watch = {
  documentId: string;
  url: string;
  scope: Element;
  anchor: UploadAnchor;
  target: ResumeUploadTarget;
  createdAt: number;
  before: string;
  autoParseExpected: boolean;
  input: HTMLInputElement;
  serverName: string;
  attachmentId: string;
  previousParsingComplete?: boolean;
  previousRepopulationObserved?: boolean;
};
const watches = new Map<string, Watch>();
type Receipt = Watch & { attachment: AttachmentMetadata; parsingComplete: boolean; repopulationObserved: boolean; completed: boolean; valid: boolean };
const receipts = new Map<HTMLInputElement, Receipt>();
type ExistingWatch = Pick<Watch, 'documentId' | 'url' | 'scope' | 'anchor' | 'target' | 'createdAt'> & {
  fileName: string;
  input?: HTMLInputElement;
};
const existingWatches = new Map<string, ExistingWatch>();

function pdfInput(input: HTMLInputElement): boolean {
  const accepts = input.accept.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
  return !accepts.length || accepts.some(value => ['.pdf', 'application/pdf', 'application/*', '*/*'].includes(value));
}

function uploadAnchor(scope: Element, input?: HTMLInputElement): UploadAnchor {
  return {
    resumeLabel: input ? describeUpload(input).resumeLabel : textLines(scope).find(line => RESUME_UPLOAD_LABEL.test(line)),
    inputId: input?.id || undefined, inputName: input?.name || undefined,
    purpose: describeResumeUploadScope(scope, input).upload.purpose,
  };
}

/** Rebind observations after framework rendering, never assign another file. */
function relocatedUpload(watch: Pick<Watch, 'scope' | 'anchor'>, fileName: string): { scope: Element; input?: HTMLInputElement } | undefined {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter(input => !input.closest(SKIP) && pdfInput(input) && rendered(input.parentElement ?? input))
    .map(describeUpload);
  const scored = inputs.map(candidate => {
    const { anchor } = watch;
    const sameInput = (anchor.inputId && candidate.input.id === anchor.inputId)
      || (anchor.inputName && candidate.input.name === anchor.inputName);
    const sameScope = watch.scope.isConnected && watch.scope.contains(candidate.input);
    // A resume parser must remain a resume parser, not a generic attachment
    // input that happens to contain the same filename.
    const semantic = (!anchor.purpose || candidate.upload.purpose === anchor.purpose)
      && (anchor.resumeLabel ? Boolean(candidate.resumeLabel) : Boolean(sameInput));
    const score = sameScope ? 8 : semantic ? 1 + (sameInput ? 4 : 0)
      + (candidate.resumeLabel === anchor.resumeLabel ? 2 : 0) : 0;
    return { ...candidate, score, scope: sameScope ? watch.scope : candidate.scope };
  }).filter(candidate => candidate.score > 0);
  const bestScore = Math.max(0, ...scored.map(candidate => candidate.score));
  const best = scored.filter(candidate => candidate.score === bestScore);
  if (best.length === 1) return { scope: best[0]!.scope, input: best[0]!.input };
  if (best.length > 1) return undefined;
  // Some sites remove the file input entirely and leave a filename button.
  // Require the expected receipt inside a local, semantically matching region.
  const scopes = watch.scope.isConnected ? [watch.scope] : receiptScopesWithoutInput();
  const matching = scopes.filter(scope => visiblePdfNames(scope).includes(fileName)
    && (!watch.anchor.purpose || describeResumeUploadScope(scope).upload.purpose === watch.anchor.purpose)
    && (scope === watch.scope || (watch.anchor.resumeLabel && textLines(scope).some(line => RESUME_UPLOAD_LABEL.test(line)))));
  return matching.length === 1 ? { scope: matching[0]! } : undefined;
}

function formSignature(): string {
  return JSON.stringify(Array.from(document.querySelectorAll('input:not([type="file"]),textarea,select,[contenteditable="true"]'))
    .filter(element => !element.closest(SKIP))
    .map(element => [
      element.tagName, element.getAttribute('name'), element.getAttribute('type'),
      'value' in element ? (element as HTMLInputElement).value : element.textContent,
      'checked' in element ? (element as HTMLInputElement).checked : undefined,
    ]));
}

function formRepopulated(before: string, after: string): boolean {
  const oldRows = JSON.parse(before) as unknown[][];
  return (JSON.parse(after) as unknown[][]).some((row, index) =>
    typeof row[3] === 'string' && row[3].trim().length > 0 && row[3] !== oldRows[index]?.[3]);
}

function result(reason: string, status: ResumePreparationResult['attachment']['status'] = 'not_uploaded'): ResumePreparationResult {
  return { ready: false, reason, attachment: { status } };
}

function visiblePdfNames(scope: Element): string[] {
  // A standalone filename can be a receipt. Inline format instructions and
  // extension wildcards cannot; otherwise "支持*.pdf" suppresses the first upload.
  return uploadReceiptNames(scope).filter(name => PDF_FILE_NAME.test(name));
}

function targetInfo(input: HTMLInputElement): ResumeUploadTarget {
  const description = describeUpload(input);
  return { ...description.upload, elementId: pageObserver.register(input), label: description.label };
}

function beginExistingReceipt(scope: Element, fileName: string, input?: HTMLInputElement): ResumePreparationResult {
  const selected = input?.files?.[0];
  if (selected && selected.name !== fileName) return result('selected_file_receipt_mismatch', 'existing_unverified');
  const description = describeResumeUploadScope(scope, input);
  const target: ResumeUploadTarget = input ? targetInfo(input) : { ...description.upload, label: description.label };
  const watchId = crypto.randomUUID();
  existingWatches.set(watchId, {
    documentId: pageObserver.documentId, url: location.href, scope, anchor: uploadAnchor(scope, input), target, fileName, input, createdAt: Date.now(),
  });
  while (existingWatches.size > 4) existingWatches.delete(existingWatches.keys().next().value!);
  return {
    ready: false, reason: 'recheck_existing_receipt', watchId, target,
    attachment: { status: 'receipt_existing', fileName, identity: 'unverified' },
  };
}

/** Some sites replace the upload input with a server-backed filename button. */
function receiptScopesWithoutInput(): Element[] {
  const scopes = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const name = uploadReceiptName(node.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    if (!name || !PDF_FILE_NAME.test(name) || !node.parentElement || !rendered(node.parentElement)) continue;
    for (let scope: Element | null = node.parentElement; scope && scope !== document.body; scope = scope.parentElement) {
      if (scope.querySelectorAll('input:not([type="file"]),textarea,select').length > 2) break;
      // Filenames such as “已上传简历.pdf” are evidence inside a region, not
      // the region's label; continue upward to its actual upload heading.
      if (/上传简历|简历附件|附件简历|上传附件|upload\s*(?:your\s*)?resume|resume\s*attachment/i.test(textLines(scope).filter(line => !PDF_FILE_NAME.test(line)).join(' '))) {
        const region = scope.closest('.form-item,.ud-formily-item,[class^="apply-field-"],[class*=" apply-field-"],section');
        scopes.add(region && region.querySelectorAll('input[type="file"]').length <= 1
          && region.querySelectorAll('input:not([type="file"]),textarea,select').length <= 2 ? region : scope);
        break;
      }
    }
  }
  return [...scopes];
}

export function beginResumePreparation(elementId?: string, revision?: number, serverName = 'resume', attachmentId = 'resume-pdf', mode: 'upload_if_missing' | 'existing_only' = 'upload_if_missing', attachmentsOnly = false): ResumePreparationResult {
  for (const [id, watch] of watches) if (Date.now() - watch.createdAt > 120_000) watches.delete(id);
  for (const [id, watch] of existingWatches) if (Date.now() - watch.createdAt > 120_000) existingWatches.delete(id);
  for (const [input, receipt] of receipts) {
    if (!receipt.valid || receipt.documentId !== pageObserver.documentId || receipt.url !== location.href) {
      receipts.delete(input);
      continue;
    }
    if (!input.isConnected || !receipt.scope.isConnected) {
      const relocated = relocatedUpload(receipt, receipt.attachment.fileName);
      if (relocated) receipt.scope = relocated.scope;
      if (relocated?.input && relocated.input !== input) {
        receipts.delete(input);
        receipt.input = relocated.input;
        receipts.set(relocated.input, receipt);
        const invalidate = () => { receipt.valid = false; };
        relocated.input.addEventListener('input', invalidate, { once: true });
        relocated.input.addEventListener('change', invalidate, { once: true });
      }
      // A timeout followed by a delayed region replacement must retain our
      // assignment identity, even while the new filename has not appeared yet.
    }
  }
  let candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter(input => !input.closest(SKIP) && pdfInput(input) && rendered(input.parentElement ?? input));
  // The parser and the eventual application attachment are separate obligations.
  if (!elementId) {
    candidates = candidates.filter(input => !['avatar', 'other'].includes(describeUpload(input).upload.purpose));
    if (attachmentsOnly) candidates = candidates.filter(input => describeUpload(input).upload.purpose === 'resume_attachment');
    else {
      const parsers = candidates.filter(input => describeUpload(input).upload.purpose === 'resume_parse');
      if (parsers.length) candidates = parsers;
      else if (candidates.length > 1) {
        const resumes = candidates.filter(input => describeUpload(input).resumeLabel);
        if (resumes.length) candidates = resumes;
      }
    }
  }
  if (!elementId && candidates.length !== 1) {
    const scopes = candidates.length ? [...new Set(candidates.map(uploadScope))] : receiptScopesWithoutInput()
      .filter(scope => {
        const purpose = describeResumeUploadScope(scope).upload.purpose;
        return attachmentsOnly ? purpose === 'resume_attachment' : !['avatar', 'other'].includes(purpose);
      });
    const existing = scopes.flatMap(scope => visiblePdfNames(scope).map(fileName => ({ scope, fileName })));
    if (existing.length === 1) return beginExistingReceipt(existing[0]!.scope, existing[0]!.fileName);
    if (existing.length > 1) return result('ambiguous_existing_pdf_receipt', 'existing_unverified');
    if (!candidates.length) return result(attachmentsOnly ? 'no_independent_resume_attachment' : mode === 'existing_only' ? 'existing_pdf_receipt_missing' : 'no_upload_control');
    return {
      ...result('ambiguous_upload_control'),
      revision: pageObserver.revision,
      candidates: candidates.map(input => {
        const { label, context, upload } = describeUpload(input);
        return { elementId: pageObserver.register(input), accept: input.accept, label, context, upload };
      }),
    };
  }
  const input = elementId ? pageObserver.getElement(elementId, revision) : candidates[0]!;
  if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !pdfInput(input)) return result('not_pdf_upload_control');
  const target = targetInfo(input);
  const outcome = (reason: string, status?: ResumePreparationResult['attachment']['status']) => ({ ...result(reason, status), target });
  if (attachmentsOnly && target.purpose !== 'resume_attachment') return outcome('not_independent_resume_attachment');
  if (['avatar', 'other'].includes(target.purpose)) return outcome('not_resume_upload_control');
  const id = pageObserver.register(input);
  const scope = uploadScope(input);
  const visibleNames = visiblePdfNames(scope);
  const known = receipts.get(input);
  const selected = input.files?.[0];
  const reusable = known && known.scope === scope && known.serverName === serverName && known.attachmentId === attachmentId
    && (visibleNames.includes(known.attachment.fileName) || (!known.completed && !visibleNames.length))
    && (!selected || (selected.name === known.attachment.fileName && selected.size === known.attachment.size && selected.type === known.attachment.mimeType));
  // A server receipt is sufficient to supplement an existing form, but says nothing
  // about equality with the MCP bytes. Do not require a historical upload cache.
  if (visibleNames.length > 1) return outcome('ambiguous_existing_pdf_receipt', 'existing_unverified');
  if (visibleNames.length === 1 && (!reusable || mode === 'existing_only')) return beginExistingReceipt(scope, visibleNames[0]!, input);
  if (mode === 'existing_only') return outcome('existing_pdf_receipt_missing');
  if (!reusable && input.files?.length) return outcome('existing_attachment_unverified', 'existing_unverified');
  inspectAttachmentTarget(id, revision);
  const pageLines = textLines(document.body);
  if (pageLines.some(line => PARSING_BUSY.test(line) || UPLOAD_BUSY.test(line))) return outcome('upload_or_parsing_already_in_progress');
  const watchId = crypto.randomUUID();
  watches.set(watchId, {
    documentId: pageObserver.documentId, url: location.href, scope, anchor: uploadAnchor(scope, input), target, createdAt: Date.now(), before: reusable && !known.completed ? known.before : formSignature(),
    autoParseExpected: Boolean(reusable && known.autoParseExpected) || target.autoParse,
    input, serverName, attachmentId, previousParsingComplete: reusable ? known.parsingComplete : false,
    previousRepopulationObserved: reusable ? known.repopulationObserved : false,
  });
  while (watches.size > 4) watches.delete(watches.keys().next().value!);
  return {
    ...result(reusable ? 'recheck_existing_upload' : 'upload_required'),
    ...(reusable ? { attachment: { status: known.completed ? 'page_receipt_observed' as const : 'assigned_unverified' as const, metadata: known.attachment } } : {}),
    target, watchId, elementId: id, revision: pageObserver.revision,
  };
}

/** No form writes here. Receipt, parser state and a bounded quiet interval are independent checks. */
export async function waitForResumePreparation(watchId: string, attachment?: AttachmentMetadata): Promise<ResumePreparationResult> {
  const watch = existingWatches.get(watchId) ?? watches.get(watchId);
  const before = formSignature();
  const observed = await observeResumePreparation(watchId, attachment);
  if (!watch) return observed;
  const target = watch.input?.isConnected ? targetInfo(watch.input)
    : { ...watch.target, receiptNames: visiblePdfNames(watch.scope) };
  return { ...observed, target, formChanged: watch.documentId === pageObserver.documentId && watch.url === location.href && before !== formSignature() };
}

async function observeResumePreparation(watchId: string, attachment?: AttachmentMetadata): Promise<ResumePreparationResult> {
  const existing = existingWatches.get(watchId);
  if (existing) return waitForExistingReceipt(watchId, existing);
  const watch = watches.get(watchId);
  if (!watch || attachment?.mimeType !== 'application/pdf') return result('invalid_upload_watch', 'failed');
  // Keep the identity of our own assignment even when the site takes longer than this wait.
  // A retry can observe the same pending upload; it must never assign a second PDF over it.
  const pendingReceipt: Receipt = {
    ...watch, attachment, parsingComplete: Boolean(watch.previousParsingComplete),
    repopulationObserved: Boolean(watch.previousRepopulationObserved), completed: false, valid: true,
  };
  receipts.set(watch.input, pendingReceipt);
  const invalidateReceipt = () => { pendingReceipt.valid = false; };
  watch.input.addEventListener('input', invalidateReceipt, { once: true });
  watch.input.addEventListener('change', invalidateReceipt, { once: true });
  const startedAt = Date.now();
  let stableSince = startedAt;
  let lastSignature = '';
  let sawParsingBusy = false;
  let receipt = false;
  let parsingComplete = false;
  let repopulationObserved = false;
  let attachmentChanged = false;
  let regionUnavailable = false;
  const changed = () => { attachmentChanged = true; };
  watch.input.addEventListener('input', changed);
  watch.input.addEventListener('change', changed);
  try {
    while (Date.now() - startedAt <= TIMEOUT_MS) {
      if (watch.documentId !== pageObserver.documentId || watch.url !== location.href) {
        return { ...result('page_or_upload_region_changed', 'assigned_unverified'), attachment: { status: 'assigned_unverified', metadata: attachment } };
      }
      if (attachmentChanged) return result('attachment_changed_during_observation', 'existing_unverified');
      if (!watch.scope.isConnected || !watch.input.isConnected) {
        const relocated = relocatedUpload(watch, attachment.fileName);
        regionUnavailable = !relocated;
        if (!relocated) {
          receipt = false; stableSince = Date.now();
          await new Promise(resolve => setTimeout(resolve, 250));
          continue;
        }
        if (watch.scope !== relocated.scope || (relocated.input && relocated.input !== watch.input)) lastSignature = '';
        watch.scope = relocated.scope;
        if (relocated.input && relocated.input !== watch.input) {
          watch.input.removeEventListener('input', changed); watch.input.removeEventListener('change', changed);
          watch.input.removeEventListener('input', invalidateReceipt); watch.input.removeEventListener('change', invalidateReceipt);
          receipts.delete(watch.input);
          watch.input = relocated.input;
          watch.input.addEventListener('input', changed); watch.input.addEventListener('change', changed);
          watch.input.addEventListener('input', invalidateReceipt, { once: true }); watch.input.addEventListener('change', invalidateReceipt, { once: true });
          receipts.set(watch.input, pendingReceipt);
        }
        Object.assign(pendingReceipt, { scope: watch.scope, input: watch.input });
        const selected = watch.input.files?.[0];
        if (selected && (selected.name !== attachment.fileName || selected.size !== attachment.size || selected.type !== attachment.mimeType)) {
          pendingReceipt.valid = false;
          return result('attachment_changed_during_observation', 'existing_unverified');
        }
      }
      const scopedLines = textLines(watch.scope);
      const allLines = textLines(document.body);
      const parsingBusy = allLines.some(line => PARSING_BUSY.test(line));
      const busy = parsingBusy || allLines.some(line => UPLOAD_BUSY.test(line))
        || Array.from(document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')).some(rendered);
      sawParsingBusy ||= parsingBusy;
      pendingReceipt.autoParseExpected ||= parsingBusy;
      if (scopedLines.some(line => FAILURE.test(line)) || allLines.some(line => /^(?:简历)?解析失败/.test(line))) {
        pendingReceipt.valid = false;
        return { ...result('upload_or_parsing_failed', 'failed'), attachment: { status: 'failed', metadata: attachment } };
      }
      receipt = visiblePdfNames(watch.scope).includes(attachment.fileName);
      const signature = formSignature();
      parsingComplete = (!sawParsingBusy && watch.previousParsingComplete === true) || allLines.some(line => PARSING_DONE.test(line))
        || (sawParsingBusy && !busy && signature !== watch.before);
      repopulationObserved = (!sawParsingBusy && watch.previousRepopulationObserved === true)
        || formRepopulated(watch.before, signature);
      const combined = JSON.stringify([signature, receipt, busy, parsingComplete, repopulationObserved]);
      if (combined !== lastSignature || busy) { stableSince = Date.now(); lastSignature = combined; }
      const formStable = !busy && Date.now() - stableSince >= QUIET_MS;
      const parsingRequired = watch.autoParseExpected || sawParsingBusy;
      if (receipt && formStable && (!parsingRequired || parsingComplete || repopulationObserved) && Date.now() - startedAt >= MIN_OBSERVATION_MS) {
        Object.assign(pendingReceipt, { parsingComplete, repopulationObserved, completed: true });
        return {
          ready: true, reason: 'pdf_receipt_and_form_stability_observed',
          attachment: { status: 'page_receipt_observed', metadata: attachment },
          parsing: parsingRequired ? (parsingComplete ? 'observed_complete' : 'form_repopulation_observed') : 'not_indicated',
          formStable: true, elapsedMs: Date.now() - startedAt,
        };
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return {
      ...result(regionUnavailable ? 'upload_region_unconfirmed_after_rerender' : receipt ? 'parsing_or_stability_unconfirmed' : 'website_receipt_unconfirmed', receipt ? 'page_receipt_observed' : 'assigned_unverified'),
      attachment: { status: receipt ? 'page_receipt_observed' : 'assigned_unverified', metadata: attachment },
      parsing: watch.autoParseExpected || sawParsingBusy ? (parsingComplete ? 'observed_complete' : 'pending') : 'not_indicated',
      formStable: false, elapsedMs: Date.now() - startedAt,
    };
  } finally {
    watches.delete(watchId);
    watch.input.removeEventListener('input', changed);
    watch.input.removeEventListener('change', changed);
  }
}

/** Read-only reuse: verify the current receipt and quiet form, not a past parser event. */
async function waitForExistingReceipt(watchId: string, watch: ExistingWatch): Promise<ResumePreparationResult> {
  const attachment: ResumePreparationResult['attachment'] = {
    status: 'receipt_existing', fileName: watch.fileName, identity: 'unverified',
  };
  const startedAt = Date.now();
  let stableSince = startedAt;
  let lastSignature = '';
  let attachmentChanged = false;
  const changed = () => { attachmentChanged = true; };
  watch.input?.addEventListener('input', changed);
  watch.input?.addEventListener('change', changed);
  const blocked = (reason: string): ResumePreparationResult => ({
    ready: false, reason, attachment, formStable: false, elapsedMs: Date.now() - startedAt,
  });
  try {
    while (Date.now() - startedAt <= TIMEOUT_MS) {
      if (watch.documentId !== pageObserver.documentId || watch.url !== location.href) {
        return blocked('page_or_upload_region_changed');
      }
      if (attachmentChanged) return blocked('attachment_changed_during_observation');
      if (!watch.scope.isConnected || (watch.input && !watch.input.isConnected)) {
        const relocated = relocatedUpload(watch, watch.fileName);
        if (!relocated) {
          stableSince = Date.now();
          await new Promise(resolve => setTimeout(resolve, 250));
          continue;
        }
        if (watch.scope !== relocated.scope || relocated.input !== watch.input) lastSignature = '';
        watch.scope = relocated.scope;
        if (relocated.input !== watch.input) {
          watch.input?.removeEventListener('input', changed); watch.input?.removeEventListener('change', changed);
          watch.input = relocated.input;
          watch.input?.addEventListener('input', changed); watch.input?.addEventListener('change', changed);
        }
        if (watch.input?.files?.[0] && watch.input.files[0].name !== watch.fileName) return blocked('attachment_changed_during_observation');
      }
      const scopedLines = textLines(watch.scope);
      const allLines = textLines(document.body);
      if (scopedLines.some(line => FAILURE.test(line)) || allLines.some(line => /^(?:简历)?解析失败/.test(line))) {
        return { ...blocked('upload_or_parsing_failed'), attachment: { ...attachment, status: 'failed' } };
      }
      const busy = allLines.some(line => PARSING_BUSY.test(line) || UPLOAD_BUSY.test(line))
        || Array.from(document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')).some(rendered);
      const names = visiblePdfNames(watch.scope);
      if (names.some(name => name !== watch.fileName)) return blocked('attachment_changed_during_observation');
      const receipt = names.includes(watch.fileName);
      const combined = JSON.stringify([formSignature(), receipt, busy]);
      if (combined !== lastSignature || busy) { stableSince = Date.now(); lastSignature = combined; }
      if (receipt && !busy && Date.now() - stableSince >= QUIET_MS) return {
        ready: true, reason: 'existing_pdf_receipt_and_form_stability_observed', attachment,
        parsing: 'existing_form_stable', formStable: true, elapsedMs: Date.now() - startedAt,
      };
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { ...blocked('existing_pdf_not_ready'), parsing: 'pending' };
  } finally {
    existingWatches.delete(watchId);
    watch.input?.removeEventListener('input', changed);
    watch.input?.removeEventListener('change', changed);
  }
}
