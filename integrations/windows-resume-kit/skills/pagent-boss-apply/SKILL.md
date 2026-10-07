---
name: pagent-boss-apply
description: 由 Codex 直连 Pagent MCP 处理 BOSS 直聘已收藏岗位的首次沟通、简历图片发送与取消感兴趣。适用于 BOSS 收藏页投递，不用于网申表单填写。
---

# BOSS 收藏岗位投递

Codex 选择岗位、判断结果并决定是否处理下一岗；Pagent MCP 的确定性代码执行单岗流程。不向 Pagent 聊天框派发任务，不调用 `dispatch_task` 或启动 Pagent 独立模型。网申填写使用 [pagent-resume-fill](../pagent-resume-fill/SKILL.md)。

分享版首次使用：读取当前使用者的简历资料和附件元信息，确认 BOSS 账号、`resume-image` 与招呼语均属于本人。默认文案只是通用问候；实际投递前用本人提供的内容设置并回读，不能沿用原作者的身份、实习或成绩。

1. 用 `list_tabs` 固定已打开的 BOSS 收藏页 `tabId`，再用 `boss_list_current_favorites({tabId})` 只读取得当前页岗位及稳定 `jobId`。结合本轮已保存的任务状态，按 `jobId` 选定一个候选；不根据列表行号或相似公司名推断身份。筛选、去重和投递顺序由 Codex 控制。BOSS CLI 可用于其支持的只读检索；不要调用 `greet`，以免和本轮固定文案重复。
2. 省略 `greeting` 前，可用 `boss_get_favorites_preferences` 只读核对当前模板；用户要求更新模板时用 `boss_set_favorites_greeting({greeting})` 写入并回读。查看现场工具 schema 后调用 `boss_apply_favorite_job({tabId, jobId, greeting?, serverName?, attachmentId?, dryRun?})`。默认 `dryRun:true` 只读预检；用户已授权本轮实际投递时传 `false`，不逐岗重复询问。图片固定为简历 MCP 的 `resume-image`（默认 `serverName:"resume"`、`attachmentId:"resume-image"`）。单次调用只处理一个明确岗位，不用旧的 `boss_start_favorites_task` 全量扫描或跨岗位循环。同一标签页的页面操作须串行；如先用直接浏览器工具检查，完成后 `browser_end_task` 释放该上下文。
3. 单岗入口返回 `taskId` 后，用 `boss_get_favorites_task({tabId, taskId, includeRecipients:true})` 读取状态和回执，不能把启动成功当成投递成功。核对账号、招聘者和岗位后，依次确认文字送达、指定图片送达，最后确认已取消该岗位的“感兴趣”。只有全部确认才记完成。身份、页面、草稿或任一回执不明时保留收藏及断点，不猜测成功，也不自动重发。
4. 异常时先只读取得本岗记录和页面现场。必要时以 `browser_list_tools` → `browser_call_tool` 调用 `boss_inspect_favorites_exception`；仅在可证实的断点上通过 `boss_resolve_favorites_exception` 继续、跳过或暂停。已确认发送的步骤不可重发；无法确认的步骤不试探性重发。安全验证、登录失效或页面不可操作时停止。
5. 逐岗向用户报告已完成、保留及需核对的岗位和对应回执。发送或取消收藏是外部操作，只有本轮用户授权才执行；读取和预检不代表授权实际投递。

具体字段和状态以当前 MCP schema 为准；流程实现与异常机制见 [BOSS 收藏投递文档](<__INSTALL_ROOT__/docs/boss-favorites.md>)。
