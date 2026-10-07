import { randomBytes } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function requireRegularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Existing local data must be regular files.');
}

async function copyIfMissing(from, to) {
  try { await copyFile(from, to, constants.COPYFILE_EXCL); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await requireRegularFile(to);
  }
  JSON.parse(await readFile(to, 'utf8'));
}

export async function initializeData({ kitRoot, extensionId }) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid Chrome extension ID.');
  const root = resolve(kitRoot);
  const dataDir = join(root, 'resume-mcp', 'data');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if ((await lstat(dataDir)).isSymbolicLink()) throw new Error('Data directory must not be a symlink.');
  const tokenPath = join(dataDir, 'token');
  try { await writeFile(tokenPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await requireRegularFile(tokenPath);
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (token.length < 32 || /\s/.test(token) || token.includes('\uFEFF')) throw new Error('Existing local token is invalid; it was not overwritten.');
  await copyIfMissing(join(root, 'resume-mcp', 'examples', 'resume.example.json'), join(dataDir, 'resume.json'));
  await copyIfMissing(join(root, 'resume-mcp', 'examples', 'attachments.example.json'), join(dataDir, 'attachments.json'));
  const generated = {
    'windows-install.json': { extensionId, installRoot: root.replaceAll('\\', '/') },
    'pagent-resume-config.json': { mcpServers: { resume: {
      url: 'http://127.0.0.1:17360/mcp',
      transport: 'streamable-http',
      enabled: true,
      headers: { Authorization: `Bearer ${token}` },
      preservePersonalData: true,
      allowAttachmentUploads: true,
    } } },
  };
  for (const [name, value] of Object.entries(generated)) {
    const target = join(dataDir, name);
    try { await requireRegularFile(target); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(target, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  }
  return { initialized: true, tokenPreservedOrCreated: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.platform !== 'win32') throw new Error('Use install.ps1 on Windows so private directory permissions are applied.');
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--extension-id') throw new Error('Use install.ps1 -ExtensionId <id>.');
    await initializeData({ kitRoot: dirname(dirname(fileURLToPath(import.meta.url))), extensionId: args[1] });
    console.log('Local resume data initialized; existing resume, attachments and token were preserved.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
