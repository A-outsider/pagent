import { useState } from 'react';
import {
  IconCheck,
  IconCommand,
  IconListDetails,
  IconPlayerRecord,
  IconRoute,
  IconSparkles,
  IconTrash,
} from '@tabler/icons-react';
import type { TeachingSession } from '@/shared/contracts/teaching';
import { AnimatedBadge } from '@/shared/ui/beui/animated-badge';
import { Button } from '@/shared/ui/beui/button';

const ACTION_NAMES: Record<string, string> = {
  click: '点击',
  double_click: '双击',
  input: '输入',
  select: '选择',
  keypress: '按键',
  scroll: '滚动',
  navigate: '跳转',
  reload: '刷新',
  tab_switch: '切换标签',
  tab_open: '打开标签',
  tab_close: '关闭标签',
  comment: '备注',
};

export function FlowConfirmCard({
  session,
  busy,
  onConfirm,
  onDiscard,
}: {
  session: TeachingSession;
  busy: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const [tab, setTab] = useState<'flow' | 'records'>('flow');
  const draft = session.draft;
  if (!draft) {
    return (
      <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-accent-ink">
            <IconSparkles size={18} className="animate-pulse" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">正在编写操作记录</p>
            <p className="mt-0.5 text-[11.5px] text-ink-3">正在整理页面、控件与操作细节…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card" aria-label="示教流程确认">
      <header className="border-b border-line bg-linear-to-b from-primary/6 to-transparent px-3.5 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[13.5px] font-semibold text-ink">{draft.name}</h3>
              <AnimatedBadge status="success">待确认</AnimatedBadge>
            </div>
            <p className="mt-1 text-[11.5px] leading-4.5 text-ink-3">{draft.purpose}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <AnimatedBadge status="info" icon={<IconCommand size={11} />}>/{draft.key}</AnimatedBadge>
          <AnimatedBadge icon={<IconRoute size={11} />}>{draft.steps.length} 个步骤</AnimatedBadge>
          <AnimatedBadge icon={<IconPlayerRecord size={11} />}>{session.actions.length} 条记录</AnimatedBadge>
          <AnimatedBadge icon={<IconSparkles size={11} />}>提示词已封装</AnimatedBadge>
        </div>
      </header>

      <div className="p-3">
        <div className="grid grid-cols-2 rounded-lg bg-field p-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={tab === 'flow' ? 'bg-surface text-ink shadow-xs hover:bg-surface' : 'text-ink-3'}
            onClick={() => setTab('flow')}
          >
            <IconRoute size={14} />流程
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={tab === 'records' ? 'bg-surface text-ink shadow-xs hover:bg-surface' : 'text-ink-3'}
            onClick={() => setTab('records')}
          >
            <IconListDetails size={14} />原始记录
          </Button>
        </div>

        {tab === 'flow' ? (
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
            {draft.prerequisites.length > 0 && (
              <div className="rounded-lg border border-line bg-page px-2.5 py-2">
                <p className="text-[10.5px] font-semibold text-ink-3">开始前</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {draft.prerequisites.map((item) => (
                    <AnimatedBadge key={item} showIcon={false}>{item}</AnimatedBadge>
                  ))}
                </div>
              </div>
            )}
            {draft.steps.map((step, index) => (
              <div key={step.id} className="flex gap-2.5 rounded-lg border border-line bg-page px-2.5 py-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-accent-ink">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[11.5px] font-semibold text-ink">{step.title}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[10.5px] leading-4 text-ink-3">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {session.actions.map((action, index) => (
              <div key={action.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-hover">
                <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[9.5px] text-ink-3">{index + 1}</span>
                <AnimatedBadge showIcon={false} className="shrink-0">
                  {ACTION_NAMES[action.kind] ?? action.kind}
                </AnimatedBadge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10.5px] text-ink-2">
                    {action.target?.name || action.target?.text || action.detail || action.page.title || action.page.url}
                  </p>
                  {action.value && (
                    <p className="mt-0.5 truncate font-mono text-[9.5px] text-ink-3">
                      {action.redacted ? '[敏感输入已隐藏]' : action.value}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {draft.lastRequest && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-primary/8 px-2.5 py-2 text-[10.5px] text-ink-2">
            <IconSparkles size={13} className="shrink-0 text-accent-ink" />
            <span className="truncate">已调整：{draft.lastRequest}</span>
          </div>
        )}

        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={busy}>
            <IconTrash size={14} />放弃
          </Button>
          <Button type="button" size="sm" onClick={onConfirm} disabled={busy}>
            <IconCheck size={14} />{busy ? '处理中…' : '确认并固化'}
          </Button>
        </div>
      </div>
    </section>
  );
}
