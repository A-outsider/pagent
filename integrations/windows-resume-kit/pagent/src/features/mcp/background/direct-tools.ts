import { tool } from 'langchain';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createAgentTools, type ToolBridge } from '@/features/agent/runtime/tools';
import { isResumeFillRequest, resumePreparationMode, ResumeWorkflow } from '@/features/agent/runtime/resume-workflow';
import { isRepeatedAction } from '@/shared/contracts/policy';
import { ResumeExecutionBudget, type ResumeBudgetMetadata, type ResumeBudgetDeferral } from '@/features/agent/runtime/resume-budget';

const FOCUS_WAIT_MS = 5_000;
const focusCommands = new Map<number, Promise<void>>();

async function waitForFocus<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  void request.catch(() => {});
  signal.throwIfAborted();
  let onAbort!: () => void;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', onAbort); }
}

/** A tool session, not an Agent: no model, credentials, graph or automatic retry. */
export async function createDirectTools(bridge: ToolBridge, prompt = '', url = '', setupSignal?: AbortSignal, budget = new ResumeExecutionBudget()) {
  const resume = new ResumeWorkflow(isResumeFillRequest(prompt, url), resumePreparationMode(prompt));
  const history: Array<{ name: string; args: string }> = [];
  let nowcoderStarted = false;
  let focusEmulation: 'inactive' | 'enabled' | 'unavailable' = 'inactive';
  let focusRequest: Promise<void> | undefined;
  let restoreRequest: Promise<void> | undefined;
  let focusNeedsRestore = false;
  let disposed = false;
  let activeToolSignal: AbortSignal | undefined;
  let timedOut = false;
  const queueFocus = (enabled: boolean, signal?: AbortSignal) => {
    const previous = focusCommands.get(bridge.tabId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (enabled) {
        signal?.throwIfAborted();
        if (disposed) throw new Error('直接工具上下文已结束');
        focusNeedsRestore = true;
      }
      await bridge.cdp.command('Emulation.setFocusEmulationEnabled', { enabled });
      if (!enabled) { focusNeedsRestore = false; focusEmulation = 'inactive'; }
    });
    focusCommands.set(bridge.tabId, next);
    void next.finally(() => {
      if (focusCommands.get(bridge.tabId) === next) focusCommands.delete(bridge.tabId);
    }).catch(() => {});
    return next;
  };
  const enableBackgroundFocus = async (signal?: AbortSignal) => {
    if (!resume.enabled || disposed || focusEmulation !== 'inactive') return;
    focusRequest ??= (async () => {
      const waiting = AbortSignal.any([AbortSignal.timeout(FOCUS_WAIT_MS), ...(signal ? [signal] : [])]);
      try {
        // Keeps background rAF/timers progressing without activating the user's tab or window.
        await waitForFocus(queueFocus(true, waiting), waiting);
        if (!disposed) focusEmulation = 'enabled';
      } catch { focusEmulation = 'unavailable'; }
    })();
    await focusRequest;
  };
  const sourceTool = (name: string) => /(?:^|_)get_resume$|(?:^|_)lookup_resume_fields$/.test(name);
  const readOnly = (name: string) => sourceTool(name) || /^(?:observe_page(?:_changes)?|search_page_text|capture_screenshot|scan_resume_form|verify_form_fields|record_resume_progress|get_resume_progress|resume_execution_phase|page_info|get_source|list_tabs|extract_interactions|inspect_element_tree|find_common_ancestor|execute_named_script|get_network_log|get_console_log|get_network_request|boss_get_task|boss_get_favorites_task|boss_inspect_favorites_exception|memory_search|wait_for)$/.test(name);
  const tools: StructuredToolInterface[] = await createAgentTools({ ...bridge,
    content: (name, payload, options) => {
      activeToolSignal?.throwIfAborted();
      const signals = [activeToolSignal, options?.signal].filter((item): item is AbortSignal => !!item);
      return signals.length ? bridge.content(name, payload, { signal: AbortSignal.any(signals) })
        : options ? bridge.content(name, payload, options) : bridge.content(name, payload);
    },
    // MCP must return pixels, rather than the internal UI's optional truncated data URL.
    settings: { ...bridge.settings, screenshotAsImage: true },
    mcp: { ...bridge.mcp, callTool: async (name, args) => {
      const result = await bridge.mcp.callTool(name, args);
      if (sourceTool(name)) {
        resume.enabled = true;
        // Remember original facts before the tool wrapper redacts its display output.
        resume.after(name, args as Record<string, unknown>, result);
      }
      return result;
    } },
  }, () => resume.enabled, () => resume.preparationMode, (path) => resume.sourceValue(path));
  const disabled = new Set(bridge.settings.disabledBuiltinTools ?? []);
  const progress = [tool(async ({ records }) => JSON.stringify(resume.recordProgress(records)), {
    name: 'record_resume_progress',
    description: '登记来源记录及具体来源叶子与网页字段的对应关系；不写网页、不自证成功。组合正文可用 fields 明确覆盖的来源事实，仍须独立核验。不适用须有页面依据，暂缓项保留在 deferredFields。',
    schema: z.object({ records: z.array(z.object({
      sourcePath: z.string().min(1), elementIds: z.array(z.string().min(1)).optional(),
      disposition: z.enum(['attempted', 'not_applicable']), reason: z.string().optional(),
      fields: z.array(z.object({
        sourcePath: z.string().min(1), elementIds: z.array(z.string().min(1)).optional(),
        disposition: z.enum(['mapped', 'not_applicable', 'deferred']), reason: z.string().optional(),
      })).max(100).optional(),
    })).min(1).max(60) }),
  }), tool(async ({ compact }) => {
    const full = JSON.parse(resume.reviewContext());
    if (!compact) return JSON.stringify({ ...full, executionBudget: budget.snapshot() });
    const { fieldEvidence, pageCoverage, ...progress } = full;
    return JSON.stringify({ ...progress,
      executionBudget: budget.snapshot(),
      fieldEvidence: fieldEvidence.map(({ value: _value, ...evidence }: Record<string, unknown>) => evidence),
      pageCoverage: pageCoverage?.summary ? {
        documentId: pageCoverage.documentId, revision: pageCoverage.revision, coverage: pageCoverage.coverage,
        summary: pageCoverage.summary,
        sections: pageCoverage.sections.map(({ name, recordCount }: { name: string; recordCount: number }) => ({ name, recordCount })),
        issues: pageCoverage.issues.filter(({ kind }: { kind: string }) => kind !== 'empty'),
        navigationHints: pageCoverage.navigationHints,
        fieldDetailsTool: 'scan_resume_form',
      } : pageCoverage,
    });
  }, {
    name: 'get_resume_progress',
    description: '只读来源逐项覆盖和执行预算。nextFields 区分定位补填与回读，deferredFields 保留未解决项；自动插件或少数字段核验不会消除其他来源待办。默认不重复原始值。',
    schema: z.object({ compact: z.boolean().default(true) }),
  }), tool(async ({ phase }) => {
    const decision = phase === 'review' ? budget.enterReview() : { allowed: true };
    return JSON.stringify({ ...decision, executionBudget: budget.snapshot(), progress: JSON.parse(resume.reviewContext()) });
  }, {
    name: 'resume_execution_phase',
    description: '全部页面普通主填后进入集中难项及来源检查（review，3分钟）。main 不重置主填计时；review 的诊断和恢复窗口独立，保留主填缺项与总耗时。同阶段重绑不清零，局部超限先让路，正常填写、保存和首次核验继续。',
    schema: z.object({ phase: z.enum(['main', 'review']) }),
  })];
  tools.push(...progress.filter((item) => !disabled.has(item.name)));
  for (const item of tools) {
    if (item.name === 'boss_start_favorites_task') item.description += '\n本直连模式执行归属为external；异常保持needs_attention交外部调用者处理，不调用Pagent模型。';
    if (item.name === 'boss_inspect_favorites_exception') item.description = '只读核对本标签页外部启动的感兴趣投递任务异常；必须使用返回的taskId/exceptionId。不能接管Pagent内部任务，不发送、不取消收藏。';
    if (item.name === 'boss_resolve_favorites_exception') item.description = '对本标签页external任务当前异常决定continue/skip/pause。保留身份与回执检查，立即安全应用到原断点；无需等待Pagent回合，不启动模型，不重发已确认或结果未知的消息。';
  }

  const call = async (name: string, originalArgs: Record<string, unknown>, signal?: AbortSignal, metadata?: ResumeBudgetMetadata): Promise<unknown> => {
    const selected = tools.find((item) => item.name === name);
    if (!selected) throw new Error(`工具不存在或已禁用：${name}；先读取本标签页的工具列表`);
    return resume.serialize(async () => {
      signal?.throwIfAborted();
      if (disposed) throw new Error('直接工具上下文已结束');
      if (timedOut && !['get_resume_progress', 'record_resume_progress', 'resume_execution_phase'].includes(name)) {
        return { ok: false, status: 'unknown', reason: 'previous_execution_budget_timeout', action: 'continue_other_pages',
          note: '本上下文上次调用结果未知，不派发更多页面动作。结束上下文并转其他页；后续重新绑定只能回读未知结果，不盲重发。' };
      }
      const args = structuredClone(originalArgs);
      if (sourceTool(name) || ['ensure_resume_attachment', 'scan_resume_form', 'record_resume_progress'].includes(name)) resume.enabled = true;
      resume.beginTool(name);
      const deferred: ResumeBudgetDeferral[] = [];
      if (resume.enabled) {
        budget.activate();
        for (;;) {
          const decision = budget.before(name, args, metadata);
          if (decision.allowed) break;
          const batchKey = name === 'interact_elements' ? 'steps' : name === 'verify_form_fields' ? 'fields' : undefined;
          const batch = batchKey && Array.isArray(args[batchKey]) ? args[batchKey] as Record<string, unknown>[] : undefined;
          if (decision.elementIds?.length) {
            const progress = JSON.parse(resume.reviewContext());
            for (const field of progress.sourceFields ?? []) {
              const requested = batch?.some(item => item.sourcePath === field.sourcePath && decision.elementIds!.includes(String(item.elementId)));
              if (!requested && !field.elementIds?.some((id: string) => decision.elementIds!.includes(id))) continue;
              resume.recordProgress([{ sourcePath: field.recordSourcePath, disposition: 'attempted', fields: [{
                sourcePath: field.sourcePath, disposition: 'deferred', reason: decision.reason,
              }] }]);
            }
          }
          const remaining = batch?.filter(field => !decision.elementIds?.includes(String(field.elementId)));
          if (!batchKey || !remaining?.length || remaining.length === batch!.length) return { ...decision,
            executionBudget: budget.snapshot(), progress: JSON.parse(resume.reviewContext()) };
          deferred.push(decision);
          args[batchKey] = remaining;
        }
      }
      await enableBackgroundFocus(signal);
      signal?.throwIfAborted();
      if (disposed) throw new Error('直接工具上下文已结束');
      if (name === 'prepare_resume_form' && nowcoderStarted) {
        throw new Error('牛客补填后不能重新解析覆盖表单；使用 ensure_resume_attachment 核对独立简历附件，继续扫描和核验字段');
      }
      if (!readOnly(name) && isRepeatedAction(history, name, args, 3)) throw new Error('此动作已连续重复三次，本次未执行；请读取状态、核验或换一种有依据的做法');
      resume.before(name, args);
      if (!readOnly(name)) {
        history.push({ name, args: JSON.stringify(args) });
        if (history.length > 3) history.shift();
      }
      if (name === 'run_nowcoder_fill') nowcoderStarted = true;
      // Phase time only schedules work; diagnostic and recovery windows still abort stuck calls.
      const remaining = resume.enabled ? budget.remainingMilliseconds() : undefined;
      const deadline = remaining === undefined ? undefined : AbortSignal.timeout(Math.max(1, Math.ceil(remaining)));
      const signals = [signal, deadline].filter((item): item is AbortSignal => !!item);
      const invocationSignal = signals.length ? AbortSignal.any(signals) : undefined;
      // Keep the old aborted bridge signal for any late work from a timed-out tool.
      if (!timedOut) activeToolSignal = invocationSignal;
      try {
        const invocation = selected.invoke(args, { signal: invocationSignal });
        const result = invocationSignal ? await waitForFocus(invocation, invocationSignal) : await invocation;
        if (!sourceTool(name)) resume.after(name, args, result);
        if (resume.enabled) budget.after(name, args, result, metadata);
        return deferred.length ? { status: 'partial', executed: result, deferred, executionBudget: budget.snapshot() } : result;
      } catch (error) {
        resume.failure(name);
        if (resume.enabled) budget.failure(name, args, metadata);
        if (deadline?.aborted && !signal?.aborted) {
          timedOut = true;
          return { ok: false, status: 'unknown',
          reason: 'execution_budget_timeout', action: 'continue_other_pages',
          note: '本次等待预算到期；已派发的页面动作可能仍在完成，不能当作未执行或立即重发。保留成果，继续其他页面，后续仅回读结果。',
          executionBudget: budget.snapshot(), progress: JSON.parse(resume.reviewContext()) };
        }
        throw error;
      }
    });
  };
  setupSignal?.throwIfAborted();
  await enableBackgroundFocus(setupSignal);
  const dispose = async (tabClosed = false) => {
    disposed = true;
    if (tabClosed) { focusEmulation = 'inactive'; return true; }
    await focusRequest;
    if (!focusNeedsRestore) return true;
    try {
      // The raw command stays ordered after an unanswered enable. Timeout only
      // stops this wait; a later session must not overtake the old restoration.
      restoreRequest ??= queueFocus(false).catch((error) => { restoreRequest = undefined; throw error; });
      await waitForFocus(restoreRequest, AbortSignal.timeout(FOCUS_WAIT_MS));
      return true;
    } catch { return false; }
  };
  return { tools, call, resume, budget, dispose, get focusEmulation() { return focusEmulation; } };
}
