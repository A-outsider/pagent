# Windows 安装与首次验收

这套连接是：`Codex → Pagent MCP Host → Chrome 扩展 → 招聘页面`。扩展通过本机 Resume MCP 读取你的结构化简历和附件。直接 MCP 模式无需配置 Pagent 独立聊天模型的 API key。

## 1. 准备目录、Node.js 和 Chrome 扩展

1. 安装 Git，将分享分支克隆到永久 NTFS 本地目录（避开 OneDrive 和共享目录），随后进入 `integrations/windows-resume-kit`。不要把后续生成的个人数据提交 Git 或转发给别人。

   ```powershell
   git clone --branch codex/windows-resume-share --single-branch https://github.com/A-outsider/pagent.git C:\Tools\pagent-resume
   cd C:\Tools\pagent-resume\integrations\windows-resume-kit
   ```
2. 安装 [Node.js](https://nodejs.org/) 24 或更高版本（包含 npm），重新打开普通 PowerShell。无需管理员权限。
3. 打开 Chrome 的 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，选本分享目录的 **`pagent\dist`** 目录。所需扩展权限由本人查看并确认。
4. 复制扩展卡片上的 ID（32 位 a–p 字母）。本地加载位置影响扩展 ID，因此安装后保持目录不变。

脚本兼容 Windows PowerShell 5.1，使用 UTF-8 无 BOM 写 JSON。下方命令中的 `-ExecutionPolicy Bypass` 只作用于本次 PowerShell 进程，不修改系统或当前用户的执行策略；不会提权。

## 2. 安装本机依赖与 Skill

在 PowerShell 中进入分享目录，把示例 ID 换成自己的扩展 ID：

```powershell
cd 'C:\Tools\pagent-resume\integrations\windows-resume-kit'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -ExtensionId '这里替换为你的32位扩展ID'
```

此脚本会：

- 只安装 `pagent-host` 和 `resume-mcp` 的生产依赖；关闭依赖安装脚本，不安装整个 Pagent 开发依赖。
- 在 `resume-mcp\data` 创建本人的随机 Token、空简历、空附件索引和扩展配置；已有 Token、简历和附件索引保留。
- 将该数据目录及其中文件的访问权限设置为当前 Windows 用户和 SYSTEM。Token 独立禁用 ACL 继承并通过运行时权限检查。
- 把两个 Skill 复制到 `%CODEX_HOME%\skills`，未设置时使用 `%USERPROFILE%\.codex\skills`。已有同名 Skill 不覆盖，终端会提醒手工比较合并。
- 生成 `codex-mcp.fragment.toml`，不修改你的 `config.toml`。

若安装失败，先看对应错误再继续。依赖可重装；资料和 Token 不自动重置。脚本不会启动浏览器、授权扩展、发送消息或设置开机启动。

## 3. 填入自己的资料与附件

请让你本机的 Codex 读取 `resume-mcp\AGENTS.md`，根据你明确提供的简历填写 `resume-mcp\data\resume.json`。初始模板的 `sections` 为空，不含可直接投递的人物信息。未知信息留空；经历归属规则由本人确定。不要把 Token 文件提供给模型作为简历资料。

可用以下命令登记本人附件；每个 ID 只能首次登记，不会覆盖已有附件：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-attachment.ps1 -Id resume-pdf -Path 'C:\Users\你的用户名\Documents\本人简历.pdf'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-attachment.ps1 -Id resume-image -Path 'C:\Users\你的用户名\Documents\本人简历.png'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-attachment.ps1 -Id avatar -Path 'C:\Users\你的用户名\Pictures\本人头像.jpg'
```

`resume-pdf` 只接受 PDF；`resume-image`、`avatar` 接受 PNG/JPEG；单文件最多 20 MiB。代码检查扩展名、实际文件头和 SHA-256，复制原始字节到受限的 `data\attachments`，并更新 `data\attachments.json`。登记不会上传到网站。更换已有附件需要核对用途和版本后显式更新，脚本不自动删除旧版。

## 4. 接入 Codex 与 Pagent

**Codex 连接 Host：**把生成的 `codex-mcp.fragment.toml` 合并进你的 Codex 配置（通常是 `%USERPROFILE%\.codex\config.toml`，设置过 `CODEX_HOME` 时使用该目录）。已有 `[mcp_servers.pagent]` 时只核对/合并该段，不能重复添加或替换整份配置。

```toml
[mcp_servers.pagent]
url = "http://127.0.0.1:17344/mcp"
tool_timeout_sec = 330
```

**Pagent 连接简历源：**用本机文本编辑器打开 `resume-mcp\data\pagent-resume-config.json`，将配置粘到扩展设置中的“MCP 服务器”→“MCP 配置 JSON”，选择“保存并连接”。已有其他服务器时仅合并 `mcpServers.resume`，保留其他项。这个文件包含你本机的认证 Token，只粘贴到该扩展的本地配置里，不发给同学、不粘进聊天。

生成配置已设置：服务器名 `resume`、URL `http://127.0.0.1:17360/mcp`、`preservePersonalData: true`、`allowAttachmentUploads: true`。后两项允许正确读取本人联系电话等简历信息，并在你授权的任务中上传已登记附件。

## 5. 启动与只读预检

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-services.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-services.ps1
```

启动器为两个服务设置你自己的 `PAGENT_EXTENSION_ID` 并打开两个服务窗口，使用期间保持窗口开启。请通过脚本启动；直接运行入口但未设置该环境变量会被拒绝。脚本先检查 `127.0.0.1:17344` 与 `127.0.0.1:17360`；端口被占用就报错，不杀进程、不自动换端口。若一项启动失败，查看该窗口错误；不要连续重开多份服务。关闭窗口或在窗口中按 Ctrl+C 可停止对应服务。

预检仅检查本地健康接口及 Host 是否连上扩展，不会填写或发送。随后让 Codex 重新加载 MCP/Skill（必要时重开 Codex），再发：

> 使用 Pagent MCP 做只读预检：列出我的 Chrome 标签，绑定我指定的招聘页，确认可读取最新简历和附件索引，不输出 Token 或附件字节；不填写、不发送、不取消收藏。报告连接是否正常及缺少的资料。

Codex 必须能调用 Pagent 的 `list_tabs`、`browser_list_tools`，并通过当前上下文访问 Resume MCP 的 `get_resume` / `list_attachments`。外部工具名可能带服务器前缀，以发现到的 schema 为准。修改扩展的服务器配置或扩展 ID 后，重新绑定浏览器任务上下文，不复用旧 contextId。工具连通不代表网申已提交或消息已发出。

## 6. 先试一份，再使用整批流程

- **招聘网站网申：**使用 `pagent-resume-fill`；先指定一个申请页。默认填写到待提交状态，回读所有来源记录和附件后交付；最终提交另按你当次授权处理。
- **BOSS 直聘：**使用 `pagent-boss-apply`。先用本人账号登录并收藏一个要试投的岗位，提供你自己的招呼语，让 Codex 通过 `boss_set_favorites_greeting` 保存并回读确认；先以 `dryRun` 预检。不能直接使用空模板或其他人的自我介绍。当前 `boss_apply_favorite_job` 是固定的组合操作：**发送文字 → 发送已登记的 `resume-image` → 两项成功后取消该岗位收藏**。首次只指定一个岗位，明确授权这三步后再执行，并核对实际回执。若仅想打招呼或想保留收藏，不使用这个组合入口。
- **牛客辅助：**Windows 不支持本分享目录 macOS 专用的牛客工具栏自动打开脚本。需要辅助时，先由本人手动安装并打开牛客面板；面板不可用则记录并继续直接填写，不将其作为完成整份申请的前提。

本分享目录没有导入原作者的 Cookie、历史投递记录、浏览器偏好或个人招呼语。不要把作者的已投递状态用到你的账号上。

## 常见问题

| 现象 | 处理 |
|---|---|
| 找不到 Node/npm | 安装 Node.js 24+ 并新开 PowerShell；`node --version` 应至少 v24。 |
| Windows 权限检查不通过 | 在本人可写的 NTFS 本地目录重新运行安装脚本；不要通过放开全体用户权限解决。 |
| 扩展显示简历服务器未授权/连接失败 | 检查 Resume 窗口、扩展 ID 是否一致、是否粘贴当前本机配置。无需输出 Token 排查。 |
| Host 未连接扩展 | 检查 Chrome 中扩展已启用、两个窗口正常运行，再看扩展设置/服务错误。 |
| 端口占用 | 判断是否已开本套服务，先运行只读预检；确认自己启动的旧服务后手动关闭对应窗口。 |
| 同名 Skill 已存在 | 比较已有版本后合并；安装器不覆盖。若搬动了目录，已有 Skill 的绝对路径也需更新。 |
| 重复登记附件被拒绝 | 核对 `data\attachments.json` 中已登记版本；不要重复覆盖。 |

测试边界：分享前在 macOS 完成可跨平台的代码构建与测试；PowerShell 5.1、Windows ACL 实机及 Windows Chrome→Codex 的端到端流程仍需按上述步骤验收。没有把“脚本已生成”当成“同学电脑已安装成功”。
