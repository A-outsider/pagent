# Windows 上使用简历填写与 BOSS 投递

将分享分支克隆到准备长期保留的 NTFS 本地目录，再进入本目录。使用你自己的 Chrome、招聘网站账号和简历。目录不要放进公共共享、OneDrive 或其他自动同步的位置。

```powershell
git clone --branch codex/windows-resume-share --single-branch https://github.com/still-soda/pagent.git C:\Tools\pagent-resume
cd C:\Tools\pagent-resume\integrations\windows-resume-kit
```

后续安装命令在 `integrations/windows-resume-kit` 中执行；Chrome 应加载该目录里的 `pagent/dist`。保持克隆目录不变，扩展 ID 和已安装 Skill 会引用这个位置。

本目录包含两个 Skill、Pagent Chrome 扩展、Pagent MCP Host，以及存放本人资料的 Resume MCP。它不包含作者的简历、账号或登录状态。默认安装使用编译好的扩展和 Host，无需构建 Pagent 源码。

先安装 Node.js 24 或更高版本，然后打开 [INSTALL.md](INSTALL.md) 按步骤完成：加载扩展、登记扩展 ID、安装本机服务、导入自己的简历、连接 Codex 和扩展。

可以把下面这段发给你电脑上的 Codex，并把本文件夹作为工作目录：

> 请阅读当前文件夹的 START-HERE.md 和 INSTALL.md，在我的 Windows 电脑上安装这套能力。使用我的资料与账号，不导入其他人的身份信息。按说明检测 Node.js、安装本地依赖、生成我的 Token 并保护本地数据权限；不要输出 Token、替换已有 Codex 配置或覆盖已有同名 Skill。Chrome 扩展由我手动加载并提供扩展 ID。准备完成后先做只读预检。BOSS 组合入口固定执行发送文字、发送我的简历图片、成功后取消该岗位收藏；等我指定一个岗位、招呼语并明确授权这三步后，再试投一个。此阶段不批量发送，不提交网申；若我只想打招呼或保留收藏，不使用组合入口。

已在作者电脑上检查构建及可跨平台测试的部分；**Windows PowerShell、Windows ACL、Chrome 与 Codex 的完整连通仍需在你的电脑上验收**。Windows 不提供 macOS 专用的牛客工具栏自动打开能力；可由你手动打开已安装的牛客面板，其他填表步骤继续按实际页面执行。
