import {
  attachmentDescriptorSchema,
  type AttachmentDescriptor,
} from '@/shared/contracts/attachments';
import type { McpServerConfig } from '@/shared/contracts/mcp';

export function parseAttachmentDescriptor(result: unknown, attachmentId: string): AttachmentDescriptor {
  try {
    const response = result as { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] };
    if (response.isError) throw new Error();
    const texts = response.content?.filter((block) => block.type === 'text');
    const value = response.structuredContent ?? (
      texts?.length === 1 && texts[0]?.text ? JSON.parse(texts[0].text) : null
    );
    const parsed = attachmentDescriptorSchema.safeParse(value?.attachment);
    if (!parsed.success || parsed.data.id !== attachmentId) throw new Error();
    return parsed.data;
  } catch {
    // Never expose a raw MCP result or validation error containing its input.
    throw new Error('附件描述无效：需要匹配的 ID、文件名、PDF/JPEG/PNG 类型、大小和 SHA-256');
  }
}

export async function downloadAttachmentBytes(
  attachment: AttachmentDescriptor,
  config: McpServerConfig,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted();
  const endpoint = new URL(config.url);
  const url = new URL(attachment.url);
  const expected = new URL(`/files/${attachment.id}`, endpoint);
  if (
    !['http:', 'https:'].includes(endpoint.protocol)
    || endpoint.username || endpoint.password
    || url.href !== expected.href || url.origin !== endpoint.origin
    || url.username || url.password
  ) throw new Error('附件地址必须是已配置 MCP 同源的 /files/<id>，不允许其他地址');

  let response: Response;
  try {
    response = await fetch(url, {
      headers: config.headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
  } catch {
    signal?.throwIfAborted();
    throw new Error('附件下载失败或发生重定向');
  }
  if (!response.ok || !response.body) throw new Error('附件下载失败');
  const declaredLength = response.headers.get('content-length');
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (
    contentType !== attachment.mimeType
    || (declaredLength !== null && Number(declaredLength) !== attachment.size)
  ) {
    await response.body.cancel();
    throw new Error('附件响应的类型或大小与描述不符');
  }
  const bytes = new Uint8Array(attachment.size);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) throw new Error();
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== bytes.byteLength) throw new Error();
  } catch {
    await reader.cancel().catch(() => {});
    signal?.throwIfAborted();
    throw new Error('附件下载不完整或超出声明大小');
  } finally {
    reader.releaseLock();
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== attachment.sha256.toLowerCase()) throw new Error('附件 SHA-256 校验失败');
  return bytes;
}
