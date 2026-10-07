import { z } from 'zod';
export const bossAuditResumeImagesSchema = z.object({
    cursor: z.string().min(1).max(2_000).optional(),
    since: z.iso.datetime({ offset: true }).optional().describe('只检查此时间点起本人发过消息的联系人，例如 2026-09-20T10:00:00+08:00。不传则不限制时间。续页沿用首次条件。时间只筛选联系人，图片仍检查全部历史。'),
    limit: z.number().int().min(1).max(15).default(15),
}).strict();
export const bossSendResumeImagesSchema = z.object({
    scanId: z.string().min(1).max(200),
    recipientIds: z.array(z.string().min(1).max(200)).min(1).max(10)
        .refine((ids) => new Set(ids).size === ids.length, '收件人不能重复'),
    serverName: z.string().min(1).max(200).default('resume'),
    attachmentId: z.literal('resume-image').default('resume-image'),
    dryRun: z.boolean().default(true),
}).strict();
export const bossGetResumeImageScanSchema = z.object({
    scanId: z.string().min(1).max(200).optional().describe('省略则读取当前标签页最近一次有效扫描；分页时固定使用返回的 scanId。'),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50),
}).strict();
