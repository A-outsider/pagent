import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, UIEvent, WheelEvent } from 'react';
import { IconBrowser, IconCommand, IconEye, IconPointer } from '@tabler/icons-react';
import LoadingState from '@/shared/ui/beautiful-ui/primitives/LoadingState';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useStickToBottom } from '../hooks/useStickToBottom';
import {
  messagesAfter,
  olderRoundStartId,
  visibleWindow,
  visibleWindowStartId,
} from '../message-window';
import type { ChatMessage, TaskRow, UserBadge, UserReference } from '@/shared/contracts/session-messages';
import type { AgentSettings } from '@/shared/contracts/settings';
import type { ObservedElement } from '@/shared/contracts/page';
import { PanelHeader } from './PanelHeader';
import { TabStrip } from './TabStrip';
import { HistoryDrawer } from './HistoryDrawer';
import { PageContext } from './PageContext';
import { AssistantMessage, hasAssistantOutput } from './AssistantMessage';
import { Composer } from './Composer';
import { BossTaskPanel } from './BossTaskPanel';
import { BossFavoritesTaskPanel } from './BossFavoritesTaskPanel';
import { FlowConfirmCard } from '@/features/teaching/ui/FlowConfirmCard';
import { CommandSavedAlert } from '@/features/teaching/ui/CommandSavedAlert';
import { isRecentConversation } from '@/features/agent/session/conversations';
import type { SavedCommand, TeachingSession } from '@/shared/contracts/teaching';

const LOAD_OLDER_TOP_PX = 64;

function HiddenMessagesBanner({ count, onShow }: { count: number; onShow: () => void }) {
  return (
    <div className="flex items-center justify-center gap-1 py-0.5 text-[12px] text-ink-3">
      <span>隐藏了 {count} 条消息</span>
      <button
        type="button"
        aria-label="显示隐藏的消息"
        onClick={onShow}
        className="flex size-5 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
      >
        <IconEye size={13} stroke={2} />
      </button>
    </div>
  );
}

