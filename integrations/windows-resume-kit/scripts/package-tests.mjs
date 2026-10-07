import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeData } from './initialize-data.mjs';
import { registerAttachment } from './register-attachment.mjs';

async function fixture(t) {
  const kitRoot = await mkdtemp(join(tmpdir(), 'pagent-package-test-'));
  t.after(() => rm(kitRoot, { recursive: true, force: true }));
  const examples = join(kitRoot, 'resume-mcp', 'examples');
  await mkdir(examples, { recursive: true });
  await writeFile(join(examples, 'resume.example.json'), '{"metadata":{"schemaVersion":1},"classificationRules":[],"sections":{}}');
  await writeFile(join(examples, 'attachments.example.json'), '{"version":1,"attachments":[]}');
  await initializeData({ kitRoot, extensionId: 'a'.repeat(32) });
  const dataDir = join(kitRoot, 'resume-mcp', 'data');
  await mkdir(join(dataDir, 'attachments'), { mode: 0o700 });
  return { kitRoot, dataDir };
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

test('initialization creates unique local token and preserves user resume/token on rerun', async t => {
  const { kitRoot, dataDir } = await fixture(t);
  const token = await readFile(join(dataDir, 'token'), 'utf8');
  assert.match(token, /^[a-f0-9]{64}$/);
  const ownResume = { sections: { example: { suppliedByUser: true } } };
  await writeFile(join(dataDir, 'resume.json'), JSON.stringify(ownResume));
  await initializeData({ kitRoot, extensionId: 'b'.repeat(32) });
  assert.equal(await readFile(join(dataDir, 'token'), 'utf8'), token);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'resume.json'), 'utf8')), ownResume);
  const config = JSON.parse(await readFile(join(dataDir, 'pagent-resume-config.json'), 'utf8'));
  assert.equal(config.mcpServers.resume.headers.Authorization, `Bearer ${token}`);
  assert.equal(config.mcpServers.resume.preservePersonalData, true);
  assert.equal(config.mcpServers.resume.allowAttachmentUploads, true);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'windows-install.json'), 'utf8')).extensionId, 'b'.repeat(32));
});

test('initialization rejects invalid extension ID before creating data', async t => {
  const { kitRoot } = await fixture(t);
  await assert.rejects(initializeData({ kitRoot, extensionId: 'invalid' }), /extension ID/);
});

test('registered PDF bytes and SHA-256 match the source; existing ID cannot be overwritten', async t => {
  const { kitRoot, dataDir } = await fixture(t);
  const sourcePath = join(kitRoot, 'my-resume.pdf');
  await writeFile(sourcePath, pdf);
  const result = await registerAttachment({ dataDir, id: 'resume-pdf', sourcePath });
  assert.equal(result.sha256, createHash('sha256').update(pdf).digest('hex'));
  const index = JSON.parse(await readFile(join(dataDir, 'attachments.json'), 'utf8'));
  assert.equal(index.attachments.length, 1);
  assert.deepEqual(await readFile(join(dataDir, 'attachments', index.attachments[0].storedName)), pdf);
  const before = await readFile(join(dataDir, 'attachments.json'), 'utf8');
  await writeFile(sourcePath, Buffer.concat([pdf, Buffer.from('changed')]));
  await assert.rejects(registerAttachment({ dataDir, id: 'resume-pdf', sourcePath }), /already exists/);
  assert.equal(await readFile(join(dataDir, 'attachments.json'), 'utf8'), before);
  assert.equal((await readdir(join(dataDir, 'attachments'))).length, 1);
});

test('image IDs enforce image MIME and validate actual file signature', async t => {
  const { kitRoot, dataDir } = await fixture(t);
  const pdfPath = join(kitRoot, 'resume.pdf');
  const wrongPath = join(kitRoot, 'fake.png');
  await writeFile(pdfPath, pdf);
  await writeFile(wrongPath, pdf);
  await assert.rejects(registerAttachment({ dataDir, id: 'avatar', sourcePath: pdfPath }), /require PNG or JPEG/);
  await assert.rejects(registerAttachment({ dataDir, id: 'resume-image', sourcePath: wrongPath }), /do not match/);
  assert.equal((await readdir(join(dataDir, 'attachments'))).length, 0);
});

test('a real image signature registers without changing bytes', async t => {
  const { kitRoot, dataDir } = await fixture(t);
  const sourcePath = join(kitRoot, 'avatar.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS8kAAAAASUVORK5CYII=', 'base64');
  await writeFile(sourcePath, png);
  const result = await registerAttachment({ dataDir, id: 'avatar', sourcePath });
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.size, png.length);
});

test('invalid existing attachment index is rejected before a copy is created', async t => {
  const { kitRoot, dataDir } = await fixture(t);
  const sourcePath = join(kitRoot, 'resume.pdf');
  await writeFile(sourcePath, pdf);
  await writeFile(join(dataDir, 'attachments.json'), '{"version":2,"attachments":[]}');
  await assert.rejects(registerAttachment({ dataDir, id: 'resume-pdf', sourcePath }));
  assert.deepEqual(await readdir(join(dataDir, 'attachments')), []);
  assert.equal((await readdir(dataDir)).includes('attachments.lock'), false);
});

test('an existing registration lock is retained and blocks concurrent mutation', async t => {
  const { kitRoot, dataDir } = await fixture(t);
  const sourcePath = join(kitRoot, 'resume.pdf');
  await writeFile(sourcePath, pdf);
  await writeFile(join(dataDir, 'attachments.lock'), 'existing run');
  await assert.rejects(registerAttachment({ dataDir, id: 'resume-pdf', sourcePath }), /already running/);
  assert.equal(await readFile(join(dataDir, 'attachments.lock'), 'utf8'), 'existing run');
});

test('symlink source files are refused', { skip: process.platform === 'win32' }, async t => {
  const { kitRoot, dataDir } = await fixture(t);
  const actual = join(kitRoot, 'actual.pdf');
  const link = join(kitRoot, 'link.pdf');
  await writeFile(actual, pdf);
  await symlink(actual, link);
  await assert.rejects(registerAttachment({ dataDir, id: 'resume-pdf', sourcePath: link }), /symlink/);
});
