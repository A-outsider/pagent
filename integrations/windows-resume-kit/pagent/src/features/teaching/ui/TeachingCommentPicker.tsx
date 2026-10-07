import { useEffect, useRef, useState } from 'react';

type PickerBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const BOX_PADDING = 4;

function elementLabel(element: Element, rect: DOMRect): string {
  const html = element as HTMLElement;
  const id = html.id ? `#${html.id}` : '';
  const classes = (html.getAttribute('class') ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => `.${item}`)
    .join('');
  const selector = `${element.tagName.toLowerCase()}${id}${classes}`;
  return `${selector}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

export function TeachingCommentPicker({
  targetElement: initialElement,
  onCancel,
  onSubmit,
}: {
  targetElement?: HTMLElement | null;
  onCancel: () => void;
  onSubmit: (comment: string, element?: HTMLElement | null) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const targetRef = useRef<Element | null>(initialElement ?? null);
  const pendingTargetRef = useRef<Element | null>(null);
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const [selectedTarget, setSelectedTarget] = useState<Element | null>(initialElement ?? null);
  const [box, setBox] = useState<PickerBox>();
  const [label, setLabel] = useState('');
  const [comment, setComment] = useState('');

  // Mode: if initialElement is null (direct comment without element), we don't pick element, just show textarea
  // If initialElement was undefined, we pick element first, then show textarea
  // If initialElement was an HTMLElement, we already have it selected
  const isDirectMode = initialElement === null;
  const isInputPhase = isDirectMode || selectedTarget !== null;

  const updateTargetBox = (element: Element | null) => {
    targetRef.current = element;
    if (!element) {
      setBox(undefined);
      setLabel('');
      return;
    }
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left - BOX_PADDING);
    const top = Math.max(0, rect.top - BOX_PADDING);
    setBox({
      left,
      top,
      width: Math.min(window.innerWidth - left, rect.width + BOX_PADDING * 2),
      height: Math.min(window.innerHeight - top, rect.height + BOX_PADDING * 2),
    });
    setLabel(elementLabel(element, rect));
  };

  useEffect(() => {
    if (initialElement) {
      updateTargetBox(initialElement);
    }
  }, [initialElement]);

  useEffect(() => {
    if (isInputPhase) {
      const timer = window.setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      return () => window.clearTimeout(timer);
    }
  }, [isInputPhase]);

  const elementUnderPointer = (x: number, y: number): Element | null => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    overlay.style.pointerEvents = 'none';
    const element = document.elementFromPoint(x, y);
    overlay.style.pointerEvents = 'auto';
    if (!element || element.closest('pagent-root')) return null;
    return element;
  };

  const debounceTarget = (element: Element | null) => {
    if (isInputPhase) return;
    if (element === targetRef.current || element === pendingTargetRef.current) return;
    window.clearTimeout(hoverTimerRef.current);
    pendingTargetRef.current = element;
    hoverTimerRef.current = window.setTimeout(() => {
      updateTargetBox(pendingTargetRef.current);
      pendingTargetRef.current = null;
    }, 50);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
      }
    };
    const refresh = () => updateTargetBox(targetRef.current);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      window.clearTimeout(hoverTimerRef.current);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [onCancel]);

  const commit = () => {
    const trimmed = comment.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onSubmit(trimmed, (selectedTarget as HTMLElement) || null);
  };

  // Compute position for the textarea
  let inputLeft = window.innerWidth / 2 - 160;
  let inputTop = 80;

  if (box && !isDirectMode) {
    const spaceBelow = window.innerHeight - (box.top + box.height);
    const spaceAbove = box.top;
    inputLeft = Math.min(Math.max(16, box.left), window.innerWidth - 340);
    if (spaceBelow >= 120 || spaceBelow >= spaceAbove) {
      inputTop = Math.min(window.innerHeight - 110, box.top + box.height + 8);
    } else {
      inputTop = Math.max(16, box.top - 100);
    }
  }

  return (
    <div
      ref={overlayRef}
      className={`pointer-events-auto fixed inset-0 z-2147483647 ${
        isInputPhase ? '' : 'cursor-crosshair'
      }`}
      aria-label="示教备注评论"
      onPointerMove={(event) => {
        if (!isInputPhase) {
          const element = elementUnderPointer(event.clientX, event.clientY);
          debounceTarget(element);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (!isInputPhase) {
          event.preventDefault();
          event.stopPropagation();
          window.clearTimeout(hoverTimerRef.current);
          const element = elementUnderPointer(event.clientX, event.clientY);
          if (element) {
            setSelectedTarget(element);
            updateTargetBox(element);
          }
        } else {
          // If clicked outside textarea while in input phase, cancel or commit
          const target = event.target as Node;
          if (textareaRef.current && !textareaRef.current.contains(target)) {
            event.preventDefault();
            commit();
          }
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      {box && (
        <div
          className="pointer-events-none fixed rounded-[3px] border-2 border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.55),0_4px_18px_rgba(0,0,0,0.18)]"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            transition: isInputPhase
              ? 'none'
              : 'left 160ms cubic-bezier(0.23,1,0.32,1), top 160ms cubic-bezier(0.23,1,0.32,1), width 160ms cubic-bezier(0.23,1,0.32,1), height 160ms cubic-bezier(0.23,1,0.32,1)',
          }}
        >
          <span
            className="absolute left-0 max-w-72 truncate rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground shadow-card"
            style={{
              top: box.top >= 30 ? -28 : Math.min(box.height + 4, window.innerHeight - box.top - 24),
            }}
          >
            {label}
          </span>
        </div>
      )}

      {!isInputPhase && (
        <div className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-[11.5px] text-ink-2 shadow-raised backdrop-blur">
          单击选择元素以添加备注 · Esc 取消
        </div>
      )}

      {isInputPhase && (
        <div
          className="pointer-events-auto fixed z-50 flex flex-col gap-1.5"
          style={{
            left: inputLeft,
            top: inputTop,
            width: 320,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <textarea
            ref={textareaRef}
            aria-label="输入备注评论"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                onCancel();
              }
            }}
            placeholder={
              isDirectMode
                ? '对此示教步骤进行备注评论…'
                : '对此元素进行备注评论…'
            }
            rows={3}
            className="w-full resize-none rounded-xl border-2 border-primary bg-surface p-2.5 text-[13px] font-medium text-ink shadow-raised outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center justify-between px-1 text-[10.5px] text-ink-3">
            <span>Enter 提交 · Shift+Enter 换行 · Esc 取消</span>
          </div>
        </div>
      )}
    </div>
  );
}