export function AgentPanel({
  settings,
  messages,
  tasks: _tasks,
  running,
  workingOnThisPage = running,
  thinking,
  startedAt,
  error,
  page,
  view,
  conversations,
  closedTabIds,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onCloseTab,
  onDeleteConversation,
  onViewChange,
  onClose,
  onSubmit,
  onStop,
  onClearSelection,
  onSettingsChange,
  onHeaderPointerDown,
  imageDataUrl,
  onMarkScreen,
  onRemoveImage,
  selectedElement,
  selectingElement,
  onSelectElement,
  onRemoveElement,
  teachingSession,
  teachingBusy,
  confirmedCommand,
  onStartTeaching,
  onCancelTeaching,
  onConfirmTeaching,
}: {
  settings: AgentSettings;
  messages: ChatMessage[];
  tasks: TaskRow[];
  running: boolean;
  workingOnThisPage?: boolean;
  thinking: string;
  startedAt?: number;
  error: string;
  page: { url: string; title: string; selection: string };
  conversations: Array<{ id: string; title: string; updatedAt?: number; running?: boolean }>;
  closedTabIds: ReadonlySet<string>;
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void | Promise<void>;
  onCloseTab: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  view: 'chat' | 'settings';
  onViewChange: (view: 'chat' | 'settings') => void;
  onClose: () => void;
  onSubmit: (
    prompt: string,
    context?: string,
    imageDataUrl?: string,
    badges?: UserBadge[],
    references?: UserReference[],
  ) => void;
  onStop: () => void;
  onClearSelection: () => void;
  onSettingsChange: (settings: AgentSettings) => void;
  onHeaderPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  imageDataUrl?: string;
  onMarkScreen: () => void;
  onRemoveImage: () => void;
  selectedElement?: ObservedElement;
  selectingElement: boolean;
  onSelectElement: () => void;
  onRemoveElement: () => void;
  teachingSession?: TeachingSession | null;
  teachingBusy?: boolean;
  confirmedCommand?: SavedCommand | null;
  onStartTeaching: () => void;
  onCancelTeaching: () => void;
  onConfirmTeaching: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hiddenAfterIds, setHiddenAfterIds] = useState<Record<string, string | undefined>>({});
  const [visibleFromId, setVisibleFromId] = useState<string | undefined>();
  const pendingRevealRef = useRef(false);
  const restoringRef = useRef<{ height: number; top: number } | null>(null);
  const ignoreScrollLoadRef = useRef(true);
  const lastLoadScrollTopRef = useRef(0);
  const sourceMessages = messagesAfter(messages, hiddenAfterIds[activeConversationId]);
  const renderedMessages = visibleWindow(sourceMessages, visibleFromId);
  const hiddenCount = messages.length - sourceMessages.length;
  const hidingCurrentTurn = sourceMessages.length === 0 && hiddenCount > 0;
  const lastUserId = [...messages].reverse().find((message) => message.role === 'user')?.id;
  const { scrollerRef, contentRef, onScroll, unpin } = useStickToBottom({
    enabled: view === 'chat' && !historyOpen,
    resetKey: `${activeConversationId}:${lastUserId ?? ''}`,
  });
  const sourceRef = useRef(sourceMessages);
  const fromIdRef = useRef(visibleFromId);
  sourceRef.current = sourceMessages;
  fromIdRef.current = visibleFromId;

  useEffect(() => {
    setVisibleFromId(undefined);
    ignoreScrollLoadRef.current = true;
  }, [activeConversationId]);

  const loadOlder = useCallback(() => {
    if (restoringRef.current) return;
    const olderId = olderRoundStartId(sourceRef.current, fromIdRef.current);
    const scroller = scrollerRef.current;
    if (!olderId || !scroller) return;
    unpin();
    restoringRef.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
    setVisibleFromId(olderId);
  }, [scrollerRef, unpin]);

  useLayoutEffect(() => {
    if (!pendingRevealRef.current) return;
    pendingRevealRef.current = false;
    unpin();
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [hiddenAfterIds, unpin]);

  useLayoutEffect(() => {
    const restore = restoringRef.current;
    if (!restore) return;
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.scrollTop = restore.top + (scroller.scrollHeight - restore.height);
      lastLoadScrollTopRef.current = scroller.scrollTop;
    }
    restoringRef.current = null;
  }, [visibleFromId]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    onScroll();
    const top = event.currentTarget.scrollTop;
    if (ignoreScrollLoadRef.current) {
      ignoreScrollLoadRef.current = false;
      lastLoadScrollTopRef.current = top;
      return;
    }
    const scrollingUp = top < lastLoadScrollTopRef.current;
    lastLoadScrollTopRef.current = top;
    if (scrollingUp && top <= LOAD_OLDER_TOP_PX) loadOlder();
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY >= 0) return;
    unpin();
    if (event.currentTarget.scrollTop <= LOAD_OLDER_TOP_PX) loadOlder();
  };
  // 标签页只展示最近 3h 内活跃（且未被关闭）的会话 + 当前会话；其余保留在历史抽屉中
  const tabs = conversations.filter(
    (item) =>
      (isRecentConversation(item) && !closedTabIds.has(item.id)) ||
      item.id === activeConversationId,
  );

  const handleDeleteConversation = (id: string) => {
    const target = conversations.find((item) => item.id === id);
    if (target?.running) onStop();
    onDeleteConversation(id);
  };

  return (
    <div className="pagent-window relative flex h-[min(680px,calc(100vh-48px))] w-full flex-col self-start">
      <PanelHeader
        running={running}
        workingOnThisPage={workingOnThisPage}
        view={view}
        onViewChange={onViewChange}
        onMinimize={onClose}
        onHeaderPointerDown={onHeaderPointerDown}
        onClear={() => {
          setVisibleFromId(undefined);
          setHiddenAfterIds((current) => ({
            ...current,
            [activeConversationId]: messages.at(-1)?.id,
          }));
        }}
      />

      <TabStrip
        conversations={tabs}
        activeId={activeConversationId}
        onSelect={onSelectConversation}
        onClose={onCloseTab}
        onCreate={() => {
          setHistoryOpen(false);
          return onCreateConversation();
        }}
        onHistoryToggle={() => setHistoryOpen((open) => !open)}
        historyOpen={historyOpen}
      />

      <HistoryDrawer
        open={historyOpen}
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={(id) => {
          onSelectConversation(id);
          setHistoryOpen(false);
        }}
        onDelete={handleDeleteConversation}
        onClose={() => setHistoryOpen(false)}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          aria-label="聊天记录"
          onScroll={handleScroll}
          onWheel={handleWheel}
          className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pt-2.5 pb-2"
        >
          {view === 'settings' ? (
            <SettingsPanel settings={settings} onChange={onSettingsChange} />
          ) : (
            <div ref={contentRef} className="flex flex-col gap-2.5">
              <PageContext page={page} onClearSelection={onClearSelection} />
              {hiddenCount > 0 && (
                <HiddenMessagesBanner
                  count={hiddenCount}
                  onShow={() => {
                    pendingRevealRef.current = true;
                    unpin();
                    setHiddenAfterIds((current) => {
                      const next = { ...current };
                      delete next[activeConversationId];
                      return next;
                    });
                  }}
                />
              )}
              {renderedMessages.map((message) =>
                message.role === 'user' ? (
                  <div key={message.id} className="flex justify-end pl-14">
                    <div className="flex max-w-full flex-col gap-1.5 rounded-xl bg-field p-1.5 text-[13px] leading-[1.4] text-ink">
                      {message.imageDataUrl && (
                        <img
                          src={message.imageDataUrl}
                          alt="已标记的屏幕截图"
                          className="max-h-40 max-w-full rounded-lg object-contain"
                        />
                      )}
                      {message.badges && message.badges.length > 0 && (
                        <div className="flex flex-wrap gap-1 px-1 pt-0.5">
                          {message.badges.map((badge, idx) => {
                            if (badge.type === 'tab') {
                              return (
                                <span
                                  key={`tab-${badge.id}-${idx}`}
                                  className="flex h-5.5 items-center gap-1 rounded-chip bg-surface/80 px-1.5 text-[11px] text-ink-2 shadow-hairline"
                                >
                                  <IconBrowser size={12} stroke={2} className="shrink-0" />
                                  <span className="max-w-36 truncate">{badge.title}</span>
                                </span>
                              );
                            }
                            if (badge.type === 'command') {
                              return (
                                <span
                                  key={`cmd-${badge.key}-${idx}`}
                                  className="flex h-5.5 items-center gap-1 rounded-chip bg-primary/12 px-1.5 text-[11px] font-medium text-accent-ink shadow-hairline"
                                >
                                  <IconCommand size={12} stroke={2} className="shrink-0" />
                                  <span className="max-w-28 truncate">/{badge.key}</span>
                                  {badge.name && <span className="max-w-24 truncate text-ink-3">({badge.name})</span>}
                                </span>
                              );
                            }
                            if (badge.type === 'element') {
                              return (
                                <span
                                  key={`el-${idx}`}
                                  className="flex h-5.5 items-center gap-1 rounded-chip bg-surface/80 px-1.5 text-[11px] text-ink-2 shadow-hairline"
                                >
                                  <IconPointer size={12} stroke={2} className="shrink-0" />
                                  <span className="max-w-36 truncate">{badge.name || (badge.tag ? `<${badge.tag}>` : '页面元素')}</span>
                                </span>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}
                      <span className="px-1.5">{message.content}</span>
                    </div>
                  </div>
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    streaming={running && message === renderedMessages.at(-1)}
                  />
                ),
              )}
              <BossTaskPanel key={page.url} url={page.url} />
              {teachingSession && ['summarizing', 'reviewing'].includes(teachingSession.status) && (
                <FlowConfirmCard
                  session={teachingSession}
                  busy={Boolean(teachingBusy)}
                  onConfirm={onConfirmTeaching}
                  onDiscard={onCancelTeaching}
                />
              )}
              {confirmedCommand && (
                <CommandSavedAlert command={confirmedCommand} />
              )}
              {running && !hidingCurrentTurn && !hasAssistantOutput(renderedMessages.at(-1)) && (
                <LoadingState label={thinking || '正在思考…'} variant="Dots" startTime={startedAt} />
              )}
              {error && !hidingCurrentTurn && (
                <div className="rounded-card bg-red-tint px-3 py-2 text-[12.5px] text-red">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {view === 'chat' && <BossFavoritesTaskPanel url={page.url} />}
        {view === 'chat' && (
          <Composer
            settings={settings}
            running={workingOnThisPage}
            onSubmit={(prompt, context, attachedImage, badges, references) => {
              setVisibleFromId((current) => visibleWindowStartId(sourceMessages, current));
              onSubmit(prompt, context, attachedImage, badges, references);
            }}
            onStop={onStop}
            onSettingsChange={onSettingsChange}
            imageDataUrl={imageDataUrl}
            onMarkScreen={onMarkScreen}
            onRemoveImage={onRemoveImage}
            selectedElement={selectedElement}
            selectingElement={selectingElement}
            onSelectElement={onSelectElement}
            onRemoveElement={onRemoveElement}
            onStartTeaching={onStartTeaching}
            placeholder={teachingSession?.status === 'reviewing' ? '告诉我如何调整这份流程总结…' : undefined}
          />
        )}
      </div>
    </div>
  );
}
