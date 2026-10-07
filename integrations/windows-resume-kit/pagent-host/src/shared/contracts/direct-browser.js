import { z } from 'zod';
export const browserListToolsSchema = z.object({
    tabId: z.number().int().positive(),
    prompt: z.string().min(1).max(32_000).optional().describe('本次用户任务原文，初始化用途和上传限制；省略时沿用同页上下文。不会调用模型。'),
    names: z.array(z.string().min(1)).max(100).optional().describe('可选，仅返回指定工具的说明和参数；不影响可用能力。'),
    resetResumeBudget: z.boolean().default(false).describe('用于明确的新任务，或用户纠正限时策略、加载修复后继续现有缺项。普通主填进入review使用独立阶段窗口，不需要重置；同阶段重绑不清零。'),
});
export const browserCallToolSchema = z.object({
    tabId: z.number().int().positive(),
    contextId: z.string().min(1),
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()).default({}),
    execution: z.object({
        diagnostic: z.boolean().optional().describe('标记本调用用于排障；false 不会绕过已识别的失败恢复预算。'),
        fieldIds: z.array(z.string().min(1)).max(100).optional().describe('本调用正在排查的字段 ID；不改变网页操作参数。'),
    }).optional(),
});
export const browserEndTaskSchema = z.object({ tabId: z.number().int().positive(), contextId: z.string().min(1) });
export const DIRECT_BROWSER_METHODS = ['browser_list_tools', 'browser_call_tool', 'browser_end_task'];
