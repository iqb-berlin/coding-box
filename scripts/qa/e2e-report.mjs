import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkflowCatalog, workflowCoverage } from './e2e-workflows.mjs';

export function summarizeReports(catalog, reports, expectedSuites = []) {
  const suites = [...new Set([...expectedSuites, ...reports.map(report => report.suite)])];
  const tests = reports.flatMap(report => report.tests.map(test => ({ suite: report.suite, ...test })));
  const executed = tests.filter(test => ['passed', 'failed'].includes(test.state)).length;
  const failed = tests.filter(test => test.state === 'failed').length;
  const coverage = workflowCoverage(catalog, reports);
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    missingSuites: suites.filter(suite => !reports.some(report => report.suite === suite)),
    inconsistentSources: new Set(reports.map(report => report.revision)).size > 1 ||
      new Set(reports.map(report => report.pipelineId).filter(Boolean)).size > 1,
    unverifiedRequiredWorkflows: coverage.workflows.filter(workflow => workflow.priority === 'critical' &&
      workflow.mapped && workflow.evidence.every(item => suites.includes(item.suite)) && workflow.status !== 'passed').map(workflow => workflow.id),
    summary: { tests: tests.length, executed, failed,
      skipped: tests.length - executed, errors: reports.reduce((sum, report) => sum + report.summary.errors, 0),
      failureRate: executed ? failed / executed : null,
      retriedPasses: tests.filter(test => test.retriedPass).length,
      durationMs: reports.reduce((sum, report) => sum + report.summary.durationMs, 0) },
    suites: reports.map(report => ({ suite: report.suite, revision: report.revision, sourceDirty: report.sourceDirty,
      pipelineId: report.pipelineId, ...report.summary })),
    slowestTests: [...tests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
    coverage
  };
}

export function renderSummary(report) {
  const { summary, coverage } = report;
  const rate = summary.failureRate === null ? 'n/a' : `${(summary.failureRate * 100).toFixed(1)}%`;
  const lines = ['# Cypress-Ergebnis', '',
    `Testfälle: ${summary.tests}; ausgeführt: ${summary.executed}; fehlgeschlagen: ${summary.failed}; übersprungen: ${summary.skipped}; Ausführungsfehler: ${summary.errors}.`,
    `Fehlerrate unter ausgeführten Tests: ${rate}; Laufzeit der Suiten: ${(summary.durationMs / 1000).toFixed(1)} s; nach Wiederholung bestandene Tests: ${summary.retriedPasses}.`, '',
    `Kritische Workflows: ${coverage.critical.mapped}/${coverage.critical.total} mit Live-Testreferenzen; ${coverage.critical.passed}/${coverage.critical.total} durch die vorliegenden Ergebnisse bestätigt.`,
    `Gesamter Katalog: ${coverage.summary.mapped}/${coverage.summary.total} zugeordnet; ${coverage.summary.passed}/${coverage.summary.total} bestätigt.`, '',
    'Zuordnung ist Planabdeckung. Bestätigung benötigt alle referenzierten Tests; fehlende oder übersprungene Ergebnisse zählen nicht als bestanden.',
    'Eine einzelne Ausführung belegt keine historische Flakiness-Rate. Test-Retries bleiben unverändert.', ''];
  if (report.missingSuites.length) lines.push(`Fehlende Suiten: ${report.missingSuites.join(', ')}`, '');
  if (report.inconsistentSources) lines.push('Die Ergebnisse stammen aus unterschiedlichen Commits oder CI-Pipelines und bilden keinen gemeinsamen Nachweis.', '');
  lines.push('| Workflow | Priorität | Ergebnis |', '|---|---|---|');
  for (const workflow of coverage.workflows) lines.push(`| ${workflow.id}: ${workflow.name} | ${workflow.priority} | ${workflow.status}${workflow.gap ? `: ${workflow.gap}` : ''} |`);
  lines.push('', '## Langsamste Testfälle', '', '| Suite / Datei | Test | Sekunden |', '|---|---|---:|');
  for (const test of report.slowestTests) lines.push(`| ${test.suite} / ${test.spec} | ${test.title.join(' > ').replaceAll('|', '\\|')} | ${(test.durationMs / 1000).toFixed(1)} |`);
  return lines.join('\n') + '\n';
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const directory = path.join(root, 'coverage/cypress');
  const catalog = readWorkflowCatalog(root);
  const planOnly = process.argv.includes('--plan');
  const suites = process.argv.find(argument => argument.startsWith('--suites='))?.slice(9).split(',') || [];
  const reports = !planOnly && fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && (!suites.length || suites.includes(entry.name)))
    .map(entry => path.join(directory, entry.name, 'results.json')).filter(file => fs.existsSync(file))
    .map(file => JSON.parse(fs.readFileSync(file, 'utf8'))) : [];
  const report = summarizeReports(catalog, reports, suites);
  fs.mkdirSync(directory, { recursive: true });
  const name = planOnly ? 'workflow-plan' : 'summary';
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, `${name}.md`), renderSummary(report));
  console.log(renderSummary(report));
  if (!planOnly && (report.missingSuites.length || report.inconsistentSources || report.unverifiedRequiredWorkflows.length ||
    report.summary.failed || report.summary.errors || !report.summary.executed)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
