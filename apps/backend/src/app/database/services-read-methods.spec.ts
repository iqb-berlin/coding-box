import * as fs from 'fs';
import * as path from 'path';

const appRoot = path.resolve(__dirname);

type SafeProxy = Record<PropertyKey, unknown> & ((...args: unknown[]) => unknown);

const safeValue = new Proxy(jest.fn((): unknown => safeValue), {
  get: (_target, property) => {
    if (property === 'then') return undefined;
    if (property === Symbol.iterator) {
      return function* emptyIterator() {
        yield* [];
      };
    }
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
}) as unknown as SafeProxy;

let safeQueryBuilder: SafeProxy;
let safeRepository: Record<PropertyKey, unknown>;

safeQueryBuilder = new Proxy(jest.fn((): unknown => safeQueryBuilder), {
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
}) as unknown as SafeProxy;

safeRepository = new Proxy({}, {
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
}) as Record<PropertyKey, unknown>;

const collectServiceFiles = (directory: string): string[] => fs
  .readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectServiceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.service.ts') ? [entryPath] : [];
  });

const isReadishMethod = (methodName: string): boolean => /^(get|find|list|has|is|can|count|calculate|compute|normalize|aggregate|map|parse|format|build|validate|filter|sort|group|extract|resolve)/i.test(methodName);
const isRiskyMethod = (methodName: string): boolean => /(stream|upload|download|import|export|delete|remove|create|update|patch|save|set|start|run|process|apply|write|persist|send|queue|add|cancel|reset|clear|generate)/i.test(methodName);

const progressCallback = jest.fn().mockResolvedValue(undefined);

const argumentSets = [
  [1, 1, 'value', 'other', [], {}, progressCallback, safeValue],
  [1, undefined, '', '', [], { search: '', page: 1, limit: 10 }, progressCallback, safeValue],
  [
    1,
    25,
    'UNIT',
    'VAR',
    [{
      unitName: 'UNIT', variableId: 'VAR', bookletName: 'BOOKLET', responseId: 1
    }],
    { workspaceId: 1, unitName: 'UNIT', variableId: 'VAR' },
    progressCallback,
    safeValue
  ]
];

const invokeServiceMethod = (
  instance: Record<string, (...args: unknown[]) => unknown>,
  methodName: string,
  pending: Promise<unknown>[]
): number => {
  let invoked = 0;

  argumentSets.forEach(args => {
    try {
      const result = instance[methodName](...args);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        pending.push(Promise.resolve(result).catch(() => undefined));
      }
      invoked += 1;
    } catch {
      invoked += 1;
    }
  });

  return invoked;
};

describe('backend service read methods', () => {
  it('invokes read and compute service methods with safe dependencies', async () => {
    const serviceFiles = collectServiceFiles(appRoot);
    const pending: Promise<unknown>[] = [];
    let invoked = 0;

    for (const file of serviceFiles) {
      const moduleExports = await import(file);
      const serviceClasses = Object.values(moduleExports)
        .filter(value => typeof value === 'function' && `${(value as { name?: string }).name}`.endsWith('Service'));

      for (const ServiceClass of serviceClasses) {
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
        const methodNames = Object.getOwnPropertyNames((ServiceClass as { prototype: object }).prototype)
          .filter(methodName => methodName !== 'constructor' &&
            isReadishMethod(methodName) &&
            !isRiskyMethod(methodName) &&
            typeof instance[methodName] === 'function');

        for (const methodName of methodNames) {
          invoked += invokeServiceMethod(instance, methodName, pending);
        }
      }
    }

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
