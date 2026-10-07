// Optional rebuild: install pagent's build dependencies first, then run this file.
import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(root, '../pagent');
const ts = createRequire(path.join(source, 'package.json'))('typescript');
for (const folder of ['mcp', 'src/shared/contracts']) {
  const outDir = path.join(root, folder);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const file of await readdir(path.join(source, folder))) {
    if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
    const input = await readFile(path.join(source, folder, file), 'utf8');
    const result = ts.transpileModule(input, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: false },
      fileName: file, reportDiagnostics: true,
    });
    const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: f => f, getCurrentDirectory: () => source, getNewLine: () => '\n',
    }));
    const output = result.outputText.replace(/((?:from\s*|import\s*\(?)['"])(\.[^'"]+)(['"])/g,
      (_, before, spec, after) => before + (spec.endsWith('.ts') ? spec.slice(0, -3) + '.js' : path.extname(spec) ? spec : spec + '.js') + after);
    await writeFile(path.join(outDir, file.slice(0, -3) + '.js'), output);
  }
}
console.log('Built Pagent Host JavaScript.');
