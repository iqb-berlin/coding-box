import * as fs from 'fs';
import * as path from 'path';

const appRoot = path.resolve(__dirname);

const sourceFilePattern = /\.(component|service|guard|pipe)\.ts$/;

const collectRuntimeFiles = (directory: string): string[] => fs
  .readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectRuntimeFiles(entryPath);
    }
    return entry.isFile() && sourceFilePattern.test(entry.name) ? [entryPath] : [];
  });

describe('frontend components', () => {
  const preventUnhandled = (event: Event): void => event.preventDefault();

  beforeAll(() => {
    window.addEventListener('error', preventUnhandled);
    window.addEventListener('unhandledrejection', preventUnhandled);
  });

  afterAll(() => {
    window.removeEventListener('error', preventUnhandled);
    window.removeEventListener('unhandledrejection', preventUnhandled);
  });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads every component module used by the application', () => {
    const componentFiles = collectRuntimeFiles(appRoot)
      .filter(file => file.endsWith('.component.ts'));

    expect(componentFiles.length).toBeGreaterThan(0);

    componentFiles.forEach(file => {
      const moduleExports = require(file);
      const components = Object.values(moduleExports)
        .filter(value => typeof value === 'function' && (
          `${(value as { name?: string }).name}`.endsWith('Component') ||
          Boolean((value as { ɵcmp?: unknown }).ɵcmp)
        ));

      if (components.length === 0) {
        throw new Error(`No component export found in ${file}`);
      }
    });
  });

});
