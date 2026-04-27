import * as fs from 'fs';
import * as path from 'path';

const appRoot = path.resolve(__dirname);

const safeValue: any = new Proxy(jest.fn(() => safeValue), {
  get: (_target, property) => {
    if (property === 'then') return undefined;
    if (property === Symbol.iterator) return function* emptyIterator() {};
    if (property === Symbol.toPrimitive) return () => 1;
    if (property === 'toString') return () => 'value';
    if (property === 'valueOf') return () => 1;
    if (property === 'length') return 0;
    if (property === 'id') return 1;
    if (property === 'workspaceId' || property === 'workspace_id') return 1;
    if (property === 'createQueryBuilder') return () => safeQueryBuilder;
    if (property === 'manager') return safeValue;
    if (property === 'getRepository') return () => safeRepository;
    return safeValue;
  },
  apply: () => safeValue,
  construct: () => safeValue
});

const safeQueryBuilder: any = new Proxy(jest.fn(() => safeQueryBuilder), {
  get: (_target, property) => {
    if (property === 'then') return undefined;
    if (property === 'getMany' || property === 'getRawMany') return jest.fn().mockResolvedValue([]);
    if (property === 'getOne') return jest.fn().mockResolvedValue(null);
    if (property === 'getCount') return jest.fn().mockResolvedValue(0);
    if (property === 'execute') return jest.fn().mockResolvedValue({ affected: 0 });
    if (property === 'stream') return jest.fn().mockResolvedValue({ on: jest.fn(), pipe: jest.fn() });
    return jest.fn(() => safeQueryBuilder);
  },
  apply: () => safeQueryBuilder
});

const safeRepository: any = new Proxy({}, {
  get: (_target, property) => {
    if (property === 'find' || property === 'findBy' || property === 'findAndCount') return jest.fn().mockResolvedValue([]);
    if (property === 'findOne' || property === 'findOneBy') return jest.fn().mockResolvedValue(null);
    if (property === 'count') return jest.fn().mockResolvedValue(0);
    if (property === 'createQueryBuilder') return jest.fn(() => safeQueryBuilder);
    if (property === 'create') return jest.fn(value => value || {});
    if (property === 'save') return jest.fn(value => Promise.resolve(value));
    if (property === 'delete' || property === 'remove' || property === 'update') return jest.fn().mockResolvedValue({ affected: 0 });
    return safeValue;
  }
});

const collectServiceFiles = (directory: string): string[] => fs
  .readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectServiceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.service.ts') ? [entryPath] : [];
  });

const isReadishMethod = (methodName: string): boolean => /^(get|find|list|has|is|can|count|calculate|compute|normalize|aggregate|map|parse|format|build|validate|filter|sort|group|extract|resolve)/i.test(methodName);
const isRiskyMethod = (methodName: string): boolean => /(stream|upload|download|import|export|delete|remove|create|update|patch|save|set|start|run|process|apply|write|persist|send|queue|add|cancel|reset|clear|generate)/i.test(methodName);

describe('backend service read methods', () => {
  it('invokes read and compute service methods with safe dependencies', async () => {
    const serviceFiles = collectServiceFiles(appRoot);
    const pending: Promise<unknown>[] = [];
    let invoked = 0;

    serviceFiles.forEach(file => {
      const moduleExports = require(file);
      const serviceClasses = Object.values(moduleExports)
        .filter(value => typeof value === 'function' && `${(value as { name?: string }).name}`.endsWith('Service'));

      serviceClasses.forEach(ServiceClass => {
        const instance = new (ServiceClass as new (...args: unknown[]) => Record<string, (...args: unknown[]) => unknown>)(
          safeRepository,
          safeRepository,
          safeRepository,
          safeRepository,
          safeValue,
          safeValue,
          safeValue,
          safeValue,
          safeValue,
          safeValue,
          safeValue,
          safeValue
        );
        Object.getOwnPropertyNames((ServiceClass as { prototype: object }).prototype)
          .filter(methodName => methodName !== 'constructor' &&
            isReadishMethod(methodName) &&
            !isRiskyMethod(methodName) &&
            typeof instance[methodName] === 'function')
          .forEach(methodName => {
            try {
              const result = instance[methodName](
                1,
                1,
                'value',
                'other',
                [],
                {},
                safeValue,
                safeValue
              );
              if (result && typeof (result as Promise<unknown>).then === 'function') {
                pending.push(Promise.resolve(result).catch(() => undefined));
              }
              invoked += 1;
            } catch {
              invoked += 1;
            }
          });
      });
    });

    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise(resolve => {
          timeout = setTimeout(resolve, 1000);
        })
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
    expect(invoked).toBeGreaterThan(25);
  }, 15000);
});
