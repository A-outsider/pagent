export function PageContext({
  page,
  onClearSelection,
}: {
  page: { url: string; title: string; selection: string };
  onClearSelection: () => void;
}) {
  return (
    <div className="pagent-context">
      <div className="flex items-start gap-2 px-2.5 py-2">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[5px] bg-accent-tint text-accent">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-ink">{page.title || '当前页面'}</div>
          <div className="truncate text-[11px] text-ink-3">{page.url}</div>
        </div>
      </div>
      {page.selection ? (
        <div className="flex items-start gap-2 border-t border-line px-2.5 py-1.5">
          <p className="min-w-0 flex-1 text-[12px] leading-5 text-ink-2">{page.selection}</p>
          <button
            type="button"
            aria-label="清除选区"
            onClick={onClearSelection}
            className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
