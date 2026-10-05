const fs = require('node:fs');
const path = require('node:path');

// Jest's aggregated results contain assertion failures and errors that prevent a
// suite from starting. Preserve both so GitLab never displays a failed suite as
// an empty or successful report. Do not include console output in the artifact.
const escapeXml = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const seconds = value => (Number.isFinite(value) ? Math.max(0, value) / 1000 : 0);

class JunitReporter {
  constructor(_globalConfig, options = {}) {
    if (!/^[a-z0-9-]+$/.test(options.project || '')) {
      throw new Error('JUnit reporter requires a frontend/backend project name.');
    }
    this.project = options.project;
    this.workspaceRoot = path.resolve(__dirname, '../..');
    this.outputFile = options.outputFile || path.join(
      this.workspaceRoot, 'reports', 'junit', `${this.project}.xml`
    );
    this.error = undefined;
  }

  onRunComplete(_contexts, results) {
    try {
      const suites = results.testResults.map(result => this.renderSuite(result));
      if (results.runExecError) {
        const message = results.runExecError.stack || results.runExecError.message;
        suites.push({
          tests: 1,
          failures: 0,
          errors: 1,
          skipped: 0,
          xml: '<testsuite name="Jest execution" tests="1" failures="0" errors="1" skipped="0">\n' +
            `<testcase classname="${escapeXml(this.project)}" name="Jest execution">` +
            `<error>${escapeXml(message)}</error></testcase>\n</testsuite>`
        });
      }
      const count = key => suites.reduce((total, suite) => total + suite[key], 0);
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        `<testsuites name="${escapeXml(this.project)}" tests="${count('tests')}" ` +
        `failures="${count('failures')}" errors="${count('errors')}" skipped="${count('skipped')}">\n` +
        suites.map(suite => suite.xml).join('\n') + '\n</testsuites>\n';
      fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
      fs.writeFileSync(this.outputFile, xml, 'utf8');
    } catch (error) {
      this.error = error;
    }
  }

  getLastError() {
    return this.error;
  }

  renderSuite(result) {
    const file = path.relative(this.workspaceRoot, result.testFilePath);
    let failures = 0;
    let errors = 0;
    let skipped = 0;
    const testcases = result.testResults.map(test => {
      const classname = [this.project, file, ...(test.ancestorTitles || [])].join('.');
      const attributes = `classname="${escapeXml(classname)}" ` +
        `name="${escapeXml(test.title || test.fullName)}" time="${seconds(test.duration)}"`;
      if (test.status === 'failed') {
        failures += 1;
        const message = test.failureMessages?.join('\n') || 'Test failed without an assertion message.';
        return `<testcase ${attributes}><failure>${escapeXml(message)}</failure></testcase>`;
      }
      if (['pending', 'todo', 'disabled', 'skipped'].includes(test.status)) {
        skipped += 1;
        return `<testcase ${attributes}><skipped/></testcase>`;
      }
      return `<testcase ${attributes}/>`;
    });
    if (result.testExecError) {
      errors += 1;
      const message = result.failureMessage || result.testExecError.stack || result.testExecError.message;
      testcases.push(`<testcase classname="${escapeXml(this.project)}" name="${escapeXml(file)}: suite initialization">` +
        `<error>${escapeXml(message)}</error></testcase>`);
    }
    const runtime = result.perfStats?.runtime ??
      ((result.perfStats?.end || 0) - (result.perfStats?.start || 0));
    return {
      tests: testcases.length,
      failures,
      errors,
      skipped,
      xml: `<testsuite name="${escapeXml(file)}" tests="${testcases.length}" failures="${failures}" ` +
        `errors="${errors}" skipped="${skipped}" time="${seconds(runtime)}">\n` +
        testcases.join('\n') + '\n</testsuite>'
    };
  }
}

module.exports = JunitReporter;
