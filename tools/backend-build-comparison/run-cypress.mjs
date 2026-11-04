import { writeFile } from 'node:fs/promises';
import cypress from 'cypress';

const result = await cypress.run({
  configFile: 'cypress.workflows.config.ts', browser: 'electron',
  spec: 'cypress/workflows/**/*.cy.ts',
  config: { screenshotsFolder: `${process.env.BUILD_COMPARISON_PROOF}/screenshots`,
    downloadsFolder: `${process.env.BUILD_COMPARISON_PROOF}/downloads` }
});
const failed = result.status === 'failed' || result.totalFailed !== 0 || !result.totalTests ||
  result.totalPending || result.totalSkipped || result.totalPassed !== result.totalTests || !result.runs?.length;
const summary = {
  status: failed ? 'failed' : 'finished', totalTests: result.totalTests, totalPassed: result.totalPassed,
  totalFailed: result.totalFailed, totalPending: result.totalPending, totalSkipped: result.totalSkipped,
  totalDuration: result.totalDuration,
  runs: result.runs?.map(run => ({ spec: run.spec.relative, stats: run.stats,
    tests: run.tests.map(test => ({ title: test.title, state: test.state,
      errors: test.attempts.map(attempt => attempt.error?.message).filter(Boolean) })) }))
};
await writeFile(`${process.env.BUILD_COMPARISON_PROOF}/cypress-results.json`, JSON.stringify(summary, null, 2));
if (failed) {
  process.exitCode = 1;
}
