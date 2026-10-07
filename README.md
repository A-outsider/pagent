# Pagent

页面内浏览器 Agent。它以 Shadow DOM 悬浮面板的形式生活在当前网页中，使用 LangChain.js 调用你本地配置的模型，并对页面执行观测、点击、输入、滚动、导航、截图和可选的 CDP 高级操作。

## Windows 简历填写与 BOSS 投递

本分支在 [`integrations/windows-resume-kit`](integrations/windows-resume-kit/START-HERE.md) 提供 Codex 直接调用的网申填写与 BOSS 收藏岗位投递能力，包含两个 Skill、预构建 Chrome 扩展、MCP 服务及 Windows 安装脚本。

```powershell
git clone --branch codex/windows-resume-share --single-branch https://github.com/still-soda/pagent.git C:\Tools\pagent-resume
cd C:\Tools\pagent-resume\integrations\windows-resume-kit
```

按该目录的 [INSTALL.md](integrations/windows-resume-kit/INSTALL.md) 安装，并导入使用者自己的简历和账号。先只读预检，再授权单岗试投；Windows 真机端到端流程仍需验收。完整源码与预构建产物均在该目录，安装无需构建根项目。

## 技术栈

- Chromium Manifest V3 + [WXT](https://wxt.dev/)
- React + TypeScript + Tailwind CSS + shadcn 风格组件
- UI 直接使用 [Beautiful UI](https://www.beautifului.dev/) 的 Chat、Prompt Bar、Thinking、Streaming Text、Tool Chips、Task Rows、Context Cards 等 MIT 示例组件
- LangChain.js `createAgent` + Zod 工具

## 目录结构

```
src/
  entrypoints/          # WXT 入口（background、content、options、popup）
  features/
    agent/              # Agent 后台、runtime、会话领域、UI
    page/               # 页面观测/操作与 content 命令
    settings/           # 设置面板
  shared/
    browser/            # tabs、CDP、截图、权限
    contracts/          # RPC schema 与领域类型（settings/page/session/agent）
    extension/          # rpc、keepalive、theme、hotkey 等扩展基础设施
    storage/            # chrome.storage 与 IndexedDB
    ui/                 # 通用 UI 与 Beautiful UI 原语
    utils/
  assets/               # 样式与静态资源
public/                 # WXT public（图标等，保持根目录）
tests/unit              # 单元测试
tests/e2e               # Playwright E2E（fixtures 在 tests/e2e/fixtures）
```

## 开发

```bash
pnpm install
pnpm dev
```

Chrome 会打开并自动加载扩展。也可手动打开 `chrome://extensions`，启用开发者模式，加载 `dist`。

```bash
pnpm compile
pnpm test
pnpm build   # 产物输出到 dist/
pnpm test:e2e
```

## 首次使用

1. 打开任意 http/https 页面，右下角会出现 Pagent。按 `Alt+P` 可呼出或隐藏面板，也可在 `chrome://extensions/shortcuts` 修改快捷键。
2. 在设置中选择服务商（OpenAI / Anthropic / Google Gemini / DeepSeek / Moonshot Kimi / 智谱 GLM / 阿里云百炼 / 火山方舟 / xAI Grok / 硅基流动 / Ollama 本地 / 自定义 OpenAI 兼容），写入 API Key。已保存密钥的服务商会在设置页自动拉取最新模型列表，也可手动刷新；Ollama 本地无需密钥。OpenAI 和兼容端点可切换 Chat Completions 或 `/responses` API；DeepSeek 使用 Chat Completions 以保留流式思考内容。
3. 密钥写入 `chrome.storage.local`，关闭浏览器后仍保留。
4. 直接发送任务即可全自动执行。面板顶部始终保留停止按钮。

## 能力

- 语义 DOM 观测、页面源码（DOM/原始 HTML/正文/链接/脚本/样式表，支持 grep 与分页）、页面文本搜索、选区、iframe 标记、元素 `elementId` + revision
- 会话按网站域名写入本地 Vault：会话期间导航到的每个域名都会归档当前会话，且只有对应站点的 Vault 能看到这些会话；会话与 Vault 存在 IndexedDB，扩展更新或浏览器重启后仍保留
- 同一标签页内跳转会继续当前任务；新页面只展示当前域名 Vault 里的会话
- 点击、双击、悬停、输入、清空、选择、按键、滚动、等待、高亮
- 导航、前进后退、刷新、标签页创建/切换/关闭
- 可见区域截图；启用 CDP 后支持整页截图和坐标级输入
- 网络请求与控制台日志（CDP `Network` / `Runtime` / `Log`，任务开始时 attach 并缓冲）
- 内置命名脚本：链接、标题、表单、meta、页面统计、选区
- 可选 `execute_cdp_script`，仅在设置中明确开启

## MCP 服务

Pagent 可作为一个 MCP 服务，供外部 Agent 查看浏览器标签页、派发任务并查询会话状态。先加载扩展，再启动服务：

```bash
pnpm mcp
```

在 MCP 客户端中配置：

```json
{
  "mcpServers": {
    "pagent": {
      "command": "pnpm",
      "args": ["--dir", "/绝对路径/pagent", "mcp"]
    }
  }
}
```

工具：

- `get_usage`：查询本服务用法，供本地 Agent 与 Pagent 协同（扩展未连接时也可用）
- `list_tabs`：罗列全部标签页，以及是否有 Agent 正在该页工作
- `dispatch_task`：向指定标签页（或新建/导航到 url）派发任务
- `get_session`：按 sessionId / tabId / conversationId 查看会话状态

MCP 进程在 `127.0.0.1:17342-17357` 内寻找空闲端口并监听；扩展启动后在同一范围内探测 `/health` 发现服务。`--port` / `PAGENT_MCP_PORT` 必须落在该范围内，并作为优先尝试的端口。HTTP MCP 地址为 `http://127.0.0.1:<实际端口>/mcp`。在终端里直接运行时不会占用 stdin；由 MCP 客户端以管道拉起时自动启用 stdio。
