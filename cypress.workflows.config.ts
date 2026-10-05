import { defineConfig } from 'cypress';
import { createReplayHarness } from './scripts/e2e/replay/harness.mjs';

export default defineConfig({
  video: false,
  retries: 0,
  screenshotsFolder: 'cypress/replay-artifacts/screenshots',
  downloadsFolder: 'cypress/replay-artifacts/downloads',
  defaultCommandTimeout: 30_000,
  requestTimeout: 30_000,
  responseTimeout: 120_000,
  e2e: {
    baseUrl: process.env.REPLAY_E2E_BASE_URL,
    specPattern: 'cypress/workflows/**/*.cy.ts',
    supportFile: 'cypress/support/replay-e2e.ts',
    setupNodeEvents(on) {
      const harness = createReplayHarness(process.env);
      on('task', {
        'workflows:setup': () => harness.setup(),
        'workflows:prepare-imported-coding': () => harness.prepareImportedCoding(),
        'workflows:cleanup': () => harness.cleanup()
      });
      on('after:run', () => harness.cleanup());
    }
  }
});
