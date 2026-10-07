import { pageObserver } from '@/features/page/observer';
import { assignAttachment } from '@/features/page/actions/attachments';
import type { AssignAttachmentRequest } from '@/shared/contracts/attachments';
import type { BossFavoriteRow, BossFavoriteTarget, BossFavoritesPage, BossFavoritesSkippedCard } from '@/shared/contracts/boss-favorites';
import { bossState, type BossPageState } from './content-adapter';

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type FavoritesGuard = { accountKey: string; documentId: string };
export type FavoritesTargetRequest = FavoritesGuard & { target: BossFavoriteTarget };
type FavoritesWriteRequest = FavoritesTargetRequest & { allowIncomingReply?: boolean };

function shown(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function hasBlockingDialog(): boolean {
  return Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]'))
    .some((element) => shown(element) && element.getAttribute('aria-hidden') !== 'true');
}

function assertNoBlockingDialog(): void {
  if (hasBlockingDialog()) {
    throw new Error('页面出现对话框，暂停固定流程并交由 AI 判断');
  }
}

function accountKey(): string {
  const header = document.querySelector('#header');
  const source = header?.querySelector<HTMLImageElement>('.nav-figure img')?.getAttribute('src');
  let avatar = '';
  if (source) {
    const url = new URL(source, location.href);
    avatar = `${url.origin}${url.pathname}`;
  }
  const name = clean(header?.querySelector('a[href*="/web/geek/recommend"]')?.textContent);
  if (!avatar && !name) throw new Error('无法确认当前 BOSS 登录账号');
  return JSON.stringify([name, avatar]);
}

function avatarPath(image: HTMLImageElement | null): string {
  const source = image?.getAttribute('src');
  if (!source) return '';
  try {
    const url = new URL(source, location.href);
    return `${url.origin}${url.pathname}`;
  } catch { return ''; }
}

function favoritesPage(): void {
  const url = new URL(location.href);
  if (url.origin !== 'https://www.zhipin.com' || url.pathname !== '/web/geek/recommend'
    || url.searchParams.get('tab') !== '4' || url.searchParams.get('sub') !== '1') {
    throw new Error('当前不是 BOSS 个人中心的感兴趣职位收藏页');
  }
  assertNoBlockingDialog();
}

function disabled(element: HTMLElement): boolean {
  return element.classList.contains('disabled') || element.getAttribute('aria-disabled') === 'true'
    || element.hasAttribute('disabled');
}

