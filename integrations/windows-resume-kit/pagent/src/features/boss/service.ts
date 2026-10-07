import type { BossAuditResumeImagesRequest, BossAuditResumeImagesResult, BossGetResumeImageScanRequest, BossGetResumeImageScanResult, BossResumeRecipient, BossSendResumeImagesRequest, BossSendResumeImagesResult } from '@/shared/contracts/boss';
import { attachmentMetadataSchema } from '@/shared/contracts/attachments';
import { idbGet, idbSet } from '@/shared/storage/idb';
import { downloadMcpAttachment } from '@/features/mcp/background/mcp-manager';
import type { BossPageState, BossListRow } from './content-adapter';
import { captureBossHistory } from './network-capture';
import { runBossSendQueue } from './send-queue';
import { classifyBossReceiptView } from './send-receipt';
import { isBossHistoryComplete } from './history-evidence';

export type BossContent = <T>(tabId: number, name: string, payload?: unknown, signal?: AbortSignal) => Promise<T>;
type Content = BossContent;
export type BossExecution = {
  taskToken?: symbol;
  expectedIdentity?: Pick<BossPageState, 'accountKey' | 'documentId'>;
  loadAttachment?: typeof downloadMcpAttachment;
  onAudit?: (result: BossAuditResumeImagesResult) => Promise<void>;
  onDelivery?: (result: BossSendResumeImagesResult['recipients'][number]) => Promise<void>;
};
type RecordEntry = BossListRow & { result?: BossResumeRecipient; identity?: string };
type Scan = {
  id: string; tabId: number; documentId: string; accountKey: string; createdAt: number;
  rows: Map<string, RecordEntry>; index: number; listComplete: boolean;
  cursor?: string; attachmentSha?: string; since?: string;
  stopReason?: 'list_end' | 'time_cutoff';
  orderUncertain: boolean; previousActivity?: BossListRow['lastActivity'];
  planned: Set<string>;
};
const scans = new Map<string, Scan>();
const busyTabs = new Set<number>();
const taskOwners = new Map<number, symbol>();

export function reserveBossTaskTab(tabId: number): symbol {
  if (busyTabs.has(tabId) || taskOwners.has(tabId)) throw new Error('此页面已有 BOSS 操作正在执行');
  const token = Symbol('boss-task');
  taskOwners.set(tabId, token);
  return token;
}

