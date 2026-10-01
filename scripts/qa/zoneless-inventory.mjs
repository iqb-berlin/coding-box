import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseTemplate } from '@angular/compiler';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = 'apps/frontend/src/app';
const matrixArgument = process.argv.indexOf('--matrix');
if (matrixArgument >= 0 && !process.argv[matrixArgument + 1]) throw new Error('--matrix requires a file path');
const matrixFile = matrixArgument >= 0 ? path.resolve(process.argv[matrixArgument + 1]) :
  path.join(root, 'docs/qa/zoneless-coverage.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
const filesUnder = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const name = path.join(directory, entry.name);
  return entry.isDirectory() ? filesUnder(name) : [name];
});
const productionFiles = filesUnder(path.join(root, sourceRoot)).filter(file =>
  file.endsWith('.ts') && !/\.(spec|mock)\.ts$/.test(file));
const entries = [];
const occurrences = new Map();
const externalImports = new Map();
function record(file, owner, kind, name, text, line, details = {}) {
  const prefix = `${file}#${owner}:${kind}:${name}`;
  const index = (occurrences.get(prefix) || 0) + 1;
  occurrences.set(prefix, index);
  entries.push({ id: `${prefix}:${index}`, file, owner, kind, name, line,
    fingerprint: hash(text), ...details });
}
for (const absolute of productionFiles) {
  const file = path.relative(root, absolute);
  const source = fs.readFileSync(absolute, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    if (module.startsWith('.')) continue;
    const packageName = module.split('/').slice(0, module.startsWith('@') ? 2 : 1).join('/');
    const references = externalImports.get(packageName) || new Set();
    references.add(file);
    externalImports.set(packageName, references);
  }
  function visit(node, owner = 'module', method = 'initialization') {
    if (ts.isClassDeclaration(node)) {
      owner = node.name?.text || 'anonymous';
      for (const decorator of ts.getDecorators(node) || []) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call)) continue;
        const kind = call.expression.getText(sf);
        if (!['Component', 'Directive', 'Pipe', 'Injectable'].includes(kind)) continue;
        const metadata = call.arguments[0];
        const properties = metadata && ts.isObjectLiteralExpression(metadata) ? metadata.properties : [];
        const property = name => properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === name)?.initializer;
        const inline = property('template');
        const templateUrl = property('templateUrl');
        const templateFile = templateUrl ? path.resolve(path.dirname(absolute), templateUrl.text) : absolute;
        const templateLineOffset = inline ? sf.getLineAndCharacterOfPosition(inline.getStart(sf) + 1).line : 0;
        const template = inline?.text ?? (templateUrl ? fs.readFileSync(templateFile, 'utf8') : '');
        record(file, owner, kind, owner, `${node.getText(sf)}\n${template}`,
          sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          { selector: property('selector')?.text || '', testCandidates: [] });
        if (template) {
          const parsed = parseTemplate(template, templateFile);
          if (parsed.errors?.length) throw new Error(parsed.errors.map(e => e.toString()).join('\n'));
          const seen = new Set();
          function walk(value) {
            if (!value || typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            for (const binding of value.inputs || []) {
              record(file, owner, 'template-binding', binding.name, binding.value.source,
                binding.sourceSpan.start.line + templateLineOffset + 1,
                { templateFile: path.relative(root, templateFile), expression: binding.value.source });
            }
            if (value.value?.source && value.sourceSpan) {
              record(file, owner, 'template-text', 'interpolation', value.value.source,
                value.sourceSpan.start.line + templateLineOffset + 1,
                { templateFile: path.relative(root, templateFile), expression: value.value.source });
            }
            if (value.expression?.source && value.sourceSpan) {
              record(file, owner, 'template-condition', 'control-flow', value.expression.source,
                value.sourceSpan.start.line + templateLineOffset + 1,
                { templateFile: path.relative(root, templateFile), expression: value.expression.source });
            }
            for (const event of value.outputs || []) {
              record(file, owner, 'template-event', event.name, event.handler.source,
                event.sourceSpan.start.line + templateLineOffset + 1, { templateFile: path.relative(root, templateFile), expression: event.handler.source });
            }
            for (const key of ['children', 'branches', 'cases', 'empty', 'placeholder', 'loading', 'error', 'node']) {
              const child = value[key];
              if (Array.isArray(child)) child.forEach(walk); else walk(child);
            }
          }
          parsed.nodes.forEach(walk);
        }
      }
    }
    if (ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) method = node.name.getText(sf);
    if (ts.isConstructorDeclaration(node)) method = 'constructor';
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(sf);
      if (/(?:\.subscribe|\.then|\.catch|\.finally|setTimeout|setInterval|requestAnimationFrame|addEventListener|\.listen|firstValueFrom|lastValueFrom|debounceTime|debounce|delay|timer|interval|fromEvent|HostListener|queueMicrotask|requestIdleCallback)$/.test(expression)) {
        record(file, owner, 'async-source', `${method}/${expression}`, node.getText(sf), sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
    }
    if (ts.isNewExpression(node) && /^(ResizeObserver|MutationObserver|IntersectionObserver|FileReader|Worker|WebSocket|EventSource)$/.test(node.expression.getText(sf))) {
      record(file, owner, 'browser-source', `${method}/${node.expression.getText(sf)}`, node.getText(sf), sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    if (ts.isAwaitExpression(node)) record(file, owner, 'await', method, node.getText(sf), sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && /\.(onload|onerror|onmessage|onprogress)$/.test(node.left.getText(sf))) {
      record(file, owner, 'browser-callback', `${method}/${node.left.getText(sf)}`, node.getText(sf), sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, child => visit(child, owner, method));
  }
  visit(sf);
}
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const [packageName, references] of externalImports) {
  const version = packageJson.dependencies?.[packageName] || packageJson.devDependencies?.[packageName] || 'workspace alias / unresolved';
  const lockedVersion = packageLock.packages?.[`node_modules/${packageName}`]?.version || 'unresolved';
  const callers = [...references].sort();
  record('package.json', packageName, 'external-library', packageName,
    JSON.stringify({ version, lockedVersion, callers }), 1, { version, lockedVersion, callerCandidates: callers });
}
// References are candidates for human reachability review, not proof of a caller.
const allSourceFiles = filesUnder(path.join(root, sourceRoot));
const testSourceFiles = allSourceFiles.filter(file => file.endsWith('.spec.ts'))
  .map(file => ({ file: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }));
const referenceFiles = allSourceFiles.filter(file => /\.(ts|html)$/.test(file) && !/\.(spec|mock)\.ts$/.test(file))
  .map(file => ({ file: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }));
for (const entry of entries.filter(item => ['Component', 'Directive', 'Pipe', 'Injectable'].includes(item.kind))) {
  entry.testCandidates = testSourceFiles.filter(item => item.text.includes(entry.owner)).map(item => item.file);
  entry.callerCandidates = referenceFiles.filter(item => item.file !== entry.file &&
    (item.text.includes(entry.owner) || (entry.selector && item.text.includes(`<${entry.selector}`))))
    .map(item => item.file);
}
entries.sort((a, b) => a.id.localeCompare(b.id));
const requiredScenarios = ['delayed-success', 'empty', 'error-retry', 'progress', 'out-of-order', 'context-change', 'destroy', 'reopen', 'debounce-timer', 'roles'];
const previous = fs.existsSync(matrixFile) ? JSON.parse(fs.readFileSync(matrixFile, 'utf8')) : { entries: [] };
const oldById = new Map(previous.entries.map(entry => [entry.id, entry]));
if (process.argv.includes('--update')) {
  const matrix = { schemaVersion: 1, scenarios: requiredScenarios,
    entries: entries.map(entry => {
      const old = oldById.get(entry.id);
      const unchanged = old?.fingerprint === entry.fingerprint;
      return { ...entry, review: unchanged ? old.review : { status: 'open', caller: '', roles: [], scenarios: {}, tests: [], evidence: [], reason: '' } };
    }) };
  // One inventory record per line keeps generated evidence out of lengthy PR diffs.
  fs.writeFileSync(matrixFile, `{"schemaVersion":1,"scenarios":${JSON.stringify(requiredScenarios)},"entries":[\n${matrix.entries.map(entry => JSON.stringify(entry)).join(',\n')}\n]}\n`);
} else {
  const currentIds = new Set(entries.map(entry => entry.id));
  const missing = entries.filter(entry => oldById.get(entry.id)?.fingerprint !== entry.fingerprint);
  const stale = previous.entries.filter(entry => !currentIds.has(entry.id));
  const duplicates = previous.entries.length - oldById.size;
  if (missing.length || stale.length || duplicates) {
    console.error(`Inventory differs: ${missing.length} new/changed entries, ${stale.length} removed entries, ${duplicates} duplicate IDs. Review and run --update.`);
    process.exitCode = 1;
  }
  if (process.argv.includes('--require-complete')) {
    const incomplete = previous.entries.filter(entry => {
      const review = entry.review;
      if (!review) return true;
      if (review.status === 'excluded') return !review.reason || !review.evidence?.length;
      return review.status !== 'passed' || !review.caller || !review.roles?.length || !Array.isArray(review.tests) || !review.tests.length || !review.evidence?.length ||
        review.tests.some(test => typeof test !== 'string' || !/\.(spec|cy)\.ts(?:#.*)?$/.test(test) || !fs.existsSync(path.resolve(root, test.split('#')[0]))) ||
        requiredScenarios.some(scenario => !['passed', 'not-applicable'].includes(review.scenarios?.[scenario]?.status) ||
          (review.scenarios[scenario].status === 'not-applicable' && !review.scenarios[scenario].reason) ||
          (review.scenarios[scenario].status === 'passed' && !review.scenarios[scenario].evidence));
    });
    if (incomplete.length) {
      console.error(`${incomplete.length} entries lack complete reviewed evidence; no zoneless approval.`);
      process.exitCode = 1;
    }
  }
  if (process.argv.includes('--require-risk-coverage')) {
    const argument = process.argv.indexOf('--risk-matrix');
    const riskFile = argument >= 0 ? process.argv[argument + 1] : path.join(root, 'docs/qa/zoneless-risk-coverage.json');
    const risk = JSON.parse(fs.readFileSync(riskFile, 'utf8'));
    const areas = ['management', 'jobs', 'coding-replay', 'results-validation', 'files-exports-metadata', 'administration'];
    const mechanisms = ['http', 'progress', 'ordering', 'lifecycle', 'timers-promises', 'browser-libraries', 'roles-persistence'];
    const validTest = test => typeof test === 'string' && /\.(spec|cy)\.ts$/.test(test) && fs.existsSync(path.resolve(root, test));
    const findings = [...new Set(fs.readFileSync(path.join(root, 'docs/qa/zoneless-audit.md'), 'utf8').match(/ZL-\d{3}/g))];
    const coveredFindings = new Set((risk.areas || []).flatMap(area => area.findings || []));
    const invalid = risk.schemaVersion !== 1 || risk.scope !== 'risk-based' ||
      risk.areas?.length !== areas.length || areas.some(id => {
        const matches = risk.areas?.filter(area => area.id === id) || [];
        const area = matches[0];
        return matches.length !== 1 || !area.name || !area.risk || !Array.isArray(area.tests) ||
          !area.tests.length || area.tests.some(test => !validTest(test)) || !Array.isArray(area.findings);
      }) || risk.mechanisms?.length !== mechanisms.length || mechanisms.some(id => {
        const matches = risk.mechanisms?.filter(mechanism => mechanism.id === id) || [];
        const mechanism = matches[0];
        return matches.length !== 1 || !mechanism.evidence || !Array.isArray(mechanism.areas) ||
          !mechanism.areas.length || mechanism.areas.some(area => !areas.includes(area));
      }) || findings.some(id => !coveredFindings.has(id)) ||
      !Array.isArray(risk.unresolvedFindings) || risk.unresolvedFindings.length > 0 ||
      !Array.isArray(risk.residualLimits) || risk.residualLimits.length < 1 ||
      risk.residualLimits.some(limit => typeof limit !== 'string' || !limit.trim());
    if (invalid) {
      console.error('Risk coverage lacks required areas, mechanisms, regression references or residual limits, or has unresolved findings.');
      process.exitCode = 1;
    } else {
      console.log(`Risk coverage references verified: ${areas.length} areas, ${mechanisms.length} mechanisms, ${findings.length} corrected findings. Test execution and CI results are separate requirements.`);
    }
  }
}
console.log(JSON.stringify({ sourceFiles: productionFiles.length, entries: entries.length,
  byKind: entries.reduce((counts, entry) => ({ ...counts, [entry.kind]: (counts[entry.kind] || 0) + 1 }), {}) }));
