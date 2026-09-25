import { defineConfig } from 'cypress';
import { createReplayHarness } from './scripts/e2e/replay/harness.mjs';
import { expireAuthSession } from './scripts/e2e/replay/auth-fixture.mjs';

export default defineConfig({
  video: false,
  screenshotsFolder: 'cypress/replay-artifacts/screenshots',
  defaultCommandTimeout: 30_000,
  requestTimeout: 30_000,
  responseTimeout: 120_000,
  e2e: {
    baseUrl: process.env.REPLAY_E2E_BASE_URL,
    specPattern: 'cypress/auth/**/*.cy.ts',
    supportFile: 'cypress/support/replay-e2e.ts',
    setupNodeEvents(on) {
      const harness = createReplayHarness(process.env);
      on('task', {
        'coding:setup': () => harness.setup(),
        'coding:expire-session': () => expireAuthSession(),
        'coding:cleanup': () => harness.cleanup()
      });
      on('after:run', () => harness.cleanup());
    }
  }
});
