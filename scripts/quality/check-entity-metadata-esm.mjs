import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const snapshotModule = new URL('./entity-metadata-snapshot.cjs', import.meta.url).href;

// Only add Node's file extensions to temporary output. Do not transform classes,
// decorators or evaluation order: the native loader must expose metadata cycles.
function nodeImportExtensions(options) {
  return context => source => {
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text.startsWith('.')) {
        const resolved = ts.resolveModuleName(node.moduleSpecifier.text, source.fileName, options, ts.sys).resolvedModule;
        assert.ok(resolved && /\.tsx?$/.test(resolved.resolvedFileName),
          `Expected a local TypeScript module: ${source.fileName}: ${node.moduleSpecifier.text}`);
        let specifier = path.relative(path.dirname(source.fileName), resolved.resolvedFileName)
          .replaceAll(path.sep, '/').replace(/\.tsx?$/, '.js');
        if (!specifier.startsWith('.')) specifier = `./${specifier}`;
        const literal = context.factory.createStringLiteral(specifier);
        return ts.isImportDeclaration(node) ?
          context.factory.updateImportDeclaration(node, node.modifiers, node.importClause, literal, node.attributes) :
          context.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, literal, node.attributes);
      }
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(source, visit);
  };
}

function compile(files, options, outDir, esm) {
  const compilerOptions = {
    ...options, outDir, noEmit: false, noEmitOnError: true, incremental: false,
    declaration: false, sourceMap: false,
    ...(esm ? { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler } : {})
  };
  const program = ts.createProgram(files, compilerOptions);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name, getCurrentDirectory: () => workspace, getNewLine: () => '\n'
    }));
  }
  const result = program.emit(undefined, undefined, undefined, undefined,
    esm ? { after: [nodeImportExtensions(compilerOptions)] } : undefined);
  assert.equal(result.emitSkipped, false, 'Entity compilation must emit JavaScript');
  writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: esm ? 'module' : 'commonjs' }));
}

export function verifyEntityMetadata({ files, options, root = workspace }) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'backend-entity-esm-'));
  try {
    symlinkSync(path.join(workspace, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
    const runner = path.join(temporary, 'inspect.mjs');
    writeFileSync(runner, `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      import { DataSource } from 'typeorm';
      import snapshot from ${JSON.stringify(snapshotModule)};
      const require = createRequire(import.meta.url);
      const [format, ...files] = process.argv.slice(2);
      const entities = new Set();
      for (const file of files) {
        const exports = format === 'esm' ? await import(pathToFileURL(file).href) : require(file);
        for (const value of Object.values(exports)) if (typeof value === 'function') entities.add(value);
      }
      const source = new DataSource({ type: 'postgres', entities: [...entities], synchronize: false });
      await source.buildMetadatas();
      assert.equal(source.entityMetadatas.length, entities.size, 'Every entity must have PostgreSQL metadata');
      process.stdout.write(JSON.stringify(snapshot(source)));
    `);
    const snapshots = [];
    for (const esm of [false, true]) {
      const outDir = path.join(temporary, esm ? 'esm' : 'commonjs');
      mkdirSync(outDir);
      compile(files, { ...options, rootDir: root }, outDir, esm);
      const emitted = files.map(file => path.join(outDir, path.relative(root, file).replace(/\.ts$/, '.js')));
      for (const order of esm ? [emitted, [...emitted].reverse()] : [emitted]) {
        // New unmodified Node processes: no ts-node, VM modules or custom loader.
        const output = execFileSync(process.execPath, [runner, esm ? 'esm' : 'commonjs', ...order], {
          env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, encoding: 'utf8',
          timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
        });
        snapshots.push(JSON.parse(output));
      }
    }
    assert.deepEqual(snapshots[1], snapshots[0], 'Native ESM and CommonJS PostgreSQL metadata must match');
    assert.deepEqual(snapshots[2], snapshots[0], 'Native ESM metadata must also match in reverse import order');
    return snapshots[0];
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const configPath = path.join(workspace, 'apps/backend/tsconfig.app.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    assert.equal(parsed.errors.length, 0, 'The production TypeScript configuration must be valid');
    const directory = path.join(workspace, 'apps/backend/src/app/database/entities');
    const files = readdirSync(directory).filter(file => file.endsWith('.entity.ts')).sort()
      .map(file => path.join(directory, file));
    assert.ok(files.length, 'The native ESM probe must include entities');
    const metadata = verifyEntityMetadata({ files, options: parsed.options });
    console.log(`Native ESM PostgreSQL metadata matches CommonJS (${metadata.length} entities; both import orders).`);
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  }
}
