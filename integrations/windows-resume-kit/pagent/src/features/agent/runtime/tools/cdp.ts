import { tool } from 'langchain';
import { z } from 'zod';
import { isolateUntrustedPage } from '@/features/agent/runtime/middleware';
import { safeJson, truncate } from '@/shared/utils/utils';
import type { ToolBridge, TrackActionFn } from './types';

export function createCdpTools(bridge: ToolBridge, trackAction: TrackActionFn) {
  const cdpScript = tool(
    async ({ expression, awaitPromise }) =>
      truncate(
        safeJson(await trackAction(() => bridge.cdp.script(expression, awaitPromise))),
        6000,
      ),
    {
      name: 'execute_cdp_script',
      description:
        '通过 CDP Runtime.evaluate 执行 JavaScript，可 awaitPromise。表单填写优先 interact_elements，不要在同步循环中连续给同一受控表单赋值，也不要绕过事件直接改框架内部状态；结构化工具确实失败才用脚本，每项写入必须等待页面更新。脚本 true 或即时 value 不证明填写成功，之后必须独立用 verify_form_fields 核验。只读查询用 observe_page、extract_interactions 等结构化工具。',
      schema: z.object({
        expression: z.string(),
        awaitPromise: z.boolean().optional(),
      }),
    },
  );

  const cdpCommand = tool(
    async ({ method, params }) =>
      truncate(
        safeJson(await trackAction(() => bridge.cdp.command(method, params))),
        8000,
      ),
    {
      name: 'execute_cdp_command',
      description:
        '直接向当前标签页发送任意 Chrome DevTools Protocol 命令（method + params，如 DOM.getDocument、Emulation.setDeviceMetricsOverride、Input.dispatchMouseEvent 等），返回 CDP 结果。需要 debugger 权限；结构化工具满足需求时优先用结构化工具。',
      schema: z.object({
        method: z.string().regex(/^[A-Za-z]+\.[A-Za-z]+$/).describe('CDP 域和方法名，例如 Page.captureScreenshot'),
        params: z.record(z.string(), z.unknown()).optional().describe('该方法对应的 CDP 参数对象'),
      }),
    },
  );

  const cdpClick = tool(
    async ({ x, y }) => {
      if (bridge.settings.executionMode !== 'cdp') {
        return '当前为 DOM 模式。如需坐标级输入，请在设置中切换到 CDP。';
      }
      return safeJson(
        await trackAction(() => bridge.cdp.input({ x, y, type: 'click' })),
      );
    },
    {
      name: 'cdp_click_xy',
      description: '使用 CDP 在视口坐标点击，更接近真实输入。',
      schema: z.object({
        x: z.number(),
        y: z.number(),
      }),
    },
  );

  const networkLog = tool(
    async (filter) => {
      if (!bridge.settings.captureDevtools) {
        return '用户已关闭网络/控制台采集。';
      }
      return isolateUntrustedPage(safeJson(await bridge.cdp.network(filter)));
    },
    {
      name: 'get_network_log',
      description:
        '读取当前标签页在调试器 attach 之后的网络请求摘要（方法、URL、状态码、类型、耗时）。Cookie/Authorization 等敏感头已脱敏。需要看响应体时再用 get_network_request。若刚开始采集、缓冲为空，请复现操作或刷新后再查。',
      schema: z.object({
        urlIncludes: z.string().optional(),
        method: z.string().optional(),
        resourceType: z.string().optional().describe('例如 Document、XHR、Fetch、Script'),
        failedOnly: z.boolean().optional(),
        includeNoise: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
  );

  const consoleLog = tool(
    async (filter) => {
      if (!bridge.settings.captureDevtools) {
        return '用户已关闭网络/控制台采集。';
      }
      return isolateUntrustedPage(safeJson(await bridge.cdp.console(filter)));
    },
    {
      name: 'get_console_log',
      description:
        '读取当前标签页在调试器 attach 之后的控制台输出、未捕获异常和浏览器日志。只能看到 attach 之后的记录。',
      schema: z.object({
        level: z.string().optional().describe('例如 log、info、warning、error'),
        textIncludes: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
  );

  const networkRequest = tool(
    async ({ requestId, includeBody }) => {
      if (!bridge.settings.captureDevtools) {
        return '用户已关闭网络/控制台采集。';
      }
      return isolateUntrustedPage(
        truncate(safeJson(await bridge.cdp.request(requestId, includeBody)), 8000),
      );
    },
    {
      name: 'get_network_request',
      description:
        '读取单条网络请求的请求/响应头（已脱敏）。includeBody 仅对文本/JSON 响应尝试读取正文。',
      schema: z.object({
        requestId: z.string(),
        includeBody: z.boolean().optional(),
      }),
    },
  );

  return [
    cdpScript,
    cdpCommand,
    cdpClick,
    networkLog,
    consoleLog,
    networkRequest,
  ];
}
