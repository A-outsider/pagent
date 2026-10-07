import { z } from 'zod';
export const DEFAULT_BOSS_GREETING = '您好，我对这个岗位很感兴趣，方便进一步沟通吗？';
export const bossStartFavoritesTaskSchema = z.object({
    maxRecipients: z.number().int().min(1).max(2_000).default(10),
    greeting: z.string().trim().min(1).max(5_000).default(DEFAULT_BOSS_GREETING),
    serverName: z.string().trim().min(1).max(200).default('resume'),
    attachmentId: z.literal('resume-image').default('resume-image'),
    dryRun: z.boolean().default(true),
    /** Trusted runner input; never exposed on the legacy list-scanning MCP tool. */
    targetJobId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(200).optional(),
}).strict();
/** Public, single-job entry. Unknown fields such as maxRecipients are rejected. */
export const bossApplyFavoriteJobInputSchema = z.object({
    jobId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(200),
    greeting: z.string().trim().min(1).max(5_000).optional(),
    serverName: z.string().trim().min(1).max(200).default('resume'),
    attachmentId: z.literal('resume-image').default('resume-image'),
    dryRun: z.boolean().default(true),
}).strict();
export const bossListCurrentFavoritesSchema = z.object({
    tabId: z.number().int().positive(),
}).strict();
export const bossGetFavoritesTaskSchema = z.object({
    taskId: z.string().min(1).max(200).optional(),
    includeRecipients: z.boolean().default(false),
}).strict();
export const bossCancelFavoritesTaskSchema = z.object({ taskId: z.string().min(1).max(200) }).strict();
export const bossFavoritesExceptionTaskSchema = z.object({ taskId: z.string().min(1).max(200), exceptionId: z.string().min(1).max(200) }).strict();
export const bossResolveFavoritesTaskSchema = bossFavoritesExceptionTaskSchema.extend({
    action: z.enum(['continue', 'skip', 'pause']), reason: z.string().trim().min(1).max(2_000),
}).strict();
export const bossFavoritesPreferencesSchema = z.object({
    greeting: z.string().trim().min(1).max(5_000),
    maxRecipients: z.number().int().min(1).max(2_000),
}).strict();
/** Omission uses the locally saved greeting rather than overwriting it with the initial template. */
export const bossStartFavoritesInputSchema = bossStartFavoritesTaskSchema.omit({ greeting: true, targetJobId: true }).extend({
    greeting: bossFavoritesPreferencesSchema.shape.greeting.optional(),
});
