export type ComposerToken = {
  kind: 'at' | 'slash';
  query: string;
  start: number;
};

export type BrowserTab = {
  id: number;
  title: string;
  url: string;
  active?: boolean;
};

export type MentionedTabSnapshot = {
  tabId: number;
  title: string;
  url: string;
  active?: boolean;
  content?: string;
  truncated?: boolean;
  error?: string;
};

export type SlashCommand = {
  key: string;
  name: string;
  desc: string;
  prompt: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    key: 'observe',
    name: '观测页面',
    desc: '查看结构和可见元素',
    prompt: '观测当前页面，概括页面类型、主要区域和可操作元素。',
  },
  {
    key: 'summarize',
    name: '总结页面',
    desc: '列出关键信息和可操作项',
    prompt: '总结当前页面的主要内容，列出关键信息和可操作项。',
  },
  {
    key: 'screenshot',
    name: '截取屏幕',
    desc: '描述当前看到的界面',
    prompt: '截取当前页面，描述你看到的界面和需要注意的地方。',
  },
  {
    key: 'search',
    name: '搜索文本',
    desc: '在页面中查找内容',
    prompt: '在当前页面搜索：',
  },
  {
    key: 'links',
    name: '提取链接',
    desc: '按用途分组列出',
    prompt: '提取当前页面的主要链接，按用途分组列出。',
  },
  {
    key: 'headings',
    name: '提取标题',
    desc: '概括文档结构',
    prompt: '提取当前页面的标题层级，概括文档结构。',
  },
  {
    key: 'forms',
    name: '分析表单',
    desc: '字段、必填项和提交方式',
    prompt: '分析当前页面的表单字段、必填项和提交方式。',
  },
  {
    key: 'tabs',
    name: '列出标签',
    desc: '当前窗口的浏览器标签',
    prompt: '列出当前窗口的标签页，并指出当前标签。',
  },
  {
    key: 'network',
    name: '网络请求',
    desc: '标出失败或异常项',
    prompt: '查看当前页面最近的网络请求，标出失败或异常项。',
  },
  {
    key: 'console',
    name: '控制台',
    desc: '重点汇报错误和警告',
    prompt: '查看当前页面控制台输出，重点汇报错误和警告。',
  },
];

export function parseComposerToken(draft: string): ComposerToken | null {
  const match = /(^|\s)([@/])(\S*)$/.exec(draft);
  if (!match || match.index == null || match[2] == null || match[1] == null) return null;
  return {
    kind: match[2] === '@' ? 'at' : 'slash',
    query: match[3] ?? '',
    start: match.index + match[1].length,
  };
}

export function applyComposerInsertion(draft: string, token: ComposerToken | null, insertion: string): string {
  const prefix = token ? draft.slice(0, token.start) : draft;
  if (!insertion) return prefix;
  return `${prefix}${insertion}${insertion.endsWith(' ') ? '' : ' '}`;
}

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((command) => {
    const key = command.key.toLowerCase();
    return (
      key.startsWith(q) ||
      command.name.toLowerCase().includes(q) ||
      command.desc.toLowerCase().includes(q)
    );
  });
}

export function normalizeBrowserTabs(value: unknown): BrowserTab[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const tab = item as Record<string, unknown>;
    if (typeof tab.id !== 'number') return [];
    const title = typeof tab.title === 'string' && tab.title.trim() ? tab.title.trim() : '无标题';
    const url = typeof tab.url === 'string' ? tab.url : '';
    return [{ id: tab.id, title, url, active: Boolean(tab.active) }];
  });
}

export function tabHost(url: string): string {
  if (!url) return '未知地址';
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function filterBrowserTabs(tabs: BrowserTab[], query: string): BrowserTab[] {
  const q = query.trim().toLowerCase();
  if (!q) return tabs;
  return tabs.filter(
    (tab) => tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q) || tabHost(tab.url).toLowerCase().includes(q),
  );
}

export const MENTION_MENU_MAX_HEIGHT = 240;

export function clampMentionMenuHeight(available: number, maxHeight = MENTION_MENU_MAX_HEIGHT): number {
  return Math.min(maxHeight, Math.max(0, Math.floor(available)));
}

export function composerNeedsFullWidth(
  draft: string,
  measuredTextWidth: number,
  controlsWidth: number,
  modelButtonWidth: number,
): boolean {
  if (!draft) return false;
  const fixedControlsWidth = 28 * 2 + modelButtonWidth;
  const inlineGaps = 4 * 3;
  const inlineInputWidth = controlsWidth - fixedControlsWidth - inlineGaps;
  return draft.includes('\n') || measuredTextWidth + 8 > inlineInputWidth;
}

export function visiblePrompt(draft: string, tabs: BrowserTab[]): string {
  return draft.trim() || (tabs.length > 0 ? '请查看这些标签页。' : '');
}

export function slashCommandContext(command: SlashCommand): string {
  return [
    `用户明确选择了命令 /${command.key}（${command.name}）。`,
    '必须结合用户当前补充要求，按照以下命令说明执行；不要向用户复述整段说明。',
    '<command_instructions>',
    command.prompt,
    '</command_instructions>',
  ].join('\n');
}

export function mergeComposerContexts(
  ...contexts: Array<string | null | undefined>
): string | undefined {
  const merged = contexts.map((value) => value?.trim()).filter(Boolean).join('\n\n');
  return merged || undefined;
}
