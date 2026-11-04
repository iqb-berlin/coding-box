import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../..', import.meta.url));
const configPath = path.join(root, 'apps/backend/tsconfig.build.json');
const outputArgument = process.argv.find(argument => argument.startsWith('--outputPath='));
const output = path.resolve(root, outputArgument?.slice('--outputPath='.length) ?? 'dist/backend-build-comparison/tsc');
assert.ok(output.startsWith(path.join(root, 'dist') + path.sep), 'Output must be inside workspace dist/');
// The production Dockerfile restores the CommonJS workspace manifest at its
// root. Keep emitted ESM in an independent package scope which survives that.
const runtime = path.join(output, 'runtime');
const watch = process.argv.includes('--watch');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const options = {
  ...parsed.options, rootDir: root, outDir: runtime, noEmit: false, noEmitOnError: true,
  declaration: false, sourceMap: false,
  ...(watch ? { incremental: true, tsBuildInfoFile: path.join(output, '.tsbuildinfo') } : {})
};
const generated = 'apps/backend/src/app/database/services/coding/generated/autocoder-compatibility-engine';
const replacements = new Map([[
  path.join(root, 'apps/backend/src/environments/environment.ts'),
  path.join(root, 'apps/backend/src/environments/environment.prod.ts')
]]);

// This experiment leaves the source tree untouched. Node extensions and JSON
// attributes are added to emitted imports; the generated CJS engine gets an
// explicit .cjs boundary. These steps are part of measured build time.
function nativeImports(context) {
  return source => {
    const resolve = specifier => {
      if (!specifier.startsWith('.')) return specifier;
      const resolved = ts.resolveModuleName(specifier, source.fileName, options, ts.sys).resolvedModule;
      assert.ok(resolved, `Unresolved local import: ${source.fileName}: ${specifier}`);
      let target = replacements.get(resolved.resolvedFileName) ?? resolved.resolvedFileName;
      if (target === path.join(root, generated + '.d.ts')) target = path.join(root, generated + '.cjs');
      else target = target.replace(/\.tsx?$/, '.js');
      let relative = path.relative(path.dirname(source.fileName), target).replaceAll(path.sep, '/');
      if (!relative.startsWith('.')) relative = './' + relative;
      return relative;
    };
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = resolve(node.moduleSpecifier.text);
        const literal = context.factory.createStringLiteral(specifier);
        if (ts.isImportDeclaration(node)) {
          const attributes = specifier.endsWith('.json') ? context.factory.createImportAttributes([
            context.factory.createImportAttribute(context.factory.createIdentifier('type'), context.factory.createStringLiteral('json'))
          ]) : node.attributes;
          return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause, literal, attributes);
        }
        return context.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly,
          node.exportClause, literal, node.attributes);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('.')) {
        return context.factory.updateCallExpression(node, node.expression, node.typeArguments,
          [context.factory.createStringLiteral(resolve(node.arguments[0].text)), ...node.arguments.slice(1)]);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(source, visit);
  };
}

function packageOutput() {
  mkdirSync(path.dirname(path.join(runtime, generated)), { recursive: true });
  cpSync(path.join(root, generated + '.js'), path.join(runtime, generated + '.cjs'));
  cpSync(path.join(root, 'schemas'), path.join(output, 'schemas'), { recursive: true });
  writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  writeFileSync(path.join(output, 'main.mjs'), "import './runtime/apps/backend/src/main.js';\n");
}

function diagnostics(errors) {
  if (!errors.length) return false;
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  return true;
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
if (watch) {
  const host = ts.createWatchCompilerHost(configPath, options, ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram, error => diagnostics([error]), () => {});
  host.afterProgramCreate = builder => {
    const errors = [...builder.getOptionsDiagnostics(), ...builder.getGlobalDiagnostics(),
      ...builder.getSyntacticDiagnostics(), ...builder.getSemanticDiagnostics()];
    if (diagnostics(errors)) return;
    const emitted = builder.emit(undefined, undefined, undefined, undefined, { after: [nativeImports] });
    if (diagnostics(emitted.diagnostics) || emitted.emitSkipped) return;
    packageOutput();
    console.log('BUILD_COMPARISON_COMPLETED');
  };
  ts.createWatchProgram(host);
} else {
  const program = ts.createProgram(parsed.fileNames, options);
  if (diagnostics([...parsed.errors, ...ts.getPreEmitDiagnostics(program)])) process.exit(1);
  const emitted = program.emit(undefined, undefined, undefined, undefined, { after: [nativeImports] });
  if (diagnostics(emitted.diagnostics) || emitted.emitSkipped) process.exit(1);
  packageOutput();
  assert.ok(existsSync(path.join(runtime, 'apps/backend/src/main.js')));
  console.log('BUILD_COMPARISON_COMPLETED');
}
