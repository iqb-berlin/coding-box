import { DataSource, QueryRunner } from 'typeorm';
import { DatabaseExportService } from './database-export.service';

const mockSqliteRun = jest.fn((...args: unknown[]) => {
  const callback = args[args.length - 1];
  if (typeof callback === 'function') {
    callback(null);
  }
});

const mockSqliteClose = jest.fn((callback?: (error: Error | null) => void) => {
  callback?.(null);
});

jest.mock('sqlite3', () => ({
  Database: jest.fn().mockImplementation(() => ({
    run: mockSqliteRun,
    close: mockSqliteClose
  }))
}));

describe('DatabaseExportService', () => {
  type MockQueryRunner = QueryRunner & {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    query: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };

  const workspaceColumns = [
    { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
    { column_name: 'name', data_type: 'character varying', is_nullable: 'NO' }
  ];

  const codingJobUnitColumns = [
    { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
    { column_name: 'workspace_id', data_type: 'integer', is_nullable: 'YES' }
  ];

  const getWorkspaceExportTables = () => {
    const service = new DatabaseExportService({} as DataSource);
    return (service as unknown as {
      getWorkspaceExportTables: () => Array<{ name: string; query: string }>
    }).getWorkspaceExportTables();
  };

  const createQueryRunner = (): MockQueryRunner => ({
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    isTransactionActive: true,
    isReleased: false
  } as unknown as MockQueryRunner);

  const createWorkspaceExportService = (
    queryRunner: MockQueryRunner
  ): DatabaseExportService => {
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    } as unknown as DataSource;
    const service = new DatabaseExportService(dataSource);

    Object.defineProperty(service, 'getWorkspaceExportTables', {
      value: () => [
        {
          name: 'workspace',
          query: 'SELECT w.* FROM workspace w WHERE w.id = $1'
        },
        {
          name: 'coding_job_unit',
          query: `
            SELECT cju.* FROM coding_job_unit cju
            LEFT JOIN coding_job cj ON cju.coding_job_id = cj.id
            WHERE COALESCE(cju.workspace_id, cj.workspace_id) = $1
          `
        }
      ]
    });

    return service;
  };

  beforeEach(() => {
    mockSqliteRun.mockClear();
    mockSqliteClose.mockClear();
  });

  it('includes coding_job_unit in workspace-scoped SQLite exports', () => {
    const tables = getWorkspaceExportTables();

    const codingJobUnitConfig = tables.find(table => table.name === 'coding_job_unit');

    expect(codingJobUnitConfig).toBeDefined();
    expect(codingJobUnitConfig?.query).toContain('coding_job_unit');
    expect(codingJobUnitConfig?.query).toContain('COALESCE(cju.workspace_id, cj.workspace_id) = $1');
  });

  it('deduplicates bookletinfo rows in workspace-scoped SQLite exports', () => {
    const tables = getWorkspaceExportTables();

    const bookletInfoConfig = tables.find(table => table.name === 'bookletinfo');

    expect(bookletInfoConfig).toBeDefined();
    expect(bookletInfoConfig?.query).toContain('SELECT DISTINCT bi.*');
  });

  it('includes audit, revision and coding context tables in workspace-scoped SQLite exports', () => {
    const tables = getWorkspaceExportTables();
    const tableNames = tables.map(table => table.name);

    expect(tableNames).toEqual(expect.arrayContaining([
      'workspace',
      'logs',
      'journal_entries',
      'replay_statistics',
      'workspace_test_results_revision',
      'job_definitions',
      'coding_job',
      'coding_job_coder',
      'coding_job_variable',
      'coding_job_variable_bundle',
      'coding_unit_freshness',
      'variable_bundle'
    ]));

    const missingsProfileConfig = tables.find(table => table.name === 'missings_profile');
    expect(missingsProfileConfig?.query).toContain('FROM job_definitions jd');
  });

  it('exports workspace tables through a read-only repeatable-read query runner', async () => {
    const queryRunner = createQueryRunner();
    queryRunner.query.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql === 'SET TRANSACTION READ ONLY') {
        return Promise.resolve([]);
      }

      if (sql.includes('information_schema.columns')) {
        return Promise.resolve(params?.[0] === 'workspace' ?
          workspaceColumns :
          codingJobUnitColumns);
      }

      if (sql.includes('table_constraints')) {
        return Promise.resolve([{ column_name: 'id' }]);
      }

      if (sql.includes('COUNT(*)') && sql.includes('FROM workspace w')) {
        return Promise.resolve([{ count: '1' }]);
      }

      if (sql.includes('COUNT(*)') && sql.includes('coding_job_unit')) {
        return Promise.resolve([{ count: '1' }]);
      }

      if (sql.includes('FROM workspace w') && sql.includes('LIMIT')) {
        return Promise.resolve([{ id: 7, name: 'Demo' }]);
      }

      if (sql.includes('coding_job_unit') && sql.includes('LIMIT')) {
        return Promise.resolve([{ id: 11, workspace_id: 7 }]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });
    const progress = jest.fn();
    const service = createWorkspaceExportService(queryRunner);

    await service.exportWorkspaceToSqliteFile(
      '/tmp/kodierbox-workspace-export.sqlite',
      7,
      progress
    );

    expect(queryRunner.connect).toHaveBeenCalled();
    expect(queryRunner.startTransaction).toHaveBeenCalledWith('REPEATABLE READ');
    expect(queryRunner.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(100, 'Export abgeschlossen');

    const sqliteStatements = mockSqliteRun.mock.calls.map(call => call[0]);
    expect(sqliteStatements).toEqual(expect.arrayContaining([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "workspace"'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "coding_job_unit"'),
      expect.stringContaining('INSERT INTO "workspace"'),
      expect.stringContaining('INSERT INTO "coding_job_unit"')
    ]));
  });

  it('rolls back and releases the read-only transaction when workspace export fails', async () => {
    const queryRunner = createQueryRunner();
    queryRunner.query.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql === 'SET TRANSACTION READ ONLY') {
        return Promise.resolve([]);
      }

      if (sql.includes('information_schema.columns')) {
        return Promise.resolve(params?.[0] === 'workspace' ?
          workspaceColumns :
          codingJobUnitColumns);
      }

      if (sql.includes('COUNT(*)')) {
        return Promise.reject(new Error('count failed'));
      }

      throw new Error(`Unexpected query: ${sql}`);
    });
    const service = createWorkspaceExportService(queryRunner);

    await expect(service.exportWorkspaceToSqliteFile(
      '/tmp/kodierbox-workspace-export-failed.sqlite',
      7
    )).rejects.toThrow('count failed');

    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(mockSqliteClose).toHaveBeenCalled();
  });
});
