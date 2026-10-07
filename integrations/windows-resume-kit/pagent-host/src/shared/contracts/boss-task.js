import { z } from 'zod';
const since = z.iso.datetime({ offset: true }).optional();
export const bossStartTaskSchema = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('audit'), since }).strict(),
    z.object({
        operation: z.literal('send'), since,
        scanId: z.string().min(1).max(200).optional(),
        recipientIds: z.array(z.string().min(1).max(200)).min(1).max(2_000)
            .refine((ids) => new Set(ids).size === ids.length, '收件人不能重复').optional(),
        maxRecipients: z.number().int().min(1).max(2_000).default(2_000),
        serverName: z.string().min(1).max(200).default('resume'),
        attachmentId: z.literal('resume-image').default('resume-image'),
        dryRun: z.boolean().default(true),
    }).strict().refine((value) => !value.scanId || !value.since, '引用扫描时不能更改时间范围')
        .refine((value) => !value.recipientIds || Boolean(value.scanId), '指定收件人时必须引用原扫描'),
]);
export const bossGetTaskSchema = z.object({
    taskId: z.string().min(1).max(200).optional(),
    includeRecipients: z.boolean().default(false),
}).strict();
export const bossCancelTaskSchema = z.object({ taskId: z.string().min(1).max(200) }).strict();
// Model/MCP tool schemas require an object at the root. Validate the operation branch at execution.
const sendFields = bossStartTaskSchema.options[1].shape;
export const bossStartTaskInputSchema = z.object({
    operation: z.enum(['audit', 'send']),
    since: sendFields.since,
    scanId: sendFields.scanId,
    recipientIds: sendFields.recipientIds,
    maxRecipients: sendFields.maxRecipients.removeDefault().optional(),
    serverName: sendFields.serverName.removeDefault().optional(),
    attachmentId: sendFields.attachmentId.removeDefault().optional(),
    dryRun: sendFields.dryRun.removeDefault().optional(),
}).strict();
