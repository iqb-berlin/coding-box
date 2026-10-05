import * as fs from 'fs';
import * as path from 'path';

const appRoot = path.resolve(__dirname, '..');

const collectControllerFiles = (directory: string): string[] => fs
  .readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectControllerFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.controller.ts') ? [entryPath] : [];
  });

describe('backend controller imports', () => {
  it('loads every controller module used by the application', async () => {
    const controllerFiles = collectControllerFiles(appRoot);

    expect(controllerFiles.length).toBeGreaterThan(0);

    for (const file of controllerFiles) {
      const moduleExports = await import(file);
      const controllers = Object.values(moduleExports)
        .filter(value => typeof value === 'function' && `${(value as { name?: string }).name}`.endsWith('Controller'));

      expect(controllers).not.toHaveLength(0);
    }
  });
});
