import type { FlowDraft, RecordedAction, TeachingSession } from '@/shared/contracts/teaching';
import { loadSecrets, loadSettings } from '@/shared/storage/storage';
import { createChatModel } from '@/features/agent/runtime/models';

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function commandKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return normalized || `flow-${Date.now().toString(36)}`;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) return String(part.text);
      return '';
    })
    .join('');
}

function jsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const source = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const value = JSON.parse(source);
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const ACTION_LABELS: Record<RecordedAction['kind'], string> = {
  click: '点击',
  double_click: '双击',
  input: '输入',
  select: '选择',
  keypress: '按键',
  scroll: '滚动',
  navigate: '页面跳转',
  reload: '页面刷新',
  tab_switch: '切换标签页',
  tab_open: '打开标签页',
  tab_close: '关闭标签页',
  comment: '备注',
};

function actionLine(action: RecordedAction, index?: number): string {
  const target = [
    action.target?.name && `名称=${action.target.name}`,
    action.target?.text && action.target.text !== action.target.name && `文本=${action.target.text}`,
    action.target?.role && `角色=${action.target.role}`,
    action.target?.tag && `标签=${action.target.tag}`,
    action.target?.inputType && `类型=${action.target.inputType}`,
    action.target?.placeholder && `占位=${action.target.placeholder}`,
    action.target?.href && `链接=${action.target.href}`,
    action.target?.selector && `定位=${action.target.selector}`,
  ].filter(Boolean).join('；');
  const value = action.redacted ? '[已隐藏敏感输入]' : action.value;
  return [
    index != null ? `${index + 1}.` : undefined,
    ACTION_LABELS[action.kind],
    `页面=${action.page.title || '无标题'} (${action.page.url})`,
    target && `目标={${target}}`,
    value != null && `值=${value}`,
    action.detail && `补充=${action.detail}`,
  ].filter(Boolean).join(' | ');
}

export function createDetailedFallbackDraft(session: TeachingSession): FlowDraft {
  const meaningful = session.actions.filter((action) => action.kind !== 'scroll');
  const steps = meaningful.map((action, index) => ({
    id: id('step'),
    title: `${ACTION_LABELS[action.kind]}${action.target?.name ? `「${action.target.name}」` : ''}`,
    detail: actionLine(action, index),
  }));
  const host = new URL(session.originUrl).hostname;
  return {
    id: id('draft'),
    sessionId: session.id,
    conversationId: session.conversationId,
    name: `${host} 操作流程`,
    key: commandKey(`${host}-flow`),
    purpose: `复用在 ${host} 上示教的操作流程`,
    prerequisites: [`打开 ${session.originUrl}`],
    steps,
    prompt: `请参考以下操作记录协助我完成同类任务：\n${steps.map((step, index) => `${index + 1}. ${step.detail}`).join('\n')}`,
    revision: 1,
    updatedAt: Date.now(),
  };
}

function normalizeDraft(
  value: Record<string, unknown>,
  base: FlowDraft,
  request?: string,
): FlowDraft {
  const rawSteps = Array.isArray(value.steps) ? value.steps : [];
  const steps = rawSteps.flatMap((item, index) => {
    if (typeof item === 'string') {
      return [{ id: id('step'), title: `步骤 ${index + 1}`, detail: item }];
    }
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    return [{
      id: id('step'),
      title: String(row.title || `步骤 ${index + 1}`),
      detail: String(row.detail || row.description || ''),
    }];
  });
  return {
    ...base,
    name: String(value.name || base.name).slice(0, 80),
    key: commandKey(String(value.key || base.key)),
    purpose: String(value.purpose || base.purpose),
    prerequisites: Array.isArray(value.prerequisites)
      ? value.prerequisites.map(String).filter(Boolean)
      : base.prerequisites,
    steps: steps.length ? steps : base.steps,
    prompt: String(value.prompt || base.prompt),
    revision: base.revision + (request ? 1 : 0),
    updatedAt: Date.now(),
    lastRequest: request,
  };
}

async function invokeJson(prompt: string): Promise<Record<string, unknown> | null> {
  const model = createChatModel(await loadSettings(), await loadSecrets());
  const response = await model.invoke(prompt);
  return jsonObject(contentText(response.content));
}

export async function summarizeTeaching(session: TeachingSession): Promise<FlowDraft> {
  const fallback = createDetailedFallbackDraft(session);
  const log = session.actions.map(actionLine).join('\n');
  const prompt = `你是资深的浏览器操作流程编辑器。根据用户示教记录编写一条可复用的中文提示词命令。
只返回 JSON，不要 markdown。格式：
{"name":"简短命令名","key":"英文或中文短 key","purpose":"用途","prerequisites":["前置条件"],"steps":[{"title":"步骤标题","detail":"明确操作"}],"prompt":"用户选择命令后填入对话框的完整提示词"}
提示词用于让 Agent 理解并协助类似任务，不是确定性脚本。
严格要求：
1. 按时间顺序覆盖每一项有业务意义的操作，不要只概括成“填写表单”或“点击按钮”。
2. detail 必须保留页面、控件名称/文本、选择项、非敏感输入值、按键、跳转目标和标签页切换。
3. 可以合并连续滚动等噪声，但同一页面的多个输入字段必须分别写明；提交、确认、筛选、切换等点击必须写明目标。
4. prompt 中必须包含完整顺序、判断条件和结果验证方式。不要编造未发生的操作，敏感值保持隐藏。
发起页面：${session.originUrl}
示教记录：
${log}`;
  try {
    const value = await invokeJson(prompt);
    if (!value) return fallback;
    const normalized = normalizeDraft(value, fallback);
    const meaningfulCount = fallback.steps.length;
    const minimumSteps = Math.min(20, Math.max(1, Math.ceil(meaningfulCount * 0.6)));
    const detailLength = normalized.steps.reduce((sum, step) => sum + step.detail.length, 0);
    if (normalized.steps.length < minimumSteps || detailLength < meaningfulCount * 45) {
      return { ...normalized, steps: fallback.steps, prompt: fallback.prompt };
    }
    return normalized;
  } catch {
    return fallback;
  }
}

export async function reviseFlow(draft: FlowDraft, request: string): Promise<FlowDraft> {
  const prompt = `你是浏览器操作流程编辑器。根据用户修改要求更新流程草稿。
只返回 JSON，字段必须为 name、key、purpose、prerequisites、steps、prompt。
除非用户明确要求删除，否则必须保留当前草稿中的控件名称、输入值、页面跳转、标签切换和验证细节。
当前草稿：${JSON.stringify(draft)}
用户要求：${request}`;
  try {
    const value = await invokeJson(prompt);
    return value ? normalizeDraft(value, draft, request) : {
      ...draft,
      prompt: `${draft.prompt}\n\n补充要求：${request}`,
      revision: draft.revision + 1,
      updatedAt: Date.now(),
      lastRequest: request,
    };
  } catch {
    return {
      ...draft,
      prompt: `${draft.prompt}\n\n补充要求：${request}`,
      revision: draft.revision + 1,
      updatedAt: Date.now(),
      lastRequest: request,
    };
  }
}
