export const USAGE_TOPICS = [
    'overview',
    'workflow',
    'direct_browser',
    'list_tabs',
    'open_tabs_background',
    'dispatch_task',
    'get_session',
    'boss_favorites',
    'boss_resume_images',
    'collaboration',
];
const SECTIONS = {
    direct_browser: `直接浏览器模式（不调用 Pagent 聊天模型，不需要它的模型 API key）：
1. list_tabs 选择用户已打开的目标 tabId；不能猜页面或默认操作当前活动标签。
2. browser_list_tools({ tabId, prompt: 用户本次任务原文 }) 返回 contextId、toolNames、tools 的原参数 schema 和操作规则。此入口复用全部已启用内置工具及已配置外部 MCP。names 可只读取某几个工具的 schema；不会减少可调用能力。
3. browser_call_tool({ tabId, contextId, name, args }) 直接执行原工具。先 observe_page/extract_interactions/search_page_text 获取真实 elementId，interact_elements 批量填写，verify_form_fields 独立核验。sourcePath、页面变化观测、牛客去重、附件回执和填写证据在同页上下文中保留；capture_screenshot 返回图像块。
4. 简历填报先读 get_resume/lookup_resume_fields，再 prepare_resume_form、核对解析字段、run_nowcoder_fill、scan_resume_form、补齐所有适用来源记录。get_resume_progress.nextFields 按来源叶子区分 locate_and_fill/read_back/recover_once；正文、日期不会因名称通过而消失。先完成全部页面普通内容，再调用 resume_execution_phase({phase:"review"}) 集中处理延后难项并检查来源完整性。主填5分钟、集中难项及检查3分钟；每阶段独立累计页诊断90秒/6次和当前实际失败目标恢复45秒/3次，主填耗尽项不阻断review，同阶段重绑不清零。正常定位、保存、首填和首次核验继续；未写字段核验不可用不创建失败恢复。限时是让路规则，不是要求用户另开任务的门槛。排障调用可附 execution:{diagnostic:true,fieldIds:[...]}。未知资料留空。PDF/独立附件用专用工具，头像用 upload_attachment。
5. BOSS首发机械任务仍可运行；通过外部MCP启动的任务异常只返回needs_attention，不启动Pagent模型。外部调用者按需读取状态，使用boss_inspect_favorites_exception和boss_resolve_favorites_exception核对并决定continue/skip/pause；后者安全应用决定，不重发已确认文字或未知结果图片。不能接管内部Pagent任务。
6. 真正换文档或工具设置变化后重新browser_list_tools，旧contextId不会操作新页。open_tab/switch_tab返回目标，但不会偷偷改变此上下文tabId，新标签另行绑定。已有Pagent Agent和后台机械任务占用时不可接管；任务读取/停止除外。网页错误或超时不证明未执行，先读取现场，不盲重试发消息或上传。
7. 完成后browser_end_task({ tabId, contextId })释放观察/来源上下文。它不撤回网页写入或上传、不取消BOSS后台任务。新增外部MCP工具后先结束旧上下文再读列表。记忆embedding服务、简历资源MCP、牛客助手和浏览器权限沿用原依赖。
独立Agent委派仍可选用dispatch_task，但会调用Pagent自己配置的模型。`,
    overview: `你是本地 Agent；Pagent 是跑在用户浏览器里的页面 Agent。
你负责拆任务、选标签页、决定何时派发、根据会话结果继续推理。
Pagent 负责打开网页、观察 DOM、点击、输入、滚动、导航。不要自己去“猜页面长什么样”，把浏览操作交给 Pagent。

可用工具：
- browser_list_tools / browser_call_tool / browser_end_task：直接调用完整浏览器工具，由本地 Agent 推理，Pagent 只执行；默认优先此方式，无需配置 Pagent 聊天模型。
- get_usage：查询本服务的用法（本工具）。Pagent 扩展未连接时也能调用。
- list_tabs：查看全部标签页，以及是否已有 Agent 在该页工作。
- open_tabs_background：给定链接去重后放进独立后台窗口，或指定 windowId 添加，不切焦点、不派发模型。
- dispatch_task：向某个标签页派发任务。立即返回 sessionId，不等待任务完成。
- get_session：按 sessionId / tabId / conversationId 查看进度、思考、最近消息。
- boss_start_favorites_task：指定投递数，从感兴趣岗位首次沟通，发送固定文字和图片并取消收藏；正常路径全由代码执行。
- boss_get_favorites_task / boss_cancel_favorites_task：按需读取该流程的进度、回执和异常决定，或停止后续操作。
- boss_start_task：使用 operation=audit 启动单独的完整只读查漏；新流程不自动补发。
- boss_get_task / boss_cancel_task：按需读取任务状态或停止后续操作，默认不返回名单。
- boss_audit_resume_images / boss_send_resume_images / boss_get_resume_image_scan：保留供旧客户端兼容，新任务使用后台能力。

普通页面任务先 list_tabs，再 browser_list_tools、browser_call_tool；细节见direct_browser。dispatch_task/get_session仍可委派独立Agent。BOSS感兴趣岗位机械任务可先list_tabs，再boss_start_favorites_task；页面直接展示进度，异常交外部调用者读取现场并决定继续、跳过或暂停。不确定协议时先get_usage。`,
    collaboration: `分工：
- 本地 Agent：规划、选择目标页、撰写给 Pagent 的 prompt、根据 get_session 的结果做下一步决策。
- Pagent：在真实标签页里操作网页。同一标签页同一时刻只有一个 Agent 在跑；再次 dispatch_task 会打断当前任务。

协作原则：
1. 不要对 agent.working = true 的标签页派发，除非你就是要打断它。
2. 不要对 protected = true 的标签页派发（chrome://、扩展页等受保护页面）。
3. prompt 写成 Pagent 能直接执行的页面操作，避免空泛的“帮我处理一下”。
4. dispatch_task 成功只代表“已接手”，不代表网页任务完成。用 get_session 看到 running = false 再下结论。
5. 需要接着同一段对话时，把上次返回的 conversationId 传回 dispatch_task；省略则会新建会话。
6. 扩展未连接时，list_tabs / dispatch_task / get_session 会失败。此时只能 get_usage；请提示用户打开浏览器并加载 Pagent 扩展。`,
    workflow: `推荐流程：
直接操作优先 list_tabs → browser_list_tools({tabId,prompt}) → browser_call_tool({tabId,contextId,name,args})，详细规则见direct_browser。以下是可选的独立Agent委派方式，会调用Pagent自己的模型：
1. list_tabs，记录 tabId、url、title、protected、agent.working、agent.sessionId。
2. 选定目标：
   - 已有合适标签页：dispatch_task({ prompt, tabId })
   - 需要打开新地址：dispatch_task({ prompt, url })  （会新建标签页）
   - 已有标签页要先跳转：dispatch_task({ prompt, tabId, url })
   - 都不传：派到当前活动标签页
3. 保存返回的 tabId、sessionId、conversationId。
4. 隔几秒调用 get_session({ sessionId })：
   - running = true：仍在工作，可读 thinking / tasks / messages 判断是否卡住
   - running = false 且 found = true：本轮结束，根据 messages 和 error 决定是否再派发
   - found = false：会话已不可见（标签页可能关了），重新 list_tabs
5. 同一站点的后续步骤，带上 conversationId 继续，而不是每次都开新会话。`,
    list_tabs: `list_tabs()
无参数。返回 { tabs: HostTab[] }。

HostTab 关键字段：
- tabId, title, url, active, windowId, status, pinned
- protected：true 时无法注入 Agent，不能派发
- agent.working：该页是否有 Agent 正在跑
- agent.sessionId / conversationId / title / thinking / error：最近一次会话摘要

用法：选目标页、避开冲突、发现可续上的 sessionId。`,
    dispatch_task: `dispatch_task({ prompt, tabId?, url?, conversationId? })
立即启动 Pagent，不等待页面任务完成。

参数：
- prompt（必填）：交给 Pagent 的任务。写具体操作和成功标准。
- tabId：已有标签页。省略且无 url 时用当前活动标签页。
- url：无 tabId 时新建并打开；与 tabId 同时出现则先导航再执行。
- conversationId：续上已有会话；省略则新建。

成功返回：{ ok: true, tabId, sessionId, conversationId }

注意：
- 对正在工作的标签页再派发会打断旧任务。
- 受保护页面、非法 URL、扩展未连接会失败。
- 拿到 sessionId 后用 get_session 跟踪，不要假设已经做完。`,
    open_tabs_background: `open_tabs_background({ urls, windowId?, groupName? })
每批1–100个链接，只接受符合当前导航策略的HTTP(S) URL。标准URL化去重，保留query/hash区别。
默认新建focused:false的普通窗口。指定windowId时，仅在该窗口active:false新增，跳过已有链接；其他窗口及原标签不移动、不关闭、不改分组。
返回windowId、opened、existing、failed、duplicateCount、group。只代表标签已创建，不代表页面加载成功或岗位已核验。
groupName只为本次新标签命名分组；缺tabGroups权限时照常打开并返回permission_required，不自动申请权限。
部分失败应参考返回结果续做；后续批次固定返回的windowId。不要用普通open_tab/switch_tab替代，它们会激活标签/窗口。
此工具不启动Pagent任务，不会中断其他标签已有会话。`,
    get_session: `get_session({ sessionId?, tabId?, conversationId? })
至少提供一个查询键，多个同时给时按 AND 匹配。

返回：
- found / running
- tabId, url, title
- sessionId, conversationId, conversationTitle
- thinking, error, updatedAt, budget
- tasks[]：Pagent 内部步骤
- messages[]：最近至多 8 条（内容截断）

running = true 表示仍在跑；false 且 found = true 表示本轮已结束。
优先用 dispatch_task 返回的 sessionId 查询。`,
    boss_favorites: `BOSS 感兴趣岗位首次沟通（先 list_tabs，选择个人中心“感兴趣—职位收藏”标签页）：
1. 只读预览：boss_start_favorites_task({tabId, maxRecipients:10, dryRun:true})。只读列表和去重，不点击立即沟通、不发送、不取消收藏。maxRecipients 范围1至2000，默认10。
2. 用户明确授权实际发送后，boss_start_favorites_task({tabId, maxRecipients:10, dryRun:false})。maxRecipients 按文字、图片回执及取消收藏均确认的完整成功人数计算，跳过不占名额。立即网申、未知按钮、字段不完整的单个候选直接记录原因并跳过、保留收藏，不触发 AI，也不阻断其他岗位。
3. greeting 省略时使用用户已保存的打招呼语；用户指定新文本时原样传 greeting。默认模板和数量可在扩展的感兴趣投递面板修改，本轮启动后固定。serverName 默认 resume，attachmentId 固定 resume-image，每批只下载并校验一次。
4. 程序只处理“立即沟通”，稳定岗位/招聘者标识去重，核对会话，再发固定文字和简历图；两条回执确认后返回列表取消感兴趣，确认后额外等待1秒。列表移位按稳定标识重定位，不能按行号推进。
5. 返回 taskId 即已接手，简短告知启动并结束本轮。不要再 dispatch_task 指挥逐个点击，不轮询维持任务，不使用通用脚本/上传替代专用流程。
6. 按需 boss_get_favorites_task({tabId,taskId?,includeRecipients:false})。需要名单才 includeRecipients:true。status=needs_attention 表示流程已停止，exception 包含阶段、文字/图片/取消收藏确认状态和 handoff/resolution。通过外部 MCP 启动的任务不调用 Pagent 模型；外部调用者用 browser_list_tools 绑定该页，再经 browser_call_tool 调用 boss_inspect_favorites_exception 读取现场，调用 boss_resolve_favorites_exception 选择 continue/skip/pause。决定立即安全应用，代码按原队列及回执断点继续，不重发已确认消息。不能接管内部 Pagent 任务，也不要另起投递任务。
7. 用户取消时使用 boss_cancel_favorites_task({tabId,taskId}) 停止后续动作，不触发 Pagent 接管。已开始的发送可能送达；后台重启只恢复报告，不自动恢复发送。不能把未确认消息当成未发送。
8. 完成后可按用户要求单独使用 boss_start_task operation=audit 完整只读查漏。它不能证明本批指定文字、图片版本和取消收藏均已完成，不根据查漏结果自动补发。`,
    boss_resume_images: `BOSS 完整只读查漏（使用 list_tabs 返回的求职者聊天 tabId）：
1. 查漏：boss_start_task({ tabId, operation:"audit", since? })。代码自动扫描完整指定范围；since 是带时区 ISO 时间，未指定则不限。
2. 启动立即返回 taskId，任务独立于模型运行。调用方告知已启动并结束本轮，页面直接展示进度、分类名单和报告，不轮询维持运行，不操作该标签页干扰任务。
3. 用户问进度或原因时按需调用一次 boss_get_task({ tabId, taskId? })，默认只返回摘要和计数；需要明细才传 includeRecipients:true。只读任务记录，不重新访问页面历史、不触发续扫或发送。taskId 绑定原始 tabId，省略时读取该页最近任务，null 表示暂无记录。
4. boss_cancel_task({ tabId, taskId }) 停止后续扫描。不能猜ID，不能把扫描发现缺图当成补发授权。
此旧扫描把本人发出的图片作为简历图线索，并跳过已回复会话；历史不足或类型未知列为 uncertain。它不能确认本批指定文字、图片版本和取消收藏状态，本批对账使用 boss_get_favorites_task。
旧 boss_audit_resume_images / boss_get_resume_image_scan / boss_send_resume_images 和 operation=send 保留兼容，但当前工作流不调度补发；使用 boss_start_favorites_task 完成感兴趣岗位首次沟通。`,
};
const ORDER = [
    'overview',
    'collaboration',
    'workflow',
    'list_tabs',
    'open_tabs_background',
    'dispatch_task',
    'get_session',
    'boss_favorites',
    'boss_resume_images',
];
export function getUsageGuide(topic) {
    if (topic) {
        return `# ${topic}\n\n${SECTIONS[topic].trim()}`;
    }
    return [
        '# Pagent MCP 用法',
        '',
        `可按 topic 查询某一段：${USAGE_TOPICS.join(', ')}。省略 topic 返回全文。`,
        '',
        ...ORDER.flatMap((name) => [`## ${name}`, '', SECTIONS[name].trim(), '']),
    ].join('\n');
}