function favoriteRows(): { rows: Array<{ element: HTMLElement; row: BossFavoriteRow }>; skippedCards: BossFavoritesSkippedCard[] } {
  const skippedCards: BossFavoritesSkippedCard[] = [];
  const pageKey = clean(document.querySelector('.pager .options-pages a.selected')?.textContent) || '未知';
  const rows = Array.from(document.querySelectorAll<HTMLElement>('li.item-boss'))
    .filter(shown).flatMap((card, index) => {
      const element = card.querySelector<HTMLElement>(':scope > .item-content');
      if (!element || !shown(element)) {
        skippedCards.push({ pageKey, rowIndex: index + 1, reason: '岗位卡片内容结构无法识别；已跳过并保留收藏' });
        return [];
      }
      const link = element.querySelector<HTMLAnchorElement>('.job-info .job-name a.name');
      let url: URL | undefined;
      try { if (link?.getAttribute('href')) url = new URL(link.getAttribute('href')!, location.href); }
      catch { /* A malformed link is an individual skipped card, never a guessed ID. */ }
      const jobId = url?.origin === location.origin ? /^\/job_detail\/([^/]+)\.html$/.exec(url.pathname)?.[1] : undefined;
      const start = element.querySelector<HTMLElement>('.info-header .btns a.btn-startchat');
      const actionId = /^personal_interest_(chat|continue)_(\S+)$/.exec(start?.getAttribute('ka') ?? '');
      // BOSS also stores campus-application cards here. They cannot open a recruiter chat.
      const applyLinks = Array.from(element.querySelectorAll<HTMLAnchorElement>('.info-header .btns a[href]'))
        .filter((anchor) => clean(anchor.textContent) === '立即网申');
      const verifiedApply = !start && applyLinks.length === 1 && (() => {
        try {
          const applyUrl = new URL(applyLinks[0]!.getAttribute('href')!, location.href);
          return applyUrl.origin === 'https://xiaoyuan.zhipin.com' && applyUrl.pathname === '/'
            && !applyUrl.username && !applyUrl.password && applyUrl.searchParams.getAll('encryptJobId').length === 1
            && Boolean(jobId) && applyUrl.searchParams.get('encryptJobId') === jobId;
        } catch { return false; }
      })();
      const cancel = element.querySelector<HTMLElement>('.info-header .btns a.btn-like');
      const cancelId = clean(cancel?.textContent) === '取消感兴趣'
        ? /^personal_interest_cancel_(\S+)$/.exec(cancel?.getAttribute('ka') ?? '') : null;
      const bossKey = actionId?.[2] ?? (verifiedApply ? cancelId?.[1] : undefined);
      const name = element.querySelector('h3.name > span');
      const bossName = clean(name?.textContent);
      const bossRole = clean(element.querySelector('h3.name > span.gray')?.textContent);
      const bossAvatar = avatarPath(element.querySelector<HTMLImageElement>('.info-header .img-box img'));
      const company = clean(element.querySelector('.company-info .text b a[href^="/gongsi/"]')?.textContent);
      const jobTitle = clean(link?.querySelector('.job-name-text')?.textContent);
      const missing = [!jobId && '岗位 ID', !bossName && '招聘者姓名', !bossRole && '招聘者职务',
        !bossAvatar && '招聘者头像', !company && '公司', !jobTitle && '岗位名称',
        !actionId && !verifiedApply && '可核验的沟通或网申入口', !bossKey && '招聘者 ID'].filter(Boolean);
      if (missing.length) {
        skippedCards.push({ pageKey, rowIndex: index + 1, ...(jobId ? { jobId } : {}),
          ...(jobTitle ? { jobTitle } : {}), ...(company ? { company } : {}), reason: `缺少：${missing.join('、')}；已跳过并保留收藏` });
        return [];
      }
      const label = clean(start?.textContent);
      const action: BossFavoriteRow['action'] = verifiedApply ? 'apply' : actionId?.[1] === 'chat' && label === '立即沟通' ? 'start'
        : actionId?.[1] === 'continue' && label === '继续沟通' ? 'continue' : 'unknown';
      // Keep only the public job path, never the securityId query or other ephemeral credentials.
      return [{ element, rowIndex: index + 1, row: { jobId: jobId!, bossKey: bossKey!, bossName, bossRole, bossAvatar, company, jobTitle,
        jobUrl: `${url!.origin}${url!.pathname}`, action } }];
    });
  const counts = new Map<string, number>();
  for (const jobId of [...rows.map(({ row }) => row.jobId), ...skippedCards.map((card) => card.jobId)]) {
    if (jobId) counts.set(jobId, (counts.get(jobId) ?? 0) + 1);
  }
  const unique = rows.filter(({ row, rowIndex }) => {
    if (counts.get(row.jobId) === 1) return true;
    skippedCards.push({ pageKey, rowIndex, jobId: row.jobId, jobTitle: row.jobTitle, company: row.company,
      reason: '岗位 ID 重复，无法唯一定位；已跳过全部重复卡片并保留收藏' });
    return false;
  });
  return { rows: unique, skippedCards: skippedCards.sort((left, right) => left.rowIndex - right.rowIndex) };
}

export function favoritesState(): BossFavoritesPage {
  favoritesPage();
  const parsed = favoriteRows();
  const rows = parsed.rows.map(({ row }) => row);
  if (!rows.length && !parsed.skippedCards.length) throw new Error('收藏列表为空或尚未就绪，无法从当前页面确认列表完成');
  const pager = document.querySelector('.pager .options-pages');
  const selected = pager?.querySelector('a.selected');
  const next = pager?.querySelector('i.ui-icon-arrow-right')?.closest<HTMLElement>('a');
  const pageKey = clean(selected?.textContent);
  if (!/^[1-9]\d*$/.test(pageKey) || !next) throw new Error('无法确认收藏列表分页状态');
  return { accountKey: accountKey(), documentId: pageObserver.documentId, pageKey,
    listComplete: disabled(next), rows, ...(parsed.skippedCards.length ? { skippedCards: parsed.skippedCards } : {}) };
}

