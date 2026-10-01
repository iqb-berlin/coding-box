import { defineConfig } from 'cypress';
import baseConfig from './cypress.config';

export default defineConfig({
  ...baseConfig,
  retries: 0,
  e2e: {
    ...baseConfig.e2e,
    specPattern: ['cypress/zoneless/**/*.cy.ts', 'cypress/e2e/zoneless-dialogs.cy.ts']
  }
});
