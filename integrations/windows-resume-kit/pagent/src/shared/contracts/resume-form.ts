import { z } from 'zod';
import { attachmentIdSchema, attachmentMetadataSchema, type AttachmentMetadata } from './attachments';

export const prepareResumeFormSchema = z.object({
  elementId: z.string().min(1).optional(),
  revision: z.number().int().nonnegative().optional(),
  serverName: z.string().min(1).max(200).default('resume'),
  attachmentId: attachmentIdSchema.default('resume-pdf'),
  mode: z.enum(['upload_if_missing', 'existing_only']).default('upload_if_missing'),
  attachments_only: z.boolean().default(false),
}).strict();

export const resumeUploadWatchSchema = z.object({
  watchId: z.string().min(1),
  attachment: attachmentMetadataSchema.optional(),
}).strict();

export type ResumeUploadInfo = {
  purpose: 'resume_parse' | 'resume_attachment' | 'avatar' | 'other' | 'unknown';
  autoParse: boolean;
  receiptNames: string[];
  /** Local selection is not a website receipt. */
  assignedFileNames: string[];
  inProgress?: boolean;
};

export type ResumeUploadTarget = ResumeUploadInfo & { elementId?: string; label: string };

export type ResumePreparationResult = {
  ready: boolean;
  reason: string;
  target?: ResumeUploadTarget;
  /** Mutation evidence for this invocation, never inferred from a historical receipt. */
  filesAssigned?: boolean;
  formChanged?: boolean;
  attachment: {
    status: 'not_uploaded' | 'existing_unverified' | 'assigned_unverified' | 'page_receipt_observed' | 'receipt_existing' | 'failed';
    metadata?: AttachmentMetadata;
    fileName?: string;
    identity?: 'unverified';
  };
  parsing?: 'not_observed' | 'pending' | 'observed_complete' | 'form_repopulation_observed' | 'not_indicated' | 'existing_form_stable';
  formStable?: boolean;
  watchId?: string;
  elementId?: string;
  revision?: number;
  candidates?: { elementId: string; accept: string; label?: string; context?: string; upload?: ResumeUploadInfo }[];
  elapsedMs?: number;
};
