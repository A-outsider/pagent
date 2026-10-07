import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useAgentSession } from '../hooks/useAgentSession';
import { ScreenAnnotator } from '@/features/canvas/ScreenAnnotator';
import { ElementPicker } from '@/features/canvas/ElementPicker';
import { rpc } from '@/shared/extension/rpc-client';
import type { ObservedElement } from '@/shared/contracts/page';
import { pageObserver } from '@/features/page/observer';
import { uiEvents } from '@/features/page/ui-events';
import {
  notePagentInteraction,
} from '@/features/page/selection';
import {
  clampFabPosition,
  clampPanelPosition,
  clampPanelWidth,
  collapsedPosition,
  FAB_DRAG_THRESHOLD,
  isPanelDragTarget,
  loadPanelPosition,
  loadPanelWidth,
  nextPanelResize,
  panelPositionFromFab,
  panelSize,
  savePanelLayout,
  type PanelPosition,
  type PanelResizeEdge,
} from '@/shared/extension/panel-position';
import { applyShadowTheme } from '@/shared/extension/theme';
import { AgentPanel } from './AgentPanel';
import { TeachingOrb } from '@/features/teaching/ui/TeachingOrb';
import { useTeachingSession } from '@/features/teaching/ui/useTeachingSession';
import { TeachingCommentPicker } from '@/features/teaching/ui/TeachingCommentPicker';
import {
  isTeachingCommentDirectHotkey,
  isTeachingCommentElementHotkey,
} from '@/shared/extension/hotkey';
import { BotIcon } from '@/shared/ui/BotIcon';
import { waitForCapturePaint, withCaptureTimeout } from '@/shared/extension/capture';

