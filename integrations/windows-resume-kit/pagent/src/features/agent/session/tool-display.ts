import { truncate } from '@/shared/utils/utils';
import { formatDuration } from '@/features/agent/runtime/usage';

export type ToolVisualKind =
  | 'observe'
  | 'search'
  | 'click'
  | 'type'
  | 'navigate'
  | 'tab'
  | 'wait'
  | 'read'
  | 'script'
  | 'network';

type ToolMeta = {
  label: string;
  kind: ToolVisualKind;
};

const NAMED_SCRIPTS: Record<string, string> = {
  extract_links: '提取链接',
  extract_headings: '提取标题',
  extract_forms: '提取表单',
  extract_interactions: '提取交互目标',
  extract_meta: '提取元信息',
  page_stats: '页面统计',
  get_selection: '读取选区',
};

const TOOLS: Record<string, ToolMeta> = {
  observe_page: { label: '观察页面', kind: 'observe' },
  observe_page_changes: { label: '观察页面变化', kind: 'observe' },
  search_page_text: { label: '搜索页面', kind: 'search' },
  capture_screenshot: { label: '截取屏幕', kind: 'read' },
  click_element: { label: '点击', kind: 'click' },
  dblclick_element: { label: '双击', kind: 'click' },
  hover_element: { label: '悬停', kind: 'click' },
  type_text: { label: '输入文字', kind: 'type' },
  prepare_resume_form: { label: '检查简历附件与表单状态', kind: 'type' },
  ensure_resume_attachment: { label: '检查并补齐简历附件', kind: 'type' },
  upload_attachment: { label: '上传授权附件', kind: 'type' },
  boss_start_task: { label: '启动 BOSS 后台任务', kind: 'observe' },
  boss_get_task: { label: '读取 BOSS 任务状态', kind: 'observe' },
  boss_cancel_task: { label: '停止 BOSS 后台任务', kind: 'click' },
  boss_start_favorites_task: { label: '启动感兴趣岗位投递', kind: 'type' },
  boss_get_favorites_task: { label: '读取感兴趣投递进度', kind: 'observe' },
  boss_cancel_favorites_task: { label: '停止感兴趣岗位投递', kind: 'click' },
  boss_inspect_favorites_exception: { label: '核实投递异常现场', kind: 'observe' },
  boss_resolve_favorites_exception: { label: '决定继续、跳过或暂停', kind: 'click' },
  boss_audit_resume_images: { label: 'BOSS 简历查漏（只读）', kind: 'observe' },
  boss_get_resume_image_scan: { label: '读取 BOSS 查漏结果', kind: 'observe' },
  boss_send_resume_images: { label: 'BOSS 简历图片发送计划', kind: 'type' },
  clear_field: { label: '清空输入', kind: 'type' },
  select_option: { label: '选择选项', kind: 'type' },
  interact_elements: { label: '批量交互', kind: 'type' },
  verify_form_fields: { label: '核验表单字段', kind: 'observe' },
  run_nowcoder_fill: { label: '牛客助手补充填写', kind: 'type' },
  scan_resume_form: { label: '扫描整表与遗漏', kind: 'observe' },
  record_resume_progress: { label: '登记简历栏目与经历进度', kind: 'observe' },
  drag_element: { label: '拖拽', kind: 'click' },
  press_key: { label: '按下按键', kind: 'type' },
  scroll_page: { label: '滚动页面', kind: 'navigate' },
  wait_for: { label: '等待变化', kind: 'wait' },
  navigate: { label: '打开网页', kind: 'navigate' },
  go_back: { label: '后退', kind: 'navigate' },
  go_forward: { label: '前进', kind: 'navigate' },
  reload_page: { label: '刷新页面', kind: 'navigate' },
  page_info: { label: '读取页面信息', kind: 'read' },
  get_source: { label: '查看源码', kind: 'read' },
  list_tabs: { label: '列出标签页', kind: 'tab' },
  open_tab: { label: '打开标签页', kind: 'tab' },
  switch_tab: { label: '切换标签页', kind: 'tab' },
  close_tab: { label: '关闭标签页', kind: 'tab' },
  extract_interactions: { label: '提取交互目标', kind: 'observe' },
  inspect_element_tree: { label: '查看元素结构', kind: 'read' },
  find_common_ancestor: { label: '查找共同祖先', kind: 'read' },
  execute_named_script: { label: '运行内置脚本', kind: 'read' },
  execute_cdp_script: { label: '执行页面脚本', kind: 'script' },
  execute_cdp_command: { label: '发送 CDP 命令', kind: 'script' },
  cdp_click_xy: { label: '坐标点击', kind: 'click' },
  get_network_log: { label: '查看网络请求', kind: 'network' },
  get_console_log: { label: '查看控制台', kind: 'network' },
  get_network_request: { label: '查看请求详情', kind: 'network' },
  memory_search: { label: '查询记忆', kind: 'read' },
  memory_write: { label: '写入记忆', kind: 'read' },
};

