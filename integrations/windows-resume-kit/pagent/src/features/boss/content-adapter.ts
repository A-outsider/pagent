import { pageObserver } from '@/features/page/observer';
import { assignAttachment } from '@/features/page/actions/attachments';
import type { AssignAttachmentRequest } from '@/shared/contracts/attachments';
import { bossListActivity, type BossListActivity } from './list-time';

/** Extension-internal DOM evidence. Image URLs must never enter model-visible logs. */
export type BossListRow = {
  key: string; name: string; company?: string;
  /** Header recommendations and pinned contacts are outside the ordinary chronological list. */
  pinned?: boolean;
  lastActivity?: BossListActivity;
};
export type BossPageMessage = {
  id: string; outgoing: boolean; imageUrl?: string; delivered: boolean; timeLabel?: string;
  /** True for an ordinary received message, false for own/system messages; absent means unclassified. */
  incomingReply?: boolean;
};
export type BossPageState = {
  documentId: string;
  accountKey: string;
  filterActive: boolean;
  rows: BossListRow[];
  listOrder?: 'recent-first';
  listComplete: boolean;
  selectedKey?: string;
  selectedCount?: number;
  headerName?: string;
  loading: boolean;
  messages: BossPageMessage[];
  uploadTarget?: { elementId: string; revision: number };
};

export type BossAssignRequest = {
  key: string;
  documentId: string;
  accountKey: string;
  attachment: AssignAttachmentRequest;
};

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function page(): HTMLElement {
  if (location.hostname !== 'www.zhipin.com' || location.pathname !== '/web/geek/chat') {
    throw new Error('BOSS 专项操作仅支持已登录的求职者聊天页面');
  }
  const root = document.querySelector<HTMLElement>('.chat-container');
  if (!root) throw new Error('BOSS 聊天页面尚未就绪');
  return root;
}

function shown(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function imagePath(image: HTMLImageElement | null): string {
  const src = image?.getAttribute('src');
  if (!src) return '';
  try {
    const url = new URL(src, location.href);
    return `${url.origin}${url.pathname}`;
  } catch { return ''; }
}

function accountKey(): string {
  const header = document.querySelector('#header');
  const avatar = imagePath(header?.querySelector<HTMLImageElement>('.nav-figure img') ?? null);
  const name = clean(header?.querySelector('a[href*="/web/geek/recommend"]')?.textContent);
  if (!avatar && !name) throw new Error('无法从页面确认当前登录账号');
  return JSON.stringify([name, avatar]);
}

function mainList(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('.chat-user .chat-content > .user-list > .user-list-content');
}

async function waitMainListReady(): Promise<{ root: HTMLElement; list: HTMLElement }> {
  const documentId = pageObserver.documentId;
  const account = accountKey();
  // BOSS removes VirtualList while a newly selected filter loads, even after its label changes.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const root = page();
    if (documentId !== pageObserver.documentId || account !== accountKey() || !filterActive(root)) {
      throw new Error('等待联系人列表时页面、账号或筛选已变化');
    }
    const list = mainList(root);
    if (list && shown(list)) return { root, list };
    const empty = root.querySelector('.chat-user .chat-content > .user-list .no-data .no-setting-text');
    if (empty && shown(empty) && clean(empty.textContent) === '30天内暂无联系人') {
      throw new Error('BOSS 当前联系人列表为空，本次扫描未完成');
    }
    await pause(100);
  }
  throw new Error('BOSS 联系人列表尚未就绪，本次扫描未完成，请稍后重试');
}

function rows(root: HTMLElement) {
  // The virtual list's header contains pinned contacts in ordinary li elements without role=listitem.
  // Scope to the main list so an open group/drawer cannot add unrelated contacts or its ending marker.
  const now = Date.now();
  return Array.from(mainList(root)?.querySelectorAll<HTMLElement>('.friend-content') ?? []).map((element) => {
    const box = element.querySelector('.name-box');
    const name = clean(box?.querySelector('.name-text')?.textContent);
    const labels = Array.from(box?.children ?? []).filter((child) => child.tagName === 'SPAN' && !child.classList.contains('name-text'));
    const company = clean(labels[0]?.textContent);
    const role = clean(labels[1]?.textContent);
    // This tuple locates a rendered row only. The background binds it to a history-response contact ID.
    const key = JSON.stringify([name, company, role, imagePath(element.querySelector('.figure img'))]);
    const pinned = element.classList.contains('friend-top') || Boolean(element.closest('.friend-content-warp.ai-filter'))
      || !element.closest('li[role="listitem"]');
    const time = element.querySelector(':scope > .text > div > .time');
    const lastActivity = time && shown(time) ? bossListActivity(clean(time.textContent), now) : undefined;
    return { element, key, name, pinned, ...(company ? { company } : {}), ...(lastActivity ? { lastActivity } : {}) };
  }).filter((row) => row.name);
}

