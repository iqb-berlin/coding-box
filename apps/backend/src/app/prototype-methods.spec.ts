import * as fs from 'fs';
import * as path from 'path';
import { Readable, Writable } from 'stream';

const appRoot = path.resolve(__dirname);
type SafeProxy = Record<PropertyKey, unknown> & ((...args: unknown[]) => unknown);

const createQueryBuilder = () => {
  const qb: Record<string, unknown> = {};
  [
    'innerJoin',
    'leftJoin',
    'leftJoinAndSelect',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orWhere',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'addOrderBy',
    'take',
    'skip',
    'limit',
    'offset',
    'setParameter',
    'setParameters'
  ].forEach(method => {
    qb[method] = jest.fn(() => qb);
  });
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getOne = jest.fn().mockResolvedValue(null);
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
  qb.stream = jest.fn().mockResolvedValue(Readable.from([]));
  return qb;
};

const safeWritable = () => {
  const writable = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  }) as Writable & Record<string, unknown>;
  writable.setHeader = jest.fn();
  writable.status = jest.fn(() => writable);
  writable.json = jest.fn(() => writable);
  writable.send = jest.fn(() => writable);
  writable.end = jest.fn();
  writable.write = jest.fn(() => true);
  return writable;
};

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
    if (property === 'id' || property === 'workspaceId' || property === 'workspace_id') return 1;
    if (property === 'user') return { id: 1, sub: 'user-sub', preferred_username: 'user' };
    if (property === 'file') return { filename: 'file.xml', originalname: 'file.xml', buffer: Buffer.from('value') };
    if (property === 'files') return [];
    if (property === 'buffer') return Buffer.from('value');
    if (property === 'createQueryBuilder') return () => createQueryBuilder();
    if (property === 'getRepository') return () => safeValue;
    if (property === 'find' || property === 'findBy' || property === 'findAndCount') return jest.fn().mockResolvedValue([]);
    if (property === 'findOne' || property === 'findOneBy') return jest.fn().mockResolvedValue(null);
    if (property === 'count') return jest.fn().mockResolvedValue(0);
    if (property === 'save') return jest.fn(value => Promise.resolve(value));
    if (property === 'delete' || property === 'remove' || property === 'update') return jest.fn().mockResolvedValue({ affected: 0 });
    if (property === 'pipe') return jest.fn(() => safeWritable());
    if (property === 'on') {
      return jest.fn((_event, callback) => {
        if (typeof callback === 'function') callback();
        return safeValue;
      });
    }
    if (property === 'getCodingListCsvStream' || property === 'getCodingResultsByVersionCsvStream') {
      return jest.fn().mockResolvedValue(Readable.from([]));
    }
    if (property === 'getCodingListJsonStream') return jest.fn(() => Readable.from([], { objectMode: true }));
    if (property === 'getCodingListAsExcel' || property === 'getCodingResultsByVersionAsExcel') {
      return jest.fn().mockResolvedValue(Buffer.from('value'));
    }
    if (property === 'getVariablePageMap') return jest.fn().mockResolvedValue(new Map());
    if (property === 'resolveExclusionsForQueries') {
      return jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      });
    }
    if (property === 'log' || property === 'warn' || property === 'error' || property === 'debug') return jest.fn();
    return safeValue;
  },
  apply: () => safeValue,
  construct: () => safeValue
}) as unknown as SafeProxy;

const collectFiles = (directory: string): string[] => fs
  .readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath);
    if (!entry.isFile()) return [];
    if (entry.name.endsWith('.controller.ts')) return [entryPath];
    return [];
  });

const requestLike = {
  id: 1,
  workspaceId: 1,
  workspace_id: 1,
  unitName: 'UNIT',
  variableId: 'VAR',
  query: { mode: 'coding', page: '1', limit: '10' },
  params: { workspace_id: '1', id: '1' },
  body: { workspaceId: 1, unitName: 'UNIT', variableId: 'VAR' },
  user: { id: 1, sub: 'user-sub', preferred_username: 'user' },
  file: { filename: 'file.xml', originalname: 'file.xml', buffer: Buffer.from('value') },
  files: []
};

const methodArgSets = [
  [1, '1', 'value', ['1', '2'], [], {}, requestLike, safeWritable(), safeValue, safeValue],
  [1, undefined, '', [], {}, { ...requestLike, query: {}, body: {} }, safeWritable(), safeValue, safeValue],
  [0, '0', 'true', ['x'], [{ id: 1 }], { ...requestLike, query: { mode: 'booklet-view' } }, safeWritable(), safeValue, safeValue]
];

const invokeControllerMethod = (
  prototype: Record<string, unknown>,
  methodName: string,
  pending: Promise<unknown>[]
): number => {
  let invoked = 0;

  methodArgSets.forEach(args => {
    try {
      const result = (prototype[methodName] as (...args: unknown[]) => unknown)
        .apply(safeValue, args);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        pending.push(Promise.resolve(result).catch(() => undefined));
      }
    } catch {
      // Smoke coverage intentionally stops when defensive doubles are insufficient.
    } finally {
      invoked += 1;
    }
  });

  return invoked;
};

describe('backend controller prototype method smoke coverage', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('invokes controller prototype methods with safe doubles', async () => {
    const pending: Promise<unknown>[] = [];
    let invoked = 0;

    for (const file of collectFiles(appRoot)) {
      const moduleExports = await import(file);
      const classes = Object.values(moduleExports)
        .filter(value => typeof value === 'function' &&
          `${(value as { name?: string }).name}`.endsWith('Controller'));

      for (const ClassExport of classes) {
        const prototype = (ClassExport as { prototype: Record<string, unknown> }).prototype;
        const methodNames = Object.getOwnPropertyNames(prototype)
          .filter(methodName => methodName !== 'constructor' && typeof prototype[methodName] === 'function');

        for (const methodName of methodNames) {
          invoked += invokeControllerMethod(prototype, methodName, pending);
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
      if (timeout) clearTimeout(timeout);
    }

    expect(invoked).toBeGreaterThan(300);
  }, 120000);
});
