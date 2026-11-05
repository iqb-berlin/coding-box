const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const escapeXml = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const duration = value => Number.isFinite(value) ? Math.max(0, value) : 0;

function buildReport(suite, results, metadata = {}) {
  const tests = [];
  const errors = [];
  for (const run of results?.runs || []) {
    const spec = run.spec.relative.replaceAll('\\', '/');
    if (run.error) errors.push({ spec, message: 'Cypress could not execute the spec; see the job log.' });
    if (!run.tests?.length && !run.error) errors.push({ spec, message: 'Spec executed no tests.' });
    for (const test of run.tests || []) {
      const attempts = (test.attempts || []).map(attempt => attempt.state);
      tests.push({ spec, title: test.title, state: test.state,
        durationMs: duration(test.duration), attempts,
        retriedPass: test.state === 'passed' && attempts.includes('failed') });
    }
  }
  if (!results?.runs?.length) errors.push({ spec: suite, message: 'Cypress produced no spec results; see the job log.' });
  const count = state => tests.filter(test => test.state === state).length;
  const summary = {
    tests: tests.length, passed: count('passed'), failed: count('failed'),
    skipped: tests.filter(test => !['passed', 'failed'].includes(test.state)).length,
    errors: errors.length, retriedPasses: tests.filter(test => test.retriedPass).length,
    durationMs: duration(results?.totalDuration),
    failureRate: count('passed') + count('failed') ? count('failed') / (count('passed') + count('failed')) : null
  };
  // Preserve a run-level failure even if Cypress could not attach it to a test.
  if (results?.totalFailed > summary.failed && !errors.length) {
    errors.push({ spec: suite, message: 'Cypress reported additional failures outside the test results.' });
    summary.errors = errors.length;
  }
  return { schemaVersion: 1, suite, ...metadata, generatedAt: new Date().toISOString(),
    browser: results?.browserName || null, summary, tests, errors };
}

function renderJunit(report) {
  const { summary, suite } = report;
  const cases = report.tests.map(test => {
    const attributes = `classname="${escapeXml(`${suite}.${test.spec}`)}" name="${escapeXml(test.title.join(' > '))}" time="${test.durationMs / 1000}"`;
    // Do not copy request bodies, tokens or Cypress console output into reports.
    const outcome = test.state === 'failed' ? '<failure message="Cypress test failed; see the job log and screenshots."/>' :
      test.state !== 'passed' ? '<skipped/>' : '';
    return `<testcase ${attributes}>${outcome}</testcase>`;
  });
  for (const error of report.errors) {
    cases.push(`<testcase classname="${escapeXml(suite)}" name="${escapeXml(`${error.spec}: execution`)}"><error message="Cypress spec or run failed to execute; see the job log."/></testcase>`);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<testsuites><testsuite name="${escapeXml(suite)}" tests="${summary.tests + summary.errors}" failures="${summary.failed}" errors="${summary.errors}" skipped="${summary.skipped}" time="${summary.durationMs / 1000}">\n` +
    cases.join('\n') + '\n</testsuite></testsuites>\n';
}

function clearCypressReports(root, suite) {
  const directory = path.join(root, 'coverage/cypress', suite);
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['results.json', 'junit.xml']) fs.rmSync(path.join(directory, name), { force: true });
}

function registerCypressReporting(on, config, suite, afterRun = async () => {}) {
  const root = config.projectRoot || path.resolve(__dirname, '../..');
  const directory = path.join(root, 'coverage/cypress', suite);
  on('before:run', () => clearCypressReports(root, suite));
  on('after:run', async results => {
    let revision = null;
    let sourceDirty = null;
    try {
      const options = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
      revision = execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
      sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], options).trim());
    } catch { /* Source archives have no Git metadata. */ }
    const report = buildReport(suite, results, { revision, sourceDirty, pipelineId: process.env.CI_PIPELINE_ID || null });
    // Artifacts must survive a failing cleanup as well as a failing test.
    const write = () => {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
      fs.writeFileSync(path.join(directory, 'junit.xml'), renderJunit(report));
    };
    try { write(); } finally {
      try { await afterRun(); } catch (error) {
        report.errors.push({ spec: suite, message: 'Disposable fixture cleanup failed; see the job log.' });
        report.summary.errors += 1;
        write();
        throw error;
      }
    }
  });
}

module.exports = { buildReport, renderJunit, clearCypressReports, registerCypressReporting };
