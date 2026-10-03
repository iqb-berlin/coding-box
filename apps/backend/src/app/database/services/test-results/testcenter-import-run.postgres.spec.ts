import { createMock } from '@golevelup/ts-jest';
import { HttpService } from '@nestjs/axios';
import { DataSource } from 'typeorm';
import { TestcenterImportRun } from '../../entities/testcenter-import-run.entity';
import Workspace from '../../entities/workspace.entity';
import { TestcenterService } from './testcenter.service';
import { PersonService } from './person.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { CacheService } from '../../../cache/cache.service';
import { ImportOptionsDto } from '../../../../../../../api-dto/files/import-options.dto';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Testcenter durable import runs Postgres integration', () => {
  let connection: DataSource;
  let workspaceId: number;

  beforeAll(async () => {
    connection = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      entities: [Workspace, TestcenterImportRun],
      synchronize: false
    });
    await connection.initialize();
  }, 30000);

  beforeEach(async () => {
    const workspace = await connection.getRepository(Workspace).save({ name: `import-run-test-${Date.now()}` });
    workspaceId = workspace.id;
  });

  afterEach(async () => {
    if (workspaceId) await connection.getRepository(Workspace).delete(workspaceId);
  });

  afterAll(async () => {
    if (connection?.isInitialized) await connection.destroy();
  });

  it('recovers a completed import across service instances without Redis or another upstream request', async () => {
    const get = jest.fn().mockResolvedValue({ data: [] });
    const cache = createMock<CacheService>({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(false)
    });
    const createService = () => new TestcenterService(
      createMock<PersonService>({ getImportStatistics: jest.fn().mockResolvedValue({ persons: 0, booklets: 0, units: 0 }) }),
      { axiosRef: { get } } as unknown as HttpService,
      createMock<WorkspaceFilesService>(),
      cache,
      createMock<WorkspaceTestResultsService>({ invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) }),
      connection
    );
    const options: ImportOptionsDto = {
      responses: 'true',
      logs: 'false',
      definitions: 'false',
      units: 'false',
      player: 'false',
      codings: 'false',
      booklets: 'false',
      testTakers: 'false',
      metadata: 'false'
    };
    const result = await createService().importWorkspaceFiles(String(workspaceId), 'tc', '1', '', 'token', options, 'g1', true, undefined, 'durable-run');
    const restartedService = createService();
    expect(await restartedService.getImportWorkspaceFilesProgress(String(workspaceId), 'durable-run')).toMatchObject({ status: 'completed', result });
    expect(await restartedService.importWorkspaceFiles(String(workspaceId), 'tc', '1', '', 'token', options, 'g1', true, undefined, 'durable-run')).toEqual(result);
    expect(get).toHaveBeenCalledTimes(1);
  }, 30000);
});
