import { z } from 'zod';
import type { AttachmentMetadata } from './attachments';

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
export type BossStartFavoritesTaskRequest = z.infer<typeof bossStartFavoritesTaskSchema>;
export type BossApplyFavoriteJobInput = z.infer<typeof bossApplyFavoriteJobInputSchema>;
export type BossGetFavoritesTaskRequest = z.infer<typeof bossGetFavoritesTaskSchema>;
export type BossCancelFavoritesTaskRequest = z.infer<typeof bossCancelFavoritesTaskSchema>;
export type BossResolveFavoritesTaskRequest = z.infer<typeof bossResolveFavoritesTaskSchema>;
export type BossFavoritesExceptionTaskRequest = z.infer<typeof bossFavoritesExceptionTaskSchema>;

export type BossFavoriteTarget = {
  jobId: string; bossKey: string; jobTitle: string; company: string; bossName: string; jobUrl?: string;
  bossRole?: string; bossAvatar?: string;
};
export type BossFavoriteRow = BossFavoriteTarget & { action: 'start' | 'continue' | 'apply' | 'unknown' };
export type BossFavoritesSkippedCard = {
  pageKey: string; rowIndex: number; jobId?: string; jobTitle?: string; company?: string; reason: string;
};
export type BossFavoritesPage = {
  accountKey: string; documentId: string; pageKey: string; listComplete: boolean; rows: BossFavoriteRow[];
  skippedCards?: BossFavoritesSkippedCard[];
};
export type BossFavoritesChat = {
  accountKey: string; documentId: string; bossKey: string; jobId: string;
  ready: boolean; existingOutgoing: boolean; draftEmpty: boolean;
  hasIncomingReply?: boolean;
};
export type BossFavoritesReceipt = {
  accountKey: string; documentId: string; bossKey: string; jobId: string;
  verified: boolean; receiptId?: string; reason?: string;
};
export type BossFavoritesContext = {
  tabId: number; accountKey: string; documentId: string; signal: AbortSignal;
  allowIncomingReply?: boolean;
  /** Targeted jobs must remain on the original visible favorites page. */
  currentPageOnly?: boolean;
};
export type BossFavoritesVerificationInput = {
  greeting: string; attachment?: AttachmentMetadata; textAttempted: boolean; imageAttempted: boolean;
};
export type BossFavoritesVerification = {
  accountKey: string; documentId: string; bossKey: string; jobId: string;
  text: { confirmed: boolean; receiptId?: string }; image: { confirmed: boolean; receiptId?: string };
};
/** Navigation adapters wait for the target document, then return its fresh identity. */
export interface BossFavoritesOperations {
  readFavorites(context: Pick<BossFavoritesContext, 'tabId' | 'signal'>): Promise<BossFavoritesPage>;
  readCurrentFavorites(context: Pick<BossFavoritesContext, 'tabId' | 'signal'>): Promise<BossFavoritesPage>;
  nextFavorites(context: BossFavoritesContext): Promise<BossFavoritesPage>;
  openChat(target: BossFavoriteTarget, context: BossFavoritesContext): Promise<BossFavoritesChat>;
  readChat(target: BossFavoriteTarget, context: BossFavoritesContext): Promise<BossFavoritesChat>;
  /** Read-only evidence for the exception Agent. Never mutates the page. */
  inspect?(target: BossFavoriteTarget | undefined, context: BossFavoritesContext): Promise<unknown>;
  /** Rebind to the existing matching chat; never clicks a first-contact action again. */
  reopenChat?(target: BossFavoriteTarget, context: BossFavoritesContext): Promise<BossFavoritesChat>;
  verifyDelivery?(target: BossFavoriteTarget, input: BossFavoritesVerificationInput, context: BossFavoritesContext): Promise<BossFavoritesVerification>;
  sendText(target: BossFavoriteTarget, text: string, context: BossFavoritesContext): Promise<BossFavoritesReceipt>;
  sendImage(target: BossFavoriteTarget, image: { attachment: AttachmentMetadata; base64: string }, context: BossFavoritesContext): Promise<BossFavoritesReceipt>;
  returnFavorites(context: BossFavoritesContext, pageKey?: string): Promise<BossFavoritesPage>;
  removeFavorite(target: BossFavoriteTarget, context: BossFavoritesContext): Promise<{
    accountKey: string; documentId: string; jobId: string; removed: boolean;
  }>;
}

export type BossFavoritesPhase = 'scanning' | 'preparing' | 'opening' | 'text' | 'image' | 'returning' | 'removing' | 'cooldown' | 'finished';
export type BossFavoritesExceptionReview = {
  status: 'running' | 'completed' | 'failed';
  exceptionId: string; startedAt: number; completedAt?: number;
  summary?: string; recommendation?: 'inspect' | 'retry_after_verification' | 'skip' | 'stop';
  reason?: string; error?: string;
};
export type BossFavoritesHandoff = {
  status: 'queued' | 'running' | 'completed' | 'failed'; conversationId: string; sessionId?: string;
  createdAt: number; completedAt?: number; error?: string;
};
export type BossFavoritesException = {
  id: string; code: string; message: string; phase: BossFavoritesPhase;
  jobId?: string; recruiterId?: string; jobTitle?: string; company?: string;
  textConfirmed: boolean; imageConfirmed: boolean; unfavoriteConfirmed: boolean;
  review?: BossFavoritesExceptionReview;
  handoff?: BossFavoritesHandoff;
  resolution?: { action: 'continue' | 'skip' | 'pause'; reason: string; decidedAt: number; appliedAt?: number };
};
export type BossFavoritesRecipient = BossFavoriteTarget & {
  status: 'planned' | 'preview' | 'skipped' | 'completed' | 'uncertain';
  phase: BossFavoritesPhase;
  reason?: string;
  textConfirmed: boolean; imageConfirmed: boolean; unfavoriteConfirmed: boolean;
  textReceiptId?: string; imageReceiptId?: string;
  openingAttempted?: boolean; textAttempted?: boolean; imageAttempted?: boolean; unfavoriteAttempted?: boolean;
  allowIncomingReply?: boolean;
};
/** Set by the trusted entry point, never by a model-supplied task request. */
export type BossFavoritesExecutionOwner = 'pagent' | 'external';
export type BossFavoritesTaskSnapshot = {
  taskId: string; status: 'running' | 'stopping' | 'completed' | 'stopped' | 'needs_attention';
  /** Missing on existing persisted tasks means Pagent owns their exception decisions. */
  executionOwner?: BossFavoritesExecutionOwner;
  phase: BossFavoritesPhase; createdAt: number; updatedAt: number;
  maxRecipients: number; dryRun: boolean; greeting: string; attachment?: AttachmentMetadata;
  progress: { discovered: number; planned: number; completed: number; skipped: number; previewed: number };
  recipients?: BossFavoritesRecipient[];
  skippedCards?: BossFavoritesSkippedCard[];
  exception?: BossFavoritesException; error?: string;
  exceptionHistory?: BossFavoritesException[];
};

export const bossFavoritesPreferencesSchema = z.object({
  greeting: z.string().trim().min(1).max(5_000),
  maxRecipients: z.number().int().min(1).max(2_000),
}).strict();
/** Omission uses the locally saved greeting rather than overwriting it with the initial template. */
export const bossStartFavoritesInputSchema = bossStartFavoritesTaskSchema.omit({ greeting: true, targetJobId: true }).extend({
  greeting: bossFavoritesPreferencesSchema.shape.greeting.optional(),
});
export type BossStartFavoritesInput = z.infer<typeof bossStartFavoritesInputSchema>;
