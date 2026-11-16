import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Read-only preparation for the separate TypeORM 1.x migration; no source rewriting.
const findings = [];
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (file.endsWith('.ts')) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const add = (node, kind) => findings.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind });
      function visit(node) {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'typeorm') {
          for (const name of node.importClause?.namedBindings?.elements || []) {
            if (['Connection', 'ConnectionOptions', 'AbstractRepository', 'WhereExpression'].includes(name.name.text)) add(name, 'removed-import');
          }
        }
        if (ts.isPropertyAssignment(node)) {
          const name = node.name.getText(source);
          if (['select', 'relations'].includes(name) && ts.isArrayLiteralExpression(node.initializer)) add(node, 'find-array-syntax');
          if (name === 'type' && ts.isStringLiteral(node.initializer) && node.initializer.text === 'sqlite') add(node, 'removed-sqlite-driver');
        }
        if (ts.isPropertyAccessExpression(node) && ['onConflict', 'findByIds', 'findOneById', 'exist'].includes(node.name.text)) add(node, 'removed-method');
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
scan('apps/backend');
const report = `${JSON.stringify({
  installed: JSON.parse(fs.readFileSync('node_modules/typeorm/package.json')).version,
  reference: 'https://typeorm.io/docs/releases/1.0/upgrading-from-0.3/',
  findings
}, null, 2)}\n`;
const reportFile = process.argv.find(argument => argument.startsWith('--reportFile='))?.slice('--reportFile='.length);
if (reportFile) fs.writeFileSync(reportFile, report);
else process.stdout.write(report);
