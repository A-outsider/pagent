import { useEffect, useState } from 'react';
import type { BossTaskSnapshot } from '@/shared/contracts/boss-task';
import { rpc } from '@/shared/extension/rpc-client';

const PHASE = { scanning: '正在查漏', preparing: '正在准备简历图片', sending: '正在投递', finished: '已结束' };
const AUDIT_STATUS = { sent: '此前已发', not_found: '未发现图片', uncertain: '待核查', out_of_scope: '不在范围' };
const DELIVERY_STATUS = { planned: '计划发送', sent: '本次已发送', skipped: '已跳过', uncertain: '发送待确认', failed: '发送失败' };

function mergeTask(previous: BossTaskSnapshot | null, next: BossTaskSnapshot | null) {
  if (!previous || !next) return next;
  if (previous.taskId !== next.taskId) return previous.createdAt > next.createdAt ? previous : next;
  if (next.updatedAt < previous.updatedAt) return previous;
  return { ...next, recipients: next.recipients ?? previous.recipients };
}

export function BossTaskPanel({ url }: { url: string }) {
  const [task, setTask] = useState<BossTaskSnapshot | null>(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const enabled = /^https:\/\/www\.zhipin\.com\/web\/geek\/chat(?:[?#]|$)/.test(url);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 5_000;
      try {
        const snapshot = await rpc('boss.task.get', { includeRecipients: true }) as BossTaskSnapshot | null;
        if (disposed) return;
        setTask((previous) => mergeTask(previous, snapshot));
        setError('');
        if (snapshot?.status === 'running' || snapshot?.status === 'stopping') delay = 2_000;
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!disposed) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [enabled]);

  const stop = async () => {
    if (!task) return;
    setCancelling(true);
    try {
      const snapshot = await rpc('boss.task.cancel', { taskId: task.taskId }) as BossTaskSnapshot;
      setTask((previous) => mergeTask(previous, snapshot));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCancelling(false);
    }
  };

  if (!enabled || (!task && !error)) return null;
  const label = task?.status === 'running' ? PHASE[task.phase]
    : task?.status === 'stopping' ? '正在停止'
      : task?.status === 'stopped' ? '已停止'
        : task?.status === 'failed' ? '任务失败'
          : task?.dryRun ? '预览完成（未发送）' : '已完成';

  return (
    <section aria-label="BOSS 简历图片任务" className="rounded-xl border border-line bg-surface p-3 text-[12px] text-ink">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">BOSS 简历图片{task?.operation === 'send' ? '投递' : '查漏'}</h3>
        {task?.status === 'running' && (
          <button type="button" disabled={cancelling} onClick={() => void stop()} className="rounded-md bg-field px-2 py-1 hover:bg-hover disabled:opacity-50">
            {cancelling ? '正在停止…' : '停止任务'}
          </button>
        )}
      </div>
      {task && <>
        <p role="status" className="mt-1 text-ink-2">{label}</p>
        {task.since && <p className="mt-1 text-ink-3">范围：{new Date(task.since).toLocaleString()} 起</p>}
        <p className="mt-2">已发现 {task.progress.discovered} 人 · 已检查 {task.progress.checked} 人</p>
        {task.phase === 'scanning' && <progress aria-label="查漏进度" className="mt-1 w-full" max={Math.max(1, task.progress.discovered)} value={task.progress.checked} />}
        <p className="mt-1 text-ink-3">此前已发 {task.progress.sent} · 未发现图片 {task.progress.notFound} · 待核查 {task.progress.uncertain} · 不在范围 {task.progress.outOfScope}</p>
        {task.operation === 'send' && <div className="mt-2">
          <p>{task.dryRun
            ? `预览计划：${task.delivery.planned} 人 · 已准备 ${task.recipients?.filter((recipient) => recipient.deliveryStatus === 'planned').length ?? 0} 人`
            : `投递进度：${task.delivery.processed} / ${task.delivery.planned} 人`}</p>
          {!task.dryRun && <progress aria-label="投递进度" className="mt-1 w-full" max={Math.max(1, task.delivery.planned)} value={task.delivery.processed} />}
          <p className="mt-1 text-ink-3">本次已发 {task.delivery.sent} · 跳过 {task.delivery.skipped} · 待确认 {task.delivery.uncertain} · 失败 {task.delivery.failed}</p>
        </div>}
        <p className="mt-2 text-ink-3">查漏 {(task.timings.scanMs / 1_000).toFixed(1)} 秒 · 准备 {(task.timings.prepareMs / 1_000).toFixed(1)} 秒 · 投递 {(task.timings.sendMs / 1_000).toFixed(1)} 秒</p>
        {Boolean(task.recipients?.length) && <details className="mt-2">
          <summary className="cursor-pointer text-ink-2">查看明细（{task.recipients!.length} 人）</summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left text-[11px]">
              <thead><tr><th scope="col" className="p-1">联系人</th><th scope="col" className="p-1">结果</th><th scope="col" className="p-1">原因</th></tr></thead>
              <tbody>{task.recipients!.map((recipient) => <tr key={recipient.recipientId} className="border-t border-line align-top">
                <td className="p-1">{recipient.name}<span className="block text-ink-3">{recipient.company}</span></td>
                <td className="p-1">{recipient.deliveryStatus ? DELIVERY_STATUS[recipient.deliveryStatus] : AUDIT_STATUS[recipient.status]}</td>
                <td className="p-1 break-words text-ink-3">{recipient.deliveryReason ?? recipient.reason}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>}
      </>}
      {(error || task?.error) && <p role="alert" className="mt-2 whitespace-pre-wrap text-red">{error || task?.error}</p>}
    </section>
  );
}