export const BUILTIN_TOOL_DISPLAY = Object.entries(TOOLS).map(([name, meta]) => ({
  name,
  label: meta.label,
}));

const STATUS_LABELS: Record<string, string> = {
  pending: '准备中',
  running: '进行中',
  done: '已完成',
  error: '失败',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shortUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
    return truncate(`${parsed.host}${path === '/' ? '' : path}`, 42);
  } catch {
    return truncate(value, 42);
  }
}

export function toolLabel(name: string): string {
  return TOOLS[name]?.label ?? name.replaceAll('_', ' ');
}

export function toolKind(name: string): ToolVisualKind {
  return TOOLS[name]?.kind ?? 'observe';
}

export function toolStatusLabel(status?: string): string {
  if (!status) return '';
  return STATUS_LABELS[status] ?? status;
}

export function toolChip(name: string, args?: unknown, status?: string): string {
  const fields = asRecord(args);
  const fallback = toolStatusLabel(status) || '进行中';
  switch (name) {
    case 'boss_start_task':
      return fields.operation === 'audit' ? '自动查漏' : fields.dryRun === false ? '自动投递简历图片' : '生成投递预览';
    case 'boss_get_task':
      return fields.includeRecipients ? '读取任务明细' : '读取任务摘要';
    case 'boss_cancel_task':
      return '停止后续操作';
    case 'observe_page':
      return text(fields.reason) || '查看当前页面';
    case 'observe_page_changes':
      return fields.action === 'start' ? '开始记录变化' : '检查操作结果';
    case 'search_page_text':
      return text(fields.query) ? `查找「${truncate(text(fields.query), 24)}」` : '全文查找';
    case 'capture_screenshot':
      return fields.fullPage ? '整页截图' : '可见区域';
    case 'click_element':
    case 'dblclick_element':
    case 'hover_element':
    case 'clear_field':
    case 'upload_attachment':
      return text(fields.elementId) ? `目标 ${truncate(text(fields.elementId), 18)}` : fallback;
    case 'type_text':
      return text(fields.text) ? `「${truncate(text(fields.text), 24)}」` : '写入输入框';
    case 'select_option':
      return text(fields.value) ? `选中 ${truncate(text(fields.value), 24)}` : '选择一项';
    case 'interact_elements':
      return Array.isArray(fields.steps) ? `${fields.steps.length} 个目标` : '批量执行';
    case 'verify_form_fields':
      return Array.isArray(fields.fields) ? `${fields.fields.length} 个字段` : '核验填写结果';
    case 'drag_element':
      return text(fields.targetId) ? `拖到 ${truncate(text(fields.targetId), 16)}` : '拖动元素';
    case 'press_key':
      return text(fields.key) ? `按 ${text(fields.key)}` : '发送按键';
    case 'scroll_page': {
      const direction = text(fields.direction);
      if (direction === 'up') return '向上滚动';
      if (direction === 'down') return '向下滚动';
      if (direction === 'left') return '向左滚动';
      if (direction === 'right') return '向右滚动';
      if (direction === 'top') return '回到顶部';
      if (direction === 'bottom') return '滚到底部';
      return text(fields.elementId) ? `滚到 ${truncate(text(fields.elementId), 16)}` : '滚动页面';
    }
    case 'wait_for':
      if (text(fields.text)) return `等待「${truncate(text(fields.text), 20)}」`;
      if (text(fields.urlIncludes)) return `等待地址变化`;
      if (typeof fields.ms === 'number') return `等待 ${fields.ms} 毫秒`;
      return '等待页面变化';
    case 'navigate':
    case 'open_tab':
      return text(fields.url) ? shortUrl(text(fields.url)) : name === 'open_tab' ? '新标签页' : '跳转页面';
    case 'go_back':
      return '返回上一页';
    case 'go_forward':
      return '前往下一页';
    case 'reload_page':
      return '重新加载';
    case 'page_info':
      return '标题、地址和选区';
    case 'get_source': {
      const kind = text(fields.type) || 'dom';
      if (text(fields.grep)) return `${kind} 搜索「${truncate(text(fields.grep), 20)}」`;
      if (kind === 'page') return '原始 HTML';
      if (kind === 'text') return '可见正文';
      if (kind === 'links') return '页面链接';
      if (kind === 'scripts') return '页面脚本';
      if (kind === 'stylesheets') return '页面样式';
      if (kind === 'url') return '当前地址';
      if (kind === 'title') return '当前标题';
      return '实时 HTML';
    }
    case 'list_tabs':
      return '当前窗口';
    case 'switch_tab':
    case 'close_tab':
      return typeof fields.tabId === 'number' ? `标签 ${fields.tabId}` : fallback;
    case 'inspect_element_tree':
      return text(fields.elementId)
        ? `根元素 ${truncate(text(fields.elementId), 18)}`
        : '轻量元素树';
    case 'find_common_ancestor':
      return Array.isArray(fields.elementIds) && fields.elementIds.length > 0
        ? `${fields.elementIds.length} 个元素的祖先`
        : '最近共同祖先';
    case 'execute_named_script':
      return NAMED_SCRIPTS[text(fields.name)] ?? text(fields.name) ?? '只读脚本';
    case 'execute_cdp_script':
      return text(fields.expression) ? truncate(text(fields.expression), 28) : '页面表达式';
    case 'execute_cdp_command':
      return text(fields.method) ? `命令 ${truncate(text(fields.method), 36)}` : 'CDP 命令';
    case 'cdp_click_xy':
      return typeof fields.x === 'number' && typeof fields.y === 'number'
        ? `坐标 ${Math.round(fields.x)}, ${Math.round(fields.y)}`
        : '按坐标点击';
    case 'get_network_log':
      return text(fields.urlIncludes) ? `包含 ${truncate(text(fields.urlIncludes), 20)}` : '最近的请求';
    case 'get_console_log':
      return text(fields.level) ? `${text(fields.level)} 级别` : '最近的日志';
    case 'get_network_request':
      return text(fields.requestId) ? truncate(text(fields.requestId), 22) : '单条请求';
    case 'memory_search':
      return text(fields.query) ? `检索「${truncate(text(fields.query), 24)}」` : '检索相关记忆';
    case 'memory_write':
      return text(fields.memoryId)
        ? `修改 ${truncate(text(fields.memoryId), 18)}`
        : fields.scope === 'local'
          ? '保存为局部记忆'
          : '保存为全局记忆';
    default:
      return fallback;
  }
}

