import { z } from 'zod';
import { attachmentIdSchema, attachmentMetadataSchema } from './attachments.js';
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
