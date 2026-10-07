# BOSS 感兴趣岗位首次沟通

入口为个人中心的“感兴趣 → 职位收藏”。Codex 直连 Pagent MCP 时，优先使用单岗位入口；下方的面板和多岗位后台任务为旧流程，保留兼容。旧聊天扫描仍是单独的只读查漏，不自动补发。

## Codex 直连单岗位流程

Codex 用 `list_tabs` 固定当前收藏页的 `tabId`，调用只读的 `boss_list_current_favorites({tabId})` 取得这一页的稳定 `jobId`，再选择一个岗位调用 `boss_apply_favorite_job`。Pagent 的代码只检查和处理这个岗位，不扫描整份收藏、不自动推进下一岗，也不启动 Pagent 聊天模型。Codex 负责筛选、选择文案、调用下一岗和解释结果；同一标签页的任务必须串行。如果先用直接浏览器工具检查页面，完成后用 `browser_end_task` 释放该上下文。

```json
{
  "tabId": 123,
  "jobId": "岗位的稳定 ID",
  "dryRun": true,
  "serverName": "resume",
  "attachmentId": "resume-image"
}
```

`dryRun` 默认 `true`，仅预检这一岗，不发送、不取消收藏；用户已明确授权本轮实际投递时传 `false`。`greeting` 省略时使用保存的固定模板，传入时原文发送。`boss_get_favorites_preferences` 可不打开 BOSS 页面直接读取当前模板；用户要改模板时用 `boss_set_favorites_greeting({greeting})` 写入本地偏好并回读，原有投递数量设置保持不变。工具返回 `taskId` 只表示任务启动；用 `boss_get_favorites_task({tabId, taskId, includeRecipients:true})` 读取最终状态和回执。停止后续步骤可用 `boss_cancel_favorites_task`，但已发送的消息不会撤回。

单岗正常顺序是核对账号、招聘者与岗位 → 确认固定文案的送达回执 → 确认 `resume-image` 的送达回执 → 返回收藏页按岗位 ID 取消感兴趣并确认。两条发送回执未齐或身份有歧义时，保存已知阶段并保留收藏；不自动重发。BOSS CLI 可用于支持的只读检索，不用 `greet` 触发另一条默认招呼语。页面出现登录或安全验证时停止，交由用户在原页面处理。

异常由 Codex 读取单岗记录和现场证据后判断，不交给 Pagent 独立模型。直接浏览器上下文可通过 `browser_list_tools` / `browser_call_tool` 调用 `boss_inspect_favorites_exception` 检查；决定是否恢复时使用 `boss_resolve_favorites_exception`，沿用已确认的发送断点，不能把未确认回执视作未发送。

## 分享版首次使用

默认招呼语仅为“您好，我对这个岗位很感兴趣，方便进一步沟通吗？”。实际投递前，由使用者提供并保存自己的招呼语，核对自己的 BOSS 账号及 `resume-image`；随后先做一次 `dryRun:true`。

这份快照的 Windows 安装、Chrome 扩展连接与实际投递尚未在 Windows 真机验收；先预检，再经本人授权试投一个岗位并读取回执。