/** 任务已耗时的展示行；没有计时数据时返回空串。 */
export function toolElapsedLine(elapsedMs?: number): string {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return '';
  return `当前任务已耗时 ${formatDuration(elapsedMs)}，请注意控制时间。`;
}

/** 结果正文里已经带过耗时行时先剥掉，避免面板上重复显示。 */
export function stripElapsedLine(output?: string): string {
  if (!output) return '';
  return output.replace(/^当前任务已耗时[^\n]*\r?\n?/, '');
}

export function toolUsesMono(name: string): boolean {
  return toolKind(name) === 'script';
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function compactArgs(args?: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return compactText(args);
  try {
    const json = JSON.stringify(args);
    if (!json || json === '{}' || json === '[]' || json === 'null') return '';
    return json;
  } catch {
    return '';
  }
}

export function formatToolArgs(args?: unknown): string[] {
  const line = compactArgs(args);
  return line ? [line] : [];
}

export function toolDetailLines(
  args?: unknown,
  output?: string,
  status?: string,
  elapsedMs?: number,
): string[] {
  // 耗时行排在结果正文之前
  const elapsed = toolElapsedLine(elapsedMs);
  const body = stripElapsedLine(output);
  if (body) {
    const line = compactText(body);
    return line ? [elapsed, line].filter(Boolean) : elapsed ? [elapsed] : [];
  }
  if (status === 'running' || status === 'pending') {
    return [elapsed, compactArgs(args) || '正在执行…'].filter(Boolean);
  }
  if (status === 'error') {
    return [elapsed, '调用失败'].filter(Boolean);
  }
  const argsLine = compactArgs(args);
  return [elapsed, argsLine].filter(Boolean);
}
