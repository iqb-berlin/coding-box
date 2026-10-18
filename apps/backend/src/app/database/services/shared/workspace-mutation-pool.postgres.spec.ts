import { DataSource, EntityManager } from 'typeorm';
import User from '../../entities/user.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { CoderTrainingService } from '../coding/coder-training.service';
import { CodingJobService } from '../coding/coding-job.service';
import { CodingJobAccessService } from '../coding/coding-job-access.service';
import { UsersService } from '../users/users.service';
import {
  lockWorkspaceTestResultsMutationInTransaction,
  withWorkspaceTestcenterImportLock,
  withWorkspaceTestResultsMutationTransaction
} from './workspace-test-results-lock.util';

jest.mock('../workspace/workspace-files.service', () => ({ WorkspaceFilesService: class {} }));

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Workspace mutation pool admission with PostgreSQL', () => {
  async function fixture(poolMax: number) {
    const schema = `mutation_pool_${process.pid}_${Date.now()}_${poolMax}`;
    const db = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      schema,
      entities: [User, WorkspaceUser],
      synchronize: false,
      extra: { max: poolMax, connectionTimeoutMillis: 1000, options: '-c statement_timeout=5000' }
    });
    await db.initialize();
    // Only these two fixture tables are needed; never synchronize an application database.
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`CREATE TABLE "${schema}"."user" (
      id SERIAL PRIMARY KEY, identity VARCHAR NOT NULL, issuer VARCHAR NOT NULL,
      "isAdmin" BOOLEAN NOT NULL, username VARCHAR NOT NULL)`);
    await db.query(`CREATE TABLE "${schema}"."workspace_user" (
      workspace_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      access_level INTEGER NOT NULL, can_code BOOLEAN NOT NULL,
      PRIMARY KEY (workspace_id, user_id))`);
    const user = await db.getRepository(User).save({
      identity: 'pool-fixture',
      issuer: 'pool-fixture',
      username: 'pool-fixture',
      isAdmin: true
    });
    await db.getRepository(WorkspaceUser).save({
      workspaceId: 1,
      userId: user.id,
      accessLevel: 3,
      canCode: true
    });
    return {
      db,
      user,
      close: async () => {
        try {
          await db.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          await db.destroy();
        }
      }
    };
  }

  it.each([2, 10])('runs contending training requests without exhausting a pool of %i', async poolMax => {
    const f = await fixture(poolMax);
    const { db, user } = f;
    try {
      const users = new UsersService(db.getRepository(User), db.getRepository(WorkspaceUser));
      const access = new CodingJobAccessService({} as never, {} as never, {} as never, users);
      const jobs = new CodingJobService(
        access, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never
      );
      // Model a legacy downstream read that still uses the shared repository.
      const resolveProfile = jest.fn(async () => {
        await db.query('SELECT 1');
        throw new Error('Profile validation rejected the fixture');
      });
      const training = Object.assign(Object.create(CoderTrainingService.prototype), {
        coderTrainingRepository: { manager: db.manager },
        codingJobService: jobs,
        missingsProfilesService: { resolveMissingsProfileId: resolveProfile },
        logger: { log: () => undefined, error: () => undefined }
      }) as CoderTrainingService;
      const transaction = db.manager.transaction.bind(db.manager);
      let active = 0;
      let peak = 0;
      let releaseTransactions: () => void = () => undefined;
      const pending = new Promise<void>(resolve => { releaseTransactions = resolve; });
      let firstStarted: () => void = () => undefined;
      const started = new Promise<void>(resolve => { firstStarted = resolve; });
      db.manager.transaction = (async <T>(callback: (manager: EntityManager) => Promise<T>) => transaction(async manager => {
        active += 1;
        peak = Math.max(peak, active);
        firstStarted();
        try {
          await pending;
          return await callback(manager);
        } finally {
          active -= 1;
        }
      })) as EntityManager['transaction'];
      const requests = Promise.all(Array.from({ length: poolMax }, () => training.createCoderTrainingJobs(
        1,
        [{ id: user.id, name: 'Fixture' }],
        [],
        'Fixture',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        user.id
      )));
      try {
        await started;
        // Let the other requests overlap while the first transaction owns its connection.
        await new Promise(resolve => { setTimeout(resolve, 30); });
      } finally {
        releaseTransactions();
      }
      const results = await requests;
      expect(results.every(result => result.message.endsWith('Profile validation rejected the fixture'))).toBe(true);
      expect(resolveProfile).toHaveBeenCalledTimes(poolMax);
      expect(peak).toBeLessThanOrEqual(poolMax - 1);
      expect(active).toBe(0);
    } finally {
      await f.close();
    }
  }, 15000);

  it.each([2, 10])('keeps imports moving and rolls back failed writes with a pool of %i', async poolMax => {
    const f = await fixture(poolMax);
    const { db, user } = f;
    const transaction = db.manager.transaction.bind(db.manager);
    let entered = 0;
    let waitersStarted: () => void = () => undefined;
    const waiters = new Promise<void>(resolve => { waitersStarted = resolve; });
    db.manager.transaction = (async <T>(callback: (manager: EntityManager) => Promise<T>) => transaction(async manager => {
      entered += 1;
      if (entered === poolMax - 2) waitersStarted();
      return callback(manager);
    })) as EntityManager['transaction'];
    let mutations: PromiseSettledResult<void>[] = [];
    let observeMutations: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);
    let persisted = 0;
    try {
      await withWorkspaceTestcenterImportLock(db, 1, async () => {
        observeMutations = Promise.allSettled(Array.from({ length: poolMax }, (_, index) => (
          withWorkspaceTestResultsMutationTransaction(db, async manager => {
            await lockWorkspaceTestResultsMutationInTransaction(manager, 1);
            await manager.increment(WorkspaceUser, { workspaceId: 1, userId: user.id }, 'accessLevel', 1);
            if (index === 0) throw new Error('audited write failed');
            persisted += 1;
          })
        )));
        if (poolMax > 2) await waiters;
        // This needs the extra connection while the import owns its session lock.
        await expect(db.getRepository(WorkspaceUser).findOneByOrFail({ workspaceId: 1, userId: user.id }))
          .resolves.toMatchObject({ accessLevel: 3 });
        expect(persisted).toBe(0);
      });
      mutations = await observeMutations;
      expect(mutations.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(persisted).toBe(poolMax - 1);
      expect(await db.getRepository(WorkspaceUser).findOneByOrFail({ workspaceId: 1, userId: user.id }))
        .toMatchObject({ accessLevel: 3 + poolMax - 1 });
    } finally {
      await observeMutations;
      await f.close();
    }
  }, 15000);
});
