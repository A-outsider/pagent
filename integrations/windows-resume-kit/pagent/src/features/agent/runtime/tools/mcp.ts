import { tool } from 'langchain';
import { isolateUntrustedPage } from '@/features/agent/runtime/middleware';
import { jsonSchemaToZod } from '@/features/mcp/json-schema-to-zod';
import { truncate } from '@/shared/utils/utils';
import type { McpToolMeta } from '@/shared/contracts/mcp';
import type { ToolBridge } from './types';

export async function createMcpAgentTools(bridge: Pick<ToolBridge, 'mcp'>) {
  let listed: McpToolMeta[] = [];
  try {
    listed = await bridge.mcp.listTools();
  } catch (error) {
    listed = [];
  }
  // Native helper opening belongs to the fixed preflight, never a repeatable
  // model action. Also hide namespaced duplicates produced by MCP name clashes.
  return listed.filter(meta => !/(?:^|_)resume_open_nowcoder_panel(?:_\d+)?$/.test(meta.name)).map((meta) =>
    tool(
      async (args) =>
        isolateUntrustedPage(await bridge.mcp.callTool(meta.name, args), {
          preservePersonalData: meta.preservePersonalData === true,
        }),
      {
        name: meta.name,
        description: meta.description
          ? truncate(meta.description, 800)
          : '外部 MCP 服务器提供的工具',
        schema: jsonSchemaToZod(meta.inputSchema),
      },
    ),
  );
}
