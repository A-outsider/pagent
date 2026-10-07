import { useEffect, useId, useRef, useState } from 'react';
import {
  bossFavoritesPreferencesSchema, DEFAULT_BOSS_GREETING,
  type BossFavoritesTaskSnapshot,
} from '@/shared/contracts/boss-favorites';
import { rpc } from '@/shared/extension/rpc-client';

const PHASE = {
  scanning: '读取感兴趣岗位', preparing: '准备简历图片', opening: '打开并核对会话',
  text: '发送固定文字', image: '发送简历图片', returning: '返回感兴趣列表',
  removing: '取消已完成岗位的感兴趣', cooldown: '等待 1 秒', finished: '已结束',
};
const RECIPIENT_STATUS = { planned: '待处理', preview: '预览候选', skipped: '已跳过', completed: '已完成', uncertain: '需核实' };
const RECOMMENDATION = { inspect: '先核实', retry_after_verification: '核实后再决定重试', skip: '建议跳过', stop: '建议停止' };
const DECISION = { continue: '继续处理', skip: '跳过当前岗位并继续', pause: '暂停等待用户' };
const buttonClass = 'rounded-md bg-field px-2 py-1 hover:bg-hover disabled:opacity-50';

function mergeTask(previous: BossFavoritesTaskSnapshot | null, next: BossFavoritesTaskSnapshot | null) {
  if (!next) return previous;
  if (!previous) return next;
  if (previous.taskId !== next.taskId) return previous.createdAt > next.createdAt ? previous : next;
  if (next.updatedAt < previous.updatedAt) return previous;
  return {
    ...next, recipients: next.recipients ?? previous.recipients,
    skippedCards: next.skippedCards ?? previous.skippedCards,
  };
}

