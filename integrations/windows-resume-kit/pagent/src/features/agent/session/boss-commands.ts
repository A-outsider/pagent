import type { SlashCommand } from './composer';

const BOSS_COMMANDS: SlashCommand[] = [
  {
    key: 'boss感兴趣投递',
    name: 'BOSS 感兴趣岗位投递',
    desc: '指定数量，发送固定文字与简历图，确认后取消收藏；异常交 AI 判断',
    prompt: `从 BOSS 个人中心“感兴趣—职位收藏”执行首次沟通流程。调用一次 boss_start_favorites_task，maxRecipients 按用户指定数量，未指定默认10，范围1至2000；按完整成功人数停止，跳过不占名额。
默认 dryRun=true 只读预览。用户已明确要求实际发送时 dryRun=false，已有授权无需逐人确认。greeting 省略时使用当前保存的打招呼语，用户指定新文字时原样传入，不逐人改写。serverName 默认 resume，attachmentId 固定 resume-image。
固定程序只处理“立即沟通”岗位，按岗位和招聘者去重，核对会话，发送文字并确认回执，再发简历图并确认回执，返回列表取消感兴趣并确认，最后等待1秒。正常流程全部串行，不需要模型逐步操作，不进入旧补发流程。
工具返回 taskId 后简短告知已启动并结束本轮；不轮询、不搬运ID、不用普通页面工具接管。进度或异常只读 boss_get_favorites_task；停止调用 boss_cancel_favorites_task。
立即网申、单个候选卡片未知状态或缺失字段直接记录原因并跳过，保留收藏，不占名额，也不触发 AI。账号变化、聊天对象不匹配、发送回执不明等执行异常由后台停止并保存证据，自动交 Pagent 读取现场，并调用 boss_resolve_favorites_exception 选择继续、跳过或暂停；Pagent 正常结束后程序应用决定，继续原任务，不重发已确认消息。其他联系人消息和列表重排不中断。用户取消不触发 AI，后台重启不恢复发送。可在完成后按用户要求另跑 boss_start_task operation=audit，只读查漏，不据此补发。`,
  },
  {
    key: 'boss简历查漏',
    name: 'BOSS 简历查漏',
    desc: '后台自动查漏，页面直接展示进度和名单',
    prompt: `在 BOSS 直聘求职者“仅沟通”列表执行简历图片查漏。本次仅扫描 dry run，不发送图片或消息。
调用一次 boss_start_task，operation=audit，后台代码自动检查用户指定范围。用户指定日期时按北京时间转为带 +08:00 的 ISO 时间传 since，未指定时间则不限。
扫描把图片由本人发送视为历史中的本人的简历图片；这是旧扫描的启发式，不能证明本批指定图片版本或打招呼文字已发送。对方真实回复、本人已发图者跳过，系统通知不算回复。未发现必须已读取完整历史。扫描完成不补发，需用本批感兴趣任务的发送回执单独对账。
工具返回 taskId 后简短告知已启动并结束本轮；不循环调用、不搬运收件人ID、不重新汇总名单，页面直接展示进度和报告。用户另问进度或原因时才调用 boss_get_task，只读已有记录。`,
  },
];

/** Built-in BOSS commands are available only on the supported production origin. */
export function getPageCommands(url: string, savedCommands: readonly SlashCommand[] = []): SlashCommand[] {
  let builtins: SlashCommand[] = [];
  try {
    if (new URL(url).origin === 'https://www.zhipin.com') builtins = BOSS_COMMANDS;
  } catch {
    // Invalid or protected page URLs have no site-specific commands.
  }
  const builtinKeys = new Set(builtins.map((command) => command.key));
  return [...builtins, ...savedCommands.filter((command) => !builtinKeys.has(command.key))];
}
