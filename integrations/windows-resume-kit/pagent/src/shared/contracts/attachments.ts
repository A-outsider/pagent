import { z } from 'zod';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const attachmentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const attachmentMetadataSchema = z.object({
  id: attachmentIdSchema,
  purpose: z.string().min(1).max(200),
  fileName: z.string().min(1).max(255).regex(/^[^/\\\x00-\x1f\x7f]+$/),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export const attachmentDescriptorSchema = attachmentMetadataSchema.extend({ url: z.string().url() });
export const uploadAttachmentSchema = z.object({
  serverName: z.string().min(1).max(200),
  attachmentId: attachmentIdSchema,
  elementId: z.string().min(1),
  revision: z.number().int().nonnegative().optional(),
}).strict();

export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;
export type AttachmentDescriptor = z.infer<typeof attachmentDescriptorSchema>;
export type UploadAttachmentRequest = z.infer<typeof uploadAttachmentSchema>;
/** Runtime policy only; not part of the model-facing upload schema. */
export type UploadAttachmentOptions =
  | { mimeType: 'application/pdf'; timeoutMs: number; avatarOnly?: never }
  | { avatarOnly: true; timeoutMs?: number; mimeType?: never };
export type AttachmentTarget = { documentId: string; revision: number };
/** Extension-internal message only; never pass to the model or session logger. */
export type AssignAttachmentRequest = AttachmentTarget & {
  elementId: string;
  attachment: AttachmentMetadata;
  base64: string;
  /** Internal deadline: a delayed content message must not assign a timed-out preparation. */
  expiresAt?: number;
  /** Resume correction phase: only a verified avatar may be assigned to an avatar control. */
  avatarOnly?: true;
};
export type UploadAttachmentResult = {
  elementId: string;
  attachment: AttachmentMetadata;
  filesAssigned: boolean;
  fileCount: number;
  multiple: boolean;
  websiteAcceptance: 'unverified';
};

export function assertAvatarAttachment(attachment: AttachmentMetadata, bytes: Uint8Array): void {
  if (!['image/jpeg', 'image/png'].includes(attachment.mimeType)
    || !/(?:头像|\bavatar\b)/i.test(attachment.purpose)
    || /简历|\bresume\b|\bcv\b|curriculum/i.test(attachment.purpose)) {
    throw new Error('简历补填阶段仅允许用途明确为头像的 JPEG/PNG；PDF 和简历图片只能在准备阶段处理');
  }
  const signature = attachment.mimeType === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
  if (!signature.every((byte, index) => bytes[index] === byte)) throw new Error('头像文件内容与声明的图片类型不符');
}
