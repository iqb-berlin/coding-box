import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { transformText } from './adapter.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
export function checkTypes() {
  const config = ts.readConfigFile(path.join(root, 'apps/backend/tsconfig.spec.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.join(root, 'apps/backend'), {
    noEmit: true, incremental: false, module: ts.ModuleKind.Preserve, target: ts.ScriptTarget.ES2021,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowSyntheticDefaultImports: true, types: ['node']
  });
  parsed.options.paths = { ...parsed.options.paths,
    vitest: ['tools/backend-vitest/node_modules/vitest/dist/index.d.ts'],
    ...Object.fromEntries(['compat', 'types', 'entities', 'controllers', 'deep-mock'].map(name => [`@backend-vitest/${name}`, [`tools/backend-vitest/${name}.ts`]]))
  };
  const toolFiles = ts.sys.readDirectory(directory, ['.ts'], ['node_modules'], ['**/*.ts']);
  const files = [...new Set([...parsed.fileNames, ...toolFiles,
    path.join(directory, 'node_modules/vitest/globals.d.ts'), path.join(directory, 'node_modules/vite/client.d.ts')])];
  const host = ts.createCompilerHost(parsed.options), read = host.readFile;
  host.readFile = filename => {
    const code = read(filename);
    return code && (filename.startsWith(root + '/apps/backend/') || filename.startsWith(directory + '/contracts/')) && filename.endsWith('.ts') ? transformText(code, filename) : code;
  };
  const started = performance.now(), program = ts.createProgram(files, parsed.options, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const report = { elapsedMs: Math.round(performance.now() - started), files: files.length, diagnostics: diagnostics.map(d => {
    const position = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
    return { file: d.file ? path.relative(root, d.file.fileName) : '<configuration>', line: position ? position.line + 1 : undefined, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') };
  }) };
  fs.mkdirSync(path.join(root, 'tmp/backend-vitest'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp/backend-vitest/typecheck.json'), JSON.stringify(report, null, 2));
  for (const d of report.diagnostics.slice(0, 30)) console.error(`${d.file}:${d.line || 0}: TS${d.code}: ${d.message}`);
  console.log(`Vitest pilot typecheck: ${diagnostics.length} diagnostics in ${report.elapsedMs} ms (${files.length} root files).`);
  return diagnostics.length === 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = checkTypes() ? 0 : 1;
