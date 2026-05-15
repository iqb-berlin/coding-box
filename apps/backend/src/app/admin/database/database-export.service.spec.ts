import { DataSource } from 'typeorm';
import { DatabaseExportService } from './database-export.service';

describe('DatabaseExportService', () => {
  it('includes coding_job_unit in workspace-scoped SQLite exports', () => {
    const service = new DatabaseExportService({} as DataSource);
    const tables = (service as unknown as {
      getWorkspaceExportTables: () => Array<{ name: string; query: string }>
    }).getWorkspaceExportTables();

    const codingJobUnitConfig = tables.find(table => table.name === 'coding_job_unit');

    expect(codingJobUnitConfig).toBeDefined();
    expect(codingJobUnitConfig?.query).toContain('coding_job_unit');
    expect(codingJobUnitConfig?.query).toContain('workspace_id = $1');
  });
});
