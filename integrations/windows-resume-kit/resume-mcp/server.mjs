import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { attachmentDisposition, listAttachments, readAttachment } from './attachments.mjs';
import { classificationContext, compactResume, lookupResumeFields, resumeRecordInventory } from './profile-query.mjs';
import { openNowcoderPanel } from './nowcoder-panel.mjs';
import { assertPrivateTokenFile } from './token-permissions.mjs';

export function pagentOrigin(extensionId = process.env.PAGENT_EXTENSION_ID) {
  if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('PAGENT_EXTENSION_ID 必须是当前 Pagent Chrome 扩展的 32 位 a-p ID。');
  }
  return `chrome-extension://${extensionId}`;
}
const DEFAULT_DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url));
const ALLOWED_HEADERS = ['authorization', 'content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'];
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ATTACHMENT_FIRST_RULES = '固定前置、失败放行（fail-open）：流程依次执行一次 prepare_resume_form（serverName=resume、attachmentId=resume-pdf）→ 模型读取 get_resume 与 classificationRules、核对 PDF 解析并做必要局部清理 → run_nowcoder_fill（牛客补充填写）→ scan_resume_form（整表扫描）→ 模型补齐和一次尾查。附件是否需要上传由当前页面各上传区的回执与赋值证据决定，不按“补充填写”“已上传”等关键词跳过。默认 mode:upload_if_missing：缺少简历附件就优先上传，已有回执则复用；仅用户明确禁止上传或重传时用 mode:existing_only，禁止上传或重新解析，该限制绑定当前申请页。首次前置未找到或无法确定控件时，模型在牛客之前根据 scan_resume_form 和页面语义定位目标，再调用 prepare_resume_form；不得把未尝试上传当成已尝试。PDF 后先核对解析结果，再运行一次牛客；不可跳过解析核对直接触发牛客。分别检查顶部简历解析区和独立正式简历附件区：一个区的成功不代表另一区完成；通用“其他附件”不自动放入简历。主填和尾查可用 ensure_resume_attachment 补传明确的独立非解析简历附件，不能因此重新触发顶部解析覆盖表单。同一上传区已接收或已赋值待确认时只观察，不盲目重传；首次上传后有限等待接收、解析及表单稳定。PDF 或牛客控件缺失、失败、超时、回执不明或 ready:false 只记录对应阶段待核验，继续其余有依据的字段及全部适用经历；失败放行不等于永久放弃尚未尝试的独立附件区。解析仍变化的区域暂缓，先填其他区域，稍后重读并核对变化。无需证明网站附件与本地原件字节相同，不得宣称已核验其哈希，不寻找删除或替换附件按钮，不得填完后重传解析覆盖。';
const CLASSIFICATION_RULES = '解析核对和局部清理：classificationRules 是用户已确认的经历归属规则，按 aliases 与公司、职位、日期等身份信息核对 sourcePath；归属于实习的内容填在对应实习经历，不另建独立项目。规则只决定归属，日期、正文仍读取 sourcePath 原记录，不推断或改写。先保留来源路径及页面现有内容和归属，确认可恢复，再修复已明确匹配的误分类或重复记录；只移除错误位置的对应记录或确定的重复项，在正确栏目恢复来源内容。保留已上传附件、正确基本信息、教育和正确经历，不全表清空，不覆盖或删除身份不明、可能由用户补充的记录。清理或匹配失败记录原因并继续牛客及其余有依据的字段，不因局部不确定终止任务。期望薪资按原数值及期望薪资单位使用，不映射为现薪，不推算税前、税后或年包。';
const COMPLETENESS_RULES = '结束前必须让模型再做一轮完整性复查，保留工具能力：对照全部有内容的来源栏目、recordInventory 每条记录和 scan_resume_form 整表清单，包括牛客已填、尚未写入、折叠或未挂载栏目。来源工作经历含实习时，按记录性质填写网页实习经历；网页同时有工作经历与实习经历时，不因勾选没有工作经历而漏掉实习。先一次 get_resume compact:true 获取全部来源，超限才按栏目分批；先批量处理有依据的普通字段，复杂日期或下拉失败记下后继续其他栏目。写入和 verify_form_fields 优先传 sourcePath 让工具内部解析原值并自动记账；脱敏展示占位串不是原值，不把 [redacted-*] 作为输入或核验预期。需要额外登记记录范围时再用 record_resume_progress 一次批量登记多条 sourcePath、对应全部适用字段 elementIds、attempted 或有理由的 not_applicable；非数组栏目用 sections.栏目名，登记不等于成功，未登记且未经核验的记录仍属于未处理。复查须包含牛客已经写入而模型未修改的字段，不能只核验本轮写过的字段。观察返回 nextOffset 时保持 scope 翻页读完；新增记录后重新定位。复查发现遗漏继续补填，然后独立 verify_form_fields；网页仍报错的值不能算通过。解析并覆盖尚待点击时不能说已解析，也不能在补填后擅自触发覆盖。只复查一轮，不循环重传、重跑牛客或重复整轮填写；最后三至五句说明补齐的模块与具体失败/未处理原因，运行时附工具计数，不重复输出第二套统计。';
const FILLING_RULES = `填写规则：${ATTACHMENT_FIRST_RULES}${CLASSIFICATION_RULES}${COMPLETENESS_RULES}只填写有明确依据的信息；未知、缺失、冲突或语义不明确的字段直接跳过，任务允许部分完成。单个字段、控件或记录的读取、写入、核验失败只影响该项，记录原因后继续后续字段、记录和栏目；不得把局部不确定作为整轮终止条件。只有用户明确停止、登录失效或页面不可操作等实际无法推进时才停止。即使网站标记必填，也不自行补“面议”“无”“是”等默认值或编造经历，不为补齐反复追问。recordInventory 是来源记录清单，不是页面完成数；对当前页面适用的每条经历逐条处理并核对，不能填首条就结束。工作经历按公司+职位+起止日期绑定来源 sourcePath 与页面记录，项目按名称+日期绑定；recordIndex 仅是来源索引，禁止按全页 input/textarea 的 index 盲填。页面解析或新增经历后重新定位，身份不明确的已有记录不覆盖；不得把部门当职位、把工作内容或附件自行复制成新增项目。全部写入后用 verify_form_fields 独立回读来源身份和填写值；只有 stable:true 且 satisfied:true 才能报告该项已填。stable:true 仅表示值稳定，mismatch、satisfied:false 或未经核验均不能报告成功或全部完成；核验失败或不可用不阻断其余填写。工具写入成功不等于页面保存成功。结束时分别列出资料未知、填写失败、尚未处理的项或记录，以及附件和核验未确认项；没有用户单独授权，不点击最终提交。`;


