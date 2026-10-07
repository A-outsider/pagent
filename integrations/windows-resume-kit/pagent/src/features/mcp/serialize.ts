import { safeJson, truncate } from '@/shared/utils/utils';

/** 将 MCP callTool 的返回结果序列化为给模型阅读的文本 */
export function serializeMcpResult(result: unknown): string {
  if (result == null) return '(无内容)';
  if (typeof result !== 'object') return String(result);
  const record = result as Record<string, unknown>;
  const isError = record.isError === true;
  const content = Array.isArray(record.content) ? record.content : [];
  // Preserve complete structured records. Cutting JSON at a character limit loses
  // trailing resume modules and makes the source inventory unreadable.
  if (!isError && record.structuredContent && typeof record.structuredContent === 'object') {
    const structured = record.structuredContent as Record<string, unknown>;
    const json = JSON.stringify(structured);
    if (json.length > 64_000) return JSON.stringify({
      dataOmitted: true,
      availableSections: structured.sections && typeof structured.sections === 'object'
        ? Object.keys(structured.sections) : undefined,
      message: '结构化结果过大，未返回任何截断字段；请按栏目或使用工具分页读取，不能视为无数据或已完成。',
    });
    const guidance = content.filter((item) => {
      if (!item || typeof item !== 'object' || item.type !== 'text' || typeof item.text !== 'string') return false;
      try { JSON.parse(item.text); return false; } catch { return true; }
    }).map((item) => item.text).join('\n');
    return [json, truncate(guidance, 8_000)].filter(Boolean).join('\n');
  }
  const parts: string[] = [];
  for (const item of content) {
    if (item == null || typeof item !== 'object') {
      parts.push(String(item));
      continue;
    }
    const part = item as Record<string, unknown>;
    if (part.type === 'text') {
      parts.push(typeof part.text === 'string' ? part.text : safeJson(part, 2000));
    } else if (part.type === 'image') {
      const data = typeof part.data === 'string' ? part.data : '';
      parts.push(`[图片 ${part.mimeType ?? '未知类型'}，数据 ${data.length} 字符]`);
    } else if (part.type === 'resource') {
      parts.push(`[资源: ${safeJson(part.resource, 2000)}]`);
    } else {
      parts.push(safeJson(part, 2000));
    }
  }
  const joined = parts.join('\n').trim();
  const output = truncate(joined || safeJson(result, 4000), 12_000);
  return isError ? `工具执行失败：${output}` : output;
}