export function releaseBossTaskTab(tabId: number, token: symbol) {
  if (taskOwners.get(tabId) === token) taskOwners.delete(tabId);
}
const TTL = 30 * 60_000;
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal?.throwIfAborted();
  const end = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); };
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
  const timer = setTimeout(end, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

class ScanIdentityChangedError extends Error {}

function checkTaskIdentity(state: Pick<BossPageState, 'accountKey' | 'documentId'>, execution: BossExecution) {
  if (execution.expectedIdentity && (state.accountKey !== execution.expectedIdentity.accountKey
    || state.documentId !== execution.expectedIdentity.documentId)) {
    throw new ScanIdentityChangedError('后台任务启动后页面或登录账号已变化，已停止任务');
  }
}

function checkScanIdentity(scan: Scan, state: BossPageState) {
  if (state.accountKey !== scan.accountKey) throw new ScanIdentityChangedError('当前登录账号标识已变化，原扫描不能用于当前账号；请确认账号后重新查漏');
  if (state.documentId !== scan.documentId) throw new ScanIdentityChangedError('聊天页面标识已变化，原扫描不能用于发送；继续原任务可按原时间范围重新只读查漏');
}

function checkScanPage(scan: Scan, state: BossPageState) {
  checkScanIdentity(scan, state);
  if (!state.filterActive) throw new Error('仅沟通筛选已变化，请恢复后继续；已有查漏结果保留');
}

async function ensureScanFilter(scan: Scan, content: Content, signal?: AbortSignal): Promise<BossPageState> {
  let state = await content<BossPageState>(scan.tabId, 'boss.state', {}, signal);
  checkScanIdentity(scan, state);
  if (!state.filterActive) state = await content<BossPageState>(scan.tabId, 'boss.filter', {}, signal);
  checkScanPage(scan, state);
  return state;
}

function scanSummary(scan: Scan): Omit<BossAuditResumeImagesResult, 'recipients' | 'nextCursor'> {
  const progress = { discovered: scan.rows.size, checked: scan.index, sent: 0, notFound: 0, uncertain: 0, outOfScope: 0 };
  for (const row of scan.rows.values()) {
    if (row.result?.status === 'sent') progress.sent++;
    else if (row.result?.status === 'not_found') progress.notFound++;
    else if (row.result?.status === 'uncertain') progress.uncertain++;
    else if (row.result?.status === 'out_of_scope') progress.outOfScope++;
  }
  return { scanId: scan.id, since: scan.since, listComplete: scan.listComplete, stopReason: scan.stopReason,
    complete: Boolean(scan.stopReason) && scan.index === scan.rows.size, progress };
}

const needsAttention = (result: BossResumeRecipient) => result.status === 'not_found' || result.status === 'uncertain';

function discoverRows(scan: Scan, state: BossPageState) {
  const cutoff = scan.since ? Date.parse(scan.since) : undefined;
  const older = (row: BossListRow) => cutoff !== undefined && row.lastActivity !== undefined
    && row.lastActivity.upperExclusive <= cutoff;
  if (state.listOrder !== 'recent-first') scan.orderUncertain = true;
  // Check the whole visible window before accepting a cutoff; pinned rows have a separate order.
  let previous = scan.previousActivity;
  for (const row of state.rows) {
    if (row.pinned === true) continue;
    if (row.pinned !== false) scan.orderUncertain = true;
    if (scan.rows.has(row.key)) continue;
    if (row.lastActivity && previous && row.lastActivity.lowerInclusive >= previous.upperExclusive) scan.orderUncertain = true;
    if (row.lastActivity) previous = row.lastActivity;
  }
  scan.previousActivity = previous;
  for (let index = 0; index < state.rows.length; index++) {
    const row = state.rows[index]!;
    const existing = scan.rows.get(row.key);
    if (existing?.result?.status === 'out_of_scope' && !older(row)) {
      // A new message may move an old row during discovery. Recheck it rather than keep a stale skip.
      existing.result = undefined;
      existing.lastActivity = row.lastActivity;
      existing.pinned = row.pinned;
      scan.orderUncertain = true;
    }
    if (!existing) {
      const entry: RecordEntry = { ...row };
      if (older(row)) entry.result = {
        recipientId: uid('recipient'), name: row.name, company: row.company,
        status: 'out_of_scope', historyComplete: false,
        reason: '列表最近活动时间早于指定时间，无需打开聊天', evidenceSummary: `范围起点 ${scan.since}；按列表时间跳过`,
      };
      scan.rows.set(row.key, entry);
    }
    if (!scan.orderUncertain && row.pinned === false && older(row)
      && state.rows.slice(index).every((remaining) => remaining.pinned === false && older(remaining))) {
      scan.stopReason = 'time_cutoff';
      return;
    }
  }
  if (state.listComplete) {
    scan.listComplete = true;
    scan.stopReason = 'list_end';
  }
}

async function exclusive<T>(tabId: number, action: () => Promise<T>, token?: symbol): Promise<T> {
  if (taskOwners.has(tabId) && taskOwners.get(tabId) !== token) throw new Error('此页面的 BOSS 后台任务正在执行，请先停止该任务');
  if (busyTabs.has(tabId)) throw new Error('此页面正在查漏或发送，请等待当前操作结束');
  busyTabs.add(tabId);
  try { return await action(); } finally { busyTabs.delete(tabId); }
}

async function inspectRecipient(scan: Scan, row: RecordEntry, content: Content, signal?: AbortSignal): Promise<BossResumeRecipient> {
  const base = { recipientId: row.result?.recipientId ?? uid('recipient'), name: row.name, company: row.company };
  const uncertain = (reason: string): BossResumeRecipient => ({ ...base, status: 'uncertain', historyComplete: false, reason, evidenceSummary: '未获得足够证据；不会进入自动补发名单' });
  let capture: Awaited<ReturnType<typeof captureBossHistory>> | undefined;
  try {
    // Switching away first forces BOSS to load a fresh, identifiable history request.
    let state = await ensureScanFilter(scan, content, signal);
    capture = await captureBossHistory(scan.tabId);
    if (state.selectedKey === row.key) {
      const alternatives = [...scan.rows.values()].filter((entry) => entry.key !== row.key);
      // Prefer another candidate; a sole candidate may need one switch through the boundary row
      // to trigger a fresh history response. That row's history is not inspected or returned.
      const other = alternatives.find((entry) => entry.result?.status !== 'out_of_scope') ?? alternatives[0];
      if (other) await content(scan.tabId, 'boss.select', { key: other.key }, signal);
    }
    capture.evidence.length = 0;
    await content(scan.tabId, 'boss.select', { key: row.key }, signal);
    const messages = new Map<string, BossPageState['messages'][number]>();
    let identity: string | undefined;
    let historyComplete = false;
    let unstableReads = 0;
    for (let attempt = 0; attempt < 18; attempt++) {
      await delay(350, signal);
      await capture.refresh();
      state = await content<BossPageState>(scan.tabId, 'boss.state', {}, signal);
      checkScanIdentity(scan, state);
      if (!state.filterActive || state.selectedKey !== row.key || state.headerName !== row.name) {
        // Virtual list rows can briefly disappear on incoming messages. Never read the wrong
        // conversation, but allow the same row to settle without discarding the scan.
        if (++unstableReads >= 3) return uncertain('当前联系人暂时无法定位，保留其他查漏结果并继续；此人留待复查');
        continue;
      }
      unstableReads = 0;
      for (const message of state.messages) messages.set(message.id, message);
      const visibleIds = new Set(messages.keys());
      const relevant = capture.evidence.filter((item) => item.messageIds.some((id) => visibleIds.has(id)));
      const identityOf = (item: typeof relevant[number]) => JSON.stringify([item.contactId, item.groupId, item.source ?? '']);
      const identities = new Set(relevant.map(identityOf));
      if (identities.size > 1) return uncertain('多个会话加载结果混杂，身份无法确定');
      identity = [...identities][0];
      if (identity && row.identity && row.identity !== identity) return uncertain('会话身份与查漏结果不一致');
      if (identity && !state.loading && !capture.failed) {
        historyComplete = isBossHistoryComplete(capture.evidence.filter((item) => identityOf(item) === identity), visibleIds);
      }
      // Positive evidence is sufficient to skip; only potential candidates require all history.
      if (identity && !state.loading && !capture.failed && [...messages.values()].some((message) =>
        message.incomingReply === true || message.outgoing && message.imageUrl && message.delivered)) break;
      if (historyComplete) break;
      if (!state.loading && attempt % 3 === 2) await content(scan.tabId, 'boss.historyTop', {}, signal);
    }
    if (!identity) return uncertain('没有获得与当前会话消息匹配的历史加载身份');
    row.identity = identity;
    if ([...messages.values()].some((message) => message.incomingReply === true)) {
      return { ...base, status: 'out_of_scope', historyComplete, reason: '对方已有回复，不属于未回复会话', evidenceSummary: '发现对方历史消息；系统通知不计为回复，跳过此联系人' };
    }
    const ownImages = [...messages.values()].filter((message) => message.outgoing && message.imageUrl);
    if (ownImages.some((message) => message.delivered)) {
      return { ...base, status: 'sent', historyComplete, reason: '发现本人已发送的图片，按约定视为简历图片', evidenceSummary: `本人图片消息及发送回执；检查了 ${messages.size} 条消息` };
    }
    if (scan.since) {
      const times = new Map<string, number>();
      const conflictingTimes = new Set<string>();
      for (const page of capture.evidence) {
        if (JSON.stringify([page.contactId, page.groupId, page.source ?? '']) === identity) {
          for (const [id, time] of Object.entries(page.messageTimes ?? {})) {
            if (times.has(id) && times.get(id) !== time) conflictingTimes.add(id);
            times.set(id, time);
          }
        }
      }
      for (const id of conflictingTimes) times.delete(id);
      const ownMessages = [...messages.values()].filter((message) => message.outgoing && message.delivered);
      if (!ownMessages.some((message) => (times.get(message.id) ?? -Infinity) >= Date.parse(scan.since!))) {
        if (!historyComplete || ownMessages.some((message) => !times.has(message.id))) {
          return uncertain('无法确认本人发消息的时间是否在指定范围内');
        }
        return { ...base, status: 'out_of_scope', historyComplete, reason: '指定时间起没有本人已发送的消息', evidenceSummary: `范围起点 ${scan.since}；跳过此联系人` };
      }
    }
    if (!historyComplete) return uncertain('聊天历史未确认完整，不能认定未发过');
    if (ownImages.length) return { ...uncertain('存在本人图片，但发送回执尚未确认'), historyComplete: true };
    if ([...messages.values()].some((message) => !message.outgoing && message.incomingReply !== false)) {
      return { ...uncertain('存在无法区分对方回复与系统通知的消息'), historyComplete: true };
    }
    return { ...base, status: 'not_found', historyComplete: true, reason: '历史加载已到末页，对方尚未回复且未发现本人发送的图片', evidenceSummary: `完整回读 ${messages.size} 条消息；未发现对方回复或本人图片` };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ScanIdentityChangedError) throw error;
    return uncertain(error instanceof Error ? error.message : '会话检查失败');
  } finally { capture?.close(); }
}