function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function loadResume(dataDir) {
  let profile;
  try {
    profile = JSON.parse(await readFile(join(dataDir, 'resume.json'), 'utf8'));
  } catch {
    throw new Error('简历资料尚未准备好，或 resume.json 不是有效 JSON。');
  }
  if (!object(profile) || !object(profile.metadata) || !object(profile.sections)) {
    throw new Error('简历资料格式错误：需要 metadata 对象和 sections 对象。');
  }
  return profile;
}

function result(value, compact = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, compact ? undefined : 2) }], structuredContent: value };
}

async function runTool(work, compact = false) {
  try {
    return result(await work(), compact);
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
}

async function runResumeTool(work, compact = false) {
  const response = await runTool(work, compact);
  if (!response.isError) response.content.push({ type: 'text', text: FILLING_RULES });
  return response;
}

// Keep complete field records below Pagent's 12,000-character tool-result limit.
// An unusually large value is explicitly skipped, never shortened and offered for filling.
function fieldPage(results, offset) {
  const fields = [];
  let nextOffset = offset;
  for (let index = offset; index < results.fields.length; index += 1) {
    let field = results.fields[index];
    if (JSON.stringify(field).length > 8_000) {
      const { value, candidatePaths, ...metadata } = field;
      field = { ...metadata, status: 'too_large', action: 'skip', reason: '字段内容超出单次查询上限，未返回全文；请按栏目读取原始资料，不得使用截断值填写。' };
    }
    if (JSON.stringify([...fields, field]).length > 8_500 && fields.length) break;
    fields.push(field);
    nextOffset = index + 1;
  }
  return {
    fields,
    summary: { fill: fields.filter((field) => field.action === 'fill').length, skip: fields.filter((field) => field.action === 'skip').length },
    total: results.fields.length,
    offset,
    nextOffset: nextOffset < results.fields.length ? nextOffset : null,
    ...classificationContext(results),
  };
}

function lookupInventory(profile) {
  const inventory = resumeRecordInventory(profile);
  if (JSON.stringify(inventory).length <= 2_000) return { recordInventory: inventory, recordInventoryComplete: true };
  const counts = inventory.map(({ section, count }) => ({ section, count, sourcePath: `sections.${section}` }));
  return {
    recordInventory: JSON.stringify(counts).length <= 2_000 ? counts : [],
    recordInventoryComplete: false,
    recordInventoryNote: '记录清单超过本次输出上限，尚未完整返回；请用 get_resume 的 compact:true 按相关 sections 读取原始记录及索引，不得把省略记录视为已处理或不存在。',
  };
}

function createResumeMcp(dataDir, baseURL) {
  const mcp = new McpServer({ name: 'local-resume', version: '1.0.0' }, {
    instructions: `个人简历资料及固定网申准备动作。资料工具只读；resume_open_nowcoder_panel 仅供 Pagent 固定前置在牛客面板缺失时调用一次，不是模型自由操作工具。${FILLING_RULES}`,
  });
  mcp.registerTool('resume_open_nowcoder_panel', {
    description: '仅供 Pagent 固定流程：当前网页未显示牛客面板时，尝试按名称点击 macOS Chrome 工具栏的牛客网申助手按钮一次。只操作已经处于前台、URL 与 expectedUrl 完全一致的当前标签页，不切换页面、不填写或提交；权限缺失或其他失败返回 continue:true。deadlineMs 是绝对毫秒截止时间，不能扩大本地 8 秒超时。禁止模型重复调用。',
    inputSchema: { expectedUrl: z.string().max(4096), deadlineMs: z.number().int().positive().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (args) => runTool(() => openNowcoderPanel(args), true));
  mcp.registerTool('get_resume', {
    description: `读取简历栏目和原始长文；填写网申已知字段优先调用 lookup_resume_fields 批量匹配。compact:true 返回精简视图与 recordInventory（各栏目有内容的记录数量、原始索引、来源路径和短识别字段）；递归省略空字段，保留 false/0 和原始数组序号；默认 false 保留原始资料。全量、分栏目及 compact 结果均保留 classificationRules，按已确认归属核对 PDF 解析；省略 sections 或空数组返回全部，可按中文栏目筛选。null 是未填写，不是“无”。${FILLING_RULES}`,
    inputSchema: { sections: z.array(z.string().min(1)).optional(), compact: z.boolean().optional() },
    annotations: READ_ONLY,
  }, ({ sections, compact }) => runResumeTool(async () => {
    const profile = await loadResume(dataDir);
    if (!sections?.length) return compact ? compactResume(profile) : profile;
    const unknown = sections.filter((name) => !Object.hasOwn(profile.sections, name));
    if (unknown.length) throw new Error(`未知栏目：${unknown.join('、')}。可用栏目：${Object.keys(profile.sections).join('、')}`);
    const selected = { metadata: profile.metadata, ...classificationContext(profile), sections: Object.fromEntries(sections.map((name) => [name, profile.sections[name]])) };
    return compact ? compactResume(selected) : selected;
  }, compact));
  mcp.registerTool('lookup_resume_fields', {
    description: `网申填写首选：把页面字段一次传入 fields（最多40项），仅匹配明确原始事实。label 是字段名；重复经历须指定 section 中文栏目和从0开始的 recordIndex，不得按网页顺序猜测。known/fill 带 value/sourcePath；empty、not_found、ambiguous、too_large 均 skip，未匹配不代表用户没有该事实。支持少量确定别名，期望月薪/月薪期望等指向求职意向.期望薪资，不关联现薪；不把户籍当现居地、不推断是否提前实习。classificationRules 在每页完整返回，用于经历归属核对，不作为新字段或新项目。nextOffset非null时用同一fields继续，summary仅统计本页。recordInventory 返回来源记录清单，recordInventoryComplete:false 时按提示读取相关栏目再核对所有记录。${FILLING_RULES}`,
    inputSchema: {
      fields: z.array(z.object({ label: z.string().trim().min(1).max(120), section: z.string().trim().min(1).max(80).optional(), recordIndex: z.number().int().min(0).optional() }).strict()).min(1).max(40),
      offset: z.number().int().min(0).max(40).optional(),
    },
    annotations: READ_ONLY,
  }, ({ fields, offset = 0 }) => runResumeTool(async () => {
    if (offset > fields.length) throw new Error('offset 超出本次 fields 长度。');
    const profile = await loadResume(dataDir);
    return { ...fieldPage(lookupResumeFields(profile, fields), offset), ...lookupInventory(profile) };
  }, true));
  mcp.registerTool('search_resume', {
    description: `探索原始资料的关键词搜索；按已知网页字段填写时优先 lookup_resume_fields 一次批量查询。按字段路径或原始值做不区分大小写的子串匹配，返回匹配路径和值；无匹配为空数组，不代表用户没有该事实。null 表示未填写。${FILLING_RULES}`,
    inputSchema: { query: z.string().max(256) },
    annotations: READ_ONLY,
  }, ({ query }) => runResumeTool(async () => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) throw new Error('query 不能为空，请输入字段名或关键词。');
    const profile = await loadResume(dataDir);
    const matches = [];
    function visit(value, path) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`));
      } else if (object(value)) {
        for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
      } else if (`${path}\n${String(value)}`.toLocaleLowerCase().includes(needle)) {
        matches.push({ path, value });
      }
    }
    visit(profile.sections, 'sections');
    return { query: query.trim(), matches, ...classificationContext(profile) };
  }));
  const uploadGuide = `${ATTACHMENT_FIRST_RULES}${CLASSIFICATION_RULES}PDF 用 Pagent prepare_resume_form 尽力处理；头像独立使用 upload_attachment，参数 serverName:'resume'、attachmentId:'avatar'、elementId:当前页面头像文件输入框元素。禁止在补填后上传 PDF 或图片版简历触发重新解析。不要打开浏览器文件选择器，不要让模型读取或传递文件字节、Base64 或认证令牌。`;
  mcp.registerTool('list_attachments', {
    description: `列出已登记附件的用途、文件名、MIME、实际大小、SHA-256 和下载 URL；只返回元信息，不返回文件内容。${uploadGuide}`,
    inputSchema: {},
    annotations: READ_ONLY,
  }, () => runTool(() => listAttachments(dataDir, baseURL)));
  mcp.registerTool('get_attachment', {
    description: `按 id 获取单个已登记附件的元信息，并验证实际文件大小、类型与 SHA-256。${uploadGuide}`,
    inputSchema: { id: z.string().min(1).max(80) },
    annotations: READ_ONLY,
  }, ({ id }) => runTool(async () => ({ attachment: (await readAttachment(dataDir, baseURL, id)).attachment })));
  return mcp;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Production always uses the default loopback port. Tests inject a temporary data directory and port 0.
export async function startServer({ dataDir = DEFAULT_DATA_DIR, port = 17360, extensionId = process.env.PAGENT_EXTENSION_ID } = {}) {
  const extensionOrigin = pagentOrigin(extensionId);
  const tokenPath = join(dataDir, 'token');
  await assertPrivateTokenFile(tokenPath);
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (token.length < 32 || /\s/.test(token)) throw new Error('data/token 需要至少 32 个非空白字符。');
  const expectedAuth = Buffer.from(`Bearer ${token}`);
  let boundPort = port;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const hosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
    if (!hosts.includes(req.headers.host?.toLowerCase())) return json(res, 403, { error: 'Forbidden Host' });
    const origin = req.headers.origin;
    const allowedOrigins = [extensionOrigin, ...hosts.map((host) => `http://${host}`)];
    if (origin && !allowedOrigins.includes(origin)) return json(res, 403, { error: 'Forbidden Origin' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version, Content-Disposition');
    }
    const path = req.url?.split('?')[0];
    const fileRoute = /^\/files\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/.exec(path ?? '');
    if (req.method === 'OPTIONS' && (path === '/mcp' || fileRoute)) {
      const requested = String(req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map((header) => header.trim()).filter(Boolean);
      const methods = fileRoute ? ['GET'] : ['GET', 'POST', 'DELETE'];
      if (!origin || requested.some((header) => !ALLOWED_HEADERS.includes(header)) || !methods.includes(req.headers['access-control-request-method'])) {
        return json(res, 403, { error: 'Forbidden preflight' });
      }
      res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204).end();
      return;
    }
    const authorization = Buffer.from(req.headers.authorization ?? '');
    if (authorization.length !== expectedAuth.length || !timingSafeEqual(authorization, expectedAuth)) {
      return json(res, 401, { error: 'Unauthorized' });
    }
    if (path === '/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'local-resume' });
    const baseURL = `http://127.0.0.1:${boundPort}`;
    if (fileRoute) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { error: 'Method not allowed' });
      }
      try {
        const { attachment, bytes } = await readAttachment(dataDir, baseURL, fileRoute[1]);
        res.writeHead(200, {
          'Content-Type': attachment.mimeType,
          'Content-Length': bytes.length,
          'Content-Disposition': attachmentDisposition(attachment.fileName),
        });
        res.end(bytes);
      } catch (error) {
        json(res, error.status ?? 500, { error: error.message });
      }
      return;
    }
    if (path !== '/mcp') return json(res, 404, { error: 'Not found' });
    // This stateless service sends no server notifications; avoid an idle SSE connection.
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { error: 'Method not allowed' });
    }
    const mcp = createResumeMcp(dataDir, baseURL);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'MCP request failed' });
      else res.end();
    }
  });
  server.requestTimeout = 30_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  boundPort = server.address().port;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = await startServer();
    console.log('Resume MCP listening at http://127.0.0.1:17360/mcp');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  } catch (error) {
    console.error(`Resume MCP startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
