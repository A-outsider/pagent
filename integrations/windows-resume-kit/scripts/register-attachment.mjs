import { randomUUID, createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listAttachments, MAX_ATTACHMENT_SIZE } from '../resume-mcp/attachments.mjs';

const purposes = { 'resume-pdf': 'PDF resume', 'resume-image': 'Resume image', avatar: 'Profile photo' };
const mimeByExtension = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
function validSignature(bytes, mime) {
  if (mime === 'application/pdf') return bytes.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

export async function registerAttachment({ dataDir, id, sourcePath }) {
  if (!Object.hasOwn(purposes, id)) throw new Error('Supported IDs: resume-pdf, resume-image, avatar.');
  const source = resolve(sourcePath);
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('The source must be a regular file, not a symlink.');
  if (sourceStat.size > MAX_ATTACHMENT_SIZE) throw new Error('Attachment exceeds the 20 MiB limit.');
  const fileName = basename(source);
  if (!fileName || fileName.length > 255 || /[\x00-\x1f\x7f/\\]/.test(fileName)) throw new Error('Unsupported source filename.');
  const extension = extname(source).toLowerCase();
  const mimeType = mimeByExtension[extension];
  if (!mimeType || (id === 'resume-pdf') !== (mimeType === 'application/pdf')) throw new Error('resume-pdf requires PDF; resume-image and avatar require PNG or JPEG.');
  const bytes = await readFile(source);
  if (bytes.length > MAX_ATTACHMENT_SIZE || !validSignature(bytes, mimeType)) throw new Error('File bytes do not match the extension, or exceed the size limit.');
  const info = await lstat(dataDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Initialize the private data directory first.');
  const attachmentsDir = join(dataDir, 'attachments');
  await mkdir(attachmentsDir, { recursive: true, mode: 0o700 });
  const dirInfo = await lstat(attachmentsDir);
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) throw new Error('Attachment directory must be a real directory.');
  const lockPath = join(dataDir, 'attachments.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Attachment registration is already running, or a previous lock remains. Inspect before retrying.');
    throw error;
  }
  let createdFile;
  let temporaryIndex;
  try {
    await listAttachments(dataDir, 'http://127.0.0.1:17360');
    const indexPath = join(dataDir, 'attachments.json');
    let index;
    try { index = JSON.parse(await readFile(indexPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; index = { version: 1, attachments: [] }; }
    if (index.attachments.some(item => item.id === id)) throw new Error(`Attachment ID ${id} already exists. No file or index was replaced. Review the registered version before changing it.`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storedName = `${id}-${sha256}${extension}`;
    const destination = join(attachmentsDir, storedName);
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    createdFile = destination;
    index.attachments.push({ id, purpose: purposes[id], fileName, mimeType, storedName, sha256 });
    temporaryIndex = join(dataDir, `attachments.${randomUUID()}.tmp`);
    await writeFile(temporaryIndex, JSON.stringify(index, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporaryIndex, indexPath);
    temporaryIndex = undefined;
    createdFile = undefined;
    return { registered: true, id, mimeType, size: bytes.length, sha256 };
  } finally {
    if (temporaryIndex) await unlink(temporaryIndex).catch(() => {});
    if (createdFile) await unlink(createdFile).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.platform !== 'win32') throw new Error('Use register-attachment.ps1 on Windows to apply private directory permissions.');
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--id' || args[2] !== '--file') throw new Error('Use register-attachment.ps1 -Id <id> -Path <file>.');
    const dataDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'resume-mcp', 'data');
    const result = await registerAttachment({ dataDir, id: args[1], sourcePath: args[3] });
    console.log(`Registered ${result.id}; type ${result.mimeType}; ${result.size} bytes; SHA-256 checked.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
