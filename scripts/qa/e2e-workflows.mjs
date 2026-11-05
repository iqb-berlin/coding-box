import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export function readWorkflowCatalog(root, catalogPath = 'docs/qa/e2e-workflows.json') {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, catalogPath), 'utf8'));
  if (catalog.schemaVersion !== 1 || !catalog.scope || !catalog.workflows?.length) throw new Error('Invalid workflow catalog.');
  const ids = new Set();
  for (const workflow of catalog.workflows) {
    if (!/^WF-\d{3}$/.test(workflow.id) || ids.has(workflow.id) || !workflow.name || !workflow.risk ||
        !['critical', 'important'].includes(workflow.priority)) throw new Error(`Invalid or duplicate workflow: ${workflow.id}`);
    ids.add(workflow.id);
    if (!workflow.tests?.length) {
      if (!workflow.gap) throw new Error(`${workflow.id}: missing test references or explicit gap.`);
      continue;
    }
    if (workflow.gap) throw new Error(`${workflow.id}: choose test references or a gap.`);
    for (const reference of workflow.tests) validateReference(root, reference);
  }
  return catalog;
}

function validateReference(root, reference) {
  const { suite, spec, title } = reference;
  const expectedSuite = spec?.startsWith('cypress/auth/') ? 'auth-live' :
    spec?.startsWith('cypress/workflows/') ? 'workflows-live' :
      ['cypress/e2e/replay-live.cy.ts', 'cypress/e2e/item-matrix-live.cy.ts'].includes(spec) ? 'replay-live' : null;
  if (!expectedSuite || suite !== expectedSuite || !title || spec.includes('..')) throw new Error(`Invalid live test reference: ${spec}`);
  const source = fs.readFileSync(path.join(root, spec), 'utf8');
  const ast = ts.createSourceFile(spec, source, ts.ScriptTarget.Latest, true);
  let matches = 0;
  function visit(node, disabled = false) {
    const call = ts.isCallExpression(node) ? node.expression.getText(ast) : '';
    const inactive = disabled || /^(?:describe|context|it|test)\.(?:skip|only)$/.test(call);
    if (['it', 'test'].includes(call) && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === title && !inactive) matches += 1;
    ts.forEachChild(node, child => visit(child, inactive));
  }
  visit(ast);
  if (matches !== 1) throw new Error(`${spec}: expected one active test named "${title}", found ${matches}.`);
}

export function workflowCoverage(catalog, reports = []) {
  const workflows = catalog.workflows.map(workflow => {
    const evidence = (workflow.tests || []).map(reference => {
      const candidates = reports.filter(report => report.suite === reference.suite);
      const report = candidates.length === 1 ? candidates[0] : undefined;
      const matches = report?.tests.filter(test => test.spec === reference.spec && test.title.at(-1) === reference.title) || [];
      const state = matches.length === 1 ? matches[0].state : 'not-run';
      return { ...reference, state, revision: report?.revision || null,
        passed: state === 'passed' && report.summary.errors === 0 };
    });
    const sameSource = new Set(evidence.map(item => item.revision)).size === 1;
    return { id: workflow.id, name: workflow.name, priority: workflow.priority,
      mapped: evidence.length > 0, gap: workflow.gap || null, evidence,
      status: workflow.gap ? 'gap' : sameSource && evidence.every(item => item.passed) ? 'passed' :
        evidence.some(item => item.state === 'failed') ? 'failed' : 'not-verified' };
  });
  const summarize = items => ({ total: items.length, mapped: items.filter(item => item.mapped).length,
    passed: items.filter(item => item.status === 'passed').length,
    gaps: items.filter(item => item.status === 'gap').length });
  return { scope: catalog.scope, summary: summarize(workflows),
    critical: summarize(workflows.filter(item => item.priority === 'critical')), workflows };
}
