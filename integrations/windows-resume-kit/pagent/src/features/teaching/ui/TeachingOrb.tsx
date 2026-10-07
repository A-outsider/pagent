import { useEffect, useRef, useState } from 'react';

export function TeachingOrb({
  summarizing,
  onFinish,
  onCancel,
}: {
  summarizing?: boolean;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const orbRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const orb = orbRef.current;
        if (!orb) return;
        const rect = orb.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const length = Math.max(1, Math.hypot(dx, dy));
        const x = Math.max(-1, Math.min(1, dx / length));
        const y = Math.max(-1, Math.min(1, dy / length));
        orb.style.setProperty('--look-x', x.toFixed(3));
        orb.style.setProperty('--look-y', y.toFixed(3));
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div ref={orbRef} className={`pagent-teaching-orb-wrap ${summarizing ? 'is-summarizing' : ''}`}>
      {menuOpen && !summarizing && (
        <div className="pagent-teaching-menu" role="dialog" aria-label="示教控制">
          <div>
            <strong>正在示教</strong>
            <span>操作会持续记录</span>
            <span className="text-[10px] text-ink-3 opacity-80">Alt+X 选中元素备注 · Alt+C 直接备注</span>
          </div>
          <button type="button" className="is-primary" onClick={onFinish}>结束并总结</button>
          <button type="button" onClick={onCancel}>取消</button>
        </div>
      )}
      <button
        type="button"
        className="pagent-teaching-orb"
        aria-label={summarizing ? '正在总结示教流程' : '打开示教控制'}
        aria-expanded={menuOpen}
        onClick={() => {
          if (!summarizing) setMenuOpen((open) => !open);
        }}
      >
        <span className="pagent-teaching-pulse" aria-hidden />
        <span className="pagent-teaching-face" aria-hidden>
          <span className="pagent-teaching-eye" />
          <span className="pagent-teaching-eye" />
        </span>
      </button>
    </div>
  );
}
