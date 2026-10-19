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
    for (const { parameter, message } of requestContractBindingErrors(source, program.getTypeChecker())) {
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
export function requestContractBindingErrors(source, checker) {
  const errors = [];
  function symbolAt(node) {
    let symbol = checker?.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol;
  }
  function contractName(type, optional, seen = new Set(), bindings = new Map()) {
    if (!type) return undefined;
    if (ts.isParenthesizedTypeNode(type)) return contractName(type.type, optional, seen, bindings);
    if (ts.isUnionTypeNode(type) && optional) {
      const present = type.types.filter(member => member.kind !== ts.SyntaxKind.UndefinedKeyword);
      if (present.length === 1) return contractName(present[0], false, seen, bindings);
    }
    if (!ts.isTypeReferenceNode(type)) return undefined;
    const name = type.typeName.getText();
    if (bindings.has(name)) return contractName(bindings.get(name), optional, seen, bindings);
    const declaration = symbolAt(type.typeName)?.declarations?.find(ts.isTypeAliasDeclaration);
    if (name === 'RequestBody' || declaration?.name.text === 'RequestBody') {
      let argument = type.typeArguments?.[0];
      if (argument && ts.isTypeReferenceNode(argument)) argument = bindings.get(argument.typeName.getText()) || argument;
      return argument && ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal) ?
        argument.literal.text : undefined;
    }
    if (!declaration || seen.has(declaration)) return undefined;
    const nextSeen = new Set([...seen, declaration]);
    const nextBindings = new Map(bindings);
    declaration.typeParameters?.forEach((parameter, index) => {
      const argument = type.typeArguments?.[index] || parameter.default;
      if (argument) nextBindings.set(parameter.name.text, argument);
    });
    return contractName(declaration.type, optional, nextSeen, nextBindings);
  }
  function visit(node) {
    if (ts.isParameter(node)) {
      for (const decorator of ts.getDecorators(node) || []) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call)) continue;
        const symbol = symbolAt(call.expression);
        if (call.expression.getText(source) !== 'ValidatedBody' && symbol?.name !== 'ValidatedBody') continue;
        const name = call.arguments[0];
        const optional = call.arguments[1]?.kind === ts.SyntaxKind.TrueKeyword;
        if (!name || !ts.isStringLiteral(name) || contractName(node.type, optional) !== name.text) {
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
