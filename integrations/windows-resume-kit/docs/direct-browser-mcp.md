# 由外部 Agent 直接使用 Pagent 浏览器能力

直接工具模式复用 Pagent 内置 Agent 的工具工厂和浏览器执行桥接。Codex 等 MCP 客户端负责理解任务、安排步骤和判断结果；扩展负责执行工具，不启动自己的聊天模型，也不读取聊天模型 API key。原 `dispatch_task` 仍会启动 Pagent Agent，与直接工具模式是两个入口。

## 本机连接

本机 Codex 配置指向共用的 HTTP Host，避免每个会话各启动一个服务、扩展却只连接其中一个：

```toml
[mcp_servers.pagent]
url = "http://127.0.0.1:17344/mcp"
tool_timeout_sec = 330
```

Windows 分享版先按根目录 `INSTALL.md` 安装，使用 `scripts/start-services.ps1` 启动服务。Host 固定 `127.0.0.1:17344`，占用即报错，不自动更换端口。Chrome 加载分享包的 `pagent/dist`；更新后重新加载扩展，不刷新招聘页面。Codex 重连 MCP 后会取得新增入口；如果当前会话仍显示旧工具名单，重新连接 MCP 后再调用。

Streamable HTTP 配置格式参见 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

长工具执行期间，扩展每 10 秒独立向 Host 发送心跳，不再等工具结束才更新连接时间。`/health.extensionState` 返回 `idle / busy / offline`：`busy` 表示请求已交给扩展且尚未收到结束回执，`offline` 表示超过 45 秒未收到扩展通信；它们不证明页面是否有进展或操作是否成功。`busy` 无需重载扩展，心跳也不会让挂起的页面操作自动恢复。当前 Host 仍逐个执行请求，不因心跳增加多页并发。

响应超时分两种：提示“尚未交给扩展”时，Host 已移出排队请求，扩展不会随后执行它；提示“已交给扩展”时，只结束本次响应等待，页面操作可能仍在执行。后一种情况先等待或回读页面结果，不立即重发写入、上传或消息。客户端自己的超时未必包含交付状态，也按结果未知处理；`browser_end_task` 中止后续调用，不能保证撤回已发出的 DOM 命令。

直接桥接的单次内容脚本 RPC 最长等待 300 秒，任务/阶段中止也会释放消息等待。注入检查期间中止不会随后派发该命令；已派发后中止或达到上限则明确报告结果未知，不证明页面动作停止，也不自动重试。这是释放挂起等待的上限，不是填写耗时目标；现有截图、附件等更短的专用截止时间保持不变。

## 调用方式

1. 用 `list_tabs` 取得已打开页面的 `tabId`。
2. 调用 `browser_list_tools({ tabId, prompt: "帮我填写当前网申，未知信息留空" })`，取得 `contextId`、完整 `toolNames`、工具参数 schema 和当前页面操作说明。首次读取全部 schema；以后可用 `names` 只读取所需工具详情。
3. 调用 `browser_call_tool({ tabId, contextId, name: "observe_page", args: { scope: "page" } })`。后续填写、上传、截图、核验都使用同一个上下文，按返回结果继续。
4. 调用 `browser_end_task({ tabId, contextId })` 结束上下文，停止后续工具操作。已经发生的填写、上传或发送不会撤回；BOSS 后台任务另用对应取消工具停止。

再次列工具时，同一文档及相同设置、任务描述会复用上下文。刷新、重载内容脚本、换文档、工具设置变化或新任务描述会需要新的上下文；旧 `contextId` 不能继续写页面。`open_tab`、`switch_tab` 不改变本上下文的目标，新标签页需显式重新绑定。普通 DOM 更新不会重新建立工具实例，变化观测与简历证据可以跨调用保留。

## 能力对照