function filterActive(root: HTMLElement): boolean {
  return Array.from(root.querySelectorAll('.label-list li.selected, .label-list .ui-dropmenu-label'))
    .some((element) => shown(element) && clean(element.querySelector('.label-name')?.textContent ?? element.textContent) === '仅沟通');
}

function incomingReply(element: HTMLElement): boolean | undefined {
  // BOSS v5543 also uses item-friend for cards, so direction alone does not prove a reply.
  if (element.classList.contains('item-system') || element.classList.contains('item-myself')) return false;
  if (!element.classList.contains('item-friend')) return undefined;
  if (element.querySelector(':scope > .message-content > .item-system, :scope > .message-content > .item-resume > .item-system')) return false;
  // The platform's PK analysis card uses item-friend too; match its own title, never bubble/quote text.
  const cardTitle = element.querySelector(':scope > .message-content > .articles-center > .message-card-wrap > .message-card-top-wrap > .message-card-top-content > .message-card-top-title');
  if (clean(cardTitle?.textContent) === '你与该职位竞争者PK情况') return false;
  // Only inspect the actual bubble; a quote can contain another sender's text or image.
  const bubble = ':scope > .message-content > .text';
  if (element.querySelector([
    `${bubble} > p > .text-content`,
    `${bubble} > .message-image-content > img.message-image`,
    `${bubble} > img.message-emoji`,
    `${bubble}.voice-content`,
  ].join(', '))) return true;
  return undefined;
}

export function bossState(): BossPageState {
  const root = page();
  const listed = rows(root);
  const selected = listed.filter((row) => row.element.classList.contains('selected') || row.element.closest('[role="listitem"]')?.classList.contains('selected'));
  const conversation = root.querySelector('.chat-conversation');
  const fileInputs = Array.from(conversation?.querySelectorAll<HTMLInputElement>('.btn-sendimg input[type="file"]') ?? []);
  const upload = fileInputs.length === 1 && !fileInputs[0]!.disabled ? fileInputs[0] : undefined;
  const list = mainList(root);
  const scroller = list ? scrollContainer(list, root) : undefined;
  const messages = Array.from(conversation?.querySelectorAll<HTMLElement>('li.message-item[data-mid]') ?? []).map((element) => {
    const outgoing = element.classList.contains('item-myself');
    const image = outgoing ? element.querySelector<HTMLImageElement>('.item-image .message-image-content img.message-image') : null;
    // BOSS omits labels within five minutes and omits years on older dates. Do not infer or inherit dates.
    const timeLabel = clean(element.querySelector(':scope > .item-time > .time')?.textContent);
    const reply = incomingReply(element);
    return {
      id: element.dataset.mid!,
      outgoing,
      ...(reply !== undefined ? { incomingReply: reply } : {}),
      ...(image?.getAttribute('src') ? { imageUrl: new URL(image.getAttribute('src')!, location.href).href } : {}),
      delivered: outgoing && Boolean(element.querySelector('.message-status.status-delivery, .message-status.status-read')),
      ...(timeLabel ? { timeLabel } : {}),
    };
  });
  return {
    documentId: pageObserver.documentId,
    accountKey: accountKey(),
    filterActive: filterActive(root),
    rows: listed.map(({ element: _, ...row }) => row),
    // v5543 separates topList and sorts list$ by descending updateTime. Its pagination/updates
    // also use the oldest loaded time as their boundary; this is the site's ordering contract,
    // not a claim that every unloaded record has been independently checked.
    ...(list?.closest('.chat-user.v2') && list.querySelector(':scope > ul[role="group"]')
      && listed.every(({ element }) => element.closest('li[role="listitem"], ul[role="thead"]'))
      ? { listOrder: 'recent-first' as const } : {}),
    listComplete: Boolean(scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2)
      && Array.from(list?.querySelectorAll('.boss-list-footer .finished') ?? []).some((element) => clean(element.textContent) === '没有更多了'),
    ...(selected.length === 1 ? { selectedKey: selected[0]!.key } : {}),
    selectedCount: selected.length,
    ...(conversation ? { headerName: clean(conversation.querySelector('.top-info-content .name-content .name-text')?.textContent) } : {}),
    loading: Array.from(conversation?.querySelectorAll('.pre-loading') ?? []).some(shown),
    messages,
    ...(upload ? { uploadTarget: { elementId: pageObserver.register(upload), revision: pageObserver.revision } } : {}),
  };
}

export async function bossFilter(): Promise<BossPageState> {
  const root = page();
  if (filterActive(root)) {
    await waitMainListReady();
    return bossState();
  }
  let target = Array.from(root.querySelectorAll<HTMLElement>('.label-list li')).find((element) => clean(element.textContent) === '仅沟通' && shown(element));
  if (!target) {
    const menu = root.querySelector<HTMLElement>('.label-list .ui-dropmenu-label');
    if (!menu) throw new Error('未找到 BOSS 的仅沟通过滤入口');
    menu.click();
    await pause(80);
    target = Array.from(root.querySelectorAll<HTMLElement>('.label-list li')).find((element) => clean(element.textContent) === '仅沟通' && shown(element));
  }
  if (!target) throw new Error('仅沟通过滤选项未显示');
  target.click();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await pause(100);
    if (filterActive(page())) {
      await waitMainListReady();
      return bossState();
    }
  }
  throw new Error('未能确认仅沟通过滤已生效');
}

