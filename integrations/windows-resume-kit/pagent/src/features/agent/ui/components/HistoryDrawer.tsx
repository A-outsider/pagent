import { useEffect, useState } from 'react';
import { formatConversationTime, groupConversationsByTime } from '@/features/agent/session/conversations';

export function HistoryDrawer({
  open,
  conversations,
  activeId,
  onSelect,
  onDelete,
  onClose,
}: {
  open: boolean;
  conversations: Array<{ id: string; title: string; updatedAt?: number }>;
  activeId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => setShown(true));
      });
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), 240);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  const groups = groupConversationsByTime(conversations);

  return (
    <div className={`pagent-history-layer absolute inset-0 z-40 ${shown ? 'is-open' : ''}`}>
      <button
        type="button"
        className={`pagent-history-backdrop ${shown ? 'is-open' : ''}`}
        aria-label="关闭历史"
        onClick={onClose}
      />
      <aside className={`pagent-history-drawer flex flex-col border-r border-line bg-page ${shown ? 'is-open' : ''}`}>
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-[13px] font-medium text-ink">历史会话</span>
          <button
            type="button"
            aria-label="关闭历史"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {groups.length === 0 ? (
            <div className="px-2 py-8 text-center text-[12.5px] text-ink-3">暂无历史会话</div>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="mb-1.5 last:mb-0">
                <h3 className="px-1.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-ink-3">
                  {group.label}
                </h3>
                {group.items.map((item) => {
                  const selected = item.id === activeId;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-1 rounded-[8px] px-1.5 py-1.5 ${
                        selected ? 'bg-accent-tint' : 'hover:bg-hover'
                      }`}
                    >
                      <button
                        type="button"
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => onSelect(item.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className={`min-w-0 truncate text-[13px] ${selected ? 'font-medium text-ink' : 'text-ink-2'}`}>
                          {item.title}
                        </span>
                        {item.updatedAt ? (
                          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-3">
                            {formatConversationTime(item.updatedAt)}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        aria-label={`删除${item.title}`}
                        onClick={() => onDelete(item.id)}
                        className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-ink-3 hover:bg-hover hover:text-ink"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
