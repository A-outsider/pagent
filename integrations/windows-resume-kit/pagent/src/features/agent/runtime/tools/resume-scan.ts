import { tool } from 'langchain';
import { z } from 'zod';
import { isolateUntrustedPage } from '../middleware';
import type { ToolBridge } from './types';

export function createResumeScanTools(bridge: ToolBridge) {
  return [tool(async () => isolateUntrustedPage(JSON.stringify(await bridge.content('dom.resume.scan'))), {
    name: 'scan_resume_form',
    description: '只读扫描当前 DOM 的整张申请表：栏目、重复记录、字段当前状态、网站错误、牛客未填提示和折叠/新增入口。扫描不受 observe_page 页数影响，也不代表未挂载的下一步已检查。牛客粉红色只是可能陈旧的提示，data-nc-filled 仅表示处理过；据当前值和 MCP 资料判断缺项。字段自带 elementId；Phoenix 下拉另有同控件 triggerElementId 和 expanded，已展开就观察弹层，不重复切换。先匹配栏目及公司/项目名称等身份再批量补填/核验，网页 recordIndex 不能当来源数组下标，更不能跨工作/项目栏目套用。不要为消除红色编造未知事实。对照所有来源经历，不仅检查 issues，填后可再次扫描，无需重跑 PDF/牛客。',
    schema: z.object({}),
  })];
}
