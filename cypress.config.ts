import { defineConfig } from 'cypress';

export default defineConfig({
  component: {
    devServer: {
      framework: 'angular',
      bundler: 'webpack',
      options: {
        projectConfig: {
          root: '',
          sourceRoot: 'apps/frontend/src',
          buildOptions: {
            outputPath: 'dist/apps/frontend',
            index: 'apps/frontend/src/index.html',
            main: 'apps/frontend/src/main.ts',
            polyfills: 'apps/frontend/src/polyfills.ts',
            tsConfig: 'apps/frontend/tsconfig.app.json',
            inlineStyleLanguage: 'scss',
            assets: ['apps/frontend/src/assets'],
            styles: [
              './node_modules/@angular/material/prebuilt-themes/purple-green.css',
              'apps/frontend/src/styles.scss'
            ],
            scripts: []
          }
        }
      }
    },
    specPattern: 'cypress/component/**/*.cy.ts',
    supportFile: 'cypress/support/component.ts'
  }
});
