import { DataSource } from 'typeorm';
import { DatabaseExportService } from './database-export.service';

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
  });
});