function assertGuard(payload: FavoritesGuard): void {
  if (payload.documentId !== pageObserver.documentId || payload.accountKey !== accountKey()) {
    throw new Error('操作前页面或账号已变化，请重新读取当前页面');
  }
}

function findFavorite(payload: FavoritesTargetRequest): { element: HTMLElement; row: BossFavoriteRow } {
  favoritesPage();
  assertGuard(payload);
  const matches = favoriteRows().rows.filter(({ row }) => row.jobId === payload.target.jobId);
  const match = matches[0];
  if (matches.length !== 1 || !match) throw new Error('当前页无法唯一定位目标收藏岗位');
  if (match.row.bossKey !== payload.target.bossKey || match.row.bossName !== payload.target.bossName
    || match.row.company !== payload.target.company || match.row.jobTitle !== payload.target.jobTitle
    || match.row.bossRole !== payload.target.bossRole || match.row.bossAvatar !== payload.target.bossAvatar) {
    throw new Error('收藏岗位或招聘者信息已变化');
  }
  return match;
}

export async function favoritesNext(payload: FavoritesGuard & { pageKey: string }): Promise<BossFavoritesPage> {
  const before = favoritesState();
  const signatureOf = (state: BossFavoritesPage) => JSON.stringify({
    rows: state.rows.map((row) => [row.jobId, row.bossKey, row.action]),
    skipped: state.skippedCards?.map((card) => [card.rowIndex, card.jobId, card.jobTitle, card.company, card.reason]) ?? [],
  });
  const beforeSignature = signatureOf(before);
  assertGuard(payload);
  if (before.pageKey !== payload.pageKey || before.listComplete) throw new Error('收藏分页已变化或已到末页');
  const next = document.querySelector('.pager .options-pages i.ui-icon-arrow-right')?.closest<HTMLElement>('a');
  if (!next || disabled(next)) throw new Error('下一页入口不可用');
  next.click();
  let stable = '';
  for (let attempt = 0; attempt < 60; attempt++) {
    await pause(100);
    favoritesPage();
    if (accountKey() !== payload.accountKey) throw new Error('翻页时账号发生变化');
    let state: BossFavoritesPage;
    try { state = favoritesState(); }
    catch (error) {
      // The expected page transition may briefly unmount the rows or pager. Never retry clicks.
      if (error instanceof Error && /收藏列表为空或尚未就绪|无法确认收藏列表分页状态/.test(error.message)) {
        stable = '';
        continue;
      }
      throw error;
    }
    if (state.accountKey !== payload.accountKey) throw new Error('翻页时账号发生变化');
    const signature = signatureOf(state);
    if (state.pageKey !== before.pageKey && signature !== beforeSignature
      && signature === stable) return state;
    stable = signature;
  }
  throw new Error('无法确认收藏下一页已加载');
}

export function favoritesStart(payload: FavoritesTargetRequest): { clicked: true; jobId: string; bossKey: string } {
  const match = findFavorite(payload);
  const button = match.element.querySelector<HTMLElement>('.info-header .btns a.btn-startchat');
  if (match.row.action !== 'start' || !button || disabled(button)) throw new Error('目标岗位不是可执行的立即沟通状态');
  // Button ka, visible card identity, and click are checked in one synchronous turn.
  button.click();
  return { clicked: true, jobId: match.row.jobId, bossKey: match.row.bossKey };
}

