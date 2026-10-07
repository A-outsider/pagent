export const PAGENT_Z_INDEX = 2147483647;
export const DEFAULT_PANEL_WIDTH = 400;
export const MIN_PANEL_WIDTH = 320;
export const MAX_PANEL_WIDTH = 720;
export const FAB_SIZE = 56;
export const FAB_INSET = 8;
export const FAB_DRAG_THRESHOLD = 5;

export type PanelPosition = { x: number; y: number };
export type PanelResizeEdge = 'left' | 'right';

const STORAGE_KEY = 'pagent-panel-pos';

type StoredLayout = Partial<PanelPosition> & { width?: number };

function readStoredLayout(): StoredLayout | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredLayout;
  } catch {
    return null;
  }
}

export function clampPanelWidth(
  width: number,
  viewport = { width: window.innerWidth },
): number {
  const max = Math.max(240, Math.min(MAX_PANEL_WIDTH, viewport.width - 40));
  const min = Math.min(MIN_PANEL_WIDTH, max);
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function panelSize(width = DEFAULT_PANEL_WIDTH): { width: number; height: number } {
  return {
    width: clampPanelWidth(width),
    height: Math.min(680, window.innerHeight - 48),
  };
}

export function clampPanelPosition(
  position: PanelPosition,
  size = panelSize(),
  viewport = { width: window.innerWidth, height: window.innerHeight },
): PanelPosition {
  const maxX = Math.max(8, viewport.width - size.width - 8);
  const maxY = Math.max(8, viewport.height - size.height - 8);
  return {
    x: Math.min(maxX, Math.max(8, position.x)),
    y: Math.min(maxY, Math.max(8, position.y)),
  };
}

export function defaultPanelPosition(
  size = panelSize(),
  viewport = { width: window.innerWidth, height: window.innerHeight },
): PanelPosition {
  return clampPanelPosition(
    {
      x: viewport.width - size.width - 20,
      y: viewport.height - size.height - 20,
    },
    size,
    viewport,
  );
}

export function clampFabPosition(
  position: PanelPosition,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): PanelPosition {
  const maxX = Math.max(FAB_INSET, viewport.width - FAB_SIZE - FAB_INSET);
  const maxY = Math.max(FAB_INSET, viewport.height - FAB_SIZE - FAB_INSET);
  return {
    x: Math.min(maxX, Math.max(FAB_INSET, position.x)),
    y: Math.min(maxY, Math.max(FAB_INSET, position.y)),
  };
}

/** Bottom-right corner of the panel, where the collapsed orb sits. */
export function collapsedPosition(
  position: PanelPosition,
  size = panelSize(),
  viewport = { width: window.innerWidth, height: window.innerHeight },
): PanelPosition {
  return clampFabPosition(
    {
      x: position.x + size.width - FAB_SIZE,
      y: position.y + size.height - FAB_SIZE,
    },
    viewport,
  );
}

/** Panel top-left that keeps the orb at the panel's bottom-right corner. */
export function panelPositionFromFab(
  fab: PanelPosition,
  size = panelSize(),
): PanelPosition {
  return {
    x: fab.x + FAB_SIZE - size.width,
    y: fab.y + FAB_SIZE - size.height,
  };
}

export function loadPanelWidth(): number {
  const stored = readStoredLayout();
  if (typeof stored?.width === 'number') return clampPanelWidth(stored.width);
  return clampPanelWidth(DEFAULT_PANEL_WIDTH);
}

export function loadPanelPosition(): PanelPosition {
  const stored = readStoredLayout();
  if (typeof stored?.x === 'number' && typeof stored?.y === 'number') {
    return { x: stored.x, y: stored.y };
  }
  return defaultPanelPosition(panelSize(loadPanelWidth()));
}

export function savePanelLayout(position: PanelPosition, width: number) {
  try {
    const nextWidth = clampPanelWidth(width);
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        x: Math.round(position.x),
        y: Math.round(position.y),
        width: nextWidth,
      }),
    );
  } catch {
    // ignore
  }
}

export function savePanelPosition(position: PanelPosition) {
  savePanelLayout(position, loadPanelWidth());
}

export function nextPanelResize(
  edge: PanelResizeEdge,
  start: { pointerX: number; width: number; left: number; top: number },
  clientX: number,
  height = panelSize().height,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): { position: PanelPosition; width: number } {
  const delta = edge === 'left' ? start.pointerX - clientX : clientX - start.pointerX;
  const width = clampPanelWidth(start.width + delta, viewport);
  const left = edge === 'left' ? start.left - (width - start.width) : start.left;
  return {
    width,
    position: clampPanelPosition({ x: left, y: start.top }, { width, height }, viewport),
  };
}

export function isPanelDragTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !target.closest(
      'button, a, input, textarea, select, [role="switch"], [data-slot="select-trigger"], [data-panel-resize]',
    )
  );
}