function scrollContainer(start: HTMLElement, boundary: HTMLElement): HTMLElement {
  const candidates: HTMLElement[] = [];
  for (let current: HTMLElement | null = start; current && boundary.contains(current); current = current.parentElement) {
    candidates.push(current);
    if (current.scrollHeight > current.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(current).overflowY)) return current;
  }
  return candidates.find((element) => element.scrollHeight > element.clientHeight + 1) ?? start;
}

export async function bossListScroll(direction: 'top' | 'next'): Promise<BossPageState> {
  const { root, list } = await waitMainListReady();
  const container = scrollContainer(list, root);
  container.scrollTop = direction === 'top' ? 0 : container.scrollTop + Math.max(300, Math.floor(container.clientHeight * 0.8));
  container.dispatchEvent(new Event('scroll', { bubbles: true }));
  await pause(200);
  return bossState();
}

export async function bossSelect(key: string): Promise<BossPageState> {
  const original = bossState();
  if (!original.filterActive) throw new Error('请先选择仅沟通列表');
  let previous = '';
  let unchanged = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = bossState();
    if (state.documentId !== original.documentId || state.accountKey !== original.accountKey || !state.filterActive) {
      throw new Error('查找联系人时页面、账号或过滤条件已变化');
    }
    const matches = rows(page()).filter((row) => row.key === key);
    if (matches.length > 1) throw new Error('联系人显示信息重复，无法唯一定位');
    if (matches.length === 1) {
      const target = matches[0]!;
      target.element.click();
      for (let wait = 0; wait < 50; wait += 1) {
        await pause(100);
        const selected = bossState();
        if (selected.documentId !== original.documentId || selected.accountKey !== original.accountKey) throw new Error('选择联系人时页面或账号已变化');
        if (selected.selectedKey === key && selected.headerName === target.name && !selected.loading) return selected;
      }
      throw new Error('未能确认选中的聊天对象');
    }
    // Search the virtualized list from the top rather than trusting its old row index.
    if (attempt === 0) {
      await bossListScroll('top');
      continue;
    }
    if (state.listComplete) break;
    const signature = JSON.stringify(state.rows.map((row) => row.key));
    unchanged = signature === previous ? unchanged + 1 : 0;
    previous = signature;
    if (unchanged >= 5) break;
    await bossListScroll('next');
  }
  throw new Error('当前仅沟通列表中未能定位该联系人');
}

export async function bossHistoryTop(): Promise<BossPageState> {
  const root = page();
  const record = root.querySelector<HTMLElement>('.chat-conversation .chat-record');
  if (!record) throw new Error('尚未打开聊天记录');
  const container = scrollContainer(record, root.querySelector<HTMLElement>('.chat-conversation')!);
  // Some history loaders trigger only on an actual scroll transition.
  if (container.scrollTop === 0) container.scrollTop = 1;
  container.scrollTop = 0;
  container.dispatchEvent(new Event('scroll', { bubbles: true }));
  await pause(200);
  return bossState();
}

export function bossAssign(payload: BossAssignRequest): BossPageState {
  const state = bossState();
  const matching = state.rows.filter((row) => row.key === payload.key);
  if (state.documentId !== payload.documentId || state.documentId !== payload.attachment.documentId || state.accountKey !== payload.accountKey) {
    throw new Error('发送前页面或账号已变化');
  }
  if (!state.filterActive || state.selectedKey !== payload.key || matching.length !== 1 || state.headerName !== matching[0]?.name || state.loading) {
    throw new Error('发送前无法确认唯一的当前聊天对象');
  }
  if (state.messages.some((message) => message.incomingReply === true)) {
    throw new Error('对方已有回复，停止补发简历图片');
  }
  if (state.messages.some((message) => !message.outgoing && message.incomingReply !== false)) {
    throw new Error('发送前有未能分类的对方消息，停止补发简历图片');
  }
  if (payload.attachment.attachment.id !== 'resume-image' || !payload.attachment.attachment.mimeType.startsWith('image/')) {
    throw new Error('BOSS 简历图片发送只接受 resume-image 图片附件');
  }
  if (!state.uploadTarget || state.uploadTarget.elementId !== payload.attachment.elementId || state.uploadTarget.revision !== payload.attachment.revision) {
    throw new Error('BOSS 图片发送控件已变化');
  }
  // BOSS sends on change immediately. Keep recipient checks and assignment in one synchronous turn.
  const assigned = assignAttachment(payload.attachment);
  if (!assigned.filesAssigned) throw new Error('图片未能交给 BOSS 发送控件');
  return bossState();
}