export async function favoritesRemove(payload: FavoritesTargetRequest): Promise<{
  accountKey: string; documentId: string; jobId: string; removed: boolean;
}> {
  const before = favoritesState();
  const match = findFavorite(payload);
  if (match.row.action === 'apply') throw new Error('立即网申岗位不属于聊天首发流程，保留感兴趣状态');
  const cancel = match.element.querySelector<HTMLElement>('.info-header .btns a.btn-like');
  if (!cancel || clean(cancel.textContent) !== '取消感兴趣'
    || cancel.getAttribute('ka') !== `personal_interest_cancel_${payload.target.bossKey}` || disabled(cancel)) {
    throw new Error('未找到与目标招聘者匹配的取消感兴趣入口');
  }
  cancel.click();
  let absent = 0;
  for (let attempt = 0; attempt < 50; attempt++) {
    await pause(100);
    favoritesPage();
    assertGuard(payload);
    const state = favoritesState();
    if (state.pageKey !== before.pageKey) throw new Error('取消收藏时分页发生变化，无法确认本次结果');
    // An unparseable or duplicate card may still be the target; filtered rows are not proof of removal.
    const uncertain = state.skippedCards?.some((card) => !card.jobId || card.jobId === payload.target.jobId);
    absent = uncertain || state.rows.some((row) => row.jobId === payload.target.jobId) ? 0 : absent + 1;
    if (absent >= 3) {
      return { accountKey: payload.accountKey, documentId: pageObserver.documentId, jobId: payload.target.jobId, removed: true };
    }
  }
  throw new Error('尚未确认取消感兴趣生效，请勿重复点击');
}

export type FavoritesChatRequest = Omit<FavoritesTargetRequest, 'documentId'> & { documentId?: string };
export type FavoritesChatState = Omit<BossPageState, 'messages'> & {
  /** Original list IDs, bound to the conversation by the complete visible identity tuple below. */
  bossKey: string; jobId: string; ready: boolean; existingOutgoing: boolean; draftEmpty: boolean;
  draftText: string; sendEnabled: boolean;
  hasIncomingReply?: boolean; unclassifiedIncomingCount?: number;
  messages: Array<BossPageState['messages'][number] & { text?: string }>;
};

type ConversationBinding = {
  documentId: string; targetKey: string; root: Element; messageIds: Set<string>;
};
let conversationBinding: ConversationBinding | undefined;

// Only normalize typography: do not erase words or compare different jobs by a fuzzy score.
const normalizedJobTitle = (value: string) => clean(value.normalize('NFKC')).replace(/\s*([()!?,:;/|])\s*/g, '$1');

function messageText(element: Element): string {
  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof Element)) return '';
    if (node.tagName === 'BR') return '\n';
    if (node instanceof HTMLImageElement) return node.alt;
    return Array.from(node.childNodes).map(visit).join('');
  };
  return visit(element).replace(/\r\n?/g, '\n').trim();
}

function chatEditor(): HTMLElement {
  const editors = Array.from(document.querySelectorAll<HTMLElement>('.chat-conversation .editor-container #chat-input.chat-input[contenteditable="true"]')).filter(shown);
  if (editors.length !== 1) throw new Error('无法唯一定位可编辑的 BOSS 消息输入框');
  return editors[0]!;
}

