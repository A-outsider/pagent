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

export type BossAuditResumeImagesRequest = z.infer<typeof bossAuditResumeImagesSchema>;
export type BossSendResumeImagesRequest = z.infer<typeof bossSendResumeImagesSchema>;
export type BossGetResumeImageScanRequest = z.infer<typeof bossGetResumeImageScanSchema>;

export type BossResumeRecipient = {
  recipientId: string;
  name: string;
  company?: string;
  status: 'sent' | 'not_found' | 'uncertain' | 'out_of_scope';
  historyComplete: boolean;
  reason: string;
  evidenceSummary: string;
};

export type BossAuditResumeImagesResult = {
  scanId: string;
  /** Physical list end, independent of whether the requested time scope is complete. */
  listComplete: boolean;
  /** Requested scope has been discovered and every observed row has been classified. */
  complete: boolean;
  /** Discovery ended at the physical list end or a verified older time boundary. */
  stopReason?: 'time_cutoff' | 'list_end';
  nextCursor?: string;
  since?: string;
  /** Cumulative observed-prefix counts only; unseen rows beyond a time cutoff are not counted. */
  progress: { discovered: number; checked: number; sent: number; notFound: number; uncertain: number; outOfScope: number };
  /** This batch's not_found/uncertain rows only; progress also counts sent and out_of_scope. */
  recipients: BossResumeRecipient[];
};

export type BossGetResumeImageScanResult = BossAuditResumeImagesResult & {
  createdAt: number;
  expiresAt: number;
  offset: number;
  nextOffset?: number;
};

export type BossSendResumeImagesResult = {
  scanId: string;
  dryRun: boolean;
  complete: boolean;
  recipients: Array<{
    recipientId: string;
    status: 'planned' | 'sent' | 'skipped' | 'failed' | 'uncertain';
    reason: string;
    evidenceSummary?: string;
  }>;
};
