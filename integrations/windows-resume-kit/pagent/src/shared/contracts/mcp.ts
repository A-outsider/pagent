import { z } from 'zod';

export const MCP_TRANSPORTS = ['streamable-http', 'sse', 'websocket'] as const;

export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/**
 * mcp-server.json 风格的单台服务器配置。
 * 浏览器扩展无法启动 stdio(command) 子进程，因此仅支持远程服务器：
 * 允许额外字段（如 command/args），以便粘贴 Claude 风格配置时给出可读提示。
 */
export const mcpServerConfigSchema = z
  .object({
    url: z.string().min(1).describe('服务器地址，仅支持 http(s):// 或 ws(s)://'),
    headers: z.record(z.string(), z.string()).optional().describe('附加请求头，例如 Authorization'),
    transport: z.enum(MCP_TRANSPORTS).optional().describe('传输方式，默认按 URL 推断'),
    enabled: z.boolean().optional().describe('是否启用，默认启用'),
    preservePersonalData: z.boolean().optional().describe('保留此服务器工具返回的邮箱、手机号和长数字，默认 false；API Key 和 Token 仍脱敏'),
    allowAttachmentUploads: z.boolean().optional().describe('允许通过 upload_attachment 上传此服务器的已授权附件，默认 false'),
    disabledTools: z.array(z.string()).optional().describe('不向模型暴露的 MCP 工具原始名称'),
  })
  .passthrough();

export const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerConfigSchema),
});

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
export type McpConfig = z.infer<typeof mcpConfigSchema>;

export const EMPTY_MCP_CONFIG: McpConfig = { mcpServers: {} };

export type McpServerStatusKind =
  | 'connected'
  | 'connecting'
  | 'unauthorized'
  | 'error'
  | 'disabled'
  | 'disconnected';

export type McpServerStatus = {
  name: string;
  url: string;
  status: McpServerStatusKind;
  error?: string;
  toolCount: number;
  tools: McpToolStatus[];
};

export type McpToolStatus = {
  /** 消毒并消除重名后的模型可见名称。 */
  name: string;
  /** MCP 服务器返回的原始名称，用于持久化启用状态。 */
  originalName: string;
  description?: string;
  enabled: boolean;
};

/** 展示给模型的 MCP 工具元信息（name 已是消毒且唯一的展示名） */
export type McpToolMeta = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  preservePersonalData?: boolean;
};

export type McpState = {
  config: McpConfig;
  servers: McpServerStatus[];
};
