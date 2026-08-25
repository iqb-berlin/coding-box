import { ConflictException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import {
  lockWorkspaceTestResultsMutation,
  lockWorkspaceTestResultsMutationInTransaction,
  unlockWorkspaceTestResultsMutation
} from '../shared/workspace-test-results-lock.util';
import {
  lockWorkspaceFilesMutation,
  unlockWorkspaceFilesMutation
} from '../shared/workspace-files-lock.util';
import FileUpload from '../../entities/file_upload.entity';
import Workspace from '../../entities/workspace.entity';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';

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

describePostgres('Autocoder PostgreSQL locking', () => {
  let dataSource: DataSource;
  const runners: QueryRunner[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      ...postgresConfig,
      entities: [Workspace, FileUpload],
      extra: { max: 2 }
    });
    await dataSource.initialize();
  }, 30000);

  afterEach(async () => {
    while (runners.length > 0) {
      const runner = runners.pop();
      if (runner && !runner.isReleased) {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();
        }
        await runner.release();
      }
    }
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  const createRunner = async (): Promise<QueryRunner> => {
    const runner = dataSource.createQueryRunner();
    runners.push(runner);
    await runner.connect();
    await runner.query("SET lock_timeout = '2s'");
    return runner;
  };

  it('lets the lock holder continue while the constrained pool is full of a lock waiter', async () => {
    const workspaceId = 1_900_000_001;
    const holder = await createRunner();
    const waiter = await createRunner();
    await lockWorkspaceTestResultsMutation(holder, workspaceId);

    const waiterLock = lockWorkspaceTestResultsMutation(waiter, workspaceId);
    await new Promise(resolve => {
      setTimeout(resolve, 50);
    });

    await expect(holder.query('SELECT 1 AS continued')).resolves.toEqual([
      { continued: 1 }
    ]);

    await unlockWorkspaceTestResultsMutation(holder, workspaceId);
    await expect(waiterLock).resolves.toBeUndefined();
    await unlockWorkspaceTestResultsMutation(waiter, workspaceId);
  });

  it('serializes a manager transaction behind an active Autocoder session', async () => {
    const workspaceId = 1_900_000_002;
    const autocoder = await createRunner();
    const manager = await createRunner();
    await lockWorkspaceTestResultsMutation(autocoder, workspaceId);
    await manager.startTransaction('READ COMMITTED');

    let managerEntered = false;
    const managerMutation = (async () => {
      await lockWorkspaceTestResultsMutationInTransaction(
        manager.manager,
        workspaceId
      );
      managerEntered = true;
    })();
    await new Promise(resolve => {
      setTimeout(resolve, 50);
    });
    expect(managerEntered).toBe(false);

    await unlockWorkspaceTestResultsMutation(autocoder, workspaceId);
    await managerMutation;
    expect(managerEntered).toBe(true);
    await manager.commitTransaction();
  });

  it('lets a locked manager execute a real service repository read while the pool is full', async () => {
    const workspaceId = 1_900_000_003;
    const manager = await createRunner();
    const waiter = await createRunner();
    await manager.startTransaction('READ COMMITTED');
    await lockWorkspaceTestResultsMutationInTransaction(
      manager.manager,
      workspaceId
    );

    const waiterLock = lockWorkspaceTestResultsMutation(waiter, workspaceId);
    await new Promise(resolve => {
      setTimeout(resolve, 50);
    });

    const workspaceCoreService = { findOne: jest.fn() };
    const exclusionService = new WorkspaceExclusionService(
      workspaceCoreService as never,
      dataSource.getRepository(FileUpload),
      {} as never
    );
    await expect(exclusionService.resolveExclusionsForQueries(
      workspaceId,
      manager.manager
    )).resolves.toEqual({
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    });
    expect(workspaceCoreService.findOne).not.toHaveBeenCalled();

    await manager.commitTransaction();
    await expect(waiterLock).resolves.toBeUndefined();
    await unlockWorkspaceTestResultsMutation(waiter, workspaceId);
  });

  it('fails input mutations fast behind an active Autocoder lock', async () => {
    const [insertedWorkspace] = await dataSource.query(
      `INSERT INTO workspace (name, settings)
       VALUES ($1, $2::jsonb)
       RETURNING id`,
      [`Autocoder lock integration test ${Date.now()}`, '{}']
    ) as Array<{ id: number }>;
    const workspaceId = Number(insertedWorkspace.id);
    let autocoder: QueryRunner | undefined;
    let filesLocked = false;
    let testResultsLocked = false;

    try {
      autocoder = await createRunner();
      await lockWorkspaceTestResultsMutation(autocoder, workspaceId);
      testResultsLocked = true;
      await lockWorkspaceFilesMutation(autocoder, workspaceId);
      filesLocked = true;

      const cacheService = {
        delete: jest.fn().mockResolvedValue(undefined),
        deleteByPattern: jest.fn().mockResolvedValue(undefined),
        incr: jest.fn().mockResolvedValue(1)
      };
      const workspaceTestResultsService = {
        invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined)
      };
      const workspaceCoreService = new WorkspaceCoreService(
        dataSource.getRepository(Workspace),
        dataSource,
        cacheService as never,
        workspaceTestResultsService as never
      );

      await expect(workspaceCoreService.setIgnoredUnits(
        workspaceId,
        ['UNIT-NEWLY-IGNORED']
      )).rejects.toBeInstanceOf(ConflictException);
      await expect(workspaceCoreService.remove([workspaceId]))
        .rejects.toBeInstanceOf(ConflictException);

      const unchangedWorkspace = await dataSource
        .getRepository(Workspace)
        .findOneByOrFail({ id: workspaceId });
      expect(unchangedWorkspace.settings).toEqual({});

      await unlockWorkspaceFilesMutation(autocoder, workspaceId);
      filesLocked = false;
      await workspaceCoreService.setIgnoredUnits(
        workspaceId,
        ['UNIT-NEWLY-IGNORED']
      );

      const workspace = await dataSource.getRepository(Workspace).findOneByOrFail({
        id: workspaceId
      });
      expect(workspace.settings).toMatchObject({
        ignoredUnits: ['UNIT-NEWLY-IGNORED']
      });
    } finally {
      try {
        if (autocoder && filesLocked) {
          await unlockWorkspaceFilesMutation(autocoder, workspaceId);
        }
      } finally {
        try {
          if (autocoder && testResultsLocked) {
            await unlockWorkspaceTestResultsMutation(autocoder, workspaceId);
          }
        } finally {
          await dataSource.getRepository(Workspace).delete({ id: workspaceId });
        }
      }
    }
  });
});
