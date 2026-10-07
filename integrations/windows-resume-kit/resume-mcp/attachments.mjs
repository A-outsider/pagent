import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const READ_FLAGS = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
const basename = z.string().min(1).max(255).refine((name) => name !== '.' && name !== '..' && !/[\x00-\x1f\x7f/\\]/.test(name));
const indexSchema = z.object({
  version: z.literal(1),
  attachments: z.array(z.object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
    purpose: z.string().min(1).max(200),
    fileName: basename,
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    storedName: basename,
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  }).strict()),
}).strict();

function failure(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

async function loadIndex(dataDir) {
  let file;
  try {
    const indexPath = join(dataDir, 'attachments.json');
    const indexInfo = await lstat(indexPath);
    if (!indexInfo.isFile() || indexInfo.isSymbolicLink()) throw new Error('invalid index');
    file = await open(indexPath, READ_FLAGS);
    if (!(await file.stat()).isFile()) throw new Error('not a file');
    const parsed = indexSchema.parse(JSON.parse(await file.readFile('utf8')));
    if (new Set(parsed.attachments.map((item) => item.id)).size !== parsed.attachments.length) throw new Error('duplicate id');
    return parsed.attachments;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw failure('附件索引 attachments.json 无效：请检查 version、唯一 id、文件名、MIME 类型和 SHA-256。');
  } finally {
    await file?.close();
  }
}

function hasExpectedSignature(bytes, mimeType) {
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

async function readRegisteredAttachment(dataDir, item, baseURL) {
  let file;
  try {
    const directory = join(dataDir, 'attachments');
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid directory');
    const root = await realpath(directory);
    const attachmentPath = join(root, item.storedName);
    const entry = await lstat(attachmentPath);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('invalid attachment');
    file = await open(attachmentPath, READ_FLAGS);
    const details = await file.stat();
    if (!details.isFile()) throw new Error('not a file');
    if (details.size > MAX_ATTACHMENT_SIZE) throw failure(`附件 ${item.id} 超过 20 MiB 限制。`);
    const bytes = await file.readFile();
    if (bytes.length > MAX_ATTACHMENT_SIZE) throw failure(`附件 ${item.id} 超过 20 MiB 限制。`);
    if (!hasExpectedSignature(bytes, item.mimeType)) throw failure(`附件 ${item.id} 的内容与声明的 PDF/JPEG/PNG 类型不符。`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== item.sha256.toLowerCase()) throw failure(`附件 ${item.id} 的 SHA-256 校验失败，请更新索引或恢复原文件。`);
    return {
      attachment: {
        id: item.id,
        purpose: item.purpose,
        fileName: item.fileName,
        mimeType: item.mimeType,
        size: bytes.length,
        sha256,
        url: `${baseURL}/files/${item.id}`,
      },
      bytes,
    };
  } catch (error) {
    if (error.status) throw error;
    throw failure(`附件 ${item.id} 不可用：文件必须是附件目录内的普通文件，不能是符号链接。`);
  } finally {
    await file?.close();
  }
}

export async function listAttachments(dataDir, baseURL) {
  const entries = await loadIndex(dataDir);
  const attachments = [];
  for (const item of entries) attachments.push((await readRegisteredAttachment(dataDir, item, baseURL)).attachment);
  return { attachments };
}

export async function readAttachment(dataDir, baseURL, id) {
  const entries = await loadIndex(dataDir);
  const item = entries.find((entry) => entry.id === id);
  if (!item) throw failure('未找到已登记的附件。', 404);
  return readRegisteredAttachment(dataDir, item, baseURL);
}

export function attachmentDisposition(fileName) {
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${encoded}`;
}
