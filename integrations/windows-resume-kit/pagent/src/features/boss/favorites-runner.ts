import { bossStartFavoritesTaskSchema, bossResolveFavoritesTaskSchema, type BossStartFavoritesTaskRequest, type BossGetFavoritesTaskRequest, type BossCancelFavoritesTaskRequest, type BossFavoritesTaskSnapshot, type BossFavoritesOperations, type BossFavoritesRecipient, type BossFavoritesContext, type BossFavoritesReceipt, type BossFavoritesHandoff, type BossResolveFavoritesTaskRequest, type BossFavoritesExceptionTaskRequest, type BossFavoritesExecutionOwner } from '@/shared/contracts/boss-favorites';
import { attachmentMetadataSchema } from '@/shared/contracts/attachments';
import { idbGet, idbSet } from '@/shared/storage/idb';
import { beginBusyKeepAlive, endBusyKeepAlive } from '@/shared/extension/keepalive';
import { createMcpAttachmentLoader, type downloadMcpAttachment } from '@/features/mcp/background/mcp-manager';
import { reserveBossTaskTab, releaseBossTaskTab } from './service';

type StoredTask = { tabId: number; accountKey: string; documentId: string; currentJobId?: string; sourcePageKey?: string; snapshot: BossFavoritesTaskSnapshot;
  request?: BossStartFavoritesTaskRequest; queueJobIds?: string[]; skippedJobIds?: string[] };
type ActiveTask = StoredTask & { abort: AbortController; token: symbol; writes: Promise<void> };
type DeliveryLedger = { taskId: string; recipient: BossFavoritesRecipient };
type RunnerOptions = {
  loadAttachment?: typeof downloadMcpAttachment;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onException?: (snapshot: BossFavoritesTaskSnapshot, persistHandoff: (handoff: BossFavoritesHandoff) => Promise<void>, tabId: number) => Promise<BossFavoritesHandoff | void>;
};
const copyStored = (record: StoredTask): StoredTask => structuredClone({ tabId: record.tabId, accountKey: record.accountKey,
  documentId: record.documentId, currentJobId: record.currentJobId, sourcePageKey: record.sourcePageKey, request: record.request,
  queueJobIds: record.queueJobIds, skippedJobIds: record.skippedJobIds, snapshot: record.snapshot });
