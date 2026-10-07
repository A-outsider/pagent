import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivateTokenFile } from '../resume-mcp/token-permissions.mjs';
try {
  const kitRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  await assertPrivateTokenFile(join(kitRoot, 'resume-mcp', 'data', 'token'));
  console.log('Local token file permissions passed the runtime check.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