export function BossFavoritesTaskPanel({ url }: { url: string }) {
  const enabled = /^https:\/\/(?:www\.)?zhipin\.com\/web\/geek\/(?:recommend|chat)(?:[/?#]|$)/.test(url);
  const [task, setTask] = useState<BossFavoritesTaskSnapshot | null>(null);
  const [greeting, setGreeting] = useState(DEFAULT_BOSS_GREETING);
  const [count, setCount] = useState('10');
  const [pending, setPending] = useState<'save' | 'preview' | 'start' | 'cancel' | null>(null);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [pollError, setPollError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const draftEdited = useRef(false);
  const pendingAction = useRef(false);
  const mounted = useRef(true);
  const active = task?.status === 'running' || task?.status === 'stopping' || task?.status === 'needs_attention';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    setLoadingPreferences(true);
    void rpc('boss.favorites.preferences.get', {}).then((value) => {
      if (disposed) return;
      const preferences = bossFavoritesPreferencesSchema.parse(value);
      if (!draftEdited.current) {
        setGreeting(preferences.greeting);
        setCount(String(preferences.maxRecipients));
      }
    }).catch((cause) => {
      if (!disposed) setActionError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!disposed) setLoadingPreferences(false); });
    return () => { disposed = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 5_000;
      try {
        const snapshot = await rpc('boss.favorites.get', { includeRecipients: true }) as BossFavoritesTaskSnapshot | null;
        if (disposed) return;
        setTask((previous) => mergeTask(previous, snapshot));
        setPollError('');
        if (snapshot?.status === 'running' || snapshot?.status === 'stopping') delay = 2_000;
      } catch (cause) {
        if (disposed) return;
        setPollError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!disposed) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [enabled]);

  const preferences = () => {
    const parsed = bossFavoritesPreferencesSchema.safeParse({ greeting, maxRecipients: Number(count) });
    if (!parsed.success) throw new Error('投递数需为 1～2000 的整数，打招呼语需为 1～5000 字');
    return parsed.data;
  };

  const perform = async (action: 'save' | 'preview' | 'start' | 'cancel') => {
    if (pendingAction.current || (active && action !== 'cancel')) return;
    pendingAction.current = true;
    setPending(action);
    setActionError('');
    setNotice('');
    try {
      if (action === 'cancel') {
        if (!task) return;
        const snapshot = await rpc('boss.favorites.cancel', { taskId: task.taskId }) as BossFavoritesTaskSnapshot;
        if (mounted.current) setTask((previous) => mergeTask(previous, snapshot));
      } else if (action === 'save') {
        await rpc('boss.favorites.preferences.set', preferences());
        if (mounted.current) setNotice('模板已保存，未发送消息');
      } else {
        const snapshot = await rpc('boss.favorites.start', {
          ...preferences(), serverName: 'resume', attachmentId: 'resume-image', dryRun: action === 'preview',
        }) as BossFavoritesTaskSnapshot;
        if (mounted.current) setTask((previous) => mergeTask(previous, snapshot));
      }
    } catch (cause) {
      if (mounted.current) setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pendingAction.current = false;
      if (mounted.current) setPending(null);
    }
  };

  if (!enabled) return null;
  const disabled = Boolean(active || pending || loadingPreferences);
  const label = task?.status === 'running' ? PHASE[task.phase]
    : task?.status === 'stopping' ? '正在停止'
      : task?.status === 'stopped' ? '已停止'
        : task?.status === 'needs_attention' ? '已暂停，等待异常核实'
          : task?.dryRun ? '预览完成（未发送、未取消感兴趣）' : '本轮已结束';
  const review = task?.exception?.review;
  const handoff = task?.exception?.handoff;
  const resolution = task?.exception?.resolution;
  const lastResolution = task?.exceptionHistory?.findLast((exception) => exception.resolution)?.resolution;

  const summary = actionError || pollError ? '有错误，展开查看'
    : task ? `${label} · ${task.dryRun ? `预览 ${task.progress.previewed}` : `${task.progress.completed}/${task.maxRecipients}`}` : '设置投递数与招呼语';
  return <section aria-label="BOSS 感兴趣岗位投递" className="mx-3 mb-2 shrink-0 rounded-xl border border-line bg-surface text-[12px] text-ink">
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      <button type="button" aria-label={expanded ? '收起感兴趣岗位投递' : '展开感兴趣岗位投递'}
        aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span aria-hidden className="shrink-0 text-ink-3">{expanded ? '▾' : '▸'}</span>
        <span className="shrink-0 font-semibold">感兴趣岗位投递</span>
        <span title={summary} className="min-w-0 truncate text-ink-3">{summary}</span>
      </button>
      {active && <button type="button" disabled={pending === 'cancel' || task?.status === 'stopping'} onClick={() => void perform('cancel')} className={buttonClass}>
        {pending === 'cancel' || task?.status === 'stopping' ? '正在停止…' : '停止任务'}
      </button>}
    </div>
    {expanded && <div id={detailsId} aria-label="感兴趣岗位投递详情" className="max-h-[min(320px,40vh)] overflow-y-auto overscroll-contain border-t border-line px-3 py-2">
    <p className="mt-1 text-ink-3">只处理“立即沟通”的岗位，发送文字和简历图片后取消感兴趣。其他或无法识别的卡片跳过，不占投递数。每个完整操作后等待 1 秒。</p>
    <label className="mt-3 flex items-center gap-2">投递数
      <input aria-label="投递数" type="number" min={1} max={2_000} step={1} value={count} disabled={disabled}
        onChange={(event) => { draftEdited.current = true; setCount(event.target.value); setNotice(''); }}
        className="w-20 rounded-md border border-line bg-field px-2 py-1 disabled:opacity-60" />
    </label>
    <label className="mt-2 block">打招呼语
      <textarea aria-label="打招呼语" value={greeting} maxLength={5_000} rows={5} disabled={disabled}
        onChange={(event) => { draftEdited.current = true; setGreeting(event.target.value); setNotice(''); }}
        className="mt-1 w-full resize-y rounded-md border border-line bg-field p-2 disabled:opacity-60" />
    </label>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={disabled} onClick={() => void perform('save')} className={buttonClass}>{pending === 'save' ? '正在保存…' : '保存模板'}</button>
      <button type="button" disabled={disabled} onClick={() => void perform('preview')} className={buttonClass}>{pending === 'preview' ? '正在启动…' : '预览名单'}</button>
      <button type="button" disabled={disabled} onClick={() => void perform('start')} className="rounded-md bg-ink px-2 py-1 text-surface disabled:opacity-50">{pending === 'start' ? '正在启动…' : '开始投递'}</button>
    </div>
    <p className="mt-1 text-ink-3">预览不发消息、不取消感兴趣。执行异常会交给 Pagent 核对当前页面，再决定继续、跳过或暂停；继续前由程序核验。</p>
    {notice && <p role="status" className="mt-2 text-ink-2">{notice}</p>}
    {task && <div className="mt-3 border-t border-line pt-2">
      <p role="status" className="text-ink-2">{label}</p>
      <p className="mt-1">完整完成 {task.progress.completed} / {task.maxRecipients} 个</p>
      <progress aria-label="感兴趣岗位投递进度" className="mt-1 w-full" max={task.maxRecipients} value={task.progress.completed} />
      <p className="mt-1 text-ink-3">发现 {task.progress.discovered} · 计划 {task.progress.planned} · 预览 {task.progress.previewed} · 跳过 {task.progress.skipped}</p>
      {!task.exception && lastResolution && <p className="mt-2 text-ink-2">上次异常处理：Pagent 选择{DECISION[lastResolution.action]}，{lastResolution.appliedAt ? '已由程序执行' : '决定已记录'}。</p>}
      <details className="mt-2"><summary className="cursor-pointer text-ink-2">查看本轮固定文案与图片</summary>
        <p className="mt-1 whitespace-pre-wrap text-ink-3">{task.greeting}</p>
        <p className="mt-1 text-ink-3">图片：{task.attachment?.fileName ?? '简历图片（准备后固定版本）'}</p>
      </details>
      {Boolean(task.recipients?.length) && <details className="mt-2">
        <summary className="cursor-pointer text-ink-2">查看岗位明细（{task.recipients!.length} 个）</summary>
        <div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left text-[11px]">
          <thead><tr><th scope="col" className="p-1">岗位 / 招聘者</th><th scope="col" className="p-1">结果</th><th scope="col" className="p-1">确认状态</th></tr></thead>
          <tbody>{task.recipients!.map((recipient) => <tr key={`${recipient.jobId}:${recipient.bossKey}`} className="border-t border-line align-top">
            <td className="p-1">{recipient.jobTitle}<span className="block text-ink-3">{recipient.company} · {recipient.bossName}</span></td>
            <td className="p-1">{RECIPIENT_STATUS[recipient.status]}<span className="block break-words text-ink-3">{recipient.reason ?? PHASE[recipient.phase]}</span></td>
            <td className="p-1 text-ink-3">文字：{recipient.textConfirmed ? '已确认' : '未确认'}<br />图片：{recipient.imageConfirmed ? '已确认' : '未确认'}<br />取消感兴趣：{recipient.unfavoriteConfirmed ? '已确认' : '未确认'}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
      {Boolean(task.skippedCards?.length) && <details className="mt-2">
        <summary className="cursor-pointer text-ink-2">查看已跳过卡片（{task.skippedCards!.length} 个）</summary>
        <p className="mt-1 text-ink-3">这些卡片未点击、未发送，保留感兴趣，不占投递数。</p>
        <div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left text-[11px]">
          <thead><tr><th scope="col" className="p-1">位置</th><th scope="col" className="p-1">岗位 / 公司</th><th scope="col" className="p-1">跳过原因</th></tr></thead>
          <tbody>{task.skippedCards!.map((card) => <tr key={`${card.pageKey}:${card.rowIndex}:${card.jobId ?? ''}`} className="border-t border-line align-top">
            <td className="p-1">第 {card.pageKey} 页 · 第 {card.rowIndex} 行</td>
            <td className="p-1">{card.jobTitle || '岗位未识别'}<span className="block text-ink-3">{card.company || '公司未识别'}</span></td>
            <td className="p-1 break-words text-ink-3">{card.reason}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
      {task.exception && <div className="mt-2 rounded-md bg-field p-2">
        <p className="font-medium">异常：{PHASE[task.exception.phase]}</p>
        <p className="mt-1 break-words text-ink-2">{task.exception.message}</p>
        {handoff?.status === 'queued' && <p role="status" className="mt-1">已交给 Pagent，等待当前会话结束后处理</p>}
        {handoff?.status === 'running' && <p role="status" className="mt-1">Pagent 正在“投递异常处理”会话核对页面并作决定</p>}
        {handoff?.status === 'completed' && <p role="status" className="mt-1">Pagent 已完成异常处理</p>}
        {handoff?.status === 'failed' && <p role="alert" className="mt-1 text-red">{handoff.error ?? 'Pagent 异常处理未完成，任务保持暂停'}</p>}
        {resolution && <>
          <p className="mt-2 font-medium">Pagent 决定：{DECISION[resolution.action]}</p>
          <p className="mt-1 whitespace-pre-wrap text-ink-2">{resolution.reason}</p>
          <p className="mt-1 text-ink-3">{resolution.appliedAt ? '决定已由程序执行' : '决定已记录，等待本轮会话结束后由程序核验执行'}</p>
        </>}
        {!handoff && review?.status === 'running' && <p role="status" className="mt-1">AI 正在诊断，任务保持停止</p>}
        {!handoff && review?.status === 'completed' && <>
          <p className="mt-2 font-medium">AI 判断：{review.summary}</p>
          {review.recommendation && <p className="mt-1">{RECOMMENDATION[review.recommendation]}</p>}
          <p className="mt-1 whitespace-pre-wrap text-ink-2">{review.reason}</p>
          <p className="mt-1 text-ink-3">以上仅为建议，未自动重发、取消感兴趣或继续任务。</p>
        </>}
        {!handoff && review?.status === 'failed' && <p role="alert" className="mt-1 text-red">AI 诊断未完成：{review.error ?? '请稍后核实'}。任务保持停止。</p>}
        {!handoff && !review && <p className="mt-1 text-ink-3">异常已记录，等待交给 Pagent 处理。</p>}
      </div>}
    </div>}
    {(actionError || pollError || task?.error) && <p role="alert" className="mt-2 whitespace-pre-wrap text-red">{actionError || pollError || task?.error}</p>}
    </div>}
  </section>;
}
