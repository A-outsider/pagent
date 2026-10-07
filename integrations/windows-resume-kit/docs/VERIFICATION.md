# 分享包验证记录

快照日期：2026-10-06。分享副本独立于原环境；个人资料、附件、Token、Cookie、浏览器存储、投递历史均未打包。

## 已完成

- 在 macOS、Node.js 26.4.0 上用 WXT 0.21.4 构建 Chrome MV3 扩展，产物为 `pagent/dist`。
- Host 编译为普通 JavaScript；从公共 npm 注册表按锁文件干净安装 Host 与 Resume MCP 的生产依赖，均成功。
- Host 通过真实 MCP SDK 的内存传输检查：21 项工具可发现，单岗 dryRun 默认开启，非法参数被拒绝；独占端口冲突时报错，不回退到其他端口。未连接真实招聘页面。
- Host 的扩展 ID、Host 与 Origin 访问判定 7 组测试通过。
- Resume MCP 的 69 项测试通过，覆盖来源读取、附件、鉴权与 Origin 拒绝。使用合成测试资料，无个人简历。
- 初始化与附件登记的 8 项文件测试通过，覆盖 Token/资料保留、文件类型与哈希、防覆盖、索引错误、并发锁、符号链接拒绝。
- 两个 Skill 均通过 skill-creator 的 quick_validate；分发 JavaScript 通过语法检查。
- 打包前扫描原作者姓名、联系方式、原机器路径、固定扩展 ID，并排除 data、node_modules、构建缓存、日志和 Git 数据。

## 尚未完成

Windows PowerShell 5.1、NTFS ACL、Windows Chrome 扩展与 Codex 的完整连通，以及真实招聘网站投递，尚未在 Windows 真机测试。应按 INSTALL.md 先完成只读预检，再由使用者授权试投一个岗位。

Windows 不支持自动打开牛客工具栏面板；使用者可手动打开。面板不可用时继续普通网申填写。

## 重新构建

普通安装直接使用 `pagent/dist` 和 `pagent-host`，不需要开发依赖。修改源码后才需要：在 `pagent` 目录按 `pnpm-lock.yaml` 安装开发依赖并执行 `pnpm build`；然后在包根执行 `node pagent-host/build.mjs` 重建 Host。构建不会导入浏览器数据。

安装生产依赖后，可在包根执行 `node --test scripts/package-tests.mjs` 复跑文件初始化与附件登记测试。测试使用临时目录，不修改使用者的 data。

## Git 分支交付

2026-10-07 将已验证快照放入 `integrations/windows-resume-kit`，保留源码、预构建扩展与 Host；仅调整获取/安装路径说明及 Git 分发规则。`data`、依赖目录和日志仍被忽略，`.gitattributes` 让 Windows 检出保留文本 LF。源码逻辑与 2026-10-06 的验证快照一致。
