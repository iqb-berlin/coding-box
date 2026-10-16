import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import User from '../../entities/user.entity';
import Workspace from '../../entities/workspace.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import {
  assertCodingResourceMutation, codingResourceEntities
} from '../shared/coding-ownership.policy';
import { lockWorkspaceTestResultsMutationInTransaction } from '../shared/workspace-test-results-lock.util';
import { CodingJobService } from './coding-job.service';
import { VariableBundleService } from './variable-bundle.service';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Coding ownership with PostgreSQL and competing mutations', () => {
  let db: DataSource;
  let workspaceId: number;
  let owner: User;
  let foreign: User;
  let study: User;
  let admin: User;
  let jobs: CodingJobService;
  const resources = new Map<string, number[]>();

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      entities: [`${__dirname}/../../entities/*.entity.ts`],
      synchronize: false,
      extra: { max: 4, options: '-c statement_timeout=10000' }
    });
    await db.initialize();
    const workspace = await db.getRepository(Workspace).save({ name: `ownership-proof-${Date.now()}` });
    workspaceId = workspace.id;
    const users = db.getRepository(User);
    [owner, foreign, study, admin] = await users.save(Array.from({ length: 4 }, (_, index) => ({
      identity: `ownership-${workspaceId}-${index}`,
      issuer: 'isolated-ownership-test',
      username: `ownership-${workspaceId}-${index}`,
      isAdmin: index === 3
    })));
    await db.getRepository(WorkspaceUser).save([owner, foreign, study].map((user, i) => ({
      workspaceId, userId: user.id, accessLevel: i === 2 ? 3 : 2, canCode: false
    })));
    for (const [kind, entity] of Object.entries(codingResourceEntities)) {
      const ids: number[] = [];
      for (const creatorUserId of [owner.id, foreign.id, null]) {
        const row = await db.manager.save(entity, {
          workspace_id: workspaceId,
          creatorUserId,
          name: 'Ownership proof',
          label: 'Ownership proof',
          variables: [],
          distribution_seed: 'ownership-proof'
        });
        ids.push(row.id);
      }
      resources.set(kind, ids);
    }
    jobs = Object.assign(Object.create(CodingJobService.prototype), {
      connection: db,
      codingJobRepository: db.getRepository(CodingJob),
      cacheService: { incr: async () => 1, delete: async () => undefined },
      logger: { log: () => undefined, error: () => undefined }
    }) as CodingJobService;
  }, 30000);

  afterAll(async () => {
    if (workspaceId) {
      for (const entity of Object.values(codingResourceEntities)) await db.manager.delete(entity, { workspace_id: workspaceId });
      await db.manager.delete(WorkspaceUser, { workspaceId });
      await db.query('DELETE FROM journal_entries WHERE workspace_id=$1', [workspaceId]);
      await db.manager.delete(Workspace, workspaceId);
      await db.manager.delete(User, [owner.id, foreign.id, study.id, admin.id]);
    }
    await db?.destroy();
  });

  it.each(Object.keys(codingResourceEntities))('enforces own, foreign and legacy %s rights with persisted roles', async kind => {
    const [ownId, foreignId, legacyId] = resources.get(kind)!;
    const check = (id: number, userId: number) => db.transaction(manager => assertCodingResourceMutation(
      manager, workspaceId, kind as keyof typeof codingResourceEntities, id, userId
    ));
    await expect(check(ownId, owner.id)).resolves.toMatchObject({ creatorUserId: owner.id });
    for (const id of [foreignId, legacyId]) {
      await expect(check(id, owner.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(check(id, study.id)).resolves.toMatchObject({ id });
      await expect(check(id, admin.id)).resolves.toMatchObject({ id });
    }
  });

  it('sets immutable bundle creators from the actor and persists allowed edits', async () => {
    const service = new VariableBundleService(db.getRepository(VariableBundle));
    const created = await service.createVariableBundle(workspaceId, {
      name: 'Own bundle', variables: [], creatorUserId: foreign.id
    } as never, owner.id);
    expect(created.creatorUserId).toBe(owner.id);
    await service.updateVariableBundle(created.id, workspaceId, {
      name: 'Changed', creatorUserId: foreign.id
    } as never, owner.id);
    expect(await service.getVariableBundle(created.id, workspaceId)).toMatchObject({ name: 'Changed', creatorUserId: owner.id });
  });

  it('rejects mixed bulk deletion atomically and audits privileged legacy deletion', async () => {
    const [ownId, , legacyId] = resources.get('job')!;
    await expect(jobs.deleteCodingJobs(workspaceId, [ownId, legacyId], owner.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await db.getRepository(CodingJob).countBy({ workspace_id: workspaceId })).toBe(3);
    await jobs.deleteCodingJob(legacyId, workspaceId, study.id);
    const events = await db.query('SELECT actor_user_id FROM journal_entries WHERE workspace_id=$1 AND event_type=$2', [workspaceId, 'CODING_JOB_DELETED']);
    expect(events).toEqual([{ actor_user_id: study.id }]);
  });

  it('keeps every deleted job id in the audit after a successful owned bulk deletion', async () => {
    const created = await db.getRepository(CodingJob).save([1, 2].map(index => ({
      workspace_id: workspaceId, creatorUserId: owner.id, name: `Bulk proof ${index}`
    })));
    const ids = created.map(job => job.id);
    await jobs.deleteCodingJobs(workspaceId, ids, owner.id);
    const events = await db.query('SELECT entity_id FROM journal_entries WHERE workspace_id=$1 AND event_type=$2 AND actor_user_id=$3 ORDER BY entity_id::integer', [workspaceId, 'CODING_JOB_DELETED', owner.id]);
    expect(events).toEqual(ids.sort((a, b) => a - b).map(id => ({ entity_id: String(id) })));
    expect(await db.getRepository(CodingJob).countBy({ workspace_id: workspaceId, creatorUserId: owner.id })).toBe(1);
  });

  it('rechecks creation rights after waiting for the workspace mutation lock', async () => {
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await lockWorkspaceTestResultsMutationInTransaction(holder.manager, workspaceId);
    const attempt = jobs.createCodingJob(workspaceId, { name: 'Must not be created' }, owner.id);
    const observed = attempt.then(() => undefined, () => undefined);
    try {
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const [row] = await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS blocked");
        blocked = row.blocked;
        if (!blocked) await new Promise(resolve => { setTimeout(resolve, 20); });
      }
      expect(blocked).toBe(true);
      await holder.manager.update(WorkspaceUser, { workspaceId, userId: owner.id }, { accessLevel: 1 });
      await holder.commitTransaction();
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      expect(await db.getRepository(CodingJob).countBy({ workspace_id: workspaceId, name: 'Must not be created' })).toBe(0);
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
      await observed;
      await db.manager.update(WorkspaceUser, { workspaceId, userId: owner.id }, { accessLevel: 2 });
    }
  });

  it('rechecks a revoked role after waiting for a locked foreign bundle', async () => {
    const id = resources.get('bundle')![1];
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.manager.findOneOrFail(VariableBundle, { where: { id }, lock: { mode: 'pessimistic_write' } });
    const service = new VariableBundleService(db.getRepository(VariableBundle));
    const attempt = service.updateVariableBundle(id, workspaceId, { name: 'Must not persist' }, study.id);
    const observed = attempt.then(() => undefined, () => undefined);
    try {
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const [row] = await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS blocked");
        blocked = row.blocked;
        if (!blocked) await new Promise(resolve => { setTimeout(resolve, 20); });
      }
      expect(blocked).toBe(true);
      await holder.manager.update(WorkspaceUser, { workspaceId, userId: study.id }, { accessLevel: 2 });
      await holder.commitTransaction();
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      expect(await db.getRepository(VariableBundle).findOneByOrFail({ id })).toMatchObject({ name: 'Ownership proof' });
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
      await observed;
      await db.manager.update(WorkspaceUser, { workspaceId, userId: study.id }, { accessLevel: 3 });
    }
  });

  it.each(['review', 'results_applied'])('preserves protected %s state for late pause, resume and restart calls', async status => {
    const id = resources.get('job')![0];
    await db.manager.update(CodingJob, id, { status });
    await expect(jobs.pauseCodingJob(id, workspaceId, owner.id)).resolves.toMatchObject({ status });
    await expect(jobs.resumeCodingJob(id, workspaceId, owner.id)).resolves.toMatchObject({ status });
    await expect(jobs.restartCodingJobWithOpenUnits(id, workspaceId, owner.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(await db.getRepository(CodingJob).findOneByOrFail({ id })).toMatchObject({ status });
  });

  it('applies a completed state inside the callers transaction and preserves it after commit', async () => {
    const id = resources.get('job')![0];
    await db.manager.update(CodingJob, id, { status: 'completed' });
    await db.transaction(async manager => {
      await expect(jobs.markCodingJobResultsApplied(id, workspaceId, manager)).resolves.toMatchObject({ status: 'results_applied' });
      expect(await manager.findOneByOrFail(CodingJob, { id })).toMatchObject({ status: 'results_applied' });
    });
    await expect(jobs.markCodingJobResultsApplied(id, workspaceId)).resolves.toMatchObject({ status: 'results_applied' });
    await expect(jobs.pauseCodingJob(id, workspaceId, owner.id)).resolves.toMatchObject({ status: 'results_applied' });
  });

  it.each(['manager-update', 'late-pause', 'late-progress', 'late-notes'])('rechecks protected state for %s after a competing transaction', async action => {
    const id = resources.get('job')![0];
    await db.manager.update(CodingJob, id, { status: 'active' });
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await lockWorkspaceTestResultsMutationInTransaction(holder.manager, workspaceId);
    await holder.manager.findOneOrFail(CodingJob, { where: { id }, lock: { mode: 'pessimistic_write' } });
    let finished = false;
    const actions: Record<string, () => Promise<CodingJob>> = {
      'late-pause': () => jobs.pauseCodingJob(id, workspaceId, owner.id),
      'late-progress': () => jobs.saveCodingProgress(id, {} as never),
      'late-notes': () => jobs.saveCodingNotes(id, {} as never),
      'manager-update': () => jobs.updateCodingJob(id, workspaceId, { status: 'paused' }, owner.id)
    };
    const attempt = actions[action]();
    const observed = attempt.then(() => { finished = true; }, () => { finished = true; });
    try {
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const [row] = await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS blocked");
        blocked = row.blocked;
        if (!blocked) await new Promise(resolve => { setTimeout(resolve, 20); });
      }
      expect(blocked).toBe(true);
      expect(finished).toBe(false);
      await holder.manager.update(CodingJob, id, { status: 'review' });
      await holder.commitTransaction();
      if (action === 'late-pause') await expect(attempt).resolves.toMatchObject({ status: 'review' });
      else await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      expect(await db.getRepository(CodingJob).findOneByOrFail({ id })).toMatchObject({ status: 'review' });
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
      await observed;
    }
  });
});
