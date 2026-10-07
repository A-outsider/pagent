// @ts-nocheck
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createShader, playSweep, accentChain, ACCENTS } from "glimm";
import {
  IconArrowUp,
  IconBrowser,
  IconCommand,
  IconPlus,
  IconPlayerRecord,
  IconPointer,
  IconScreenshot,
  IconSquareFilled,
  IconX,
} from '@tabler/icons-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { rpc } from '@/shared/extension/rpc-client';
import type { ObservedElement } from '@/shared/contracts/page';
import type { SavedCommand } from '@/shared/contracts/teaching';
import { getPageCommands } from '@/features/agent/session/boss-commands';
import type { UserBadge, UserReference } from '@/shared/contracts/session-messages';
import { Badge } from '@/shared/ui/badge';
import {
  applyComposerInsertion,
  clampMentionMenuHeight,
  composerNeedsFullWidth,
  visiblePrompt,
  slashCommandContext,
  mergeComposerContexts,
  filterBrowserTabs,
  filterSlashCommands,
  normalizeBrowserTabs,
  parseComposerToken,
  tabHost,
  type BrowserTab,
  type MentionedTabSnapshot,
  type SlashCommand,
} from '@/features/agent/session/composer';

/* The built-in "prism" palette is only cyan→indigo→magenta, so a sweep
 * reads as blue/purple. Build a true full-spectrum rainbow instead. */
const RAINBOW = accentChain([
  ACCENTS.red,
  ACCENTS.orange,
  ACCENTS.yellow,
  ACCENTS.green,
  ACCENTS.cyan,
  ACCENTS.blue,
  ACCENTS.purple,
]);

/* ─────────────────────────────────────────────────────────
 * PROMPT BAR
 * A composer with real controls: + features, @ browser tabs,
 * / commands, a model picker, and send.
 * Type @ or / to open the menus; ↑↓ + Enter to pick.
 * Variants: Rounded (card radius) · Pill (full radius).
 * ───────────────────────────────────────────────────────── */

const DEMO_TABS: BrowserTab[] = [
  { id: 1, title: "当前页面", url: "https://example.com/app", active: true },
  { id: 2, title: "GitHub", url: "https://github.com/pagent" },
  { id: 3, title: "文档", url: "https://docs.example.com" },
];

type MenuRow = {
  key: string;
  name: string;
  desc: string;
  badge?: string;
  tab?: BrowserTab;
  command?: SlashCommand;
  screenMark?: boolean;
  elementSelect?: boolean;
  teachingStart?: boolean;
};

type PromptModel = { key: string; name: string; tag: string };

/* self-running demo: walk the @ menu, then the / menu, and repeat.
 * Any pointer or key interaction hands control to the user. */
const AUTO_STEPS: {
  draft: string;
  active?: number;
  modelOpen?: boolean;
  model?: string;
  hold: number;
}[] = [
  { draft: "", model: "vanilla-1", hold: 1100 },
  { draft: "@", active: 0, hold: 900 },
  { draft: "@", active: 1, hold: 620 },
  { draft: "@", active: 2, hold: 700 },
  { draft: "", hold: 700 },
  { draft: "/", active: 0, hold: 900 },
  { draft: "/", active: 1, hold: 620 },
  { draft: "/", active: 3, hold: 1000 },
  { draft: "", hold: 800 },
  { draft: "", modelOpen: true, hold: 1200 },
  { draft: "", model: "sprinkles-5", hold: 2400 },
  { draft: "", hold: 900 },
];

