import ts from 'typescript';

const hooks = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const mockReturns = new Set(['mockClear', 'mockReset', 'mockRestore', 'mockImplementation', 'mockImplementationOnce', 'mockReturnValue', 'mockReturnValueOnce', 'mockReturnThis', 'mockResolvedValue', 'mockResolvedValueOnce', 'mockRejectedValue', 'mockRejectedValueOnce', 'mockName', 'mocked']);
const isFunction = node => ts.isArrowFunction(node) || ts.isFunctionExpression(node);
const isJest = (node, method) => ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
  node.expression.text === 'jest' && (!method || node.name.text === method);
function rootCallName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return rootCallName(node.expression);
  if (ts.isCallExpression(node)) return rootCallName(node.expression);
}

/** A finite, test-only Jest-to-Vitest adapter. Assertions and test data are retained. */
export function adapter(context, emit = false, runtimeImports) {
  const f = context.factory;
  return source => {
    let legacy = false;
    const testFile = /(?:\.(?:spec|test)\.ts|test\.factory\.ts)$/.test(source.fileName);
    // Production modules receive only the same TypeScript ESM/decorator emit as
    // the production build. Never repair imports or relation types in tests.
    if (!testFile) return source;
    const findJest = node => {
      if (ts.isIdentifier(node) && node.text === 'jest' || ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === '@golevelup/ts-jest') legacy = true;
      else if (!legacy) ts.forEachChild(node, findJest);
    };
    if (testFile) findJest(source);
    const test = legacy;
    const controllerTest = /[/\\]controllers-load\.spec\.ts$/.test(source.fileName);
    let needsRuntime = false, needsTypes = false, needsEntities = false, needsControllers = false;
    let functionDepth = 0, counter = 0;
    const globalLoads = [];
    const id = text => f.createIdentifier(text);
    const viCall = (name, args, types) => f.createCallExpression(f.createPropertyAccessExpression(id('vi'), name), types, args);
    const asyncModifiers = node => [...(node.modifiers || []).filter(m => m.kind !== ts.SyntaxKind.AsyncKeyword), f.createModifier(ts.SyntaxKind.AsyncKeyword)];

    // Imports required inside synchronous mock implementations are loaded by their
    // surrounding async test/hook/factory, without turning the implementation async.
    function preload(fn) {
      const declarations = [];
      const replace = node => {
        if (ts.isCallExpression(node) && (isJest(node.expression, 'requireActual') || isJest(node.expression, 'requireMock'))) {
          if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) throw new Error(`${source.fileName}: dynamic requireActual/requireMock is not supported by the pilot`);
          const name = id(`__pilotModule${counter++}`);
          declarations.push(f.createVariableStatement(undefined, f.createVariableDeclarationList([
            f.createVariableDeclaration(name, undefined, undefined, f.createAwaitExpression(viCall(node.expression.name.text === 'requireActual' ? 'importActual' : 'importMock', node.arguments, node.typeArguments || [f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)])))
          ], ts.NodeFlags.Const)));
          return name;
        }
        return ts.visitEachChild(node, replace, context);
      };
      const body = replace(fn.body);
      if (!declarations.length) return fn;
      const block = f.createBlock([...declarations, ...(ts.isBlock(body) ? body.statements : [f.createReturnStatement(body)])], true);
      return ts.isArrowFunction(fn) ? f.updateArrowFunction(fn, asyncModifiers(fn), fn.typeParameters, fn.parameters, fn.type, fn.equalsGreaterThanToken, block) :
        f.updateFunctionExpression(fn, asyncModifiers(fn), fn.asteriskToken, fn.name, fn.typeParameters, fn.parameters, fn.type, block);
    }

    function commonJsFactory(fn, forceDefault) {
      const wrapReturns = node => {
        if (isFunction(node)) return node;
        if (ts.isReturnStatement(node) && node.expression) {
          const value = id(`__pilotDefault${counter++}`);
          return f.createBlock([
            f.createVariableStatement(undefined, f.createVariableDeclarationList([f.createVariableDeclaration(value, undefined, undefined, node.expression)], ts.NodeFlags.Const)),
            f.createReturnStatement(forceDefault ? f.createObjectLiteralExpression([f.createSpreadAssignment(value), f.createPropertyAssignment('default', value)]) :
              f.createConditionalExpression(f.createBinaryExpression(f.createTypeOfExpression(value), ts.SyntaxKind.EqualsEqualsEqualsToken, f.createStringLiteral('function')), undefined,
                f.createCallExpression(f.createPropertyAccessExpression(id('Object'), 'assign'), undefined, [f.createObjectLiteralExpression([f.createPropertyAssignment('default', value)]), value]), undefined, value))
          ], true);
        }
        return ts.visitEachChild(node, wrapReturns, context);
      };
      const body = ts.isBlock(fn.body) ? fn.body : f.createBlock([f.createReturnStatement(fn.body)], true);
      const wrapped = wrapReturns(body);
      return ts.isArrowFunction(fn) ? f.updateArrowFunction(fn, fn.modifiers, fn.typeParameters, fn.parameters, fn.type, fn.equalsGreaterThanToken, wrapped) :
        f.updateFunctionExpression(fn, fn.modifiers, fn.asteriskToken, fn.name, fn.typeParameters, fn.parameters, fn.type, wrapped);
    }

    function visit(node) {
      if (controllerTest && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        needsControllers = true;
        return f.createCallExpression(f.createPropertyAccessExpression(id('Promise'), 'resolve'), undefined, [f.createElementAccessExpression(id('__pilotControllers'), node.arguments[0])]);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        let specifier = node.moduleSpecifier.text;
        let clause = node.importClause;
        if (emit && clause?.isTypeOnly) return undefined;
        if (test && specifier === '@golevelup/ts-jest') specifier = '@backend-vitest/deep-mock';
        return f.updateImportDeclaration(node, node.modifiers, clause, f.createStringLiteral(specifier), node.attributes);
      }
      if (test && ts.isQualifiedName(node) && ts.isIdentifier(node.left) && node.left.text === 'jest') {
        needsTypes = true;
        return f.updateQualifiedName(node, id('__pilotMocks'), node.right);
      }
      if (test && ts.isCallExpression(node)) {
        const callName = rootCallName(node.expression);
        let args = [...node.arguments];
        if (isJest(node.expression, 'mock') || ['it', 'test', ...hooks].includes(callName)) args = args.map(arg => isFunction(arg) ? preload(arg) : arg);
        if (isJest(node.expression, 'mock')) args = args.map(arg => isFunction(arg) ? commonJsFactory(arg, ts.isStringLiteral(args[0]) && ['fs', 'node:fs'].includes(args[0].text)) : arg);
        if (hooks.has(callName)) args = args.map(arg => {
          if (!ts.isArrowFunction(arg) || !ts.isCallExpression(arg.body)) return arg;
          const expression = arg.body.expression;
          if (ts.isPropertyAccessExpression(expression) && (mockReturns.has(expression.name.text) || isJest(expression, 'spyOn') || isJest(expression, 'fn'))) {
            return f.updateArrowFunction(arg, arg.modifiers, arg.typeParameters, arg.parameters, arg.type, arg.equalsGreaterThanToken, f.createBlock([f.createExpressionStatement(arg.body)], true));
          }
          return arg;
        });
        let expression = node.expression;
        if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'mockImplementation' && !args.length) args = [f.createArrowFunction(undefined, undefined, [], undefined, f.createToken(ts.SyntaxKind.EqualsGreaterThanToken), f.createBlock([]))];
        if (isJest(expression, 'mock') && functionDepth > 0) expression = f.createPropertyAccessExpression(id('vi'), 'doMock');
        if (isJest(expression, 'fn') && node.typeArguments?.length) {
          const [returns, parameters] = node.typeArguments;
          const argsType = parameters || f.createArrayTypeNode(f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword));
          const signature = f.createFunctionTypeNode(undefined, [f.createParameterDeclaration(undefined, f.createToken(ts.SyntaxKind.DotDotDotToken), 'args', undefined, argsType)], returns);
          return ts.visitEachChild(f.updateCallExpression(node, expression, [signature], args), visit, context);
        }
        if (isJest(expression, 'setTimeout')) return viCall('setConfig', [f.createObjectLiteralExpression([f.createPropertyAssignment('testTimeout', args[0])])]);
        if (isJest(expression, 'requireActual')) {
          if (!args[0] || !ts.isStringLiteral(args[0])) throw new Error(`${source.fileName}: dynamic requireActual is not supported by the pilot`);
          const name = id(`__pilotModule${counter++}`);
          globalLoads.push(f.createVariableStatement(undefined, f.createVariableDeclarationList([
            f.createVariableDeclaration(name, undefined, undefined, f.createAwaitExpression(viCall('importActual', args, node.typeArguments || [f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)])))
          ], ts.NodeFlags.Const)));
          return name;
        }
        if (isJest(expression, 'requireMock')) throw new Error(`${source.fileName}: requireMock needs a test, hook or mock factory scope`);
        node = f.updateCallExpression(node, expression, node.typeArguments, args);
      }
      if (testFile && ts.isPropertyAssignment(node)) {
        const propertyName = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
        if (propertyName === 'entities' && node.initializer.getText(source).includes('.entity.ts')) {
          needsEntities = true;
          return f.updatePropertyAssignment(node, node.name, id('__pilotEntities'));
        }
        // Native Vitest constructors need constructible implementations. Restrict
        // this conversion to constructor exports, retaining lexical-this arrows.
        if (test && ['Database', 'Workbook'].includes(propertyName)) {
          const constructible = child => {
            if (ts.isArrowFunction(child) && !child.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
              let lexical = false;
              const scan = n => { if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword || ts.isIdentifier(n) && n.text === 'arguments') lexical = true; ts.forEachChild(n, scan); };
              scan(child.body);
              if (!lexical) return f.createFunctionExpression(child.modifiers, undefined, undefined, child.typeParameters, child.parameters, child.type, ts.isBlock(child.body) ? child.body : f.createBlock([f.createReturnStatement(child.body)], true));
            }
            return ts.visitEachChild(child, constructible, context);
          };
          node = f.updatePropertyAssignment(node, node.name, constructible(node.initializer));
        }
      }
      if (test && isJest(node)) {
        const special = { fn: '__pilotFn', spyOn: '__backendSpyOn', mocked: '__pilotMocked', replaceProperty: '__pilotReplaceProperty', restoreAllMocks: '__pilotRestoreAllMocks' }[node.name.text];
        if (special) { needsRuntime = true; return id(special); }
        return f.createPropertyAccessExpression(id('vi'), node.name);
      }
      if (isFunction(node)) {
        functionDepth++;
        const result = ts.visitEachChild(node, visit, context);
        functionDepth--;
        return result;
      }
      return ts.visitEachChild(node, visit, context);
    }
    const transformed = ts.visitNode(source, visit);
    const imports = [];
    const parsedImport = text => ts.createSourceFile('pilot-import.ts', text, ts.ScriptTarget.Latest, true).statements[0];
    if (needsRuntime) imports.push(parsedImport("import { fn as __pilotFn, spyOn as __backendSpyOn, mocked as __pilotMocked, replaceProperty as __pilotReplaceProperty, restoreAllMocks as __pilotRestoreAllMocks } from '@backend-vitest/compat';"));
    if (needsTypes && !emit) imports.push(parsedImport("import type * as __pilotMocks from '@backend-vitest/types';"));
    if (needsEntities) imports.push(parsedImport("import { pilotEntities as __pilotEntities } from '@backend-vitest/entities';"));
    if (needsControllers) imports.push(parsedImport("import { controllerModules as __pilotControllers } from '@backend-vitest/controllers';"));
    // Imported nodes are synthesized to avoid mapping their foreign source offsets.
    for (const statement of imports) {
      const synthesize = node => { ts.setTextRange(node, { pos: -1, end: -1 }); ts.forEachChild(node, synthesize); };
      synthesize(statement);
    }
    if (emit) {
      runtimeImports?.(imports);
      return f.updateSourceFile(transformed, [...globalLoads, ...transformed.statements]);
    }
    return f.updateSourceFile(transformed, [...imports, ...globalLoads, ...transformed.statements]);
  };
}

export function transformText(code, filename) {
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true);
  const result = ts.transform(source, [adapter]);
  try { return ts.createPrinter().printFile(result.transformed[0]); } finally { result.dispose(); }
}

export function transpile(code, filename) {
  let imports = [];
  const output = ts.transpileModule(code, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021, experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false, esModuleInterop: false, sourceMap: true, inlineSources: true },
    transformers: /(?:\.(?:spec|test)\.ts|test\.factory\.ts)$/.test(filename) ? {
      before: [context => adapter(context, true, statements => { imports = statements; })],
      // Insert generated value imports after TypeScript's alias elision. They
      // have no original binder symbols and must not be resolved as old aliases.
      after: [context => source => context.factory.updateSourceFile(source, [...imports, ...source.statements])]
    } : undefined
  });
  return { code: output.outputText, map: JSON.parse(output.sourceMapText) };
}
