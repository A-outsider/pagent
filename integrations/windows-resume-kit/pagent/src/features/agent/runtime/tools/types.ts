import type { AgentSettings } from '@/shared/contracts/settings';
import type { McpToolMeta } from '@/shared/contracts/mcp';
import type { MemoryScope } from '@/shared/contracts/memory';
import type { UploadAttachmentRequest, UploadAttachmentResult, UploadAttachmentOptions } from '@/shared/contracts/attachments';
import type { BossCancelTaskRequest, BossGetTaskRequest, BossStartTaskRequest, BossTaskSnapshot } from '@/shared/contracts/boss-task';
import type { BossGetFavoritesTaskRequest, BossCancelFavoritesTaskRequest, BossFavoritesTaskSnapshot, BossStartFavoritesInput, BossFavoritesExceptionTaskRequest, BossResolveFavoritesTaskRequest } from '@/shared/contracts/boss-favorites';
import type {
  BossAuditResumeImagesRequest,
  BossAuditResumeImagesResult,
  BossGetResumeImageScanRequest,
  BossGetResumeImageScanResult,
  BossSendResumeImagesRequest,
  BossSendResumeImagesResult,
} from '@/shared/contracts/boss';

export type ToolBridge = {
  tabId: number;
  settings: AgentSettings;
  content: <T>(name: string, payload?: unknown, options?: { signal?: AbortSignal }) => Promise<T>;
  uploadAttachment: (request: UploadAttachmentRequest, options?: UploadAttachmentOptions) => Promise<UploadAttachmentResult>;
  boss: {
    startFavoritesTask: (request: BossStartFavoritesInput) => Promise<BossFavoritesTaskSnapshot>;
    getFavoritesTask: (request: BossGetFavoritesTaskRequest) => Promise<BossFavoritesTaskSnapshot | null>;
    cancelFavoritesTask: (request: BossCancelFavoritesTaskRequest) => Promise<BossFavoritesTaskSnapshot>;
    inspectFavoritesException: (request: BossFavoritesExceptionTaskRequest) => Promise<unknown>;
    resolveFavoritesException: (request: BossResolveFavoritesTaskRequest) => Promise<BossFavoritesTaskSnapshot>;
    startTask: (request: BossStartTaskRequest) => Promise<BossTaskSnapshot>;
    getTask: (request: BossGetTaskRequest) => Promise<BossTaskSnapshot | null>;
    cancelTask: (request: BossCancelTaskRequest) => Promise<BossTaskSnapshot>;
    getResumeImageScan: (request: BossGetResumeImageScanRequest) => Promise<BossGetResumeImageScanResult>;
    auditResumeImages: (request: BossAuditResumeImagesRequest) => Promise<BossAuditResumeImagesResult>;
    sendResumeImages: (request: BossSendResumeImagesRequest) => Promise<BossSendResumeImagesResult>;
  };
  /** raw=true 时返回完整未截断的 data URL（供作为图片传给模型） */
  screenshot: (fullPage?: boolean, raw?: boolean) => Promise<string>;
  navigate: (url: string) => Promise<unknown>;
  back: () => Promise<unknown>;
  forward: () => Promise<unknown>;
  reload: () => Promise<unknown>;
  tabs: {
    query: () => Promise<unknown>;
    create: (url?: string) => Promise<unknown>;
    switch: (tabId: number) => Promise<unknown>;
    close: (tabId: number) => Promise<unknown>;
  };
  cdp: {
    script: (expression: string, awaitPromise?: boolean) => Promise<unknown>;
    command: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    input: (payload: { x: number; y: number; type?: string; text?: string }) => Promise<unknown>;
    network: (filter?: {
      urlIncludes?: string;
      method?: string;
      resourceType?: string;
      failedOnly?: boolean;
      includeNoise?: boolean;
      limit?: number;
    }) => Promise<unknown>;
    console: (filter?: {
      level?: string;
      textIncludes?: string;
      limit?: number;
    }) => Promise<unknown>;
    request: (requestId: string, includeBody?: boolean) => Promise<unknown>;
  };
  mcp: {
    listTools: () => Promise<McpToolMeta[]>;
    callTool: (name: string, args: unknown) => Promise<string>;
  };
  memory: {
    search: (query: string, limit?: number) => Promise<unknown>;
    write: (content: string, scope: MemoryScope, memoryId?: string) => Promise<unknown>;
  };
};

export type TrackActionFn = <T>(action: () => Promise<T>) => Promise<T>;
export type StartChangeWatchFn = () => Promise<{ watchId: string; cursor?: unknown }>;