export default function PromptBar({
  variant = "Rounded",
  demo = true,
  tall = false,
  placeholder,
  onSend,
  running = false,
  onStop,
  models = [],
  modelKey,
  onModelChange,
  imageDataUrl,
  onMarkScreen,
  onRemoveImage,
  selectedElement,
  selectingElement = false,
  onSelectElement,
  onRemoveElement,
  onStartTeaching,
}: {
  variant?: string;
  /** the self-running walkthrough; turn off when embedding in a real surface */
  demo?: boolean;
  /** hero sizing: a multi-line input with controls on their own row */
  tall?: boolean;
  placeholder?: string;
  onSend?: (
    text: string,
    context?: string,
    imageDataUrl?: string,
    badges?: UserBadge[],
    references?: UserReference[],
  ) => void;
  /** while running the send control becomes a stop button */
  running?: boolean;
  onStop?: () => void;
  models?: PromptModel[];
  modelKey?: string;
  onModelChange?: (key: string) => void;
  imageDataUrl?: string;
  onMarkScreen?: () => void;
  onRemoveImage?: () => void;
  selectedElement?: ObservedElement;
  selectingElement?: boolean;
  onSelectElement?: () => void;
  onRemoveElement?: () => void;
  onStartTeaching?: () => void;
}) {
  const pill = variant === "Pill";
  const [draft, setDraft] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const catalog = models;
  const selectedModel = catalog.find((item) => item.key === modelKey) ?? catalog[0];
  const [mentions, setMentions] = useState<BrowserTab[]>([]);
  const [tabs, setTabs] = useState<BrowserTab[]>(demo ? DEMO_TABS : []);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState("");
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);
  const [selectedCommand, setSelectedCommand] = useState<SlashCommand | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(demo);
  const [autoStep, setAutoStep] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const wide = tall || (draft.length > 0 && expanded);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [menuMaxHeight, setMenuMaxHeight] = useState<number>();
  const [engaged, setEngaged] = useState(false);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const glimmRef = useRef<HTMLCanvasElement>(null);
  const shaderRef = useRef<ReturnType<typeof createShader> | null>(null);
  const sweepingRef = useRef(false);

  /* hand control to the user: stop the demo loop, and when they aim at
   * the input itself, clear the demo's leftover draft for a clean start */
  const takeOver = (event: { target: EventTarget | null }) => {
    setAuto(false);
    if (auto && event.target === inputRef.current) setDraft("");
  };

  const token = dismissed ? null : parseComposerToken(draft);
  const menu: "plus" | "at" | "slash" | null = plusOpen ? "plus" : token?.kind ?? null;
  const query = plusOpen ? "" : token?.query ?? "";

  const rows: MenuRow[] =
    menu === "plus"
      ? [
          {
            key: "select-element",
            name: "选择元素",
            desc: "在页面上点击选择一个元素",
            elementSelect: true,
          },
          {
            key: "mark-screen",
            name: "标记屏幕",
            desc: "截取当前画面并绘制标记",
            screenMark: true,
          },
          {
            key: "start-teaching",
            name: "开始示教",
            desc: "记录操作并编写可复用命令",
            teachingStart: true,
          },
        ]
      : menu === "at"
        ? [
            ...filterBrowserTabs(tabs, query).map((tab) => ({
              key: `tab-${tab.id}`,
              name: tab.title,
              desc: tabHost(tab.url),
              badge: tab.active ? "当前" : mentions.some((item) => item.id === tab.id) ? "已选" : undefined,
              tab,
            })),
          ]
        : menu === "slash"
        ? filterSlashCommands(
            getPageCommands(location.href, savedCommands).map((command) => ({
              key: command.key,
              name: command.name,
              desc: command.desc,
              prompt: command.prompt,
            })),
            query,
          ).map((command) => ({
            key: command.key,
            name: command.name,
            desc: command.desc,
            command,
          }))
        : [];

  useEffect(() => {
    setActive(0);
    setEngaged(false);
  }, [menu, query]);

  useEffect(() => {
    if (menu !== "at" || demo) return;
    let cancelled = false;
    setTabsLoading(true);
    setTabsError("");
    void rpc("tabs.query", {})
      .then((result) => {
        if (cancelled) return;
        setTabs(normalizeBrowserTabs(result));
      })
      .catch(() => {
        if (cancelled) return;
        setTabsError("无法列出标签页");
      })
      .finally(() => {
        if (!cancelled) setTabsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [menu, demo]);

  useEffect(() => {
    if (menu !== "slash" || demo) return;
    let cancelled = false;
    void rpc("commands.list", { url: location.href })
      .then((result) => {
        if (!cancelled && Array.isArray(result)) setSavedCommands(result as SavedCommand[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [menu, demo]);

  /* a single highlight glides to the active row instead of each row
   * toggling its own background — matches the gliding pill in the nav */
  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [menu, query, active, rows.length]);

  useLayoutEffect(() => {
    if (!menu) {
      setMenuMaxHeight(undefined);
      return;
    }
    const anchor = composerAnchorRef.current;
    const frame = anchor?.closest(".pagent-window") ?? anchor?.getRootNode();
    const topEdge =
      frame instanceof Element ? frame.getBoundingClientRect().top : 8;
    if (!anchor) return;
    const available = Math.floor(anchor.getBoundingClientRect().top - topEdge - 10);
    setMenuMaxHeight(clampMentionMenuHeight(available));
  }, [menu, query, rows.length, draft, wide, mentions.length]);

  /* Build the shader with a pinned hue phase. createShader seeds its
   * internal hueShift from Math.random(), which made the sweep a different
   * colour on every reload — pin it so the rainbow is identical each time. */
  const makeShader = () => {
    const canvas = glimmRef.current;
    if (!canvas) return null;
    const random = Math.random;
    Math.random = () => 0;
    try {
      return createShader({
        canvas,
        palette: RAINBOW,
        direction: "ltr",
        bandTight: 10,
        swellAmount: 0.85,
      });
    } finally {
      Math.random = random;
    }
  };

  /* Glimm shader lives inside the composer, invisible at rest. Selecting
   * the flagship model fires a one-shot rainbow sweep across the interior. */
  useEffect(() => {
    shaderRef.current = makeShader();
    return () => {
      shaderRef.current?.destroy();
      shaderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const celebrate = () => {
    if (sweepingRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Recreate the shader per sweep so uTime restarts at 0 — the hue phase
    // (which drifts with time) is then identical on every trigger.
    shaderRef.current?.destroy();
    const shader = makeShader();
    shaderRef.current = shader;
    if (!shader) return;
    sweepingRef.current = true;
    const sweep = playSweep(shader, {
      palette: RAINBOW,
      direction: "ltr",
      sweepMs: 570,
      outroMs: 80,
      peakAlpha: 1.3,
      bandTight: 10,
      brightness: 1.4,
      swellAmount: 1,
      waveSpeed: 1.8,
      easing: "easeOutExpo",
    });
    sweep.done.finally(() => {
      sweepingRef.current = false;
    });
  };

  /* autoplay: apply the current step, then advance after its hold */
  useEffect(() => {
    if (!auto) return;
    const step = AUTO_STEPS[autoStep % AUTO_STEPS.length];
    setDraft(step.draft);
    if (step.active !== undefined) setActive(step.active);
    if (step.modelOpen !== undefined) setModelOpen(step.modelOpen);
    const t = setTimeout(() => setAutoStep((s) => s + 1), step.hold);
    return () => clearTimeout(t);
  }, [auto, autoStep]);

  /* Move wrapped text above the controls, then grow to a compact maximum. */
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const minHeight = 28;
    const maxHeight = 100;
    if (!draft) {
      if (expanded) setExpanded(false);
      input.style.height = `${minHeight}px`;
      input.style.overflowY = "hidden";
      return;
    }

    const controls = controlsRef.current;
    const measure = measureRef.current;
    const modelButton = modelRef.current;
    if (!controls || !measure || !modelButton) return;

    const needsFullWidth = composerNeedsFullWidth(
      draft,
      measure.offsetWidth,
      controls.clientWidth,
      modelButton.offsetWidth,
    );
    if (needsFullWidth !== expanded) {
      setExpanded(needsFullWidth);
    }

    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft, expanded]);

  useEffect(() => {
    if (!plusOpen) return;
    const close = (event: PointerEvent) => {
      const inside = event.composedPath().some(
        (node) => node instanceof HTMLElement && node.dataset.promptbar !== undefined,
      );
      if (!inside) setPlusOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [plusOpen]);

  const closeMenus = () => {
    setPlusOpen(false);
    setModelOpen(false);
  };

  const pick = (row: MenuRow) => {
    if (row.elementSelect) {
      setPlusOpen(false);
      onSelectElement?.();
      return;
    } else if (row.screenMark) {
      setPlusOpen(false);
      onMarkScreen?.();
      return;
    } else if (row.teachingStart) {
      setPlusOpen(false);
      onStartTeaching?.();
      return;
    } else if (row.tab) {
      setMentions((current) => (current.some((item) => item.id === row.tab!.id) ? current : [...current, row.tab!]));
      setDraft(applyComposerInsertion(draft, token, ""));
    } else if (row.command) {
      setDraft(applyComposerInsertion(draft, token, ""));
      setSelectedCommand(row.command);
    }
    setPlusOpen(false);
    setDismissed(false);
    inputRef.current?.focus();
  };

  const canSend = !preparing && (
    draft.trim().length > 0
    || mentions.length > 0
    || Boolean(selectedCommand)
    || Boolean(imageDataUrl)
    || Boolean(selectedElement)
  );
  const send = async () => {
    if (!canSend) return;
    const selectedMentions = [...mentions];
    const selectedFlowCommand = selectedCommand;
    const text =
      visiblePrompt(draft, selectedMentions) ||
      (selectedFlowCommand ? `执行命令 /${selectedFlowCommand.key}（${selectedFlowCommand.name}）` : "") ||
      (imageDataUrl
        ? "请分析我在屏幕截图中标记的内容。"
        : selectedElement
          ? "请分析我选中的页面元素。"
          : "");
    if (!text) return;
    setPreparing(true);
    setExpanded(false);
    setDraft("");
    setMentions([]);
    setSelectedCommand(null);
    if (inputRef.current) {
      inputRef.current.style.height = "28px";
      inputRef.current.style.overflowY = "hidden";
    }
    closeMenus();
    try {
      let snapshots: MentionedTabSnapshot[] = [];
      if (!demo && selectedMentions.length > 0) {
        try {
          snapshots = (await rpc("tabs.snapshot", {
            tabIds: selectedMentions.map((tab) => tab.id),
          })) as MentionedTabSnapshot[];
        } catch {
          // Keep empty snapshots when one or more pages cannot be read.
        }
      }

      const references: UserReference[] = [];
      for (const tab of selectedMentions) {
        const snapshot = snapshots.find((s) => s.tabId === tab.id);
        references.push({
          type: 'page',
          tabId: tab.id,
          title: tab.title,
          url: tab.url,
          active: tab.active,
          content: snapshot?.content,
          truncated: snapshot?.truncated,
          error: snapshot?.error,
        });
      }

      if (selectedFlowCommand) {
        references.push({
          type: 'command',
          key: selectedFlowCommand.key,
          name: selectedFlowCommand.name,
          desc: selectedFlowCommand.desc,
          prompt: selectedFlowCommand.prompt,
        });
      }

      if (selectedElement) {
        references.push({
          type: 'element',
          name: selectedElement.name,
          tag: selectedElement.tag,
          element: selectedElement,
        });
      }

      const userBadges: UserBadge[] = [
        ...selectedMentions.map((tab) => ({ type: 'tab' as const, id: tab.id, title: tab.title })),
        ...(selectedFlowCommand ? [{ type: 'command' as const, key: selectedFlowCommand.key, name: selectedFlowCommand.name }] : []),
        ...(selectedElement ? [{ type: 'element' as const, name: selectedElement.name, tag: selectedElement.tag }] : []),
      ];
      onSend?.(
        text,
        undefined,
        imageDataUrl,
        userBadges.length > 0 ? userBadges : undefined,
        references.length > 0 ? references : undefined,
      );
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div
      data-promptbar
      className={demo ? "flex min-h-[384px] w-full max-w-105 flex-col justify-end pb-8" : "w-full"}
      onPointerDownCapture={takeOver}
      onKeyDownCapture={takeOver}
    >
      {/* composer is the anchor — menus grow up from its top edge */}
      <div ref={composerAnchorRef} className="relative">
      {/* ── @ / slash menu ─────────────────────────────── */}
      {menu && (
        <div
          onMouseLeave={() => setEngaged(false)}
          className="pagent-mention-menu absolute inset-x-0 bottom-full z-30 mb-2 rounded-[10px] bg-surface p-1 shadow-raised"
          style={{ maxHeight: menuMaxHeight }}
        >
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {/* single gliding highlight — appears once a row is hovered */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{
                top: rowBox?.top ?? 0,
                height: rowBox?.height ?? 0,
                opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
                transition:
                  "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
              }}
            />
            {rows.map((row, i) => (
                <button
                  key={row.key}
                  type="button"
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    setActive(i);
                    setEngaged(true);
                  }}
                  onClick={() => pick(row)}
                  className="relative z-10 flex h-9 w-full min-w-0 items-center gap-2.5 rounded-[6px] px-2 text-left"
                >
                  <span className="flex size-5.5 shrink-0 items-center justify-center text-ink-2">
                    {row.elementSelect ? (
                      <IconPointer size={16} stroke={2} />
                    ) : row.screenMark ? (
                      <IconScreenshot size={16} stroke={2} />
                    ) : row.teachingStart ? (
                      <IconPlayerRecord size={16} stroke={2} />
                    ) : row.tab ? (
                      <IconBrowser size={16} stroke={2} />
                    ) : (
                      <IconCommand size={16} stroke={2} />
                    )}
                  </span>
                  <span className="min-w-0 shrink truncate text-[12.5px] font-medium text-ink">
                    {row.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{row.desc}</span>
                  {row.badge && (
                    <span className={`shrink-0 text-[11px] font-medium ${row.badge === "当前" ? "text-accent-ink" : "text-ink-3"}`}>
                      {row.badge}
                    </span>
                  )}
                </button>
            ))}
            {rows.length === 0 && (
              <div className="flex h-9 items-center px-2 text-[12px] text-ink-3">
                {menu === "plus"
                  ? "没有可用功能"
                  : menu === "at"
                  ? tabsLoading
                    ? "正在读取标签页…"
                    : tabsError || (query ? `没有匹配「${query}」的标签页` : "当前窗口没有可列出的标签页")
                  : query
                    ? `没有匹配「${query}」的命令`
                    : "没有可用命令"}
              </div>
            )}
          </div>
          <div className="mt-1 shrink-0 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">
            {menu === "plus"
              ? "选择要添加的功能"
              : menu === "at"
                ? "输入 @ 搜索浏览器标签页"
                : "输入 / 搜索命令"}
          </div>
        </div>
      )}

      {/* ── composer ───────────────────────────────────── */}
      <div
        aria-disabled={selectingElement}
        className={`relative isolate flex flex-col overflow-hidden border border-line bg-surface shadow-card transition-[border-color,border-radius,opacity,filter] duration-150 focus-within:border-line-strong ${
          tall ? "gap-2.5 p-3.5" : "gap-1.5 p-1.5"
        } ${
          pill ? (mentions.length > 0 || wide ? "rounded-[24px]" : "rounded-full") : tall ? "rounded-[22px]" : "rounded-[14px]"
        } ${selectingElement ? "pointer-events-none opacity-45 grayscale" : ""}`}
      >
        {/* rainbow glimm sweep — plays across the interior on model change.
            explicit w/h: a <canvas> is a replaced element and won't stretch
            to inset-0 alone, which feeds back into the shader's ResizeObserver. */}
        <canvas
          ref={glimmRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
          style={{ borderRadius: "inherit" }}
        />
        <span
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none absolute invisible whitespace-pre text-[13px] leading-[18px]"
        >
          {draft}
        </span>

        {mentions.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 pt-0.5 ${pill ? "px-1" : "px-0.5"}`}>
            {mentions.map((tab) => (
              <span
                key={tab.id}
                className={`flex h-6.5 items-center gap-1.5 bg-field py-1 pr-1 pl-1.5 text-[11.5px] text-ink-2 shadow-hairline ${
                  pill ? "rounded-full" : "rounded-chip"
                }`}
                style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}
              >
                <IconBrowser size={13} stroke={2} />
                <span className="max-w-36 truncate">{tab.title}</span>
                <button
                  type="button"
                  aria-label={`移除 ${tab.title}`}
                  onClick={() => setMentions((current) => current.filter((item) => item.id !== tab.id))}
                  className={`-my-1 flex size-6 items-center justify-center text-ink-3 transition-colors duration-100 hover:bg-line/70 hover:text-ink ${
                    pill ? "rounded-full" : "rounded-[5px]"
                  }`}
                >
                  <IconX size={12} stroke={2.5} />
                </button>
              </span>
            ))}
          </div>
        )}

        {selectedCommand && (
          <div className={`flex items-center gap-2 pt-0.5 ${pill ? "px-1" : "px-0.5"}`}>
            <Badge variant="default" className="h-7 max-w-full gap-1.5 rounded-md pr-1 pl-2 shadow-hairline">
              <IconCommand size={13} />
              <span className="max-w-48 truncate">/{selectedCommand.key}</span>
              <span className="max-w-32 truncate text-ink-3">{selectedCommand.name}</span>
              <button
                type="button"
                aria-label={`移除命令 ${selectedCommand.name}`}
                onClick={() => setSelectedCommand(null)}
                className="grid size-5 place-items-center rounded-sm text-ink-3 hover:bg-line/70 hover:text-ink"
              >
                <IconX size={11} stroke={2.5} />
              </button>
            </Badge>
          </div>
        )}

        {imageDataUrl && (
          <div className={`flex items-center gap-2 pt-0.5 ${pill ? "px-1" : "px-0.5"}`}>
            <div className="relative overflow-hidden rounded-lg border border-line bg-field">
              <img
                src={imageDataUrl}
                alt="待发送的屏幕标记"
                className="h-14 w-24 object-cover"
              />
              <button
                type="button"
                aria-label="移除屏幕标记"
                onClick={onRemoveImage}
                className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/65 text-white"
              >
                <IconX size={12} stroke={2.5} />
              </button>
            </div>
            <span className="text-[11.5px] text-ink-3">已附加屏幕标记</span>
          </div>
        )}

        {selectedElement && (
          <div className={`flex items-center gap-2 pt-0.5 ${pill ? "px-1" : "px-0.5"}`}>
            <span className={`flex h-7 min-w-0 max-w-full items-center gap-1.5 bg-field py-1 pr-1 pl-2 text-[11.5px] text-ink-2 shadow-hairline ${
              pill ? "rounded-full" : "rounded-chip"
            }`}>
              <IconPointer size={13} stroke={2} className="size-[13px] shrink-0" />
              <span className="min-w-0 max-w-48 truncate">
                {selectedElement.name || `<${selectedElement.tag}>`}
              </span>
              <button
                type="button"
                aria-label="移除选中的元素"
                onClick={onRemoveElement}
                className={`-my-1 flex size-6 shrink-0 items-center justify-center text-ink-3 transition-colors duration-100 hover:bg-line/70 hover:text-ink ${
                  pill ? "rounded-full" : "rounded-[5px]"
                }`}
              >
                <IconX size={12} stroke={2.5} />
              </button>
            </span>
          </div>
        )}

        <div
          ref={controlsRef}
          className={`grid items-end gap-x-1 gap-y-1.5 ${
            wide
              ? "grid-cols-[28px_auto_minmax(0,1fr)_28px]"
              : "grid-cols-[28px_minmax(0,1fr)_auto_28px]"
          }`}
        >
          <button
            type="button"
            aria-label="添加内容"
            aria-expanded={plusOpen}
            onClick={() => {
              setPlusOpen((current) => !current);
              setModelOpen(false);
              inputRef.current?.focus();
            }}
            className={`flex size-7 shrink-0 items-center justify-center justify-self-start text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] ${
              pill ? "rounded-full" : "rounded-[8px]"
            } ${plusOpen ? "bg-hover text-ink" : ""} ${wide ? "col-start-1 row-start-2" : "col-start-1 row-start-1"}`}
          >
            <IconPlus size={17} stroke={2.2} />
          </button>

          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={preparing}
            onChange={(event) => {
              setDraft(event.target.value);
              setDismissed(false);
              setPlusOpen(false);
              setModelOpen(false);
            }}
            onKeyDown={(event) => {
              if (menu && rows.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setEngaged(true);
                  setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
                  return;
                }
                if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                  event.preventDefault();
                  pick(rows[active]);
                  return;
                }
              }
              if (event.key === "Escape") {
                setDismissed(true);
                closeMenus();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={preparing ? "正在读取附加页面…" : (placeholder ?? "Write a message…")}
            aria-label="Prompt"
            className={`${tall ? "min-h-[68px] px-2 py-2 text-[14px] leading-5" : "min-h-7 px-1 py-[5px] text-[13px] leading-[18px]"} min-w-0 w-full resize-none bg-transparent text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3 placeholder:truncate ${
              wide ? "col-span-full col-start-1 row-start-1" : "col-start-2 row-start-1"
            }`}
          />

          <div
            ref={modelRef}
            className={`min-w-0 ${wide ? "col-start-2 row-start-2 justify-self-start" : "col-start-3 row-start-1"}`}
          >
            {catalog.length > 0 && selectedModel && (
              <Select
                open={modelOpen}
                onOpenChange={(next) => {
                  setModelOpen(next);
                  if (next) setPlusOpen(false);
                }}
                value={selectedModel.key}
                onValueChange={(value) => {
                  onModelChange?.(value);
                  setModelOpen(false);
                  setPlusOpen(false);
                  celebrate();
                }}
              >
                <SelectTrigger
                  aria-label="选择模型"
                  className={`h-7 w-auto max-w-32 gap-1 border-0 bg-transparent px-1.5 text-[12px] font-medium text-ink-2 shadow-none hover:bg-hover hover:text-ink focus-visible:ring-0 ${
                    pill ? "rounded-full" : "rounded-[8px]"
                  }`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* send — tactile square (round in the pill variant); while the
              agent is running the same control becomes a stop button */}
          <button
            type="button"
            aria-label={running ? "停止" : preparing ? "正在读取附加页面" : "Send"}
            title={running ? "停止" : undefined}
            disabled={running ? false : !canSend}
            onClick={running ? onStop : send}
            className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] ${
              pill ? "rounded-full" : "rounded-[8px]"
            } ${wide ? "col-start-4 row-start-2" : "col-start-4 row-start-1"}`}
            style={{
              background: running ? "var(--red)" : canSend ? "var(--primary)" : "var(--line-strong)",
              color: running ? "#fff" : canSend ? "var(--primary-foreground)" : "var(--ink-2)",
            }}
          >
            {running ? <IconSquareFilled size={13} /> : <IconArrowUp size={17} stroke={2.4} />}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