| 能力 | 直接工具模式 |
| --- | --- |
| 页面快照、文本搜索、元素树、变化观测 | 复用原工具，保留变化观测基线和分页 |
| 点击、输入、下拉、批量填写、拖动、键盘、滚动 | 复用原 DOM 操作及回读结果 |
| 截图 | 返回 MCP 图像内容，不使用截断 data URL |
| 页面脚本、CDP 命令、坐标点击、网络和控制台 | 复用原执行桥接和权限设置 |
| 导航及标签页 | 显式操作指定标签页，保留原 URL 策略 |
| 简历来源与 `sourcePath` | 外部 MCP 原始值在扩展内登记；展示脱敏不影响本地赋值和比较 |
| PDF 解析准备、独立简历附件、头像 | 复用 MCP 附件下载、用途检查、重复上传保护和网页回执检查 |
| 牛客补充填写 | 复用原有限等待和同一文档只启动一次的约束 |
| 字段核验和来源覆盖 | `verify_form_fields`、`record_resume_progress`、`get_resume_progress` 保留证据与未处理记录 |
| BOSS 单岗首次沟通 | `boss_apply_favorite_job` 定向当前收藏页可见的一个岗位；Codex 决定是否调用下一岗 |
| BOSS 打招呼语模板 | `boss_get_favorites_preferences` 读取当前偏好，`boss_set_favorites_greeting` 只更新本地文案并保留投递数量 |
| BOSS 旧多岗任务与历史查漏 | 旧 `boss_start_favorites_task` 和只读查漏仍可用；进度与异常由外部调用者读取 |
| BOSS 投递异常 | 外部启动的任务暂停并保留断点；调用者用 `boss_inspect_favorites_exception` 检查，再用 `boss_resolve_favorites_exception` 选择继续、跳过或暂停，代码立即按原任务应用决定 |
| 已配置的外部 MCP 和记忆工具 | 按原启用状态动态发现；保留原服务依赖 |

工具名单来自 `createAgentTools`，不是另写一个精简白名单。被用户关闭的内置工具、截图和记忆能力继续按设置禁用；外部 MCP 也沿用其连接、工具开关及附件上传权限。一个上下文中的外部 MCP 工具名单在创建时确定；添加服务器或调整其工具开关后，先 `browser_end_task`，再 `browser_list_tools` 获取新名单。

## BOSS 收藏页单岗位投递

Codex 用 `list_tabs` 取得 BOSS 感兴趣职位收藏页 `tabId`，再调用只读顶层工具 `boss_list_current_favorites({tabId})` 获取当前页的稳定 `jobId`。选定一岗后调用 `boss_apply_favorite_job({tabId, jobId, greeting?, serverName?, attachmentId?, dryRun?})`。默认 `dryRun:true`，只预检该岗位；用户已授权实际投递时传 `false`。`greeting` 省略使用保存模板，可先用 `boss_get_favorites_preferences` 核对；更新模板用 `boss_set_favorites_greeting({greeting})`，不改原有投递数量。附件默认 `serverName:"resume"`、`attachmentId:"resume-image"`。单岗工具不扫描整份收藏、不跨岗位循环，也不调用 Pagent 模型；`dispatch_task` 和旧 `boss_start_favorites_task` 不属于此新流程。

单岗入口返回任务快照及 `taskId`，随后按需用 `boss_get_favorites_task({tabId, taskId, includeRecipients:true})` 读取最终回执。代码按正确会话、文字回执、简历图回执、取消感兴趣确认顺序推进；任一身份或回执不明时停止并保留收藏，不能把未确认当成未发送。异常由 Codex 通过直接工具上下文调用 `boss_inspect_favorites_exception` 查现场，再由 `boss_resolve_favorites_exception` 在可证实的断点上决定继续、跳过或暂停，不启动 Pagent 独立模型。用户停止时 `boss_cancel_favorites_task` 只停止后续操作，不撤回已发送内容。

同一标签页不要同时进行直接浏览器调用和单岗任务。若为预检或异常先建立了 `browser_list_tools` 上下文，完成后调用 `browser_end_task`；已有上下文本身不会启动发送。任务只处理当前页的精确岗位 ID，列表位置和公司名不足以指定目标。完整业务顺序见 [BOSS 感兴趣岗位首次沟通](boss-favorites.md)。

## 简历填写流程

外部调用者安排完整流程：读取本轮最新简历来源，准备 PDF 解析入口并核对误解析的字段，执行牛客补充填写，扫描整张申请表，补齐全部有依据且适用的字段与经历，最后独立核验字段和来源覆盖。缺失事实留空，填写工具成功不等于网站已经保存或投递。

`record_resume_progress` 只登记处理范围；只有 `verify_form_fields` 回读符合预期才产生核验证据。后续修改可能使已核验字段重新待核验。牛客阶段之后禁止重新运行 PDF 解析覆盖表单；独立的正式简历附件仍可用 `ensure_resume_attachment` 检查和补齐。已经赋值的附件先检查回执，不重复上传。

