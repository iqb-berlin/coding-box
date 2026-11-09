import { defineConfig } from 'cypress';
import { registerCypressReporting } from './scripts/qa/cypress-reporting.cjs';
import { createReplayHarness } from './scripts/e2e/replay/harness.mjs';
import { expireAuthSession, setAuthProviderAvailable } from './scripts/e2e/replay/auth-fixture.mjs';

export default defineConfig({
  video: false,
  retries: 0,
  screenshotsFolder: 'cypress/replay-artifacts/screenshots',
  defaultCommandTimeout: 30_000,
  requestTimeout: 30_000,
  responseTimeout: 120_000,
  e2e: {
    baseUrl: process.env.REPLAY_E2E_BASE_URL,
    specPattern: 'cypress/auth/**/*.cy.ts',
    supportFile: 'cypress/support/replay-e2e.ts',
    setupNodeEvents(on, config) {
      const harness = createReplayHarness(process.env);
      on('task', {
        'coding:setup': () => harness.setup(),
        'coding:read-file-settings': () => harness.readFileSettings(),
        'coding:prepare-file-settings': () => harness.prepareFileSettings(),
        'coding:expire-session': () => expireAuthSession(),
        'coding:set-provider-available': (available: boolean) => setAuthProviderAvailable(available),
        'coding:cleanup': () => harness.cleanup()
      });
      registerCypressReporting(on, config, 'auth-live', () => harness.cleanup());
    }
  }
});
