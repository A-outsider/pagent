import { pageObserver } from '../observer';
import {
  attachmentMetadataSchema,
  assertAvatarAttachment,
  MAX_ATTACHMENT_BYTES,
  type AssignAttachmentRequest,
  type AttachmentMetadata,
  type AttachmentTarget,
  type UploadAttachmentResult,
} from '@/shared/contracts/attachments';

function fileInput(elementId: string, revision?: number): HTMLInputElement {
  const element = pageObserver.getElement(elementId, revision);
  if (!(element instanceof HTMLInputElement) || element.type !== 'file') {
    throw new Error('目标必须是已观测的文件上传 input');
  }
  if (element.disabled || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') {
    throw new Error('文件上传控件已禁用');
  }
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLFieldSetElement && parent.disabled) {
      const legend = Array.from(parent.children).find((child) => child.tagName === 'LEGEND');
      if (!legend?.contains(element)) throw new Error('文件上传控件所在字段组已禁用');
    }
  }
  if (element.webkitdirectory) throw new Error('不支持目录上传控件');
  return element;
}

function assertAvatarTarget(input: HTMLInputElement): void {
  const filters = input.accept.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
  // An empty/generic accept also accepts PDF, so cannot safely be treated as an avatar control.
  if (!filters.length || !filters.every(value => /^image\/(?:[a-z0-9.+-]+|\*)$/.test(value) || /^\.(?:jpe?g|png|gif|webp|bmp|avif|heic|heif)$/.test(value))) {
    throw new Error('简历补填阶段只允许限定图片类型的头像控件，目标可能接受 PDF 或其他简历文件');
  }
  const parts = [input.id, input.name, input.getAttribute('aria-label'), input.title,
    ...Array.from(input.labels ?? []).map(label => label.textContent),
    ...(input.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent)];
  let parent = input.parentElement;
  for (let depth = 0; parent && depth < 4 && !parent.matches('body,form'); depth++, parent = parent.parentElement) {
    if (parent.querySelectorAll('input[type="file"]').length > 1
      || parent.querySelector('input:not([type="file"]),textarea,select')
      || (parent.textContent?.length ?? 0) > 800) break;
    parts.push(parent.textContent);
  }
  const text = parts.filter(Boolean).join(' ');
  if (/简历|解析|\bresume\b|\bcv\b|curriculum|\bpars(?:e|ing|er)\b/i.test(text)) {
    throw new Error('简历补填阶段禁止向简历或解析控件上传附件，以免重新解析覆盖已填写内容');
  }
  if (!/头像|证件照|上传照片|个人照片|\bavatar\b|\bportrait\b|\bheadshot\b|\bprofile[ -](?:photo|picture)\b/i.test(text)) {
    throw new Error('无法确认目标是头像控件，补填阶段不执行附件上传');
  }
}

export function inspectAttachmentTarget(elementId: string, revision?: number, avatarOnly = false): AttachmentTarget {
  const input = fileInput(elementId, revision);
  if (avatarOnly) assertAvatarTarget(input);
  return { documentId: pageObserver.documentId, revision: pageObserver.revision };
}

function accepts(input: HTMLInputElement, attachment: AttachmentMetadata): boolean {
  const filters = input.accept.toLowerCase().split(',').map((item) => item.trim()).filter(Boolean);
  return !filters.length || filters.some((filter) => {
    if (filter.startsWith('.')) return attachment.fileName.toLowerCase().endsWith(filter);
    if (/^(image|application)\/\*$/.test(filter)) return attachment.mimeType.startsWith(filter.slice(0, -1));
    return attachment.mimeType === filter;
  });
}

export function assignAttachment(payload: AssignAttachmentRequest): UploadAttachmentResult {
  if (payload.expiresAt !== undefined && (!Number.isFinite(payload.expiresAt) || Date.now() >= payload.expiresAt)) {
    throw new Error('附件上传已超时，未给页面赋值');
  }
  if (payload.documentId !== pageObserver.documentId) throw new Error('页面已导航，请重新观测上传控件');
  const input = fileInput(payload.elementId, payload.revision);
  const parsed = attachmentMetadataSchema.safeParse(payload.attachment);
  if (!parsed.success) throw new Error('附件元数据无效');
  const attachment = parsed.data;
  if (payload.avatarOnly) assertAvatarTarget(input);
  if (!accepts(input, attachment)) throw new Error('附件类型或扩展名不符合上传控件 accept');
  // Exactly one file per call. Existing selections are replaced for both single and multiple inputs.
  if (typeof payload.base64 !== 'string' || payload.base64.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) {
    throw new Error('附件内容大小无效');
  }
  let binary: string;
  try { binary = atob(payload.base64); } catch { throw new Error('附件传输内容无效'); }
  if (binary.length !== attachment.size) throw new Error('附件传输大小不符');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (payload.avatarOnly) assertAvatarAttachment(attachment, bytes);
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], attachment.fileName, { type: attachment.mimeType }));
  if (!input.multiple && transfer.files.length > 1) throw new Error('上传控件不允许多个文件');
  input.files = transfer.files;
  const filesAssigned = input.files?.length === 1
    && input.files[0]?.name === attachment.fileName
    && input.files[0]?.size === attachment.size
    && input.files[0]?.type === attachment.mimeType;
  if (filesAssigned) {
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
  return {
    elementId: payload.elementId,
    attachment,
    filesAssigned,
    fileCount: input.files?.length ?? 0,
    multiple: input.multiple,
    websiteAcceptance: 'unverified',
  };
}