function chatFacts(payload: FavoritesChatRequest) {
  const state = bossState();
  const { target } = payload;
  const expectedKey = JSON.stringify([target.bossName, target.company, target.bossRole, target.bossAvatar]);
  const selected = state.rows.filter((row) => row.key === state.selectedKey);
  const root = document.querySelector('.chat-conversation')!;
  const base = root.querySelector('.top-info-content .user-info-wrap .base-info');
  const company = clean(base?.querySelector(':scope > span:not(.base-title)')?.textContent);
  const role = clean(base?.querySelector(':scope > span.base-title')?.textContent);
  const job = clean(root.querySelector('.chat-position-content .position-content[ka="geek_chat_job_detail"] .position-name')?.textContent);
  const targetKey = JSON.stringify([payload.accountKey, target.jobId, target.bossKey, expectedKey, normalizedJobTitle(target.jobTitle)]);
  const selectedIdentityMatched = state.selectedKey === expectedKey && selected.length === 1;
  const continuityMatched = state.selectedCount === 0 && !state.selectedKey && conversationBinding?.documentId === state.documentId
    && conversationBinding.targetKey === targetKey && conversationBinding.root === root
    && state.messages.some((message) => conversationBinding!.messageIds.has(message.id));
  const editors = Array.from(root.querySelectorAll<HTMLElement>('.editor-container #chat-input.chat-input[contenteditable="true"]')).filter(shown);
  const editor = editors.length === 1 ? editors[0] : undefined;
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('.chat-op button[type="send"].btn-send')).filter(shown);
  const sendEnabled = buttons.length === 1 && clean(buttons[0]!.textContent) === '发送' && !disabled(buttons[0]!);
  const texts = new Map(Array.from(root.querySelectorAll<HTMLElement>('li.message-item[data-mid]')).map((element) => {
    const text = element.querySelector(':scope > .message-content > .text > p > .text-content');
    return [element.dataset.mid!, text ? messageText(text) : undefined];
  }));
  const messages = state.messages.map((message) => {
    const text = texts.get(message.id);
    return { ...message, ...(text !== undefined ? { text } : {}) };
  });
  const imageIds = new Set(Array.from(root.querySelectorAll<HTMLElement>('li.message-item[data-mid]'))
    .filter((element) => element.querySelector(':scope > .message-content > .text > .message-image-content > img.message-image'))
    .map((element) => element.dataset.mid!));
  const checks = {
    accountMatched: state.accountKey === payload.accountKey,
    documentMatched: payload.documentId === undefined || payload.documentId === state.documentId,
    targetIdentityAvailable: Boolean(target.bossRole && target.bossAvatar),
    selectedIdentityMatched, continuityMatched,
    nameMatched: state.headerName === target.bossName,
    // Header company is genuinely absent for some recruiters; sidebar identity still proves it.
    companyMatched: !company || company === target.company,
    roleMatched: role === target.bossRole,
    jobMatched: normalizedJobTitle(job) === normalizedJobTitle(target.jobTitle),
    notLoading: !state.loading, editorAvailable: Boolean(editor), noBlockingDialog: !hasBlockingDialog(),
  };
  let selectedIdentity: { name: string; company: string; role: string; avatarMatch: boolean } | undefined;
  if (selected.length === 1 && state.selectedKey) {
    try {
      const tuple: unknown = JSON.parse(state.selectedKey);
      if (Array.isArray(tuple) && tuple.length === 4 && tuple.every((value) => typeof value === 'string')) {
        const [name, company, role, avatar] = tuple as [string, string, string, string];
        selectedIdentity = { name, company, role, avatarMatch: avatar === target.bossAvatar };
      }
    } catch { /* An unfamiliar key is reported as missing evidence, never trusted. */ }
  }
  return { state, root, targetKey, checks, messages, imageIds, sendEnabled,
    draftEmpty: Boolean(editor && !messageText(editor) && !editor.querySelector('img,video,audio,iframe')),
    draftText: editor ? messageText(editor) : undefined,
    actual: { name: state.headerName ?? '', ...(company ? { company } : {}), ...(role ? { role } : {}), jobTitle: job,
      ...(selectedIdentity ? { selected: selectedIdentity } : {}) } };
}

/** Read-only recovery facts. Identity mismatches are evidence for AI, not errors that hide the page. */
export function favoritesInspect(payload: Pick<FavoritesChatRequest, 'target' | 'accountKey'>) {
  const facts = chatFacts(payload);
  return { accountMatched: facts.checks.accountMatched, actual: facts.actual, checks: facts.checks,
    messages: facts.messages.map(({ id, outgoing, delivered, text, imageUrl, incomingReply }) => ({
      id, outgoing, delivered, ...(text !== undefined ? { text } : {}), hasImage: Boolean(imageUrl) || facts.imageIds.has(id),
      ...(incomingReply !== undefined ? { incomingReply } : {}),
    })), draftEmpty: facts.draftEmpty, ...(facts.draftText !== undefined ? { draftText: facts.draftText } : {}) };
}

