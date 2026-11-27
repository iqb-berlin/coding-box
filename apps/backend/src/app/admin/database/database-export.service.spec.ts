import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { DatabaseExportService } from './database-export.service';
import { DatabaseExportCancelledError } from './database-export-cancelled.error';

describe('DatabaseExportService', () => {
  const getWorkspaceExportTables = () => {
    const service = new DatabaseExportService({} as DataSource);
    return (service as unknown as {
      getWorkspaceExportTables: () => Array<{ name: string; query: string }>
    }).getWorkspaceExportTables();
  };

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
    expect(missingsProfileConfig?.query).toContain('mp.workspace_id = $1');
  });

  describe('incomplete exports', () => {
    let directory: string;
    let output: string;
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'database-export-'));
      output = join(directory, 'export.sqlite');
    });
    afterEach(async () => rm(directory, { recursive: true, force: true }));

    it.each(['cancel', 'read failure', 'early end'] as const)('discards the file on %s after writing rows', async failure => {
      let written = false;
      const query = jest.fn(async (sql: string) => {
        if (sql.includes('information_schema.tables')) return [{ table_name: 'logs' }];
        if (sql.includes('information_schema.columns')) {
          return [{ column_name: 'id', data_type: 'integer', is_nullable: 'NO' }];
        }
        if (sql.includes('COUNT(*)')) return [{ count: '2' }];
        if (sql.includes('table_constraints')) return [{ column_name: 'id' }];
        if (sql.startsWith('FETCH')) {
          if (!written) return [{ id: 1 }];
          if (failure === 'read failure') throw new Error('read failed');
          return [];
        }
        return [];
      });
      const transaction = jest.fn((_isolation, copy) => copy({ query }));
      const service = new DatabaseExportService({ transaction } as unknown as DataSource);
      const progress = jest.fn((_percent, message) => {
        if (message === 'Tabelle logs: 1/2') written = true;
      });
      const exportFile = service.exportToSqliteFile(output, progress, () => written && failure === 'cancel');
      const expected = { cancel: DatabaseExportCancelledError, 'read failure': 'read failed', 'early end': 'Incomplete export' };
      await expect(exportFile).rejects.toThrow(expected[failure]);
      expect(written).toBe(true);
      expect(transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
      expect(query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
      expect(progress).not.toHaveBeenCalledWith(100, expect.anything());
      expect(existsSync(output)).toBe(false);
    });
  });
});
