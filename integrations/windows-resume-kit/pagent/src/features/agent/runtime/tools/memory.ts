import { tool } from 'langchain';
import { z } from 'zod';
import { safeJson } from '@/shared/utils/utils';
import type { ToolBridge } from './types';

export function createMemoryTools(bridge: ToolBridge) {
  const memorySearch = tool(
    async ({ query, limit }) => safeJson(await bridge.memory.search(query, limit)),
    {
      name: 'memory_search',
      description:
        '主动检索与当前任务相关的长期记忆。会同时搜索全局记忆和当前域名的局部记忆，返回记忆 ID 供后续修改。query 应使用一个完整自然语言问题，不要使用空格分隔的关键词串。',
      schema: z.object({
        query: z.string().min(1).max(4000).describe('一个完整自然语言问题'),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    },
  );

  const memoryWrite = tool(
    async ({ content, scope, memoryId }) =>
      safeJson(await bridge.memory.write(content, scope, memoryId)),
    {
      name: 'memory_write',
      description:
        '以 QA 格式写入一条长期记忆：“Q: 一个完整问题”后接“A: 答案或经验”。每次调用只能包含一组 QA；多个问题必须分别调用本工具，创建多条独立记忆。scope=global 适用于跨网站经验，scope=local 仅用于当前域名并自动记录脱敏 URL。传 memoryId 可修改已有记忆。',
      schema: z.object({
        content: z.string().min(1).max(8000).describe('仅一组 QA：Q: 一个完整问题，后接 A: 答案或经验'),
        scope: z.enum(['global', 'local']),
        memoryId: z.string().optional().describe('修改 memory_search 返回的已有记忆 ID'),
      }),
    },
  );

  return [memorySearch, memoryWrite];
}
