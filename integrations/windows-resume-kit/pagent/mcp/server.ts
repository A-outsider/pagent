import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpHostMethod } from '../src/shared/contracts/mcp-host.ts';
import { openTabsBackgroundSchema } from '../src/shared/contracts/background-tabs.ts';
import { bossAuditResumeImagesSchema, bossGetResumeImageScanSchema, bossSendResumeImagesSchema } from '../src/shared/contracts/boss.ts';
import { bossCancelTaskSchema, bossGetTaskSchema, bossStartTaskInputSchema, bossStartTaskSchema } from '../src/shared/contracts/boss-task.ts';
import { bossStartFavoritesInputSchema, bossListCurrentFavoritesSchema, bossApplyFavoriteJobInputSchema, bossGetFavoritesTaskSchema, bossCancelFavoritesTaskSchema } from '../src/shared/contracts/boss-favorites.ts';
import { bossGetFavoritesPreferencesSchema, bossSetFavoritesGreetingSchema } from '../src/shared/contracts/boss-favorites-preferences.ts';
import { USAGE_TOPICS, getUsageGuide } from './usage.ts';
import { browserListToolsSchema, browserCallToolSchema, browserEndTaskSchema, type DirectToolResult } from '../src/shared/contracts/direct-browser.ts';

export const SERVER_NAME = 'pagent';
export const SERVER_VERSION = '0.1.0';

export type CallExtension = (method: McpHostMethod, params?: unknown, timeoutMs?: number) => Promise<unknown>;

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

async function runTool(work: () => Promise<unknown>) {
  try {
    return textResult(await work());
  } catch (error) {
    return errorResult(error);
  }
}

