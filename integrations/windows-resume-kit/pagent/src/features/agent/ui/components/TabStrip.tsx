import { useLayoutEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

export type TabItem = { id: string; title: string; running?: boolean };

export function TabStrip({
  conversations,
  activeId,
  onSelect,
  onClose,
  onCreate,
  onHistoryToggle,
  historyOpen,
}: {
  conversations: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void | Promise<void>;
  onHistoryToggle: () => void;
  historyOpen: boolean;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, conversations.length]);

  const closeTab = (event: ReactMouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    onClose(id);
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line pr-1 pl-1.5 select-none">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="会话标签页"
        className="pagent-tab-strip flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1"
      >
        {conversations.map((item) => {
          const active = item.id === activeId;
          return (
            <div
              key={item.id}
              data-tab-id={item.id}
              role="tab"
              aria-selected={active}
              title={item.title}
              onClick={() => onSelect(item.id)}
              onAuxClick={(event) => {
                if (event.button === 1) closeTab(event, item.id);
              }}
              className={`group flex h-7 max-w-44 shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] border pl-2 pr-1 text-[12.5px] transition-colors duration-100 ${
                active
                  ? 'border-line-strong bg-surface text-ink shadow-hairline'
                  : 'border-transparent text-ink-2 hover:bg-hover hover:text-ink'
              }`}
            >
              {item.running ? (
                <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <button
                type="button"
                aria-label={`关闭${item.title}`}
                onClick={(event) => closeTab(event, item.id)}
                className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink ${
                  active
                    ? 'opacity-60 hover:opacity-100'
                    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                }`}
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label="新建标签页"
          onClick={() => onCreate()}
          className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink-2"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="历史会话"
          aria-pressed={historyOpen}
          onClick={onHistoryToggle}
          className={`flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-hover hover:text-ink-2 ${
            historyOpen ? 'bg-hover text-ink' : 'text-ink-3'
          }`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v4l2.5 1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
