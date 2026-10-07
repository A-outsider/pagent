import type { BossContent } from './service';
import type { FavoritesChatState } from './favorites-content';
import type { BossFavoriteTarget, BossFavoritesContext, BossFavoritesOperations, BossFavoritesPage, BossFavoritesReceipt } from '@/shared/contracts/boss-favorites';

export const BOSS_FAVORITES_URL = 'https://www.zhipin.com/web/geek/recommend?tab=4&sub=1&page=1&tag=4';
const command = 'boss.favorites.';
const normalizeText = (text: string) => text.replace(/\r\n?/g, '\n').trim();
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Options = { sleep?: (ms: number) => Promise<void>; attempts?: number };

/** Reads may be polled; every click/assignment is dispatched once, even if its response is lost. */
export function createBossFavoritesOperations(content: BossContent, options: Options = {}): BossFavoritesOperations {
  const sleep = options.sleep ?? pause;
  const attempts = options.attempts ?? 80;
  const call = <T>(context: Pick<BossFavoritesContext, 'tabId' | 'signal'>, name: string, payload: unknown = {}) => {
    context.signal.throwIfAborted();
    return content<T>(context.tabId, command + name, payload, context.signal);
  };
  function sameAccount(page: { accountKey: string }, context: BossFavoritesContext) {
    if (page.accountKey !== context.accountKey) throw new Error('登录账号已变化，已停止感兴趣岗位投递');
  }
  async function poll<T>(signal: AbortSignal, read: () => Promise<T>, ready: (state: T) => boolean, loadingErrors = false): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal.throwIfAborted();
      try {
        const state = await read();
        signal.throwIfAborted();
        if (ready(state)) return state;
      } catch (error) {
        signal.throwIfAborted();
        if (!loadingErrors) throw error;
        lastError = error;
      }
      await sleep(250);
    }
    throw new Error(lastError instanceof Error ? lastError.message : '等待页面或发送回执超时；不会自动重复操作');
  }
  async function navigateFavorites(context: Pick<BossFavoritesContext, 'tabId' | 'signal'> & Partial<Pick<BossFavoritesContext, 'documentId'>>,
    pageKey = '1'): Promise<BossFavoritesPage> {
    if (!/^[1-9]\d*$/.test(pageKey)) throw new Error('原收藏页码无效，已停止');
    context.signal.throwIfAborted();
    const tab = await browser.tabs.get(context.tabId);
    const url = tab.url ? new URL(tab.url) : undefined;
    if (url?.origin !== 'https://www.zhipin.com' || !['/web/geek/recommend', '/web/geek/chat'].includes(url.pathname)) {
      throw new Error('任务标签页已离开 BOSS 个人中心或聊天页，已停止');
    }
    let previousDocument = context.documentId;
    if (url.pathname === '/web/geek/recommend' && url.searchParams.get('tab') === '4' && url.searchParams.get('sub') === '1') {
      const current = await call<BossFavoritesPage>(context, 'state');
      if (current.pageKey === pageKey) return current;
      previousDocument = current.documentId;
    }
    context.signal.throwIfAborted();
    // Never activate a tab or focus its window. The task stays bound to the tab that started it.
    const targetUrl = new URL(BOSS_FAVORITES_URL);
    targetUrl.searchParams.set('page', pageKey);
    await browser.tabs.update(context.tabId, { url: targetUrl.href });
    return poll(context.signal, () => call<BossFavoritesPage>(context, 'state'),
      (page) => page.pageKey === pageKey && page.documentId !== previousDocument, true);
  }
  async function next(context: BossFavoritesContext, page: BossFavoritesPage): Promise<BossFavoritesPage> {
    sameAccount(page, context);
    const result = await call<BossFavoritesPage>(context, 'next', {
      accountKey: context.accountKey, documentId: page.documentId, pageKey: page.pageKey,
    });
    sameAccount(result, context);
    if (result.pageKey === page.pageKey) throw new Error('收藏列表没有前进，已停止');
    return result;
  }
  async function locate(target: BossFavoriteTarget, context: BossFavoritesContext): Promise<BossFavoritesPage> {
    let page = await call<BossFavoritesPage>(context, 'state');
    sameAccount(page, context);
    if (page.rows.some((row) => row.jobId === target.jobId && row.bossKey === target.bossKey)) return page;
    if (context.currentPageOnly) throw new Error('目标岗位或招聘者已不在原收藏页，保留收藏并停止');
    if (page.pageKey !== '1') {
      page = await navigateFavorites(context);
      sameAccount(page, context);
    }
    const seen = new Set<string>();
    while (true) {
      context.signal.throwIfAborted();
      if (seen.has(page.pageKey)) throw new Error('定位收藏岗位时分页重复，已停止');
      seen.add(page.pageKey);
      if (page.rows.some((row) => row.jobId === target.jobId)) return page;
      if (page.listComplete) throw new Error('本轮目标已不在感兴趣列表，保留进度并交由 AI 判断');
      page = await next(context, page);
    }
  }
  const rawChat = (target: BossFavoriteTarget, context: BossFavoritesContext, navigation = false) => call<FavoritesChatState>(context, 'chat', {
    target, accountKey: context.accountKey, ...(navigation ? {} : { documentId: context.documentId }),
  });
  const payload = (target: BossFavoriteTarget, context: BossFavoritesContext) => ({
    target, accountKey: context.accountKey, documentId: context.documentId,
    ...(context.allowIncomingReply ? { allowIncomingReply: true } : {}),
  });
  async function sendAndVerify(target: BossFavoriteTarget, context: BossFavoritesContext, before: FavoritesChatState,
    send: () => Promise<unknown>, matches: (message: FavoritesChatState['messages'][number]) => boolean,
    requireAssignmentReceipt = false): Promise<BossFavoritesReceipt> {
    let baseline = new Set(before.messages.map((message) => message.id));
    let dispatchError: unknown;
    context.signal.throwIfAborted();
    try {
      const result = await send();
      if (requireAssignmentReceipt) {
        const assignment = result as { assigned?: boolean; baselineIds?: string[] } | undefined;
        if (assignment?.assigned !== true || !Array.isArray(assignment.baselineIds)
          || assignment.baselineIds.some((id) => typeof id !== 'string')) {
          throw new Error('图片赋值确认缺失，不能用任意新图片作为回执');
        }
        // The content script samples immediately before assignment. New incoming cards
        // between the earlier read and assignment belong to this baseline, not the receipt.
        baseline = new Set([...baseline, ...assignment.baselineIds]);
      }
    } catch (error) {
      context.signal.throwIfAborted();
      // Unlike exact text, an arbitrary new image does not prove these attachment bytes were assigned.
      if (requireAssignmentReceipt) throw new Error(`图片赋值结果未确认，不会自动重发：${error instanceof Error ? error.message : String(error)}`);
      dispatchError = error;
    }
    const receipt = (state: FavoritesChatState) => state.messages.filter((message) => !baseline.has(message.id)
      && message.outgoing && message.delivered && matches(message));
    try {
      const state = await poll(context.signal, () => rawChat(target, context), (current) => {
        const matches = receipt(current);
        if (matches.length > 1) throw new Error('出现多条新的发送回执，无法唯一确认本次发送');
        return matches.length === 1;
      });
      return { accountKey: state.accountKey, documentId: state.documentId, bossKey: target.bossKey,
        jobId: target.jobId, verified: true, receiptId: receipt(state)[0]!.id };
    } catch (error) {
      context.signal.throwIfAborted();
      throw new Error(`发送结果未确认，不会自动重发：${dispatchError instanceof Error ? dispatchError.message : error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    readFavorites: navigateFavorites,
    async readCurrentFavorites(context) {
      context.signal.throwIfAborted();
      const tab = await browser.tabs.get(context.tabId);
      const url = tab.url ? new URL(tab.url) : undefined;
      if (url?.origin !== 'https://www.zhipin.com' || url.pathname !== '/web/geek/recommend'
        || url.searchParams.get('tab') !== '4' || url.searchParams.get('sub') !== '1') {
        throw new Error('请先在当前标签打开 BOSS 感兴趣的职位收藏页');
      }
      const page = await call<BossFavoritesPage>(context, 'state');
      if (!/^[1-9]\d*$/.test(page.pageKey)) throw new Error('无法确认当前收藏页码，已停止');
      return page;
    },
    async nextFavorites(context) {
      const page = await call<BossFavoritesPage>(context, 'state');
      if (page.documentId !== context.documentId) throw new Error('扫描期间页面已变化，已停止');
      return next(context, page);
    },
    async openChat(target, context) {
      const page = await locate(target, context);
      // A navigation can close the command channel after click. Never click a second time.
      let dispatchError: unknown;
      try { await call(context, 'start', { ...payload(target, context), documentId: page.documentId }); }
      catch (error) { context.signal.throwIfAborted(); dispatchError = error; }
      try { return await poll(context.signal, () => rawChat(target, context, true), (state) => state.ready, true); }
      catch (error) { throw dispatchError ?? error; }
    },
    readChat: rawChat,
    async inspect(target, context) {
      if (!target) {
        // Global setup/scanning failures have no recipient to compare yet.
        try { return { target: null, favorites: await call<BossFavoritesPage>(context, 'state') }; }
        catch (error) { return { target: null, error: error instanceof Error ? error.message : String(error) }; }
      }
      return call(context, 'inspect', { target, accountKey: context.accountKey });
    },
    async reopenChat(target, context) {
      // Recovery only rebinds the existing conversation; it never repeats first contact.
      return rawChat(target, context, true);
    },
    async verifyDelivery(target, input, context) {
      const state = await rawChat(target, context, true);
      const texts = state.messages.filter((message) => message.outgoing && message.delivered
        && !message.imageUrl && message.text !== undefined
        && normalizeText(message.text) === normalizeText(input.greeting));
      return { accountKey: state.accountKey, documentId: state.documentId, bossKey: target.bossKey, jobId: target.jobId,
        text: { confirmed: input.textAttempted && texts.length === 1, ...(texts.length === 1 ? { receiptId: texts[0]!.id } : {}) },
        // A displayed image alone cannot identify the uploaded file after a lost assignment acknowledgment.
        image: { confirmed: false } };
    },
    async sendText(target, text, context) {
      const before = await rawChat(target, context);
      await call(context, 'stageText', { ...payload(target, context), text });
      await poll(context.signal, () => rawChat(target, context), (state) => {
        if (normalizeText(state.draftText) !== normalizeText(text)) throw new Error('待发送的打招呼文字发生变化，已停止');
        return state.sendEnabled;
      });
      return sendAndVerify(target, context, before,
        () => call(context, 'sendText', { ...payload(target, context), text }),
        (message) => message.text !== undefined && normalizeText(message.text) === normalizeText(text) && !message.imageUrl);
    },
    async sendImage(target, image, context) {
      const before = await rawChat(target, context);
      if (!before.uploadTarget) throw new Error('未能唯一定位聊天图片上传控件');
      return sendAndVerify(target, context, before,
        () => call(context, 'assignImage', { ...payload(target, context), attachment: {
          ...image, ...before.uploadTarget, documentId: context.documentId, expiresAt: Date.now() + 10_000,
        } }), (message) => Boolean(message.imageUrl), true);
    },
    async returnFavorites(context, pageKey) {
      const page = await navigateFavorites(context, pageKey);
      sameAccount(page, context);
      return page;
    },
    async removeFavorite(target, context) {
      const page = await locate(target, context);
      return call(context, 'remove', { ...payload(target, context), documentId: page.documentId });
    },
  };
}
