import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselinePath = path.join(root, 'apps/backend/strict-baseline.json');

export function collectStrictDiagnostics(workspace = root) {
  const config = ts.readConfigFile(path.join(workspace, 'apps/backend/tsconfig.app.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.join(workspace, 'apps/backend'), {
    strict: true,
    // Nest/TypeORM initialize decorated entity and DTO properties themselves.
    strictPropertyInitialization: false,
    noEmit: true
  });
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  for (const source of program.getSourceFiles()) {
    if (!source.fileName.includes('/apps/backend/src/')) continue;
    for (const { parameter, message } of requestContractBindingErrors(source)) {
      diagnostics.push({
        file: source, start: parameter.getStart(source), length: parameter.getWidth(source),
        category: ts.DiagnosticCategory.Error, code: 95001, messageText: message
      });
    }
  }
  const records = new Map();
  for (const diagnostic of diagnostics) {
    const record = {
      file: diagnostic.file ? path.relative(workspace, diagnostic.file.fileName).replaceAll('\\', '/') : '<configuration>',
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      count: 1
    };
    const key = diagnosticKey(record);
    const existing = records.get(key);
    if (existing) existing.count += 1;
    else records.set(key, record);
  }
  return [...records.values()].sort((a, b) => diagnosticKey(a).localeCompare(diagnosticKey(b)));
}

/** Ensure the runtime/documentation contract and inferred input use the same name. */
export function requestContractBindingErrors(source) {
  const errors = [];
  function visit(node) {
    if (ts.isParameter(node)) {
      for (const decorator of ts.getDecorators(node) || []) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call) || call.expression.getText(source) !== 'ValidatedBody') continue;
        const name = call.arguments[0];
        let type = node.type;
        if (type && ts.isUnionTypeNode(type) && call.arguments[1]?.kind === ts.SyntaxKind.TrueKeyword) {
          const present = type.types.filter(member => member.kind !== ts.SyntaxKind.UndefinedKeyword);
          if (present.length === 1) [type] = present;
        }
        const argument = type && ts.isTypeReferenceNode(type) ? type.typeArguments?.[0] : undefined;
        if (!name || !ts.isStringLiteral(name) || !type || !ts.isTypeReferenceNode(type) ||
            type.typeName.getText(source) !== 'RequestBody' || !argument || !ts.isLiteralTypeNode(argument) ||
            !ts.isStringLiteral(argument.literal) || argument.literal.text !== name.text) {
          errors.push({ parameter: node, message: 'ValidatedBody and RequestBody must reference the same named contract.' });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}

function diagnosticKey(record) {
  return JSON.stringify([record.file, record.code, record.message]);
}

export function compareDiagnostics(current, baseline) {
  const accepted = new Map(baseline.map(record => [diagnosticKey(record), record.count]));
  return current.filter(record => record.count > (accepted.get(diagnosticKey(record)) || 0));
}

export function verifyBaseline(current, baseline) {
  const regressions = compareDiagnostics(current, baseline);
  if (regressions.length) {
    for (const record of regressions) {
      process.stderr.write(`${record.file}: TS${record.code}: ${record.message} (${record.count} occurrences)\n`);
    }
    throw new Error('Backend strict typecheck found new diagnostics. Fix them; do not expand the legacy baseline.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const current = collectStrictDiagnostics();
    verifyBaseline(current, baseline.diagnostics);
    if (process.argv.includes('--prune-baseline')) {
      fs.writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, diagnostics: current }, null, 2)}\n`);
    }
    const count = current.reduce((total, record) => total + record.count, 0);
    process.stdout.write(`Backend strict typecheck passed; ${count} legacy diagnostics remain.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