简历上下文自动启用 CDP focus emulation，使后台页面的帧更新和等待继续运行，不切换当前标签或窗口；结束、更换上下文或换文档时尝试恢复，关闭标签时释放上下文。`browser_list_tools.backgroundFocus` 返回 `enabled / unavailable / inactive`，不可用时继续普通工具。恢复失败保留重试状态：`browser_end_task.backgroundFocusRestored:false` 时可用同一 `contextId` 再次结束任务；下一次绑定也会重试旧清理，`previousBackgroundFocusRestored:false` 如实报告未确认，但不阻断新任务。焦点模拟不代替牛客工具栏首次注入所需的前台权限。Moka 的年月、学历及搜索下拉可直接批量 `choose-option`；已匹配的常驻选值不重复打开，学校/专业只选择精确候选。

每页只读一次完整来源，复用 `sourcePath`，每批最多 30 个字段。以批次结果和局部变化处理失败项，阶段变化才整表扫描；最后一次整表查漏后核验所有适用字段。只读 CDP、菜单开合和 Escape 保留已有证据；普通字段重写只使对应字段待核验，新增/删除或解析导致结构变化再重查。未知脚本仍按可能修改处理；纯读取的 `Runtime.evaluate` 使用 `throwOnSideEffect:true`，不要把有副作用的脚本声明为只读。

`get_resume_progress` 返回 `sourceFields`、`nextFields`、`deferredFields` 和 `coverageSummary`。每个已读非空来源叶子分别登记：名称核验通过不会覆盖同条经历的职位、日期和正文；插件完成回执也不消除来源待办。`nextAction` 区分 `locate_and_fill / read_back / recover_once`，延后项单列而不反复入执行队列。字段级映射使用 `sourcePath`；组合文本可用 `record_resume_progress.records[].fields` 登记所含来源叶子，但仍需独立回读且正文实际包含该事实。`records.status:mapped_fields_verified` 仅兼容已登记子集；整条记录完成看 `sourceCoverage.complete`，整页覆盖看 `coverageSummary.recordFieldCoverage`。进度默认不重复原值，完整证据也不输出字段原值。

直接简历模式先覆盖全部页面普通内容，再调用 `resume_execution_phase({phase:"review"})` 集中处理延后难项及来源检查。主填5分钟、review3分钟；两个阶段的90秒/6次诊断与45秒/3次实际目标恢复独立，保留主填耗尽项和总耗时。普通定位、首填、保存、首次核验不继承无关字段的失败限制；未写项核验不可用不创建恢复。排障可在 `browser_call_tool` 外层传 `execution:{diagnostic:true,fieldIds:[...]}`。同阶段局部超限返回 `status:deferred`，混批移除超限字段继续其他项并返回 `status:partial`；页限时通过 `executionBudget.phaseLimitReached` 提示 Codex 转下一页，不拒绝普通补填、必要保存或首次核验，也不缩短这些调用的超时；不能将缺项当作完成。同阶段重绑不清零，切页和结束暂停累计；主填进入review不需要用户重新授权。`resetResumeBudget:true` 仅用于明确新任务，或用户纠正策略并应用修复后继续现有缺项。页面调度、补漏和保存判断由Codex负责。

普通调用的等待也受当时剩余预算限制，预算信号传入内容桥接，避免等待旧300秒上限。到期返回 `status:unknown`，保留来源进度并隔离此上下文的后续页面动作，阻止迟到工具继续派发内容命令；只读进度仍可取。已发出的动作不能撤回，后续只能回读确认，不能因超时直接重发。预算位于扩展内存，扩展重新加载或进程重启后不保留；不能将跨上下文保留理解为永久持久化。

## 运行边界

- 同一标签页的直接工具调用串行执行；Pagent Agent 或 BOSS 后台机械任务运行期间，普通页面操作会被阻止，避免争抢页面。
- 确认发送、提交等动作仍由外部调用者按用户授权安排；直接接口不把工具存在视为已授权执行。
- Pagent 聊天模型配置不再是直接工具模式的前提。简历资源 MCP 需在线；牛客助手如需使用，应已安装并由用户手动打开（Windows 不支持自动打开）；Memory RAG 如启用仍依赖其独立 embedding 服务配置。
- 扩展负责确定性的执行与保护，原内置 Agent 的模型分析、自动阶段编排和最终说明由 Codex 承担。
- 外部启动的 BOSS 任务异常不会自动启动 Pagent 模型；只有当前任务的有效异常可以决定，已确认的消息不会重新发送。
