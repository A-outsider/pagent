import { z } from 'zod';

/**
 * 将 MCP 工具的 JSON Schema 子集转换为 zod 校验。
 * 支持 object/string/number/integer/boolean/array/enum（含嵌套），其余回退为 z.any()。
 */
export function jsonSchemaToZod(schema: unknown): z.ZodType {
  if (!schema || typeof schema !== 'object') return z.any();
  const item = schema as Record<string, unknown>;
  const type = item.type;
  if (type === 'object' || (type === undefined && item.properties != null)) {
    const properties = (item.properties ?? {}) as Record<string, unknown>;
    const required = new Set(
      Array.isArray(item.required) ? item.required.map((value) => String(value)) : [],
    );
    const shape: Record<string, z.ZodType> = {};
    for (const [key, value] of Object.entries(properties)) {
      const field = jsonSchemaToZod(value);
      shape[key] = required.has(key) ? field : field.optional();
    }
    return z.object(shape);
  }
  if (type === 'string') {
    if (Array.isArray(item.enum) && item.enum.length === 1) {
      return z.literal(String(item.enum[0]));
    }
    if (Array.isArray(item.enum) && item.enum.length > 1) {
      return z.enum(item.enum.map((value) => String(value)) as [string, ...string[]]);
    }
    return z.string();
  }
  if (type === 'number') return z.number();
  if (type === 'integer') return z.number().int();
  if (type === 'boolean') return z.boolean();
  if (type === 'array') {
    return z.array(jsonSchemaToZod(item.items));
  }
  return z.any();
}
