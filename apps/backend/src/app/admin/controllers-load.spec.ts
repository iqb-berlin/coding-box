import * as fs from 'fs';
import * as path from 'path';

const appRoot = path.resolve(__dirname, '..');

const safeValue: any = new Proxy(jest.fn(() => safeValue), {
  get: (_target, property) => {
    if (property === 'then') {
      return undefined;
    }
    if (property === Symbol.iterator) {
      return function* emptyIterator() {};
    }
    if (property === Symbol.toPrimitive) {
      return () => 1;
    }
    if (property === 'subscribe') {
      return () => ({ unsubscribe: jest.fn() });
    }
    if (property === 'status' || property === 'json' || property === 'send' || property === 'setHeader' ||
      property === 'attachment' || property === 'download' || property === 'end' || property === 'write') {
      return jest.fn(() => safeValue);
    }
    if (property === 'toString') {
      return () => 'value';
    }
    if (property === 'valueOf') {
      return () => 1;
    }
    return safeValue;
  },
  apply: () => safeValue,
  construct: () => safeValue
});

const collectControllerFiles = (directory: string): string[] => fs
  .readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectControllerFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.controller.ts') ? [entryPath] : [];
  });

describe('backend controllers', () => {
  it('loads every controller module used by the application', () => {
    const controllerFiles = collectControllerFiles(appRoot);

    expect(controllerFiles.length).toBeGreaterThan(0);

    controllerFiles.forEach(file => {
      const moduleExports = require(file);
      const controllers = Object.values(moduleExports)
        .filter(value => typeof value === 'function' && `${(value as { name?: string }).name}`.endsWith('Controller'));

      expect(controllers).not.toHaveLength(0);
    });
  });

  it('constructs controller classes with mocked dependencies', () => {
    const controllerFiles = collectControllerFiles(appRoot);
    let constructedControllers = 0;

    for (const file of controllerFiles) {
      const moduleExports = require(file);
      const controllers = Object.values(moduleExports)
        .filter(value => typeof value === 'function' && `${(value as { name?: string }).name}`.endsWith('Controller'));

      for (const ControllerClass of controllers as { prototype: object }[]) {
        const instance = new (ControllerClass as new (...args: unknown[]) => object)(
          safeValue,
          safeValue,
          safeValue,
          safeValue,
          safeValue,
          safeValue,
          safeValue,
          safeValue
        );
        expect(instance).toBeInstanceOf(ControllerClass as new (...args: unknown[]) => object);
        constructedControllers += 1;
      }
    }

    expect(constructedControllers).toBeGreaterThan(0);
  });

});
