export type ResumeSourceValue = string | number | boolean;
export type ResumeSourceResolver = (path: string) => ResumeSourceValue | undefined;
export const isRedactedPlaceholder = (value: unknown) => typeof value === 'string'
  && /^\s*\[redacted(?:-[\w-]+)?\]\s*$/i.test(value);

/** Resolve only facts already loaded in this turn, never page-provided values or expressions. */
export function resolveResumeExpectation(
  field: { intent: string; value?: ResumeSourceValue; sourcePath?: string },
  sourceValue: ResumeSourceResolver,
): { value: ResumeSourceValue } | { error: string } {
  const value = field.sourcePath ? sourceValue(field.sourcePath) : field.value;
  if (field.sourcePath && (value === undefined || value === '')) {
    return { error: '来源字段尚未读取或没有明确值；先读取简历 MCP 对应栏目，未知资料留空并继续其他项。' };
  }
  if (isRedactedPlaceholder(value)) return { error: '脱敏占位符不是实际预期值；请使用已读取 MCP 的 sourcePath，不能把占位符写入网页或用于核验。' };
  if (value === undefined || (field.intent === 'set-checked' ? typeof value !== 'boolean' : typeof value === 'boolean')) {
    return { error: '当前字段缺少与操作类型匹配的明确预期值。' };
  }
  if (field.sourcePath && field.value !== undefined && String(field.value) !== String(value)) {
    return { error: 'value 与所引用的原始资料不一致；需要转换格式时仅提供有依据的 value。' };
  }
  return { value };
}
