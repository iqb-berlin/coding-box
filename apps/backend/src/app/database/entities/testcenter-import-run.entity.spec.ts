import { DataSource } from 'typeorm';
import Workspace from './workspace.entity';
import { TestcenterImportRun } from './testcenter-import-run.entity';

class MetadataDataSource extends DataSource {
  async prepareMetadata(): Promise<void> {
    await this.buildMetadatas();
  }
}

describe('TestcenterImportRun metadata', () => {
  it('maps scoped run identifiers, JSON progress and workspace cascade deletion without connecting to Postgres', async () => {
    const connection = new MetadataDataSource({
      type: 'postgres', entities: [Workspace, TestcenterImportRun], synchronize: false
    });
    await connection.prepareMetadata();
    const metadata = connection.getMetadata(TestcenterImportRun);
    expect(metadata.tableName).toBe('testcenter_import_run');
    expect(metadata.primaryColumns.map(column => column.databaseName)).toEqual(['workspace_id', 'import_run_id']);
    expect(metadata.findColumnWithPropertyName('import_run_id')).toMatchObject({ type: 'varchar', length: '128' });
    expect(metadata.findColumnWithPropertyName('progress')).toMatchObject({ type: 'jsonb', isNullable: false });
    expect(metadata.foreignKeys).toEqual([expect.objectContaining({ referencedTablePath: 'workspace', onDelete: 'CASCADE' })]);
  });
});
