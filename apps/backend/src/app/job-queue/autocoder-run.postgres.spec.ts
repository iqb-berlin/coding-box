import { Job } from 'bull';
import { DataSource, QueryRunner } from 'typeorm';
import { CodingProcessService } from '../database/services/coding/coding-process.service';
import { WorkspaceCodingService } from '../database/services/workspace';
import { AutocoderRunService } from './autocoder-run.service';
import { TestPersonCodingJobData } from './job-queue.service';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ?
  describe :
  describe.skip;

const postgresConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  username: process.env.POSTGRES_USER || 'root',
  password: process.env.POSTGRES_PASSWORD || 'root-password',
  database: process.env.POSTGRES_DB || 'coding-box'
};

describePostgres('AutocoderRunService Postgres integration', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', ...postgresConfig });
    await dataSource.initialize();
  }, 30000);

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(
      'CREATE TEMP TABLE autocoder_atomicity_probe (id int PRIMARY KEY, value text)'
    );
    await queryRunner.query(
      `INSERT INTO autocoder_atomicity_probe (id, value)
       VALUES (1, 'original-1'), (2, 'original-2')`
    );
  });

  afterEach(async () => {
    if (queryRunner?.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    if (queryRunner && !queryRunner.isReleased) {
      await queryRunner.release();
    }
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('rolls back the first batch when the second batch fails', async () => {
    let batch = 0;
    const codingProcessService = {
      beginAutocoderPersistenceSession: jest.fn().mockResolvedValue(queryRunner),
      prepareAutocoderPreflight: jest.fn().mockResolvedValue('files-v1'),
      createAutocoderPreflightContext: jest.fn().mockReturnValue({
        codingSchemeValidations: new Map(),
        fileRevision: 'files-v1'
      }),
      processTestPersonsBatch: jest.fn().mockImplementation(
        async (...args: unknown[]) => {
          batch += 1;
          const options = args[7] as {
            capturePlan: (plan: unknown) => void;
          };
          options.capturePlan({
            workspaceId: 1,
            codedResponses: [],
            statistics: { totalResponses: 1, statusCounts: { CODED: 1 } },
            unitIds: [batch],
            autoCoderRun: 1
          });
          return { totalResponses: 1, statusCounts: { CODED: 1 } };
        }
      ),
      assertAutocoderFileRevision: jest.fn().mockResolvedValue(undefined),
      startAutocoderPersistenceTransaction: jest.fn(
        () => queryRunner.startTransaction('READ COMMITTED')
      ),
      persistAutocoderBatchPlan: jest.fn().mockImplementation(
        async (plan: { unitIds: number[] }) => {
          const id = plan.unitIds[0];
          if (id === 2) throw new Error('second batch failed');
          await queryRunner.query(
            `UPDATE autocoder_atomicity_probe
             SET value = 'changed' WHERE id = $1`,
            [id]
          );
          return true;
        }
      ),
      assertAutocoderFileRevisionForCommit: jest.fn().mockResolvedValue(undefined),
      releaseAutocoderPersistenceSession: jest.fn().mockResolvedValue(undefined)
    };
    const workspaceCodingService = {
      finalizeAutocoderPersistence: jest.fn().mockResolvedValue(undefined)
    };
    const service = new AutocoderRunService(
      codingProcessService as unknown as CodingProcessService,
      workspaceCodingService as unknown as WorkspaceCodingService
    );
    const job = {
      id: 'postgres-rollback',
      data: {
        workspaceId: 1,
        personIds: Array.from({ length: 100 }, (_, index) => String(index + 1)),
        autoCoderRun: 1
      },
      getState: jest.fn().mockResolvedValue('active'),
      progress: jest.fn().mockResolvedValue(undefined),
      queue: {
        getJob: jest.fn().mockResolvedValue({ data: { isPaused: false } })
      }
    } as unknown as Job<TestPersonCodingJobData>;

    await expect(service.run(job)).rejects.toThrow('second batch failed');

    const rows = await queryRunner.query(
      'SELECT id, value FROM autocoder_atomicity_probe ORDER BY id'
    );
    expect(rows).toEqual([
      { id: 1, value: 'original-1' },
      { id: 2, value: 'original-2' }
    ]);
  });
});
