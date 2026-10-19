const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const JunitReporter = require('./junit-reporter.cjs');

const fixture = (overrides = {}) => ({
  testFilePath: path.resolve(__dirname, '../../apps/backend/example.spec.ts'),
  perfStats: { start: 1000, end: 2000 },
  testResults: [],
  ...overrides
});

test('reports failures, skipped cases and suite startup errors with valid XML escaping', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-reporter-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outputFile = path.join(directory, 'reports', 'backend.xml');
  const reporter = new JunitReporter({}, { project: 'backend', outputFile });
  reporter.onRunComplete(new Set(), {
    testResults: [fixture({
      testResults: [
        { title: 'passes', status: 'passed', duration: 20, ancestorTitles: ['service'] },
        { title: '<missing "score"> & \'value\'', status: 'failed', duration: 30,
          failureMessages: ['Expected <0> & received null\u0000\u001b'] },
        { title: 'pending', status: 'pending' },
        { title: 'todo', status: 'todo' }
      ]
    }), fixture({
      testFilePath: path.resolve(__dirname, '../../apps/backend/startup.spec.ts'),
      testExecError: { message: 'Cannot import <service>' }
    })]
  });
  const xml = fs.readFileSync(outputFile, 'utf8');
  assert.equal(reporter.getLastError(), undefined);
  assert.match(xml, /<testsuites name="backend" tests="5" failures="1" errors="1" skipped="2">/);
  assert.match(xml, /name="&lt;missing &quot;score&quot;&gt; &amp; &apos;value&apos;" time="0.03"/);
  assert.match(xml, /<failure>Expected &lt;0&gt; &amp; received null<\/failure>/);
  assert.match(xml, /<error>Cannot import &lt;service&gt;<\/error>/);
  assert.match(xml, /name="apps\/backend\/example.spec.ts" tests="4" failures="1" errors="0" skipped="2" time="1"/);
  assert.equal((xml.match(/<skipped\/>/g) || []).length, 2);
});

test('surfaces report write failures to Jest so CI fails instead of losing the report', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-reporter-error-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'file');
  fs.writeFileSync(file, 'cannot use this file as a directory');
  const reporter = new JunitReporter({}, {
    project: 'frontend', outputFile: path.join(file, 'frontend.xml')
  });
  reporter.onRunComplete(new Set(), { testResults: [fixture()] });
  assert.ok(reporter.getLastError() instanceof Error);
});

test('reports a global execution failure even when no suite could start', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-reporter-global-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outputFile = path.join(directory, 'backend.xml');
  const reporter = new JunitReporter({}, { project: 'backend', outputFile });
  reporter.onRunComplete(new Set(), {
    testResults: [],
    runExecError: { message: 'Worker <initialization> failed' }
  });
  const xml = fs.readFileSync(outputFile, 'utf8');
  assert.equal(reporter.getLastError(), undefined);
  assert.match(xml, /<testsuites name="backend" tests="1" failures="0" errors="1" skipped="0">/);
  assert.match(xml, /<testcase classname="backend" name="Jest execution">/);
  assert.match(xml, /<error>Worker &lt;initialization&gt; failed<\/error>/);
});

test('requires a project name and gives failed assertions a diagnostic fallback', () => {
  assert.throws(() => new JunitReporter({}, { project: '../report' }), /project name/);
  const reporter = new JunitReporter({}, { project: 'backend' });
  const suite = reporter.renderSuite(fixture({
    testResults: [{ title: 'failed', status: 'failed', duration: -1 }]
  }));
  assert.equal(suite.failures, 1);
  assert.match(suite.xml, /time="0"/);
  assert.match(suite.xml, /Test failed without an assertion message/);
});
