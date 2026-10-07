import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export const STICK_TO_BOTTOM_THRESHOLD = 48;

export function isScrolledToBottom(
  element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>,
  threshold = STICK_TO_BOTTOM_THRESHOLD,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

export function nextStickPinned(input: {
  pinned: boolean;
  atBottom: boolean;
  scrollTop: number;
  lastScrollTop: number;
  heightChanged: boolean;
}): boolean {
  // A user can scroll up in the same frame that a streamed response grows.
  if (input.scrollTop < input.lastScrollTop && (!input.heightChanged || !input.atBottom)) {
    return false;
  }
  if (input.atBottom && input.scrollTop > input.lastScrollTop) return true;
  return input.pinned;
}

export function useStickToBottom(options: { enabled?: boolean; resetKey?: string } = {}) {
  const { enabled = true, resetKey } = options;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastHeightRef = useRef(0);

  const remember = (scroller: HTMLElement) => {
    lastScrollTopRef.current = scroller.scrollTop;
    lastHeightRef.current = scroller.scrollHeight;
  };

  const stick = () => {
    const scroller = scrollerRef.current;
    if (!scroller || !enabled || !pinnedRef.current) return;
    scroller.scrollTop = scroller.scrollHeight;
    remember(scroller);
  };

  useLayoutEffect(() => {
    pinnedRef.current = true;
    stick();
  }, [resetKey, enabled]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => stick());
    observer.observe(content);
    return () => observer.disconnect();
  }, [enabled]);

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const heightChanged = scroller.scrollHeight !== lastHeightRef.current;
    const atBottom = isScrolledToBottom(scroller);
    const wasPinned = pinnedRef.current;
    pinnedRef.current = nextStickPinned({
      pinned: wasPinned,
      atBottom,
      scrollTop: scroller.scrollTop,
      lastScrollTop: lastScrollTopRef.current,
      heightChanged,
    });
    remember(scroller);

    if (heightChanged && pinnedRef.current) {
      stick();
      return;
    }
    if (!wasPinned && pinnedRef.current) stick();
  };

  const unpin = useCallback(() => {
    pinnedRef.current = false;
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !enabled) return;
    let touchY: number | undefined;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (nextY !== undefined && touchY !== undefined && nextY > touchY) unpin();
      touchY = nextY;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) unpin();
    };
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: true });
    scroller.addEventListener('keydown', onKeyDown);
    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, unpin]);

  return { scrollerRef, contentRef, onScroll, unpin };
}
