import { bossStartTaskSchema, type BossStartTaskRequest, type BossGetTaskRequest, type BossCancelTaskRequest, type BossTaskSnapshot, type BossTaskRecipient } from '@/shared/contracts/boss-task';
import type { BossAuditResumeImagesResult, BossSendResumeImagesResult } from '@/shared/contracts/boss';
import { idbGet, idbSet } from '@/shared/storage/idb';
import { beginBusyKeepAlive, endBusyKeepAlive } from '@/shared/extension/keepalive';
import { createMcpAttachmentLoader } from '@/features/mcp/background/mcp-manager';
import { createBossService, reserveBossTaskTab, releaseBossTaskTab, type BossContent, type BossExecution } from './service';
import type { BossPageState } from './content-adapter';

type StoredTask = { tabId: number; accountKey: string; documentId: string; snapshot: BossTaskSnapshot; inFlight?: string[] };
type ActiveTask = StoredTask & { abort: AbortController; token: symbol; writes: Promise<void> };
const key = (id: string) => `boss-task:${id}`;
const latestKey = (tabId: number) => `boss-task-latest:${tabId}`;
const emptyProgress = () => ({ discovered: 0, checked: 0, sent: 0, notFound: 0, uncertain: 0, outOfScope: 0 });

function recountDelivery(snapshot: BossTaskSnapshot) {
  const rows = snapshot.recipients ?? [];
  const count = (status: BossTaskRecipient['deliveryStatus']) => rows.filter((item) => item.deliveryStatus === status).length;
  Object.assign(snapshot.delivery, {
    processed: rows.filter((item) => item.deliveryStatus && item.deliveryStatus !== 'planned').length,
    sent: count('sent'), skipped: count('skipped'), uncertain: count('uncertain'), failed: count('failed'),
  });
}