export function createPagentMcpServer(callExtension: CallExtension): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Pagent 浏览器工具服务。直接使用能力无需启动内置模型或配置聊天 API key：list_tabs → browser_list_tools（传本次用户任务）→ browser_call_tool。先读取工具参数和操作规则；页面变化后重新绑定上下文。dispatch_task 是可选的独立 Agent 委派，会调用 Pagent 自己的模型。',
    },
  );

  server.registerTool(
    'get_usage',
    {
      title: '查询 Pagent MCP 用法',
      description:
        '返回本地 Agent 直接使用浏览器工具的流程、参数和操作约定，以及可选的独立 Agent 委派方式。不需要 Pagent 扩展在线。可传 topic 只看某一段。',
      inputSchema: {
        topic: z
          .enum(USAGE_TOPICS)
          .optional()
          .describe(
            `可选。${USAGE_TOPICS.join(' | ')}。省略则返回完整用法。`,
          ),
      },
    },
    async ({ topic }) => ({
      content: [{ type: 'text' as const, text: getUsageGuide(topic) }],
    }),
  );

  server.registerTool(
    'list_tabs',
    {
      title: '罗列浏览器标签页',
      description:
        '列出当前浏览器的全部标签页，以及每个标签页上是否有 Pagent Agent 正在工作（含会话 ID、会话标题、思考状态）。',
    },
    async () => runTool(() => callExtension('list_tabs', {}, 15_000)),
  );

  server.registerTool(
    'browser_list_tools',
    {
      title: '读取完整浏览器工具能力',
      description: '在指定已打开标签页建立或沿用直接工具上下文，返回contextId、全部已启用内置和外部MCP工具的名字、说明和JSON参数，以及同页操作规则。完全复用Pagent内部工具工厂，含DOM/CDP/截图/填表核验/PDF与头像/牛客/简历来源/BOSS/记忆；遵守原禁用设置及资源依赖。prompt传本次用户原文，用于简历用途与不上传限制，不调用模型；省略沿用同页上下文。names可只取指定工具schema，toolNames仍返回完整名单。真正换文档需重新绑定；不会刷新、导航或派发Agent。',
      inputSchema: browserListToolsSchema.shape,
    },
    async (input) => runTool(() => callExtension('browser_list_tools', input, 90_000)),
  );
  server.registerTool('browser_call_tool', {
    title: '直接使用 Pagent 浏览器工具',
    description: '用browser_list_tools返回的contextId和原工具名/args直接执行，扩展不调用模型。参数严格按该工具inputSchema，同页串行并保留变化观察、真实简历来源、上传/核验状态，截图返回原始图像。observe/search/scan先读取真实目标，interact批量填写，verify独立回读；未知事实留空。目标tabId固定，open/switch返回新标签后须为新tab重新绑定。不能对仍有Agent或后台机械任务占用的页面操作；任务查询/停止除外。错误和超时不证明网页操作未发生，先只读检查，不能盲重试上传或发送。',
    inputSchema: browserCallToolSchema.shape,
  }, async (input) => {
    try { return await callExtension('browser_call_tool', input, 310_000) as DirectToolResult; }
    catch (error) { return errorResult(error); }
  });
  server.registerTool('browser_end_task', {
    title: '结束直接浏览器工具上下文',
    description: '取消本上下文后续工具调用并释放已读简历来源/观察记录，不刷新页面、不关闭标签、不撤回已发生的写入或上传。已启动的BOSS后台任务仍需对应cancel工具单独停止。',
    inputSchema: browserEndTaskSchema.shape,
  }, async (input) => runTool(() => callExtension('browser_end_task', input, 15_000)));

  server.registerTool(
    'open_tabs_background',
    {
      title: '在后台窗口批量打开链接',
      description: '只打开给定链接，不派发模型、不读取岗位。每批1–100个URL，标准化去重；默认创建不聚焦的独立窗口，可指定已有普通windowId并以active:false添加，跳过该窗口已有链接。绝不切焦点、移动或关闭原标签。groupName仅在已有tabGroups权限时给本次新标签分组，缺权限返回未分组。返回opened/existing/failed；部分失败时按返回结果续做，不整批重开。',
      inputSchema: openTabsBackgroundSchema.shape,
    },
    async (input) => runTool(() => callExtension('open_tabs_background', input, 45_000)),
  );

  server.registerTool(
    'dispatch_task',
    {
      title: '派发任务给 Agent',
      description:
        '向指定标签页上的 Pagent Agent 派发任务。可传 tabId 使用已有标签页，或传 url 打开/导航后再执行。不传 tabId 和 url 时使用当前活动标签页。返回 sessionId，可随后用 get_session 查询进度。',
      inputSchema: {
        prompt: z.string().min(1).describe('要交给 Agent 执行的任务描述'),
        tabId: z.number().int().positive().optional().describe('目标标签页 ID，省略则使用当前活动标签页'),
        url: z.string().min(1).optional().describe('可选。若同时提供 tabId 则导航该标签页；否则新建标签页并打开该地址'),
        conversationId: z.string().min(1).optional().describe('可选。继续已有会话；省略则新建会话'),
      },
    },
    async ({ prompt, tabId, url, conversationId }) =>
      runTool(() =>
        callExtension(
          'dispatch_task',
          { prompt, tabId, url, conversationId },
          45_000,
        ),
      ),
  );

  server.registerTool(
    'boss_start_task',
    {
      title: '启动 BOSS 后台任务',
      description: '启动 BOSS 历史聊天完整只读查漏，使用 operation=audit，可按 since 指定时间。代码自动扫描并生成报告，不根据缺图结果补发；首次沟通及固定文字/简历图投递使用 boss_start_favorites_task。operation=send、scanId、recipientIds、maxRecipients、dryRun 仅保留旧客户端兼容，当前工作流不调度补发。立即返回 taskId，任务独立继续，页面直接展示进度和报告；调用方结束本轮，不轮询、不搬运ID、不再逐批调工具。',
      inputSchema: bossStartTaskInputSchema.extend({ tabId: z.number().int().positive() }).shape,
    },
    async ({ tabId, ...request }) => runTool(() =>
      callExtension('boss_start_task', { tabId, ...bossStartTaskSchema.parse(request) }, 20_000)),
  );

  server.registerTool('boss_start_favorites_task', {
    title: '感兴趣岗位首发投递',
    description: '从已打开的BOSS个人中心感兴趣岗位页启动固定首发。maxRecipients限制完整完成数量，跳过不占。greeting省略用保存模板；图片固定MCP resume-image。dryRun默认true，只预览，不点立即沟通、不发消息、不取消收藏；用户明确要求实际投递时false。代码依次确认正确会话、文字回执、图片回执、返回取消感兴趣，完成后等1秒。立即网申、未知按钮或字段缺失的单张卡片记录原因并跳过，保留收藏，不占名额。执行异常暂停为needs_attention，不启动Pagent模型；外部调用者按需查询状态，经browser_list_tools调用boss_inspect_favorites_exception和boss_resolve_favorites_exception读取现场并选择continue/skip/pause。代码安全应用决定，沿用原任务进度且不重发已确认消息。正常运行时无需轮询或干预页面。',
    inputSchema: bossStartFavoritesInputSchema.extend({ tabId: z.number().int().positive() }).shape,
  }, async (input) => runTool(() => callExtension('boss_start_favorites_task', input, 20_000)));
  server.registerTool('boss_get_favorites_preferences', {
    title: '读取 BOSS 收藏投递偏好',
    description: '读取 Pagent 扩展本地保存的打招呼语和投递数量；没有保存值时返回默认值。无需 BOSS 标签页，不访问网站。',
    inputSchema: bossGetFavoritesPreferencesSchema,
  }, async (input) => runTool(() => callExtension('boss_get_favorites_preferences', input, 15_000)));
  server.registerTool('boss_set_favorites_greeting', {
    title: '保存 BOSS 打招呼语',
    description: '将打招呼语保存到 Pagent 扩展的本地偏好，保留现有投递数量。返回保存后的偏好；无需 BOSS 标签页，不发送消息或访问网站。',
    inputSchema: bossSetFavoritesGreetingSchema,
  }, async (input) => runTool(() => callExtension('boss_set_favorites_greeting', input, 15_000)));
  server.registerTool('boss_list_current_favorites', {
    title: '读取当前页感兴趣岗位',
    description: '只读当前 BOSS 感兴趣职位收藏页的页面状态，返回当前页码、岗位 ID、岗位名称、公司、招聘者及沟通入口状态。必须已在 tab=4&sub=1 的收藏页；不翻页、不导航、不发送、不取消收藏，也不启动 Pagent Agent。Codex 应使用返回的 jobId 精确选择 boss_apply_favorite_job 的目标，不根据行号推测。',
    inputSchema: bossListCurrentFavoritesSchema,
  }, async (input) => runTool(() => callExtension('boss_list_current_favorites', input, 15_000)));
  server.registerTool('boss_apply_favorite_job', {
    title: '处理当前收藏页指定岗位',
    description: '仅处理当前 BOSS 感兴趣列表页可见且岗位 ID 完全匹配的一岗。由 Codex 逐岗调用，不扫描整份收藏、不调度下一岗，也不启动 Pagent Agent。dryRun 默认 true，仅预览；实际投递须显式 false。文字与 resume-image 图片都确认送达后才返回原收藏页取消感兴趣；任何身份、回执或页面异常保留收藏并停止该任务。立即返回 taskId，使用 boss_get_favorites_task 查询该岗明细与最终状态；不能因查询超时或回执不明而重发。',
    inputSchema: bossApplyFavoriteJobInputSchema.extend({ tabId: z.number().int().positive() }),
  }, async (input) => runTool(() => callExtension('boss_apply_favorite_job', input, 20_000)));
  server.registerTool('boss_get_favorites_task', {
    title: '读取感兴趣投递进度', description: '只读已保存的任务、回执和异常决定，includeRecipients=true返回明细；不推进任务或调用模型。',
    inputSchema: bossGetFavoritesTaskSchema.extend({ tabId: z.number().int().positive() }).shape,
  }, async (input) => runTool(() => callExtension('boss_get_favorites_task', input, 15_000)));
  server.registerTool('boss_cancel_favorites_task', {
    title: '停止感兴趣投递', description: '停止后续操作并保留进度，不撤回已发送消息，也不自动补发。',
    inputSchema: bossCancelFavoritesTaskSchema.extend({ tabId: z.number().int().positive() }).shape,
  }, async (input) => runTool(() => callExtension('boss_cancel_favorites_task', input, 15_000)));

  server.registerTool(
    'boss_get_task',
    {
      title: '读取 BOSS 后台任务',
      description: '只读任务记录，不访问网页历史、不推进任务。taskId 省略取该标签最近任务，默认精简计数，需要名单时 includeRecipients=true。按用户需要查询，不轮询维持任务。null 表示暂无记录，不代表需要重发。',
      inputSchema: bossGetTaskSchema.extend({ tabId: z.number().int().positive() }).shape,
    },
    async (input) => runTool(() => callExtension('boss_get_task', input, 15_000)),
  );

  server.registerTool(
    'boss_cancel_task',
    {
      title: '停止 BOSS 后台任务',
      description: '停止指定任务的后续操作，保留已完成及待确认记录。已开始上传的图片仍可能送达，停止不能撤回、不代表未发送，不自动重试。',
      inputSchema: bossCancelTaskSchema.extend({ tabId: z.number().int().positive() }).shape,
    },
    async (input) => runTool(() => callExtension('boss_cancel_task', input, 15_000)),
  );

  server.registerTool(
    'boss_audit_resume_images',
    {
      title: 'BOSS 简历图片查漏（兼容旧调用）',
      description: '兼容旧调用；新任务优先用 boss_start_task 自动完成全程。在指定 BOSS 聊天页只读查漏仅沟通列表，每批默认且最多检查15名候选。可传since（带时区ISO时间）筛选此时起本人发过消息的联系人；列表时间明确过早则直接跳过，确认时间边界后停止扫描旧列表，候选仍检查全部历史。历史本人发过图片或对方真实回复过就跳过，系统通知不算回复。不发送。沿nextCursor继续同一scanId直到complete=true；这表示指定范围查完，不要求listComplete=true。新消息或列表重排不作废已有结果；筛选变化续扫自动恢复，单人读取失败只列不确定并继续。游标不可用先用boss_get_resume_image_scan取回最新nextCursor，不重扫。recipients只返回not_found和uncertain，其余只计入progress；不统计边界外未遍历联系人。无需派发模型任务。',
      inputSchema: bossAuditResumeImagesSchema.extend({ tabId: z.number().int().positive().describe('list_tabs 返回的 BOSS 聊天标签页 ID') }).shape,
    },
    async (input) => runTool(() => callExtension('boss_audit_resume_images', input, 310_000)),
  );

  server.registerTool(
    'boss_get_resume_image_scan',
    {
      title: '读取 BOSS 查漏结果（兼容旧调用）',
      description: '兼容旧调用；后台任务状态用 boss_get_task。只读恢复指定标签页已有扫描，不重新扫描或发送。scanId可省略取最近有效扫描，分页时固定scanId，沿nextOffset读取原始recipientId。recipients只含not_found和uncertain，其余只计入progress。complete=true表示指定范围查完，可规划发送；listComplete仅表示整张列表到底，stopReason=time_cutoff时不必为true。筛选或当前会话变化不影响读取已有结果。按实际错误区分记录丢失、过期、页面标识或账号变化，不把重排当失效。继续原任务且原时间范围明确时，前三者可只读重建一次；换账号或离开聊天页停止，不能猜ID。只询问原因时只读并回答。',
      inputSchema: bossGetResumeImageScanSchema.extend({ tabId: z.number().int().positive().describe('本次查漏所在的 BOSS 聊天标签页 ID') }).shape,
    },
    async (input) => runTool(() => callExtension('boss_get_resume_image_scan', input, 20_000)),
  );

  server.registerTool(
    'boss_send_resume_images',
    {
      title: 'BOSS 简历图片补发（兼容旧调用）',
      description: '仅为旧客户端保留，当前流程不自动补发；新首次投递使用 boss_start_favorites_task，旧完整扫描只使用 boss_start_task operation=audit。引用complete=true的scanId及原始收件人，默认dryRun=true先预览，明确授权后才false。每批最多10人，串行间隔至少2秒，附件用MCP resume-image。明确已发、verified记录或对方已回复则skipped继续；attempted记录只读复核，不再上传。complete=false时结束本轮，不拆成单人或新批次绕过停止。选中行离屏不等于换会话，以右侧身份、旧消息连续性和新图送达回执核验。未确认不能说实际或大概率成功，也不能推断网站风控或无证据建议等1–2小时。不自动重发。',
      inputSchema: bossSendResumeImagesSchema.extend({ tabId: z.number().int().positive().describe('本次查漏使用的 BOSS 聊天标签页 ID') }).shape,
    },
    async (input) => runTool(() => callExtension('boss_send_resume_images', input, 310_000)),
  );

  server.registerTool(
    'get_session',
    {
      title: '查看 Agent 会话状态',
      description:
        '按 sessionId、tabId 或 conversationId 查询 Pagent Agent 会话：是否仍在运行、当前思考、任务列表和最近消息。',
      inputSchema: {
        sessionId: z.string().min(1).optional().describe('dispatch_task 返回的会话 ID'),
        tabId: z.number().int().positive().optional().describe('标签页 ID'),
        conversationId: z.string().min(1).optional().describe('会话/对话 ID'),
      },
    },
    async ({ sessionId, tabId, conversationId }) =>
      runTool(() =>
        callExtension(
          'get_session',
          { sessionId, tabId, conversationId },
          15_000,
        ),
      ),
  );

  return server;
}
