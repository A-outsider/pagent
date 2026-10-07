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

export function ElementPicker({
  onCancel,
  onSelect,
}: {
  onCancel: () => void;
  onSelect: (element: Element) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<Element | null>(null);
  const pendingTargetRef = useRef<Element | null>(null);
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const [box, setBox] = useState<PickerBox>();
  const [label, setLabel] = useState('');

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
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
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

  return (
    <div
      ref={overlayRef}
      className="pointer-events-auto fixed inset-0 z-2147483647 cursor-crosshair"
      aria-label="选择页面元素"
      onPointerMove={(event) => {
        const element = elementUnderPointer(event.clientX, event.clientY);
        debounceTarget(element);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(hoverTimerRef.current);
        const element = elementUnderPointer(event.clientX, event.clientY);
        if (element) onSelect(element);
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
            transition:
              'left 160ms cubic-bezier(0.23,1,0.32,1), top 160ms cubic-bezier(0.23,1,0.32,1), width 160ms cubic-bezier(0.23,1,0.32,1), height 160ms cubic-bezier(0.23,1,0.32,1)',
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
      <div className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-[11.5px] text-ink-2 shadow-raised backdrop-blur">
        单击选择元素 · Esc 取消
      </div>
    </div>
  );
}
