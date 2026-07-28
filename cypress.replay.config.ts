import { defineConfig } from 'cypress';
import { createReplayHarness } from './scripts/e2e/replay/harness.mjs';

export default defineConfig({
  video: true,
  videosFolder: 'cypress/replay-artifacts/videos',
  screenshotsFolder: 'cypress/replay-artifacts/screenshots',
  defaultCommandTimeout: 30_000,
  requestTimeout: 30_000,
  responseTimeout: 120_000,
  e2e: {
    baseUrl: process.env.REPLAY_E2E_BASE_URL,
    specPattern: process.env.REPLAY_E2E_EXISTING_SETUP_FILE ?
      'cypress/e2e/replay-live.cy.ts' :
      [
        'cypress/e2e/replay-live.cy.ts',
        'cypress/e2e/item-matrix-live.cy.ts'
      ],
    supportFile: 'cypress/support/replay-e2e.ts',
    setupNodeEvents(on) {
      const harness = createReplayHarness(process.env);
      on('task', {
        'replay:setup': () => harness.setup(),
        'item-matrix:verify': () => harness.verifyItemMatrix(),
        'replay:cleanup': () => harness.cleanup()
      });
      on('after:run', () => harness.cleanup());
    }
  }
});