const taskKey = (id: string) => `boss-favorites-task:${id}`;
const latestKey = (tabId: number) => `boss-favorites-latest:${tabId}`;
const ledgerKey = (account: string, boss: string) => `boss-favorites-contact:${encodeURIComponent(account)}:${encodeURIComponent(boss)}`;
const jobLedgerKey = (account: string, job: string) => `boss-favorites-job:${encodeURIComponent(account)}:${encodeURIComponent(job)}`;
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(finish, ms);
  const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
});
class WorkflowError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Fixed first-contact workflow. Every write is journaled before dispatch; uncertain writes are never retried. */
export function createBossFavoritesRunner(operations: BossFavoritesOperations, options: RunnerOptions = {}) {
  const active = new Map<number, ActiveTask>();
  const latest = new Map<number, StoredTask>();
  const restored = new Map<string, StoredTask>();
  const accountOwners = new Map<string, string>();
  const reviewing = new Set<string>();
  const cancellationRequests = new Set<string>();
  const sleep = options.sleep ?? pause;
  const view = (record: StoredTask, details = false) => {
    const snapshot = structuredClone(record.snapshot);
    if (!details) { delete snapshot.recipients; delete snapshot.skippedCards; }
    return snapshot;
  };
  const save = (record: ActiveTask) => {
    record.snapshot.updatedAt = Date.now();
    const stored: StoredTask = structuredClone({ tabId: record.tabId, accountKey: record.accountKey, documentId: record.documentId,
      currentJobId: record.currentJobId, sourcePageKey: record.sourcePageKey, snapshot: record.snapshot, request: record.request,
      queueJobIds: record.queueJobIds, skippedJobIds: record.skippedJobIds });
    record.writes = record.writes.then(() => idbSet('meta', taskKey(record.snapshot.taskId), stored));
    return record.writes;
  };
  const saveStored = (record: StoredTask) => {
    record.snapshot.updatedAt = Date.now();
    return idbSet('meta', taskKey(record.snapshot.taskId), structuredClone({ tabId: record.tabId,
      accountKey: record.accountKey, documentId: record.documentId, currentJobId: record.currentJobId, sourcePageKey: record.sourcePageKey,
      request: record.request, queueJobIds: record.queueJobIds, skippedJobIds: record.skippedJobIds, snapshot: record.snapshot }));
  };
  async function findRecord(tabId: number, taskId: string): Promise<StoredTask> {
    const current = latest.get(tabId);
    const record = current?.snapshot.taskId === taskId ? current : restored.get(taskId)
      ?? await idbGet<StoredTask>('meta', taskKey(taskId));
    if (!record || record.tabId !== tabId) throw new Error('未找到此页面的感兴趣投递任务');
    return record;
  }
  function assertOwner(record: StoredTask, owner: BossFavoritesExecutionOwner) {
    if ((record.snapshot.executionOwner ?? 'pagent') !== owner) {
      throw new Error('此投递任务属于另一个执行端，不能接管异常决定');
    }
  }
  async function exceptionRecord(tabId: number, request: BossFavoritesExceptionTaskRequest, owner: BossFavoritesExecutionOwner) {
    if (active.has(tabId)) throw new Error('固定程序仍在执行，不能处理异常');
    const record = await findRecord(tabId, request.taskId);
    assertOwner(record, owner);
    if (cancellationRequests.has(request.taskId) || record.snapshot.exception?.id !== request.exceptionId || record.snapshot.status !== 'needs_attention') {
      throw new Error('异常已过期或任务状态已变化，请读取最新任务');
    }
    return record;
  }
  const context = (record: ActiveTask): BossFavoritesContext => ({ tabId: record.tabId, accountKey: record.accountKey,
    documentId: record.documentId, signal: record.abort.signal,
    currentPageOnly: Boolean(record.request?.targetJobId),
    allowIncomingReply: record.snapshot.recipients?.find((row) => row.jobId === record.currentJobId)?.allowIncomingReply });
  function bind(record: ActiveTask, state: { accountKey: string; documentId: string }, navigation = false) {
    if (!state.accountKey || !state.documentId) throw new WorkflowError('identity_missing', '无法确认页面和登录账号，已停止');
    if (record.accountKey && record.accountKey !== state.accountKey) throw new WorkflowError('account_changed', '登录账号已变化，已停止');
    if (!navigation && record.documentId && record.documentId !== state.documentId) throw new WorkflowError('document_changed', '页面在操作期间发生变化，已停止');
    record.accountKey = state.accountKey;
    record.documentId = state.documentId;
  }
  function assertChat(record: ActiveTask, row: BossFavoritesRecipient, chat: Awaited<ReturnType<BossFavoritesOperations['readChat']>>, navigation = false) {
    bind(record, chat, navigation);
    if (!chat.ready || chat.bossKey !== row.bossKey || chat.jobId !== row.jobId) {
      throw new WorkflowError('chat_identity_mismatch', '聊天对象或岗位未准确匹配，已停止');
    }
    if (!chat.draftEmpty) throw new WorkflowError('existing_draft', '聊天中已有草稿，保留草稿并停止');
    if (chat.hasIncomingReply && !row.allowIncomingReply) throw new WorkflowError('incoming_reply', '当前招聘者已有回复，交给 Pagent 判断是否继续预设投递');
  }
  function receipt(record: ActiveTask, row: BossFavoritesRecipient, result: BossFavoritesReceipt, kind: 'text' | 'image') {
    bind(record, result);
    if (result.bossKey !== row.bossKey || result.jobId !== row.jobId || !result.verified || !result.receiptId) {
      throw new WorkflowError(`${kind}_receipt_unconfirmed`, result.reason || `${kind === 'text' ? '文字' : '图片'}发送结果未确认，不会自动重发`);
    }
    if (kind === 'image' && result.receiptId === row.textReceiptId) {
      throw new WorkflowError('image_receipt_reused', '图片回执与文字回执相同，不能确认图片已发送');
    }
  }
  const journal = async (record: ActiveTask, row: BossFavoritesRecipient) => {
    await save(record);
    const entry: DeliveryLedger = { taskId: record.snapshot.taskId, recipient: structuredClone(row) };
    await idbSet('meta', ledgerKey(record.accountKey, row.bossKey), entry);
    await idbSet('meta', jobLedgerKey(record.accountKey, row.jobId), entry);
    record.abort.signal.throwIfAborted();
  };
  async function reviewException(record: StoredTask, persist: () => Promise<void>) {
    const exception = record.snapshot.exception;
    // External callers read the paused task and apply a guarded decision themselves.
    if (record.snapshot.executionOwner === 'external') return;
    if (!exception || exception.handoff || exception.resolution || !options.onException || reviewing.has(exception.id)) return;
    reviewing.add(exception.id);
    beginBusyKeepAlive();
    try {
      const persistHandoff = async (handoff: BossFavoritesHandoff) => {
        if (record.snapshot.exception?.id !== exception.id) throw new Error('异常交接标识不匹配');
        exception.handoff = structuredClone(handoff);
        await persist();
      };
      const handoff = await options.onException(view(record, true), persistHandoff, record.tabId);
      if (handoff) await persistHandoff(handoff);
    } catch (error) {
      const previousHandoff = record.snapshot.exception?.handoff as BossFavoritesHandoff | undefined;
      exception.handoff = { status: 'failed', conversationId: previousHandoff?.conversationId ?? '', createdAt: Date.now(), completedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error) };
      await persist();
    } finally { reviewing.delete(exception.id); endBusyKeepAlive(); }
  }
  function setException(record: StoredTask, error: unknown) {
    const snapshot = record.snapshot;
    const row = snapshot.recipients?.find((item) => item.jobId === record.currentJobId);
    if (row && row.status !== 'completed' && row.status !== 'skipped') row.status = 'uncertain';
    snapshot.status = 'needs_attention';
    snapshot.error = error instanceof Error ? error.message : String(error);
    snapshot.exception = {
      id: `boss_exception_${crypto.randomUUID().replaceAll('-', '')}`,
      code: error instanceof WorkflowError ? error.code : 'operation_failed', message: snapshot.error, phase: snapshot.phase,
      ...(row ? { jobId: row.jobId, recruiterId: row.bossKey, jobTitle: row.jobTitle, company: row.company } : {}),
      textConfirmed: Boolean(row?.textConfirmed), imageConfirmed: Boolean(row?.imageConfirmed), unfavoriteConfirmed: Boolean(row?.unfavoriteConfirmed),
    };
  }

  async function execute(record: ActiveTask, request: BossStartFavoritesTaskRequest, resumingRun = false) {
    const { snapshot, abort } = record;
    const signal = abort.signal;
    try {
      signal.throwIfAborted();
      let candidates: BossFavoritesRecipient[];
      if (!record.queueJobIds) {
      if (request.targetJobId) {
        snapshot.phase = 'scanning';
        snapshot.recipients = []; snapshot.skippedCards = [];
        snapshot.progress = { discovered: 0, planned: 0, completed: 0, skipped: 0, previewed: 0 };
        const page = await operations.readCurrentFavorites(context(record));
        signal.throwIfAborted();
        bind(record, page, true);
        if (!/^[1-9]\d*$/.test(page.pageKey)) throw new WorkflowError('page_unknown', '无法确认当前收藏页码，已停止');
        const owner = accountOwners.get(record.accountKey);
        if (owner && owner !== snapshot.taskId) throw new WorkflowError('account_busy', '此账号已有感兴趣岗位投递任务');
        accountOwners.set(record.accountKey, snapshot.taskId);
        record.sourcePageKey = page.pageKey;
        const matches = page.rows.filter((source) => source.jobId === request.targetJobId);
        if (matches.length !== 1 || !matches[0]?.bossKey) {
          throw new WorkflowError('target_not_visible', '当前收藏页无法唯一定位指定岗位及招聘者，未执行投递');
        }
        const source = matches[0];
        const row: BossFavoritesRecipient = { ...source, status: 'planned', phase: 'scanning',
          textConfirmed: false, imageConfirmed: false, unfavoriteConfirmed: false };
        snapshot.recipients.push(row);
        snapshot.progress.discovered = 1;
        record.currentJobId = row.jobId;
        candidates = [];
        if (source.action !== 'start') {
          row.status = 'skipped';
          row.reason = source.action === 'apply' ? '仅支持立即网申，非聊天岗位，保留收藏'
            : source.action === 'continue' ? '已沟通过，保留收藏' : '沟通状态未知，保留收藏并跳过';
          snapshot.progress.skipped = 1;
        } else if (page.rows.some((other) => other.jobId !== row.jobId
          && other.bossKey === row.bossKey && other.action === 'continue')) {
          row.status = 'skipped'; row.reason = '同一招聘者的其他岗位显示已沟通过，保留收藏';
          snapshot.progress.skipped = 1;
        } else {
          const previous = await idbGet<DeliveryLedger>('meta', ledgerKey(record.accountKey, row.bossKey))
            ?? await idbGet<DeliveryLedger>('meta', jobLedgerKey(record.accountKey, row.jobId));
          if (previous && previous.recipient.status !== 'completed') {
            Object.assign(row, { textConfirmed: previous.recipient.textConfirmed, imageConfirmed: previous.recipient.imageConfirmed,
              unfavoriteConfirmed: previous.recipient.unfavoriteConfirmed });
            throw new WorkflowError('previous_attempt_unresolved', '此前已尝试沟通但未完成核验，保留收藏，不自动重发');
          }
          if (previous) {
            row.status = 'skipped'; row.reason = '此前已完成投递'; snapshot.progress.skipped = 1;
          } else {
            candidates.push(row); snapshot.progress.planned = 1;
          }
        }
        record.queueJobIds = candidates.map((candidate) => candidate.jobId);
        record.currentJobId = undefined;
        await save(record);
      } else {
      // Scanning can restart safely: no recipient write occurs until the full queue is frozen.
      snapshot.phase = 'scanning';
      snapshot.recipients = []; snapshot.skippedCards = [];
      snapshot.progress = { discovered: 0, planned: 0, completed: 0, skipped: 0, previewed: 0 };
      let page = await operations.readFavorites(context(record));
      signal.throwIfAborted();
      bind(record, page, true);
      const owner = accountOwners.get(record.accountKey);
      if (owner && owner !== snapshot.taskId) throw new WorkflowError('account_busy', '此账号已有感兴趣岗位投递任务');
      accountOwners.set(record.accountKey, snapshot.taskId);
      // Snapshot all stable IDs before cancellation of favorites can shift pagination.
      const seenPages = new Set<string>();
      const seenJobs = new Set<string>();
      const seenSkippedCards = new Set<string>();
      const seenContacts = new Set<string>();
      const contacted = new Set<string>();
      candidates = [];
      const skipCard = (card: NonNullable<BossFavoritesTaskSnapshot['skippedCards']>[number]) => {
        const key = card.jobId ? `job:${card.jobId}` : `page:${card.pageKey}:row:${card.rowIndex}`;
        if (seenSkippedCards.has(key) || (card.jobId && seenJobs.has(card.jobId))) return;
        seenSkippedCards.add(key);
        if (card.jobId) seenJobs.add(card.jobId);
        (snapshot.skippedCards ??= []).push(card);
        snapshot.progress.discovered++;
        snapshot.progress.skipped++;
      };
      while (true) {
        signal.throwIfAborted();
        bind(record, page, true);
        if (!page.pageKey || seenPages.has(page.pageKey)) throw new WorkflowError('pagination_stalled', '感兴趣列表分页没有前进');
        seenPages.add(page.pageKey);
        for (const card of page.skippedCards ?? []) skipCard({ ...card, pageKey: page.pageKey });
        for (const [rowIndex, source] of page.rows.entries()) {
          if (!source.jobId || !source.bossKey) {
            skipCard({ pageKey: page.pageKey, rowIndex: rowIndex + 1, ...(source.jobId ? { jobId: source.jobId } : {}),
              jobTitle: source.jobTitle, company: source.company, reason: '岗位或招聘者缺少稳定标识，保留收藏并跳过' });
            continue;
          }
          if (seenJobs.has(source.jobId)) continue;
          seenJobs.add(source.jobId);
          const row: BossFavoritesRecipient = { ...source, status: 'planned', phase: 'scanning', textConfirmed: false, imageConfirmed: false, unfavoriteConfirmed: false };
          snapshot.recipients!.push(row);
          snapshot.progress.discovered++;
          record.currentJobId = row.jobId;
          if (record.skippedJobIds?.includes(row.jobId)) {
            row.status = 'skipped'; row.reason = '已按异常处理决定跳过，保留收藏';
            snapshot.progress.skipped++;
            continue;
          }
          if (source.action !== 'start' && source.action !== 'continue') {
            row.status = 'skipped';
            row.reason = source.action === 'apply' ? '仅支持立即网申，非聊天岗位，保留收藏' : '沟通状态未知，保留收藏并跳过';
            snapshot.progress.skipped++;
            continue;
          }
          if (source.action === 'continue') contacted.add(row.bossKey);
          const previous = await idbGet<DeliveryLedger>('meta', ledgerKey(record.accountKey, row.bossKey))
            ?? await idbGet<DeliveryLedger>('meta', jobLedgerKey(record.accountKey, row.jobId));
          if (previous && previous.recipient.status !== 'completed') {
            Object.assign(row, { textConfirmed: previous.recipient.textConfirmed, imageConfirmed: previous.recipient.imageConfirmed,
              unfavoriteConfirmed: previous.recipient.unfavoriteConfirmed });
            throw new WorkflowError('previous_attempt_unresolved', '此前已尝试沟通但未完成核验，保留收藏，不自动重发');
          }
          if (source.action !== 'start' || seenContacts.has(row.bossKey) || previous) {
            row.status = 'skipped';
            row.reason = previous ? '此前已完成投递' : seenContacts.has(row.bossKey) ? '同一招聘者已在本批名单中' : '已沟通过，保留收藏';
            snapshot.progress.skipped++;
          } else {
            seenContacts.add(row.bossKey);
            candidates.push(row);
            snapshot.progress.planned++;
          }
        }
        record.currentJobId = undefined;
        await save(record);
        if (page.listComplete) break;
        page = await operations.nextFavorites(context(record));
      }
      // A recruiter may own several saved jobs, only one of which displays an existing chat.
      for (let index = candidates.length - 1; index >= 0; index--) {
        const row = candidates[index]!;
        if (!contacted.has(row.bossKey)) continue;
        row.status = 'skipped';
        row.reason = '同一招聘者的其他岗位显示已沟通过，保留收藏';
        candidates.splice(index, 1);
        snapshot.progress.planned--;
        snapshot.progress.skipped++;
      }
      record.queueJobIds = candidates.map((row) => row.jobId);
      await save(record);
      }
      } else {
        const owner = accountOwners.get(record.accountKey);
        if (owner && owner !== snapshot.taskId) throw new WorkflowError('account_busy', '此账号已有感兴趣岗位投递任务');
        accountOwners.set(record.accountKey, snapshot.taskId);
        candidates = record.queueJobIds.map((jobId) => {
          const row = snapshot.recipients!.find((item) => item.jobId === jobId);
          if (!row) throw new WorkflowError('checkpoint_missing', '投递名单检查点丢失，不能继续');
          return row;
        });
      }
      if (request.dryRun) {
        for (const row of candidates.slice(0, request.maxRecipients)) { row.status = 'preview'; snapshot.progress.previewed++; }
        snapshot.status = 'completed';
        return;
      }
      candidates = candidates.filter((row) => row.status !== 'skipped' && row.status !== 'completed');
      if (!candidates.length || snapshot.progress.completed >= request.maxRecipients) { snapshot.status = 'completed'; return; }
      snapshot.phase = 'preparing';
      await save(record);
      const loader = options.loadAttachment ?? createMcpAttachmentLoader();
      const downloaded = await loader(request.serverName, request.attachmentId, signal);
      signal.throwIfAborted();
      const attachment = attachmentMetadataSchema.parse(downloaded.attachment);
      if (attachment.id !== 'resume-image' || !['image/png', 'image/jpeg'].includes(attachment.mimeType)) {
        throw new WorkflowError('invalid_resume_image', 'MCP 返回的附件不是指定简历图片');
      }
      if (snapshot.attachment && snapshot.attachment.sha256 !== attachment.sha256) {
        throw new WorkflowError('attachment_changed', '简历图片已变化；本任务只能继续使用启动时固定的版本');
      }
      snapshot.attachment = attachment;
      const base64 = btoa(Array.from(downloaded.bytes, (byte) => String.fromCharCode(byte)).join(''));
      await save(record);
      if (resumingRun && !candidates[0]?.openingAttempted) {
        bind(record, await operations.returnFavorites(context(record), record.sourcePageKey), true);
      }
      for (const row of candidates) {
        signal.throwIfAborted();
        if (snapshot.progress.completed >= request.maxRecipients) break;
        record.currentJobId = row.jobId;
        if (!row.textConfirmed || !row.imageConfirmed) {
          snapshot.phase = row.phase = 'opening';
          const resuming = row.openingAttempted;
          if (resuming) {
            if (!operations.reopenChat) throw new WorkflowError('recovery_unavailable', '当前适配器不能重新核对已有会话，请跳过或暂停');
            assertChat(record, row, await operations.reopenChat(row, context(record)), true);
          } else {
            row.openingAttempted = true;
            await journal(record, row);
            const opened = await operations.openChat(row, context(record));
            signal.throwIfAborted();
            assertChat(record, row, opened, true);
            if (opened.existingOutgoing) throw new WorkflowError('unexpected_existing_messages', '会话已有本人消息，不能作为首次沟通自动发送');
          }
          if ((row.textAttempted && !row.textConfirmed) || (row.imageAttempted && !row.imageConfirmed)) {
            if (!operations.verifyDelivery) throw new WorkflowError('delivery_unconfirmed', '曾尝试发送的消息尚未确认，请跳过或暂停；不会重复发送');
            const verified = await operations.verifyDelivery(row, { greeting: request.greeting, attachment,
              textAttempted: Boolean(row.textAttempted), imageAttempted: Boolean(row.imageAttempted) }, context(record));
            bind(record, verified);
            for (const kind of ['text', 'image'] as const) {
              if (!row[`${kind}Attempted`] || row[`${kind}Confirmed`]) continue;
              snapshot.phase = row.phase = kind;
              receipt(record, row, { ...verified, verified: verified[kind].confirmed, receiptId: verified[kind].receiptId }, kind);
              row[`${kind}Confirmed`] = true;
              row[`${kind}ReceiptId`] = verified[kind].receiptId;
            }
            await journal(record, row);
          }
        }
        if (!row.textConfirmed) {
        assertChat(record, row, await operations.readChat(row, context(record)));
        snapshot.phase = row.phase = 'text';
        row.textAttempted = true;
        await journal(record, row);
        const text = await operations.sendText(row, request.greeting, context(record));
        receipt(record, row, text, 'text');
        row.textConfirmed = true;
        row.textReceiptId = text.receiptId;
        await journal(record, row);
        }
        if (!row.imageConfirmed) {
        assertChat(record, row, await operations.readChat(row, context(record)));
        snapshot.phase = row.phase = 'image';
        row.imageAttempted = true;
        await journal(record, row);
        const image = await operations.sendImage(row, { attachment, base64 }, context(record));
        receipt(record, row, image, 'image');
        row.imageConfirmed = true;
        row.imageReceiptId = image.receiptId;
        await journal(record, row);
        }
        snapshot.phase = row.phase = 'returning';
        await save(record);
        const returned = await operations.returnFavorites(context(record), record.sourcePageKey);
        signal.throwIfAborted();
        bind(record, returned, true);
        if (request.targetJobId && (returned.pageKey !== record.sourcePageKey
          || !returned.rows.some((item) => item.jobId === row.jobId && item.bossKey === row.bossKey))) {
          throw new WorkflowError('target_moved', '返回原收藏页后目标岗位或招聘者未匹配，已发送内容不会重发');
        }
        snapshot.phase = row.phase = 'removing';
        row.unfavoriteAttempted = true;
        await journal(record, row);
        const removed = await operations.removeFavorite(row, context(record));
        bind(record, removed, true);
        if (!removed.removed || removed.jobId !== row.jobId) throw new WorkflowError('unfavorite_unconfirmed', '取消感兴趣未确认，已发送内容不会重发');
        row.unfavoriteConfirmed = true;
        row.status = 'completed';
        snapshot.progress.completed++;
        if (!request.targetJobId) snapshot.phase = row.phase = 'cooldown';
        await journal(record, row);
        if (!request.targetJobId) await sleep(1_000, signal);
        record.currentJobId = undefined;
      }
      signal.throwIfAborted();
      snapshot.status = 'completed';
    } catch (error) {
      if (signal.aborted) {
        snapshot.status = 'stopped';
        snapshot.error = '任务已停止；进行中的步骤保留记录，不会自动重发';
        const row = snapshot.recipients!.find((item) => item.jobId === record.currentJobId);
        if (row && row.status !== 'completed') row.status = 'uncertain';
      } else setException(record, error);
    } finally {
      if (snapshot.status === 'completed' || snapshot.status === 'stopped') snapshot.phase = 'finished';
      try { await save(record); }
      catch (error) { setException(record, new WorkflowError('persistence_failed', `无法保存任务进度：${error instanceof Error ? error.message : String(error)}`)); }
      if (accountOwners.get(record.accountKey) === snapshot.taskId) accountOwners.delete(record.accountKey);
      active.delete(record.tabId);
      releaseBossTaskTab(record.tabId, record.token);
      endBusyKeepAlive();
      if (!signal.aborted) await reviewException(record, () => save(record));
    }
  }

  return {
    isRunning: (tabId: number) => active.has(tabId),
    async start(tabId: number, input: BossStartFavoritesTaskRequest, executionOwner: BossFavoritesExecutionOwner = 'pagent'): Promise<BossFavoritesTaskSnapshot> {
      const request = bossStartFavoritesTaskSchema.parse(input);
      const token = reserveBossTaskTab(tabId);
      const now = Date.now();
      const record: ActiveTask = { tabId, accountKey: '', documentId: '', request, token, abort: new AbortController(), writes: Promise.resolve(), snapshot: {
        taskId: `boss_favorites_${crypto.randomUUID().replaceAll('-', '')}`, status: 'running', phase: 'scanning', createdAt: now, updatedAt: now,
        executionOwner,
        maxRecipients: request.maxRecipients, dryRun: request.dryRun, greeting: request.greeting,
        progress: { discovered: 0, planned: 0, completed: 0, skipped: 0, previewed: 0 }, recipients: [], skippedCards: [],
      } };
      active.set(tabId, record);
      try {
        await save(record);
        await idbSet('meta', latestKey(tabId), record.snapshot.taskId);
        latest.set(tabId, record);
        beginBusyKeepAlive();
        void execute(record, request).catch(() => {});
        return view(record);
      } catch (error) {
        active.delete(tabId);
        releaseBossTaskTab(tabId, token);
        throw error;
      }
    },
    async get(tabId: number, request: BossGetFavoritesTaskRequest, suppressReview = false): Promise<BossFavoritesTaskSnapshot | null> {
      const live = latest.get(tabId);
      if (live && (!request.taskId || live.snapshot.taskId === request.taskId)) return view(live, request.includeRecipients);
      const id = request.taskId ?? await idbGet<string>('meta', latestKey(tabId));
      if (!id) return null;
      const cached = restored.get(id);
      if (cached) return cached.tabId === tabId ? view(cached, request.includeRecipients) : null;
      const stored = await idbGet<StoredTask>('meta', taskKey(id));
      if (!stored || stored.tabId !== tabId) return null;
      const current = latest.get(tabId);
      if (current?.snapshot.taskId === id) return view(current, request.includeRecipients);
      const recovered = restored.get(id);
      if (recovered) return view(recovered, request.includeRecipients);
      restored.set(id, stored);
      if (stored.snapshot.status === 'running' || stored.snapshot.status === 'stopping') {
        if (suppressReview) {
          stored.snapshot.status = 'stopped';
          stored.snapshot.phase = 'finished';
          stored.snapshot.error = '后台已重启；已停止任务，不恢复发送或启动 AI 诊断，进行中的步骤须人工核验';
          const row = stored.snapshot.recipients?.find((item) => item.jobId === stored.currentJobId);
          if (row && row.status !== 'completed') row.status = 'uncertain';
        } else setException(stored, new WorkflowError('background_interrupted', '后台已重启，任务不会自动恢复；进行中的消息须核验，不能自动重发'));
        stored.snapshot.updatedAt = Date.now();
        await idbSet('meta', taskKey(id), stored);
      }
      if (stored.snapshot.exception?.review?.status === 'running') {
        stored.snapshot.exception.review = { ...stored.snapshot.exception.review, status: 'failed', completedAt: Date.now(),
          error: '浏览器后台中断了上次 AI 诊断，未自动重试' };
        await idbSet('meta', taskKey(id), stored);
      }
      if (stored.snapshot.exception?.handoff?.status === 'running' || stored.snapshot.exception?.handoff?.status === 'queued') {
        stored.snapshot.exception.handoff = { ...stored.snapshot.exception.handoff, status: 'failed', completedAt: Date.now(),
          error: '后台重启中断了上次 Pagent 异常会话；未自动重开或恢复发送' };
        await saveStored(stored);
      }
      // Restoring a report must not implicitly start an Agent that could resume delivery.
      return view(stored, request.includeRecipients);
    },
    async inspect(tabId: number, request: BossFavoritesExceptionTaskRequest, owner: BossFavoritesExecutionOwner = 'pagent'): Promise<unknown> {
      const record = await exceptionRecord(tabId, request, owner);
      if (!operations.inspect) throw new Error('当前适配器未提供异常页面观察能力');
      const target = record.snapshot.recipients?.find((row) => row.jobId === record.currentJobId);
      return operations.inspect(target, { tabId, accountKey: record.accountKey, documentId: record.documentId,
        signal: new AbortController().signal });
    },
    async resolve(tabId: number, input: BossResolveFavoritesTaskRequest, owner: BossFavoritesExecutionOwner = 'pagent'): Promise<BossFavoritesTaskSnapshot> {
      const request = bossResolveFavoritesTaskSchema.parse(input);
      const record = await exceptionRecord(tabId, request, owner);
      const exception = record.snapshot.exception!;
      if (exception.resolution) {
        if (exception.resolution.action === request.action && exception.resolution.reason === request.reason) return view(record);
        throw new Error('此异常已有处理决定，不能重复更改');
      }
      if (request.action === 'skip' && !record.currentJobId) throw new Error('当前是全局异常，没有可跳过的岗位；请选择继续或暂停');
      if (request.action === 'continue' && record.snapshot.exceptionHistory?.some((previous) =>
        previous.resolution?.action === 'continue' && previous.resolution.appliedAt !== undefined
        && previous.jobId === exception.jobId && previous.phase === exception.phase && previous.code === exception.code
        && previous.textConfirmed === exception.textConfirmed && previous.imageConfirmed === exception.imageConfirmed
        && previous.unfavoriteConfirmed === exception.unfavoriteConfirmed)) {
        throw new Error('同一步继续后仍未推进，请 skip 当前岗位或 pause；不会重复发送或重新启动异常会话');
      }
      exception.resolution = { action: request.action, reason: request.reason, decidedAt: Date.now() };
      await saveStored(record);
      return view(record);
    },
    async applyDecision(tabId: number, request: BossFavoritesExceptionTaskRequest, guard: () => void = () => {}, owner: BossFavoritesExecutionOwner = 'pagent'): Promise<BossFavoritesTaskSnapshot> {
      const stored = await findRecord(tabId, request.taskId);
      assertOwner(stored, owner);
      const alreadyApplied = [...(stored.snapshot.exceptionHistory ?? []), ...(stored.snapshot.exception ? [stored.snapshot.exception] : [])]
        .find((exception) => exception.id === request.exceptionId && exception.resolution?.appliedAt);
      if (alreadyApplied) return view(stored);
      const record = await exceptionRecord(tabId, request, owner);
      // Stage changes separately so a failed persistence write cannot mark a decision applied in memory.
      const next = copyStored(record);
      const exception = next.snapshot.exception!;
      const decision = exception.resolution;
      if (!decision) throw new Error('Pagent 尚未提交继续、跳过或暂停决定');
      if (cancellationRequests.has(request.taskId)) throw new Error('异常已过期：用户已停止此任务');
      if (decision.action === 'pause') {
        guard();
        decision.appliedAt = Date.now(); next.snapshot.status = 'stopped';
        next.snapshot.error = `Pagent 已暂停：${decision.reason}`;
        await saveStored(next);
        latest.set(tabId, next); restored.set(next.snapshot.taskId, next);
        return view(next);
      }
      if (!record.request) throw new Error('旧任务没有冻结的配置检查点，不能恢复；请暂停后重新建立任务');
      // No await between the controller's final busy check and claiming the mechanical task lease.
      guard();
      const token = reserveBossTaskTab(tabId);
      const resumed: ActiveTask = { ...next, token, abort: new AbortController(), writes: Promise.resolve() };
      active.set(tabId, resumed);
      try {
        decision.appliedAt = Date.now();
        if (decision.action === 'skip') {
          const row = resumed.snapshot.recipients?.find((item) => item.jobId === resumed.currentJobId);
          if (!row || row.status === 'completed') throw new Error('当前岗位不存在或已完成，不能跳过');
          row.status = 'skipped'; row.reason = `Pagent 决定跳过，保留收藏：${decision.reason}`;
          resumed.snapshot.progress.skipped++;
          resumed.skippedJobIds = [...new Set([...(resumed.skippedJobIds ?? []), row.jobId])];
          // Keep the original uncertain delivery ledger. Skipping never declares an attempted send absent.
          resumed.currentJobId = undefined;
        } else {
          const row = resumed.snapshot.recipients?.find((item) => item.jobId === resumed.currentJobId);
          if (row) row.allowIncomingReply = true;
        }
        (resumed.snapshot.exceptionHistory ??= []).push(structuredClone(exception));
        delete resumed.snapshot.exception; delete resumed.snapshot.error;
        resumed.snapshot.status = 'running';
        await save(resumed);
        latest.set(tabId, resumed); restored.delete(resumed.snapshot.taskId);
        beginBusyKeepAlive();
        void execute(resumed, resumed.request!, true).catch(() => {});
        return view(resumed);
      } catch (error) {
        active.delete(tabId); releaseBossTaskTab(tabId, token);
        throw error;
      }
    },
    async cancel(tabId: number, request: BossCancelFavoritesTaskRequest): Promise<BossFavoritesTaskSnapshot> {
      // Record intent before any read yields: a staged resume must not win this race.
      cancellationRequests.add(request.taskId);
      const stopActive = async (record: ActiveTask) => {
        record.snapshot.status = 'stopping';
        record.abort.abort();
        await save(record);
        return view(record);
      };
      let record = active.get(tabId);
      if (record?.snapshot.taskId === request.taskId) return stopActive(record);
      const snapshot = await this.get(tabId, { taskId: request.taskId, includeRecipients: false }, true);
      record = active.get(tabId);
      if (record?.snapshot.taskId === request.taskId) return stopActive(record);
      if (!snapshot) throw new Error('未找到此页面的感兴趣岗位投递任务');
      const stored = await findRecord(tabId, request.taskId);
      record = active.get(tabId);
      if (record?.snapshot.taskId === request.taskId) return stopActive(record);
      if (stored.snapshot.status === 'needs_attention') {
        stored.snapshot.status = 'stopped';
        stored.snapshot.error = '用户已停止任务；待处理的 Pagent 决定失效，不会恢复发送';
        await saveStored(stored);
      }
      return view(stored);
    },
  };
}