export function createBossService(content: Content) {
  return {
    getResumeImageScan: (tabId: number, request: BossGetResumeImageScanRequest, signal?: AbortSignal, execution: BossExecution = {}) => exclusive(tabId, async (): Promise<BossGetResumeImageScanResult> => {
      const scan = request.scanId ? scans.get(request.scanId)
        : [...scans.values()].reverse().find((entry) => entry.tabId === tabId);
      if (!scan || scan.tabId !== tabId) throw new Error('没有当前标签页的有效查漏结果（尚未扫描、记录丢失或后台已重启）；继续原任务可按原时间范围重新只读查漏');
      checkTaskIdentity(scan, execution);
      // Read only the current page identity; never select a chat, scroll, or load history.
      checkScanIdentity(scan, await content<BossPageState>(tabId, 'boss.state', {}, signal));
      if (Date.now() - scan.createdAt > TTL) throw new Error('当前查漏结果已过期（超过 30 分钟）；继续原任务可按原时间范围重新只读查漏');
      const rows = [...scan.rows.values()].flatMap((row) => row.result ? [{ ...row.result }] : []);
      // Keep offsets in the underlying result list, so a send-time reclassification cannot shift a page.
      const recipients: BossResumeRecipient[] = [];
      let end = request.offset;
      while (end < rows.length && recipients.length < request.limit) {
        const row = rows[end++]!;
        if (needsAttention(row)) recipients.push(row);
      }
      return { ...scanSummary(scan), createdAt: scan.createdAt, expiresAt: scan.createdAt + TTL,
        offset: request.offset, nextOffset: end < rows.length ? end : undefined,
        nextCursor: scan.cursor, recipients };
    }, execution.taskToken),
    auditResumeImages: (tabId: number, request: BossAuditResumeImagesRequest, signal?: AbortSignal, execution: BossExecution = {}) => exclusive(tabId, async (): Promise<BossAuditResumeImagesResult> => {
      for (const [id, scan] of scans) if (Date.now() - scan.createdAt > TTL) scans.delete(id);
      let scan: Scan | undefined;
      if (request.cursor) {
        scan = [...scans.values()].find((entry) => entry.cursor === request.cursor && entry.tabId === tabId);
        if (!scan) throw new Error('查漏游标不可用，请先读取已有查漏结果，使用返回的最新 nextCursor 继续');
        checkTaskIdentity(scan, execution);
        if (request.since && request.since !== scan.since) throw new Error('续页不能改变时间条件，请开始新的查漏');
        await ensureScanFilter(scan, content, signal);
        // An interrupted initial scroll must not let an older viewport become the cutoff.
        if (scan.rows.size === 0 && !scan.stopReason) await content(tabId, 'boss.listScroll', { direction: 'top' }, signal);
      } else {
        const state = await content<BossPageState>(tabId, 'boss.filter', {}, signal);
        checkTaskIdentity(state, execution);
        if (!state.filterActive || !state.accountKey) throw new Error('未识别登录账号或仅沟通筛选');
        scan = { id: uid('scan'), tabId, documentId: state.documentId, accountKey: state.accountKey, createdAt: Date.now(), rows: new Map(), index: 0, listComplete: false, since: request.since, orderUncertain: false, planned: new Set(), cursor: uid('cursor') };
        scans.set(scan.id, scan);
        await content(tabId, 'boss.listScroll', { direction: 'top' }, signal);
      }
      const recipients: BossResumeRecipient[] = [];
      // List discovery has its own cursor pages: a virtualized viewport is never treated as the whole list.
      if (!scan.stopReason) {
        for (let step = 0; step < 25; step++) {
          const state = await ensureScanFilter(scan, content, signal);
          discoverRows(scan, state);
          if (scan.stopReason) break;
          if (scan.rows.size >= 2_000) throw new Error('本次列表超过 2000 人，请缩小范围后再查漏');
          await content(tabId, 'boss.listScroll', { direction: 'next' }, signal);
        }
      }
      if (scan.stopReason) {
        const batch = [...scan.rows.values()].slice(scan.index);
        let inspected = 0;
        for (const row of batch) {
          if (!row.result) {
            if (inspected >= request.limit) break;
            row.result = await inspectRecipient(scan, row, content, signal);
            inspected++;
          }
          if (needsAttention(row.result)) recipients.push(row.result);
          scan.index++;
          await execution.onAudit?.({ ...scanSummary(scan), recipients: [{ ...row.result }] });
        }
      }
      const result = { ...scanSummary(scan), recipients };
      scan.cursor = result.complete ? undefined : uid('cursor');
      return { ...result, nextCursor: scan.cursor };
    }, execution.taskToken),
    sendResumeImages: (tabId: number, request: BossSendResumeImagesRequest, signal?: AbortSignal, execution: BossExecution = {}) => exclusive(tabId, async (): Promise<BossSendResumeImagesResult> => {
      const scan = scans.get(request.scanId);
      if (!scan || scan.tabId !== tabId || Date.now() - scan.createdAt > TTL || !scanSummary(scan).complete) throw new Error('需要当前页面 30 分钟内完成的指定范围完整查漏结果');
      checkTaskIdentity(scan, execution);
      checkScanPage(scan, await content<BossPageState>(tabId, 'boss.state', {}, signal));
      const rows = request.recipientIds.map((id) => {
        const row = [...scan.rows.values()].find((item) => item.result?.recipientId === id);
        if (!row) throw new Error('收件人不在本次查漏结果中');
        return row;
      });
      const { attachment, bytes } = await (execution.loadAttachment ?? downloadMcpAttachment)(request.serverName, request.attachmentId, signal);
      if (scan.attachmentSha && attachment.sha256 !== scan.attachmentSha) throw new Error('简历图片版本已改变，请重新查漏');
      const result: BossSendResumeImagesResult = { scanId: scan.id, dryRun: request.dryRun, complete: true, recipients: [] };
      const candidates: RecordEntry[] = [];
      for (const row of rows) {
        const pendingAttempt = row.result?.status === 'uncertain' && scan.planned.has(row.result.recipientId);
        if (!row.identity || !pendingAttempt && (row.result?.status !== 'not_found' || !row.result.historyComplete)) {
          result.recipients.push({ recipientId: row.result!.recipientId, status: 'skipped', reason: '仅完整历史中明确未发现的候选可补发' });
        } else candidates.push(row);
      }
      if (request.dryRun) {
        scan.attachmentSha = attachment.sha256;
        for (const row of candidates) {
          scan.planned.add(row.result!.recipientId);
          result.recipients.push({ recipientId: row.result!.recipientId, status: 'planned', reason: row.result!.status === 'uncertain'
            ? '仅预览只读复核计划；上次结果待确认，不会再次上传图片'
            : '仅预览；实际发送前再次检查；串行且每张间隔至少 2 秒' });
        }
        return result;
      }
      if (candidates.some((row) => !scan.planned.has(row.result!.recipientId))) throw new Error('这些收件人尚未执行发送 dry run');
      const chunks: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 32_768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
      const base64 = btoa(chunks.join(''));
      const queue = await runBossSendQueue({ recipientIds: candidates.map((row) => row.result!.recipientId), signal,
        onResult: execution.onDelivery ? (item) => execution.onDelivery!({ recipientId: item.recipientId,
          status: item.status === 'verified' ? 'sent' : item.status === 'skipped' ? 'skipped' : item.status === 'error' ? 'failed' : 'uncertain',
          reason: item.detail ?? item.status }) : undefined,
        send: async (recipientId, queueSignal) => {
        const row = candidates.find((item) => item.result!.recipientId === recipientId)!;
        const reconcileOnly = row.result!.status === 'uncertain';
        const keyBytes = new TextEncoder().encode(`${scan.accountKey}\n${row.identity}\n${attachment.sha256}`);
        const key = 'boss-image-attempt:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
        const previousAttempt = await idbGet<{ at: number; status: string }>('meta', key);
        if (previousAttempt?.status === 'verified') {
          row.result = { ...row.result!, status: 'sent', reason: '已有核验成功的发送记录，本次跳过，不重复发送' };
          return { status: 'skipped', detail: row.result.reason };
        }
        const current = await inspectRecipient(scan, row, content, queueSignal);
        row.result = current;
        if (current.status === 'sent' || current.status === 'out_of_scope') {
          if (previousAttempt && current.status === 'sent') await idbSet('meta', key, { at: previousAttempt.at, status: 'verified' });
          return { status: 'skipped', detail: `发送前复查：${current.reason}；本次未发送` };
        }
        const pending = (reason: string) => {
          row.result = { ...current, status: 'uncertain', reason, evidenceSummary: '发送结果待确认；不会自动重发' };
          return { status: 'unverified' as const, detail: reason };
        };
        if (previousAttempt) return pending('此收件人已有发送尝试记录，只读复核仍未确认图片；禁止自动重发');
        if (reconcileOnly) return pending('此人上次结果待确认，只读复核仍未确认图片；禁止自动重发');
        if (current.status !== 'not_found' || !current.historyComplete) return { status: 'unverified', detail: `发送前复查：${current.reason}` };
        const state = await content<BossPageState>(tabId, 'boss.state', {}, queueSignal);
        checkScanPage(scan, state);
        if (state.selectedKey !== row.key || state.headerName !== row.name || state.loading || !state.uploadTarget) {
          return { status: 'error', detail: '当前会话或图片上传框已变化' };
        }
        const before = new Set(state.messages.map((message) => message.id));
        // Write ahead: a timeout/restart after change must never cause an automatic duplicate send.
        await idbSet('meta', key, { at: Date.now(), status: 'attempted' });
        pending('本次发送已开始，回执尚未确认');
        let viewPending = false;
        try {
          queueSignal.throwIfAborted();
          await content(tabId, 'boss.assign', { key: row.key, documentId: scan.documentId, accountKey: scan.accountKey, attachment: { ...state.uploadTarget, documentId: scan.documentId, attachment: attachmentMetadataSchema.parse(attachment), base64 } }, queueSignal);
          for (let poll = 0; poll < 20; poll++) {
            await delay(500, queueSignal);
            const after = await content<BossPageState>(tabId, 'boss.state', {}, queueSignal);
            checkScanIdentity(scan, after);
            const view = classifyBossReceiptView(after, row, before);
            if (view === 'changed') return pending('发送后当前会话已变更，回执未确认；不自动重发');
            viewPending = view === 'pending';
            if (viewPending) continue;
            for (const message of after.messages) {
              if (!before.has(message.id) && message.outgoing && message.delivered && message.imageUrl) {
                await idbSet('meta', key, { at: Date.now(), status: 'verified' });
                row.result = { ...current, status: 'sent', reason: '本次发送后回读到新图片及发送回执' };
                return { status: 'verified', detail: '页面已出现本人简历图片及发送回执' };
              }
            }
          }
          return pending(viewPending ? '发送后未能确认当前会话身份，回执未确认；不自动重发'
            : '图片已交给网页，但未确认发送回执；已停止，不能自动重试');
        } catch (error) {
          return pending(`发送尝试后回读失败：${error instanceof Error ? error.message : String(error)}；不自动重发`);
        }
      } });
      result.complete = queue.status === 'completed';
      for (const item of queue.results) result.recipients.push({ recipientId: item.recipientId, status: item.status === 'verified' ? 'sent' : item.status === 'skipped' ? 'skipped' : item.status === 'error' ? 'failed' : 'uncertain', reason: item.detail ?? item.status });
      for (const id of queue.remainingRecipientIds) result.recipients.push({ recipientId: id, status: 'skipped', reason: '队列停止，此人未尝试发送' });
      return result;
    }, execution.taskToken),
  };
}