export function AgentApp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const session = useAgentSession();
  const teaching = useTeachingSession(session.page.url, session.activeId);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const fabFrameRef = useRef<number | undefined>(undefined);
  const skipFabClickRef = useRef(false);
  const dragRef = useRef<
    | { kind: 'panel'; offsetX: number; offsetY: number }
    | {
        kind: 'fab';
        offsetX: number;
        offsetY: number;
        startX: number;
        startY: number;
        moved: boolean;
      }
    | null
  >(null);
  const resizeRef = useRef<{
    edge: PanelResizeEdge;
    pointerX: number;
    width: number;
    left: number;
    top: number;
  } | null>(null);
  const positionRef = useRef<PanelPosition>(loadPanelPosition());
  const widthRef = useRef(loadPanelWidth());
  const [position, setPosition] = useState<PanelPosition>(positionRef.current);
  const [width, setWidth] = useState(widthRef.current);
  const [manipulating, setManipulating] = useState(false);
  const [capturingScreen, setCapturingScreen] = useState(false);
  const [annotationSource, setAnnotationSource] = useState<string>();
  const [imageDataUrl, setImageDataUrl] = useState<string>();
  const [selectingElement, setSelectingElement] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ObservedElement>();
  // teachingCommentMode: undefined = not commenting, 'pick' = picking element, 'direct' = direct comment without element, HTMLElement = element picked
  const [teachingCommentMode, setTeachingCommentMode] = useState<'pick' | 'direct' | HTMLElement | undefined>(undefined);
  const [captureError, setCaptureError] = useState('');
  const [toolCaptureHidden, setToolCaptureHidden] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const wasActiveRef = useRef(session.agentActive);

  // 面板首次打开时只保留一个标签：优先最近 3h 内最后更新的会话，否则新建会话。
  const freshSessionRef = useRef(false);
  useEffect(() => {
    if (!open || !session.ready || freshSessionRef.current) return;
    freshSessionRef.current = true;
    void session.openInitialConversation();
  }, [open, session.ready, session.openInitialConversation]);

  const updatePosition = (next: PanelPosition) => {
    positionRef.current = next;
    setPosition(next);
  };

  const updateWidth = (next: number) => {
    widthRef.current = next;
    setWidth(next);
  };

  const persistLayout = () => {
    savePanelLayout(positionRef.current, widthRef.current);
  };

  useLayoutEffect(() => {
    applyShadowTheme(rootRef.current, session.themeClass);
  }, [session.themeClass]);

  useEffect(() => {
    const hideForCapture = () => setToolCaptureHidden(true);
    const restoreAfterCapture = () => setToolCaptureHidden(false);
    uiEvents.addEventListener('capture-start', hideForCapture);
    uiEvents.addEventListener('capture-end', restoreAfterCapture);
    return () => {
      uiEvents.removeEventListener('capture-start', hideForCapture);
      uiEvents.removeEventListener('capture-end', restoreAfterCapture);
    };
  }, []);

  const restoredRef = useRef(false);
  const attachKeyRef = useRef(session.attachKey);
  useLayoutEffect(() => {
    if (!session.ready || !session.restorePanel) return;
    const attached = session.attachKey !== attachKeyRef.current;
    attachKeyRef.current = session.attachKey;
    if (restoredRef.current && !attached) return;
    restoredRef.current = true;
    onOpenChange(true);
  }, [session.ready, session.restorePanel, session.attachKey, onOpenChange]);

  useLayoutEffect(() => {
    if (session.agentActive && !session.workingOnThisPage) onOpenChange(false);
  }, [session.agentActive, session.workingOnThisPage, onOpenChange]);

  const prevWorkingOnThisPage = useRef(false);
  useLayoutEffect(() => {
    const wasWorking = prevWorkingOnThisPage.current;
    prevWorkingOnThisPage.current = session.workingOnThisPage;
    if (!wasWorking && session.workingOnThisPage) {
      onOpenChange(true);
    }
  }, [session.workingOnThisPage, onOpenChange]);

  useEffect(() => {
    const fab = fabRef.current;
    if (open || session.agentActive || manipulating) {
      fab?.style.setProperty('--fab-look-x', '0');
      fab?.style.setProperty('--fab-look-y', '0');
      return;
    }
    const onMove = (event: PointerEvent) => {
      if (fabFrameRef.current) cancelAnimationFrame(fabFrameRef.current);
      fabFrameRef.current = requestAnimationFrame(() => {
        const currentFab = fabRef.current;
        if (!currentFab) return;
        const rect = currentFab.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const distance = Math.max(1, Math.hypot(dx, dy));
        const isNearby = distance <= 280;
        const strength = Math.min(1, distance / 72);
        currentFab.style.setProperty(
          '--fab-look-x',
          isNearby ? ((dx / distance) * strength).toFixed(3) : '0',
        );
        currentFab.style.setProperty(
          '--fab-look-y',
          isNearby ? ((dy / distance) * strength).toFixed(3) : '0',
        );
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (fabFrameRef.current) cancelAnimationFrame(fabFrameRef.current);
    };
  }, [open, session.agentActive, manipulating]);

  // 工作结束时：让右下角圆形按钮水平翻转庆祝一次
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = session.agentActive;
    if (wasActive && !session.agentActive) {
      setCelebrating(true);
    } else if (session.agentActive) {
      setCelebrating(false);
    }
  }, [session.agentActive]);

  useEffect(() => {
    if (!celebrating) return;
    const timer = window.setTimeout(() => setCelebrating(false), 1300);
    return () => window.clearTimeout(timer);
  }, [celebrating]);

  useLayoutEffect(() => {
    if (teaching.session?.status === 'recording') onOpenChange(false);
    if (teaching.session && ['summarizing', 'reviewing'].includes(teaching.session.status)) {
      onOpenChange(true);
    }
  }, [teaching.session?.status, onOpenChange]);

  useLayoutEffect(() => {
    const clampToViewport = () => {
      const nextWidth = clampPanelWidth(widthRef.current);
      const size = panelSize(nextWidth);
      const next = open
        ? clampPanelPosition(positionRef.current, size)
        : panelPositionFromFab(clampFabPosition(collapsedPosition(positionRef.current, size)), size);
      updateWidth(nextWidth);
      updatePosition(next);
      savePanelLayout(next, nextWidth);
    };
    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [open]);

  useLayoutEffect(() => {
    const onMove = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (resize) {
        const size = panelRef.current?.getBoundingClientRect();
        const next = nextPanelResize(
          resize.edge,
          resize,
          event.clientX,
          size?.height ?? panelSize(widthRef.current).height,
        );
        updateWidth(next.width);
        updatePosition(next.position);
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'fab') {
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (!drag.moved && distance < FAB_DRAG_THRESHOLD) return;
        if (!drag.moved) {
          drag.moved = true;
          skipFabClickRef.current = true;
          setManipulating(true);
        }
        event.preventDefault();
        const size = panelSize(widthRef.current);
        const fab = clampFabPosition({
          x: event.clientX - drag.offsetX,
          y: event.clientY - drag.offsetY,
        });
        updatePosition(panelPositionFromFab(fab, size));
        return;
      }
      const size = panelRef.current?.getBoundingClientRect();
      updatePosition(
        clampPanelPosition(
          { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY },
          { width: widthRef.current, height: size?.height ?? panelSize(widthRef.current).height },
        ),
      );
    };
    const onUp = () => {
      if (!dragRef.current && !resizeRef.current) return;
      dragRef.current = null;
      resizeRef.current = null;
      setManipulating(false);
      persistLayout();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, []);

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !isPanelDragTarget(event.target)) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    dragRef.current = {
      kind: 'panel',
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setManipulating(true);
  };

  const onFabPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || open) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    skipFabClickRef.current = false;
    dragRef.current = {
      kind: 'fab',
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  const onResizePointerDown = (edge: PanelResizeEdge) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      edge,
      pointerX: event.clientX,
      width: widthRef.current,
      left: positionRef.current.x,
      top: positionRef.current.y,
    };
    setManipulating(true);
  };

  const height = panelSize(width).height;
  const closedPosition = collapsedPosition(position, { width, height });

  const markScreen = async () => {
    if (capturingScreen) return;
    setCaptureError('');
    const panel = panelRef.current;
    const previousStyle = panel && { transition: panel.style.transition, opacity: panel.style.opacity, pointerEvents: panel.style.pointerEvents };
    let readyForAnnotation = false;
    if (panel) {
      panel.style.transition = 'none';
      panel.style.opacity = '0';
      panel.style.pointerEvents = 'none';
    }
    setCapturingScreen(true);
    try {
      await waitForCapturePaint();
      const screenshot = await withCaptureTimeout(() => rpc('screenshot.capture', { raw: true }));
      if (typeof screenshot !== 'string' || !screenshot.startsWith('data:image/')) {
        throw new Error('截图数据无效');
      }
      readyForAnnotation = true;
      setAnnotationSource(screenshot);
    } catch (error) {
      console.error('无法截取当前屏幕', error);
      setCaptureError(error instanceof Error ? error.message : '无法截取当前屏幕');
    } finally {
      if (panel && previousStyle) {
        panel.style.transition = previousStyle.transition;
        // A successful capture stays hidden for annotation; failure must restore it.
        if (!readyForAnnotation) Object.assign(panel.style, previousStyle);
      }
      setCapturingScreen(false);
    }
  };

  useEffect(() => {
    if (!captureError) return;
    const timer = window.setTimeout(() => setCaptureError(''), 4_000);
    return () => window.clearTimeout(timer);
  }, [captureError]);

  // 示教模式期间支持 Alt+X 选中元素备注，Alt+C 直接备注
  useEffect(() => {
    if (teaching.session?.status !== 'recording') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTeachingCommentElementHotkey(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setTeachingCommentMode('pick');
      } else if (isTeachingCommentDirectHotkey(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setTeachingCommentMode('direct');
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    const shadowRoot = rootRef.current?.shadowRoot ?? rootRef.current;
    shadowRoot?.addEventListener('keydown', onKeyDown as EventListener, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      shadowRoot?.removeEventListener('keydown', onKeyDown as EventListener, true);
    };
  }, [teaching.session?.status]);

  const agentCapturingScreen = session.tasks.some(
    (task) => task.title === 'capture_screenshot' && task.status === 'running',
  );
  const panelHidden =
    capturingScreen || Boolean(annotationSource) || toolCaptureHidden || agentCapturingScreen || selectingElement || teachingCommentMode === 'pick';
  const stopPanelEvent = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <div ref={rootRef} className={`${session.themeClass} pointer-events-none`}>
      <div className="pointer-events-none fixed inset-0">
        <div
          ref={panelRef}
          className={`pagent-morph-shell pointer-events-auto absolute select-text ${
            open ? 'is-open' : ''
          } ${manipulating ? 'is-manipulating' : ''} ${celebrating ? 'is-celebrating' : ''}`}
          style={{
            left: open ? position.x : closedPosition.x,
            top: open ? position.y : closedPosition.y,
            width: open ? width : 56,
            height: open ? height : 56,
            opacity: panelHidden ? 0 : undefined,
            pointerEvents: panelHidden ? 'none' : undefined,
            transition: panelHidden ? 'none' : undefined,
          }}
          onPointerDown={(event) => {
            notePagentInteraction();
            stopPanelEvent(event);
          }}
          onPointerMove={stopPanelEvent}
          onPointerUp={stopPanelEvent}
          onPointerCancel={stopPanelEvent}
          onMouseDown={stopPanelEvent}
          onMouseMove={stopPanelEvent}
          onMouseUp={stopPanelEvent}
          onMouseOver={stopPanelEvent}
          onMouseOut={stopPanelEvent}
          onClick={stopPanelEvent}
          onDoubleClick={stopPanelEvent}
          onAuxClick={stopPanelEvent}
          onContextMenu={stopPanelEvent}
          onWheel={stopPanelEvent}
        >
          <div
            className="pagent-panel-stage"
            aria-hidden={!open}
            inert={!open}
          >
            <div
              data-panel-resize="left"
              className="pagent-resize pagent-resize-left"
              role="separator"
              aria-orientation="vertical"
              aria-label="向左调整面板宽度"
              onPointerDown={onResizePointerDown('left')}
            />
            <div
              data-panel-resize="right"
              className="pagent-resize pagent-resize-right"
              role="separator"
              aria-orientation="vertical"
              aria-label="向右调整面板宽度"
              onPointerDown={onResizePointerDown('right')}
            />
            <AgentPanel
              settings={session.settings}
              messages={session.messages}
              tasks={session.tasks}
              running={session.running}
              workingOnThisPage={session.workingOnThisPage}
              thinking={session.thinking}
              startedAt={session.startedAt}
              error={session.error}
              page={session.page}
              conversations={session.conversations}
              closedTabIds={session.closedTabIds}
              activeConversationId={session.activeId}
              onSelectConversation={session.selectConversation}
              onCreateConversation={session.createConversation}
              onCloseTab={session.closeTab}
              onDeleteConversation={session.deleteConversation}
              view={session.view}
              onViewChange={session.setView}
              onClose={() => onOpenChange(false)}
              onSubmit={(prompt, context, attachedImage, badges, references) => {
                setImageDataUrl(undefined);
                setSelectedElement(undefined);
                if (teaching.session?.status === 'reviewing') {
                  void teaching.revise(prompt);
                } else {
                  void session.send(prompt, context, attachedImage, badges, references);
                }
              }}
              onStop={() => void session.stop()}
              onClearSelection={session.clearSelection}
              onSettingsChange={session.setSettings}
              onHeaderPointerDown={onHeaderPointerDown}
              imageDataUrl={imageDataUrl}
              onMarkScreen={() => void markScreen()}
              onRemoveImage={() => setImageDataUrl(undefined)}
              selectedElement={selectedElement}
              selectingElement={selectingElement}
              onSelectElement={() => setSelectingElement(true)}
              onRemoveElement={() => setSelectedElement(undefined)}
              teachingSession={teaching.session}
              teachingBusy={teaching.busy}
              confirmedCommand={teaching.confirmed}
              onStartTeaching={() => void teaching.start()}
              onCancelTeaching={() => void teaching.cancel()}
              onConfirmTeaching={() => void teaching.confirm()}
            />
          </div>
          <button
            ref={fabRef}
            type="button"
            className={`pagent-fab ${
              session.agentActive ? 'is-working' : ''
            } ${!session.agentActive ? 'is-idle' : ''} ${celebrating ? 'is-celebrating' : ''}`}
            onPointerDown={onFabPointerDown}
            onClick={() => {
              if (skipFabClickRef.current) {
                skipFabClickRef.current = false;
                return;
              }
              onOpenChange(true);
            }}
            tabIndex={open ? -1 : 0}
            aria-hidden={open}
            aria-label={session.agentActive ? '打开 Pagent，Agent Active' : '打开 Pagent'}
          >
            {session.agentActive ? (
              <>
                <span className="pagent-fab-halo" aria-hidden />
                <span className="pagent-fab-pulse" aria-hidden />
              </>
            ) : null}
            <BotIcon animated size={56} aria-hidden />
          </button>
        </div>
      </div>
      {teaching.session && ['recording', 'summarizing'].includes(teaching.session.status) && (
        <TeachingOrb
          summarizing={teaching.session.status === 'summarizing'}
          onFinish={() => {
            onOpenChange(true);
            void teaching.finish();
          }}
          onCancel={() => void teaching.cancel()}
        />
      )}
      {annotationSource && (
        <ScreenAnnotator
          source={annotationSource}
          onCancel={() => {
            setAnnotationSource(undefined);
            setCapturingScreen(false);
          }}
          onConfirm={(dataUrl) => {
            setImageDataUrl(dataUrl);
            setAnnotationSource(undefined);
            setCapturingScreen(false);
          }}
        />
      )}
      {selectingElement && (
        <ElementPicker
          onCancel={() => setSelectingElement(false)}
          onSelect={(element) => {
            const description = pageObserver.describe(element);
            if (description) setSelectedElement(description);
            setSelectingElement(false);
          }}
        />
      )}
      {teachingCommentMode !== undefined && (
        <TeachingCommentPicker
          targetElement={
            teachingCommentMode === 'direct'
              ? null
              : teachingCommentMode === 'pick'
              ? undefined
              : teachingCommentMode
          }
          onCancel={() => setTeachingCommentMode(undefined)}
          onSubmit={(comment, element) => {
            teaching.addComment(comment, element);
            setTeachingCommentMode(undefined);
          }}
        />
      )}
      {captureError && (
        <div
          role="alert"
          className="pointer-events-auto fixed top-4 left-1/2 z-2147483647 -translate-x-1/2 rounded-xl border border-red/25 bg-surface px-4 py-2 text-[12.5px] text-red shadow-raised"
        >
          截图失败：{captureError}
        </div>
      )}
    </div>
  );
}
