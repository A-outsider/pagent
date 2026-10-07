import type { PageChangeSnapshot } from '@/features/page/change-tracker';
import type { ToolBridge } from './types';
import { createObservationTools } from './observation';
import { createInteractionTools } from './interaction';
import { createNavigationTools } from './navigation';
import { createCdpTools } from './cdp';
import { createMemoryTools } from './memory';
import { createMcpAgentTools } from './mcp';
import { createBossTools } from './boss';
import { createResumeTools } from './resume';
import { createNowcoderTools } from './nowcoder';
import { createResumeScanTools } from './resume-scan';
import type { ResumeSourceResolver } from './resume-source';
import type { ResumePreparationMode } from '../resume-workflow';

export * from './types';
export { createObservationTools } from './observation';
export { createInteractionTools } from './interaction';
export { createNavigationTools } from './navigation';
export { createCdpTools } from './cdp';
export { createMemoryTools } from './memory';
export { createMcpAgentTools } from './mcp';
export { createBossTools } from './boss';

/** 内置工具名集合，MCP 工具展示名与其冲突时自动加服务器前缀 */
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'observe_page',
  'observe_page_changes',
  'search_page_text',
  'capture_screenshot',
  'click_element',
  'dblclick_element',
  'hover_element',
  'type_text',
  'upload_attachment',
  'prepare_resume_form',
  'ensure_resume_attachment',
  'run_nowcoder_fill',
  'scan_resume_form',
  'clear_field',
  'select_option',
  'interact_elements',
  'verify_form_fields',
  'record_resume_progress',
  'get_resume_progress',
  'resume_execution_phase',
  'drag_element',
  'press_key',
  'scroll_page',
  'wait_for',
  'navigate',
  'go_back',
  'go_forward',
  'reload_page',
  'page_info',
  'get_source',
  'list_tabs',
  'open_tab',
  'switch_tab',
  'close_tab',
  'extract_interactions',
  'inspect_element_tree',
  'find_common_ancestor',
  'execute_named_script',
  'execute_cdp_script',
  'execute_cdp_command',
  'cdp_click_xy',
  'get_network_log',
  'get_console_log',
  'get_network_request',
  'memory_search',
  'memory_write',
  'boss_start_task',
  'boss_get_task',
  'boss_cancel_task',
  'boss_start_favorites_task',
  'boss_get_favorites_task',
  'boss_cancel_favorites_task',
  'boss_inspect_favorites_exception',
  'boss_resolve_favorites_exception',
]);

export async function createAgentTools(bridge: ToolBridge, isResumeFilling = () => false, getPreparationMode: () => ResumePreparationMode = () => 'upload_if_missing', sourceValue: ResumeSourceResolver = () => undefined) {
  const changeWatches = new Map<string, PageChangeSnapshot>();
  let lastWatchId: string | undefined;

  const startChangeWatch = async () => {
    const baseline = await bridge.content<PageChangeSnapshot>('dom.changes.start');
    changeWatches.set(baseline.watchId, baseline);
    lastWatchId = baseline.watchId;
    while (changeWatches.size > 8) {
      const oldest = changeWatches.keys().next().value as string | undefined;
      if (!oldest) break;
      changeWatches.delete(oldest);
    }
    return baseline;
  };

  const trackAction = async <T>(action: () => Promise<T>): Promise<T> => {
    await startChangeWatch();
    return action();
  };

  const observationTools = createObservationTools(
    bridge,
    changeWatches,
    () => lastWatchId,
    (id) => {
      lastWatchId = id;
    },
    startChangeWatch,
  );
  const interactionTools = createInteractionTools(bridge, trackAction, isResumeFilling, sourceValue);
  const navigationTools = createNavigationTools(bridge, trackAction);
  const cdpTools = createCdpTools(bridge, trackAction);
  const memoryTools = bridge.settings.memory.enabled ? createMemoryTools(bridge) : [];

  const builtinTools = [
    ...observationTools,
    ...interactionTools,
    ...createResumeTools(bridge, trackAction, getPreparationMode),
    ...createNowcoderTools(bridge),
    ...createResumeScanTools(bridge),
    ...navigationTools,
    ...cdpTools,
    ...memoryTools,
    ...createBossTools(bridge),
  ];

  const disabledBuiltinTools = new Set(bridge.settings.disabledBuiltinTools ?? []);
  // The new start tool covers both legacy operations; preserve either existing restriction.
  if (disabledBuiltinTools.has('boss_audit_resume_images') || disabledBuiltinTools.has('boss_send_resume_images')) {
    disabledBuiltinTools.add('boss_start_task');
  }
  if (disabledBuiltinTools.has('boss_get_resume_image_scan')) disabledBuiltinTools.add('boss_get_task');
  if (disabledBuiltinTools.has('boss_start_task') || disabledBuiltinTools.has('boss_send_resume_images')) disabledBuiltinTools.add('boss_start_favorites_task');
  return [
    ...builtinTools.filter((builtinTool) => !disabledBuiltinTools.has(builtinTool.name)),
    ...(await createMcpAgentTools(bridge)),
  ];
}
