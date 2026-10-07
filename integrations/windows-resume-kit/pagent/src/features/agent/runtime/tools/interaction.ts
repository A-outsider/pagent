import { tool } from 'langchain';
import { z } from 'zod';
import { safeJson } from '@/shared/utils/utils';
import { uploadAttachmentSchema } from '@/shared/contracts/attachments';
import type { ToolBridge, TrackActionFn } from './types';
import { isRedactedPlaceholder, resolveResumeExpectation, type ResumeSourceResolver } from './resume-source';
import type { FormFieldVerification, InteractionResult } from '@/shared/contracts/page';

export function createInteractionTools(bridge: ToolBridge, trackAction: TrackActionFn, isResumeFilling = () => false, sourceValue: ResumeSourceResolver = () => undefined) {
  const uploadAttachment = tool(
    async (request) => safeJson(await trackAction(() => isResumeFilling()
      ? bridge.uploadAttachment(request, { avatarOnly: true })
      : bridge.uploadAttachment(request))),
    {
      name: 'upload_attachment',
      description: '把用户已授权的 MCP 附件赋给当前标签页已观测的 input[type=file]。仅传 serverName、attachmentId、elementId 和可选 revision；不传 URL、本地路径、密钥或文件内容。每次替换为一个文件，检查 accept/disabled，支持隐藏 input；filesAssigned 只表示赋值完成，必须继续核对网页的接收或上传结果。',
      schema: uploadAttachmentSchema,
    },
  );
  const click = tool(
    async ({ elementId, revision }) =>
      safeJson(await trackAction(() => bridge.content('dom.click', { elementId, revision }))),
    {
      name: 'click_element',
      description: '点击 observe_page 返回的 elementId。点击前会先派发完整的 hover 事件序列（pointerover/mouseover/mouseenter/mousemove），可触发依赖悬停展开的菜单或控件。',
      schema: z.object({
        elementId: z.string(),
        revision: z.number().optional(),
      }),
    },
  );

  const dblclick = tool(
    async ({ elementId, revision }) =>
      safeJson(await trackAction(() => bridge.content('dom.dblclick', { elementId, revision }))),
    {
      name: 'dblclick_element',
      description: '双击指定元素。',
      schema: z.object({
        elementId: z.string(),
        revision: z.number().optional(),
      }),
    },
  );

  const hover = tool(
    async ({ elementId, revision }) =>
      safeJson(await trackAction(() => bridge.content('dom.hover', { elementId, revision }))),
    {
      name: 'hover_element',
      description: '悬停在指定元素上，用于展开菜单。',
      schema: z.object({
        elementId: z.string(),
        revision: z.number().optional(),
      }),
    },
  );

  const typeText = tool(
    async ({ elementId, text, mode, submit, revision }) =>
      isRedactedPlaceholder(text) ? safeJson({ elementId, ok: false, satisfied: false, error: '不能写入脱敏占位符，请从简历 MCP 获取真实来源。' }) : safeJson(await trackAction(() =>
        bridge.content('dom.type', { elementId, text, mode, submit, revision }),
      )),
    {
      name: 'type_text',
      description:
        '原子设置输入框文本并返回 changed/satisfied。默认 replace，避免“先清空再输入”的竞态；只有明确需要保留原值时才使用 append。',
      schema: z.object({
        elementId: z.string(),
        text: z.string(),
        mode: z.enum(['replace', 'append']).default('replace'),
        submit: z.boolean().optional(),
        revision: z.number().optional(),
      }),
    },
  );

  const clear = tool(
    async ({ elementId, revision }) =>
      safeJson(await trackAction(() => bridge.content('dom.clear', { elementId, revision }))),
    {
      name: 'clear_field',
      description: '清空输入框。',
      schema: z.object({
        elementId: z.string(),
        revision: z.number().optional(),
      }),
    },
  );

  const select = tool(
    async ({ elementId, value, revision }) =>
      safeJson(await trackAction(() =>
        bridge.content('dom.select', { elementId, value, revision }),
      )),
    {
      name: 'select_option',
      description: '选择下拉框选项。',
      schema: z.object({
        elementId: z.string(),
        value: z.string(),
        revision: z.number().optional(),
      }),
    },
  );

  const interact = tool(
    async ({ steps }) => {
      const resolved = steps.map((step) => step.intent === 'activate' ? { step } : (() => {
        const value = resolveResumeExpectation(step, sourceValue);
        return 'error' in value ? { error: value.error } : { step: { ...step, value: value.value } };
      })());
      const valid = resolved.flatMap((item) => item.step ? [item.step] : []);
      const results = valid.length ? await trackAction(() => bridge.content<InteractionResult[]>('dom.interact', { steps: valid })) : [];
      let index = 0;
      return JSON.stringify(resolved.map((item, i) => ({
        ...('error' in item ? { elementId: steps[i]!.elementId, intent: steps[i]!.intent,
          ok: false, changed: false, satisfied: false, error: item.error } : results[index++]),
        ...(steps[i]!.sourcePath ? { expectedSourcePath: steps[i]!.sourcePath } : {}),
      })));
    },
    {
      name: 'interact_elements',
      description:
        '批量执行多个已知目标，逐项等待框架刷新，整批完成后再次核验字段值。value可改用sourcePath引用本轮get_resume/lookup_resume_fields已读取的原始叶子字段，代码取真值，禁止传脱敏占位符。需要日期格式或选项转换时传有依据的value。返回before/after/changed/satisfied/stable/verificationStatus；只有satisfied=true表示此次观察匹配。失败项不阻断其他项，新增记录后仍需最终verify_form_fields核对。',
      schema: z.object({
        steps: z.array(z.object({
          elementId: z.string(),
          intent: z.enum(['activate', 'set-value', 'set-checked', 'choose-option']),
          value: z.union([z.string(), z.boolean(), z.number()]).optional(),
          sourcePath: z.string().startsWith('sections.').optional(),
          revision: z.number().int().nonnegative().optional(),
        })).min(1).max(30),
      }),
    },
  );

  const verifyFields = tool(
    async ({ fields }) => {
      const resolved = fields.map((field) => resolveResumeExpectation(field, sourceValue));
      const valid = fields.flatMap((field, i) => {
        const item = resolved[i]!;
        return 'error' in item ? [] : [{ elementId: field.elementId, revision: field.revision, intent: field.intent, value: item.value }];
      });
      const results = valid.length ? await bridge.content<FormFieldVerification[]>('dom.verifyFields', { fields: valid }) : [];
      let index = 0;
      return JSON.stringify(fields.map((field, i) => ({
        ...('error' in resolved[i]! ? { elementId: field.elementId, intent: field.intent, ok: false, stable: false,
          satisfied: false, status: 'unavailable', error: (resolved[i] as { error: string }).error } : results[index++]),
        ...(field.sourcePath ? { expectedSourcePath: field.sourcePath } : {}),
      })));
    },
    {
      name: 'verify_form_fields',
      description: '批量只读核验当前字段，包含PDF/牛客/人工已填字段。提供elementId、intent与预期value，或sourcePath引用本轮简历MCP已读取的叶子字段（如sections.基本信息.电话），工具用真实来源在本地比较；不要把[redacted-phone]等占位符当value。日期格式或选项需转换时用有依据的value。两次回读间隔250ms，返回satisfied/stable/status/脱敏actual。仅verified通过；单项缺来源/失败继续其余字段。不会写值或提交，不证明服务端保存。',
      schema: z.object({ fields: z.array(z.object({
        elementId: z.string(), revision: z.number().int().nonnegative().optional(),
        intent: z.enum(['set-value', 'set-checked', 'choose-option']),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
        sourcePath: z.string().startsWith('sections.').optional(),
      })).min(1).max(30) }),
    },
  );

  const drag = tool(
    async ({ elementId, targetId, revision }) =>
      safeJson(await trackAction(() =>
        bridge.content('dom.drag', { elementId, targetId, revision }),
      )),
    {
      name: 'drag_element',
      description: '把一个元素拖到另一个元素上。',
      schema: z.object({
        elementId: z.string(),
        targetId: z.string(),
        revision: z.number().optional(),
      }),
    },
  );

  const press = tool(
    async ({ key }) =>
      safeJson(await trackAction(() => bridge.content('dom.press', { key }))),
    {
      name: 'press_key',
      description: '向当前焦点发送按键，例如 Enter、Escape、Tab。',
      schema: z.object({ key: z.string() }),
    },
  );

  const scroll = tool(
    async (payload) =>
      safeJson(await trackAction(() => bridge.content('dom.scroll', payload))),
    {
      name: 'scroll_page',
      description: '滚动页面或滚到某个元素。',
      schema: z.object({
        elementId: z.string().optional(),
        direction: z.enum(['up', 'down', 'left', 'right', 'top', 'bottom']).optional(),
        amount: z.number().optional(),
        revision: z.number().optional(),
      }),
    },
  );

  const wait = tool(
    async (payload) => safeJson(await bridge.content('dom.wait', payload)),
    {
      name: 'wait_for',
      description: '等待文本、元素或 URL 变化。',
      schema: z.object({
        ms: z.number().optional(),
        text: z.string().optional(),
        elementId: z.string().optional(),
        urlIncludes: z.string().optional(),
      }),
    },
  );

  return [
    uploadAttachment,
    click,
    dblclick,
    hover,
    typeText,
    clear,
    select,
    interact,
    verifyFields,
    drag,
    press,
    scroll,
    wait,
  ];
}