/** Fixed BOSS workflow. No model calls, browser API requests, or automatic upload retries. */
export function createBossTaskRunner(service: ReturnType<typeof createBossService>, content: BossContent) {
  const active = new Map<number, ActiveTask>();
  const latest = new Map<number, StoredTask>();
  const starting = new Set<number>();

  const view = (record: StoredTask, details = false): BossTaskSnapshot => {
    const snapshot = structuredClone(record.snapshot);
    if (!details) delete snapshot.recipients;
    return snapshot;
  };
  const save = (record: ActiveTask) => {
    record.snapshot.updatedAt = Date.now();
    const data: StoredTask = structuredClone({ tabId: record.tabId, accountKey: record.accountKey, documentId: record.documentId,
      snapshot: record.snapshot, inFlight: record.inFlight });
    record.writes = record.writes.then(() => idbSet('meta', key(record.snapshot.taskId), data));
    return record.writes;
  };
  const mergeAudit = (record: ActiveTask, result: BossAuditResumeImagesResult) => {
    const snapshot = record.snapshot;
    snapshot.scanId = result.scanId;
    snapshot.since = result.since;
    snapshot.progress = { ...result.progress };
    const rows = new Map(snapshot.recipients!.map((row) => [row.recipientId, row]));
    for (const row of result.recipients) rows.set(row.recipientId, { ...rows.get(row.recipientId), ...row });
    snapshot.recipients = [...rows.values()];
  };
  const mergeDelivery = (record: ActiveTask, result: BossSendResumeImagesResult['recipients'][number]) => {
    const row = record.snapshot.recipients!.find((item) => item.recipientId === result.recipientId);
    if (!row) throw new Error('投递结果不属于本任务名单');
    row.deliveryStatus = result.status;
    row.deliveryReason = result.reason;
    if (result.status === 'sent') row.status = 'sent';
    if (result.status === 'uncertain') row.status = 'uncertain';
    recountDelivery(record.snapshot);
    record.inFlight = record.inFlight?.filter((id) => id !== result.recipientId);
  };

  async function execute(record: ActiveTask, request: BossStartTaskRequest) {
    const { snapshot, abort, tabId } = record;
    const signal = abort.signal;
    const execution: BossExecution = {
      taskToken: record.token,
      expectedIdentity: { accountKey: record.accountKey, documentId: record.documentId },
      loadAttachment: createMcpAttachmentLoader(),
      onAudit: async (result) => { mergeAudit(record, result); await save(record); },
      onDelivery: async (result) => { mergeDelivery(record, result); await save(record); },
    };
    let phaseStarted = Date.now();
    const setPhase = (phase: BossTaskSnapshot['phase']) => {
      const elapsed = Date.now() - phaseStarted;
      if (snapshot.phase === 'scanning') snapshot.timings.scanMs += elapsed;
      if (snapshot.phase === 'preparing') snapshot.timings.prepareMs += elapsed;
      if (snapshot.phase === 'sending') snapshot.timings.sendMs += elapsed;
      snapshot.phase = phase;
      phaseStarted = Date.now();
    };
    try {
      if (request.operation === 'send' && request.scanId) {
        let offset = 0;
        do {
          signal.throwIfAborted();
          const result = await service.getResumeImageScan(tabId, { scanId: request.scanId, offset, limit: 100 }, signal, execution);
          if (!result.complete) throw new Error('指定扫描尚未完成，请先完成查漏');
          mergeAudit(record, result);
          await save(record);
          if (result.nextOffset === undefined) break;
          if (result.nextOffset <= offset) throw new Error('查漏结果分页没有前进');
          offset = result.nextOffset;
        } while (true);
      } else {
        let cursor: string | undefined;
        do {
          signal.throwIfAborted();
          const result = await service.auditResumeImages(tabId, { since: request.since, cursor, limit: 15 }, signal, execution);
          mergeAudit(record, result);
          await save(record);
          if (result.complete) break;
          if (!result.nextCursor || result.nextCursor === cursor) throw new Error('查漏未完成且无法继续分页');
          cursor = result.nextCursor;
        } while (true);
      }
      signal.throwIfAborted();
      if (request.operation === 'send') {
        const specified = request.recipientIds && new Set(request.recipientIds);
        const rows = snapshot.recipients!;
        if (specified && [...specified].some((id) => !rows.some((row) => row.recipientId === id))) {
          throw new Error('指定收件人不在本次查漏候选中');
        }
        const candidates = rows.filter((row) => row.status === 'not_found' && row.historyComplete
          && (!specified || specified.has(row.recipientId))).slice(0, request.maxRecipients);
        snapshot.delivery.planned = candidates.length;
        setPhase('preparing');
        await save(record);
        for (let offset = 0; offset < candidates.length; offset += 10) {
          signal.throwIfAborted();
          const recipientIds = candidates.slice(offset, offset + 10).map((row) => row.recipientId);
          const input = { scanId: snapshot.scanId!, recipientIds, serverName: request.serverName, attachmentId: request.attachmentId };
          setPhase('preparing');
          const preview = await service.sendResumeImages(tabId, { ...input, dryRun: true }, signal, execution);
          for (const result of preview.recipients) mergeDelivery(record, result);
          await save(record);
          if (!preview.complete) throw new Error('投递预览未完成，已停止任务');
          signal.throwIfAborted();
          if (request.dryRun) continue;
          setPhase('sending');
          record.inFlight = [...recipientIds];
          await save(record);
          const sent = await service.sendResumeImages(tabId, { ...input, dryRun: false }, signal, execution);
          // Preserve outcomes even when cancellation occurred during the current upload.
          // The service labels unstarted queue entries skipped; retain them as not attempted.
          for (const result of sent.recipients) {
            if (result.status === 'skipped' && result.reason === '队列停止，此人未尝试发送') continue;
            mergeDelivery(record, result);
          }
          record.inFlight = undefined;
          await save(record);
          if (!sent.complete) {
            snapshot.status = 'stopped';
            snapshot.error = signal.aborted ? '任务已停止；发送待确认的记录不会自动重发' : '投递遇到失败或未确认结果，已停止后续投递';
            return;
          }
        }
      }
      signal.throwIfAborted();
      snapshot.status = 'completed';
    } catch (error) {
      snapshot.status = signal.aborted ? 'stopped' : 'failed';
      snapshot.error = signal.aborted ? '任务已停止' : error instanceof Error ? error.message : String(error);
    } finally {
      setPhase('finished');
      try { await save(record); }
      catch (error) {
        snapshot.status = 'failed';
        snapshot.error = `无法保存任务记录，已停止：${error instanceof Error ? error.message : String(error)}`;
      }
      finally {
        active.delete(tabId);
        releaseBossTaskTab(tabId, record.token);
        endBusyKeepAlive();
      }
    }
  }

  return {
    isRunning: (tabId: number) => starting.has(tabId) || active.has(tabId),
    async start(tabId: number, input: BossStartTaskRequest): Promise<BossTaskSnapshot> {
      const request = bossStartTaskSchema.parse(input);
      const token = reserveBossTaskTab(tabId);
      starting.add(tabId);
      try {
        const state = await content<BossPageState>(tabId, 'boss.state');
        if (!state.accountKey) throw new Error('无法确认 BOSS 登录账号');
        const now = Date.now();
        const record: ActiveTask = {
          tabId, accountKey: state.accountKey, documentId: state.documentId, token, abort: new AbortController(), writes: Promise.resolve(),
          snapshot: {
            taskId: `boss_task_${crypto.randomUUID().replaceAll('-', '')}`, operation: request.operation,
            ...(request.operation === 'send' ? { dryRun: request.dryRun } : {}),
            status: 'running', phase: 'scanning', since: request.since, createdAt: now, updatedAt: now,
            progress: emptyProgress(), delivery: { planned: 0, processed: 0, sent: 0, skipped: 0, uncertain: 0, failed: 0 },
            timings: { scanMs: 0, prepareMs: 0, sendMs: 0 }, recipients: [],
          },
        };
        await save(record);
        await idbSet('meta', latestKey(tabId), record.snapshot.taskId);
        active.set(tabId, record);
        latest.set(tabId, record);
        beginBusyKeepAlive();
        // Independent from the initiating model/MCP request; errors belong to the task report.
        void execute(record, request).catch(() => {});
        return view(record);
      } catch (error) {
        releaseBossTaskTab(tabId, token);
        throw error;
      } finally { starting.delete(tabId); }
    },
    async get(tabId: number, request: BossGetTaskRequest): Promise<BossTaskSnapshot | null> {
      const live = latest.get(tabId);
      if (live && (!request.taskId || live.snapshot.taskId === request.taskId)) return view(live, request.includeRecipients);
      const taskId = request.taskId ?? await idbGet<string>('meta', latestKey(tabId));
      if (!taskId) return null;
      const stored = await idbGet<StoredTask>('meta', key(taskId));
      if (!stored || stored.tabId !== tabId) return null;
      const current = latest.get(tabId);
      if (current?.snapshot.taskId === taskId) return view(current, request.includeRecipients);
      if (starting.has(tabId)) return view(stored, request.includeRecipients);
      if (stored.snapshot.status === 'running' || stored.snapshot.status === 'stopping') {
        stored.snapshot.status = 'stopped';
        stored.snapshot.phase = 'finished';
        stored.snapshot.updatedAt = Date.now();
        stored.snapshot.error = '后台已重启，任务已停止；原报告保留，继续前需重新查漏，进行中的投递须复核';
        for (const row of stored.snapshot.recipients ?? []) {
          if (stored.inFlight?.includes(row.recipientId)) {
            row.status = 'uncertain';
            row.deliveryStatus = 'uncertain';
            row.deliveryReason = '后台中断时本批尚未核验，不能认定未发送';
          }
        }
        recountDelivery(stored.snapshot);
        stored.inFlight = undefined;
        await idbSet('meta', key(taskId), stored);
      }
      return view(stored, request.includeRecipients);
    },
    async cancel(tabId: number, request: BossCancelTaskRequest): Promise<BossTaskSnapshot> {
      const record = active.get(tabId);
      if (record?.snapshot.taskId === request.taskId) {
        if (record.snapshot.status !== 'running' && record.snapshot.status !== 'stopping') return view(record);
        record.snapshot.status = 'stopping';
        record.abort.abort();
        await save(record);
        return view(record);
      }
      const report = await this.get(tabId, { taskId: request.taskId, includeRecipients: false });
      if (!report) throw new Error('未找到此页面的 BOSS 任务');
      return report;
    },
  };
}