export function favoritesChatState(payload: FavoritesChatRequest): FavoritesChatState {
  assertNoBlockingDialog();
  const facts = chatFacts(payload);
  const { state, checks } = facts;
  if (!checks.accountMatched || !checks.documentMatched) throw new Error('聊天页面或登录账号已变化');
  if (!checks.targetIdentityAvailable) throw new Error('缺少收藏页招聘者的完整身份，请重新扫描');
  if (!checks.notLoading || !(checks.selectedIdentityMatched || checks.continuityMatched)
    || !checks.nameMatched || !checks.companyMatched || !checks.roleMatched || !checks.jobMatched) {
    throw new Error('无法确认聊天对象、公司及岗位与本轮收藏目标完全一致');
  }
  if (!checks.editorAvailable) throw new Error('无法唯一定位可编辑的 BOSS 消息输入框');
  conversationBinding = { documentId: state.documentId, targetKey: facts.targetKey, root: facts.root,
    messageIds: new Set(facts.messages.slice(-500).map((message) => message.id)) };
  return { ...state, bossKey: payload.target.bossKey, jobId: payload.target.jobId, ready: true,
    existingOutgoing: state.messages.some((message) => message.outgoing), draftEmpty: facts.draftEmpty,
    draftText: facts.draftText!, sendEnabled: facts.sendEnabled, messages: facts.messages,
    hasIncomingReply: state.messages.some((message) => message.incomingReply === true),
    unclassifiedIncomingCount: state.messages.filter((message) => !message.outgoing && message.incomingReply === undefined).length };
}

/** Drafting and sending are separate commands so cancellation can be checked while Vue enables Send. */
export function favoritesStageText(payload: FavoritesWriteRequest & { text: string }): FavoritesChatState {
  const before = favoritesChatState(payload);
  if (before.hasIncomingReply && payload.allowIncomingReply !== true) throw new Error('当前目标已回复，发送前交由 AI 判断，不自动回复');
  if (!before.draftEmpty) throw new Error('聊天输入框已有草稿，未覆盖或发送');
  if (before.existingOutgoing) throw new Error('当前会话已有本人消息，不能作为未沟通首发继续发送');
  if (!payload.text.trim() || payload.text.length > 5_000) throw new Error('打招呼文字为空或过长');
  const editor = chatEditor();
  editor.focus();
  editor.textContent = payload.text;
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: payload.text }));
  return favoritesChatState(payload);
}

/** No retries: callers persist the send intent first, then verify a new message against baselineIds. */
export function favoritesSendText(payload: FavoritesWriteRequest & { text: string }): {
  clicked: true; baselineIds: string[]; state: FavoritesChatState;
} {
  const before = favoritesChatState(payload);
  if (before.hasIncomingReply && payload.allowIncomingReply !== true) throw new Error('当前目标已回复，发送前交由 AI 判断，不自动回复');
  if (before.existingOutgoing) throw new Error('发送前会话已出现本人消息，停止重复发送');
  if (!payload.text.trim() || before.draftText !== payload.text.replace(/\r\n?/g, '\n').trim()
    || chatEditor().querySelector('img,video,audio,iframe')) throw new Error('输入框与本轮打招呼文字不一致，已停止发送');
  if (!before.sendEnabled) throw new Error('发送按钮未启用，草稿保留');
  // No await between the final recipient/draft checks and the send side effect.
  Array.from(document.querySelectorAll<HTMLElement>('.chat-conversation .chat-op button[type="send"].btn-send')).find(shown)!.click();
  return { clicked: true, baselineIds: before.messages.map((message) => message.id), state: favoritesChatState(payload) };
}

export function favoritesAssignImage(payload: FavoritesWriteRequest & { attachment: AssignAttachmentRequest }): {
  assigned: true; baselineIds: string[]; state: FavoritesChatState;
} {
  const before = favoritesChatState(payload);
  if (before.hasIncomingReply && payload.allowIncomingReply !== true) throw new Error('当前目标已回复，发送前交由 AI 判断，不自动回复');
  if (!before.draftEmpty) throw new Error('聊天输入框已有草稿，暂停图片发送');
  if (payload.attachment.attachment.id !== 'resume-image' || !payload.attachment.attachment.mimeType.startsWith('image/')) {
    throw new Error('感兴趣首发只允许 resume-image 简历图片');
  }
  if (payload.attachment.documentId !== before.documentId || !before.uploadTarget
    || payload.attachment.elementId !== before.uploadTarget.elementId || payload.attachment.revision !== before.uploadTarget.revision) {
    throw new Error('图片发送控件已变化，请重新读取');
  }
  // BOSS sends immediately on change. Recipient checks and assignment remain in the same synchronous turn.
  if (!assignAttachment(payload.attachment).filesAssigned) throw new Error('未能向 BOSS 图片发送控件赋值');
  return { assigned: true, baselineIds: before.messages.map((message) => message.id), state: favoritesChatState(payload) };
}
