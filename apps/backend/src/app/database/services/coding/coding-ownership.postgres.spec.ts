import {
  ForbiddenException, BadRequestException, ConflictException, NotFoundException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import User from '../../entities/user.entity';
import Workspace from '../../entities/workspace.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { MissingsProfile } from '../../entities/missings-profile.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { MissingsProfilesService } from './missings-profiles.service';
import {
  assertCodingResourceMutation, codingResourceEntities
} from '../shared/coding-ownership.policy';
import {
  lockWorkspaceTestResultsMutationInTransaction, tryWithWorkspaceTestResultsMutationTransaction, withWorkspaceTestResultsMutationLock
} from '../shared/workspace-test-results-lock.util';
import { CodingJobService } from './coding-job.service';
import { CodingJobMutationService } from './coding-job-mutation.service';
import { CodingJobAccessService } from './coding-job-access.service';
import { CodingJobStatusService } from './coding-job-status.service';
import { CodingJobProgressService } from './coding-job-progress.service';
import { VariableBundleService } from './variable-bundle.service';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { UsersService } from '../users/users.service';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Coding ownership with PostgreSQL and competing mutations', () => {
  let db: DataSource;
  let workspaceId: number;
  let owner: User;
  let foreign: User;
  let study: User;
  let admin: User;
  let jobs: CodingJobService;
  let profiles: MissingsProfilesService;
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
      workspaceId, userId: user.id, accessLevel: i === 2 ? 3 : 2, canCode: i === 0
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
    await db.manager.save(CodingJobCoder, { coding_job_id: resources.get('job')![0], user_id: owner.id });
    const dependencies = {
      connection: db,
      usersService: new UsersService(users, db.getRepository(WorkspaceUser)),
      codingJobRepository: db.getRepository(CodingJob),
      codingJobCoderRepository: db.getRepository(CodingJobCoder),
      cacheService: { incr: async () => 1, delete: async () => undefined },
      logger: { log: () => undefined, error: () => undefined }
    };
    const access = Object.assign(Object.create(CodingJobAccessService.prototype), dependencies) as CodingJobAccessService;
    profiles = new MissingsProfilesService(
      db.getRepository(MissingsProfile),
      db.getRepository(CodingJob),
      db.getRepository(JobDefinition),
      dependencies.cacheService as never
    );
    const mutation = Object.assign(Object.create(CodingJobMutationService.prototype), dependencies, {
      access,
      missingsProfilesService: profiles,
      aggregation: {
        getCurrentAggregationSettingsSnapshot: async () => ({
          aggregationEnabled: false, aggregationThreshold: null
        })
      },
      responses: { getSlimResponsesForCodingJob: async () => [] }
    }) as CodingJobMutationService;
    const status = new CodingJobStatusService(access, mutation, {} as never, db);
    const progress = Object.assign(Object.create(CodingJobProgressService.prototype), dependencies, { access, mutation }) as CodingJobProgressService;
    jobs = new CodingJobService(
      access, {} as never, {} as never, mutation, progress, {} as never, {} as never, {} as never, {} as never, status
    );
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

  it('scopes reads and writes to the requested workspace and the persisted role', async () => {
    const other = await db.manager.save(Workspace, { name: 'Other ownership workspace' });
    const bundles = new VariableBundleService(db.getRepository(VariableBundle));
    try {
      await db.manager.save(WorkspaceUser, { workspaceId: other.id, userId: foreign.id, accessLevel: 2 });
      const bundle = await bundles.createVariableBundle(other.id, { name: 'Other bundle', variables: [] }, foreign.id);
      const job = await db.manager.save(CodingJob, { workspace_id: other.id, name: 'Other job', creatorUserId: foreign.id });

      await expect(jobs.assertUserCanAccessCodingJob(job.id, other.id, foreign.id)).resolves.toBeUndefined();
      await expect(jobs.assertUserCanAccessCodingJob(job.id, other.id, owner.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(jobs.assertUserCanAccessCodingJob(job.id, workspaceId, foreign.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(bundles.getVariableBundles(other.id)).resolves.toMatchObject({ total: 1, data: [{ id: bundle.id }] });
      await expect(bundles.getVariableBundle(bundle.id, workspaceId)).rejects.toBeInstanceOf(NotFoundException);

      await expect(bundles.updateVariableBundle(bundle.id, other.id, { name: 'Allowed edit' }, foreign.id))
        .resolves.toMatchObject({ id: bundle.id, name: 'Allowed edit' });
      await expect(bundles.updateVariableBundle(bundle.id, workspaceId, { name: 'Wrong workspace' }, foreign.id))
        .rejects.toBeInstanceOf(NotFoundException);
      await expect(bundles.updateVariableBundle(bundle.id, other.id, { name: 'Wrong role' }, owner.id))
        .rejects.toBeInstanceOf(ForbiddenException);
      await expect(db.manager.findOneByOrFail(VariableBundle, { id: bundle.id }))
        .resolves.toMatchObject({ workspace_id: other.id, name: 'Allowed edit', creatorUserId: foreign.id });
    } finally {
      await db.manager.delete(CodingJob, { workspace_id: other.id });
      await db.manager.delete(VariableBundle, { workspace_id: other.id });
      await db.manager.delete(WorkspaceUser, { workspaceId: other.id });
      await db.manager.delete(Workspace, other.id);
    }
  });

  it.each([null, undefined])('rejects a missing workspace filter (%s) on reads and edits', async missing => {
    const bundles = new VariableBundleService(db.getRepository(VariableBundle));
    const [id] = resources.get('bundle')!;
    const invalidWorkspace = missing as unknown as number;
    const filterError = /value encountered in property '([^']*\.)?workspace_id' of a where condition/i;

    await expect(bundles.getVariableBundles(invalidWorkspace)).rejects.toThrow(filterError);
    await expect(bundles.updateVariableBundle(id, invalidWorkspace, { name: 'Missing workspace' }, owner.id))
      .rejects.toThrow(filterError);
    await expect(bundles.getVariableBundle(id, workspaceId)).resolves.toMatchObject({ name: 'Ownership proof' });
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

  it('commits a job when another transaction creates its default missings profile first', async () => {
    const workspace = await db.manager.save(Workspace, { name: 'Concurrent profile initialization' });
    const holder = db.createQueryRunner();
    await holder.connect();
    let observed: Promise<unknown> | undefined;
    try {
      await holder.startTransaction();
      const profile = await profiles.ensureDefaultMissingsProfile(workspace.id, holder.manager);
      const [{ pid }] = await holder.query('SELECT pg_backend_pid() AS pid');
      const creation = jobs.createCodingJob(workspace.id, { name: 'First job' }, admin.id);
      // Observe failures even if the creation fails before reaching the insert.
      observed = creation.catch(() => undefined);

      const deadline = Date.now() + 5000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const [row] = await db.query(`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked
        `, [pid]);
        blocked = row.blocked;
        if (!blocked) await new Promise(resolve => { setTimeout(resolve, 20); });
      }
      expect(blocked).toBe(true);
      await holder.commitTransaction();

      const job = await creation;
      expect(await db.manager.findOneByOrFail(CodingJob, { id: job.id })).toMatchObject({
        workspace_id: workspace.id, missings_profile_id: profile.id
      });
      expect(await db.manager.countBy(MissingsProfile, { workspace_id: workspace.id })).toBe(1);
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
      await observed;
      await db.manager.delete(Workspace, workspace.id);
    }
  }, 15000);

  it('rejects a busy create without writing, then recovers a committed retry under the same lock', async () => {
    const request = { name: 'Retry-safe creation', creationRequestId: randomUUID() };
    const holder = db.createQueryRunner();
    await holder.connect();
    try {
      await holder.startTransaction();
      await lockWorkspaceTestResultsMutationInTransaction(holder.manager, workspaceId);
      const attempt = jobs.createCodingJob(workspaceId, request, owner.id);
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      const repository = db.getRepository(CodingJob);
      const key = { workspace_id: workspaceId, creationRequestId: request.creationRequestId };
      expect(await repository.countBy(key)).toBe(0);
      await holder.commitTransaction();

      const attempts = await Promise.allSettled([jobs.createCodingJob(workspaceId, request, owner.id),
        jobs.createCodingJob(workspaceId, request, owner.id)]);
      const saved = await repository.findOneByOrFail(key);
      expect(attempts.filter(result => result.status === 'fulfilled').length).toBeGreaterThan(0);
      for (const result of attempts) {
        if (result.status === 'fulfilled') expect(result.value.id).toBe(saved.id);
        else expect(result.reason).toBeInstanceOf(ConflictException);
      }

      await holder.startTransaction();
      await lockWorkspaceTestResultsMutationInTransaction(holder.manager, workspaceId);
      await expect(jobs.createCodingJob(workspaceId, request, owner.id)).resolves.toMatchObject({ id: saved.id });
      expect(await repository.countBy(key)).toBe(1);
      expect(await db.query(
        'SELECT entity_id FROM journal_entries WHERE workspace_id=$1 AND event_type=$2 AND entity_id=$3',
        [workspaceId, 'CODING_JOB_CREATED', String(saved.id)]
      )).toEqual([{ entity_id: String(saved.id) }]);
      await holder.commitTransaction();

      await db.manager.update(WorkspaceUser, { workspaceId, userId: owner.id }, { accessLevel: 1 });
      await expect(jobs.createCodingJob(workspaceId, request, owner.id)).rejects.toBeInstanceOf(ForbiddenException);
      await db.manager.update(WorkspaceUser, { workspaceId, userId: owner.id }, { accessLevel: 2 });

      await expect(jobs.createCodingJob(workspaceId, request, foreign.id)).resolves.not.toMatchObject({ id: saved.id });
      await expect(jobs.createCodingJob(workspaceId, { ...request, creationRequestId: randomUUID() }, owner.id))
        .resolves.not.toMatchObject({ id: saved.id });
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
      await db.manager.update(WorkspaceUser, { workspaceId, userId: owner.id }, { accessLevel: 2 });
    }
  }, 15000);

  it('waits for capacity in a free workspace while rejecting the locked workspace', async () => {
    const pool = await new DataSource({ ...db.options, extra: { max: 2 } }).initialize();
    const freeWorkspaceId = workspaceId + 1;
    const write = jest.fn().mockResolvedValue('created');
    let queued: Promise<unknown> | undefined;
    try {
      await withWorkspaceTestResultsMutationLock(pool, workspaceId, async () => {
        queued = tryWithWorkspaceTestResultsMutationTransaction(pool, freeWorkspaceId, write);
        const busy = await tryWithWorkspaceTestResultsMutationTransaction(pool, workspaceId, write);
        expect(busy).toEqual({ acquired: false });
        expect(write).not.toHaveBeenCalled();
      });
      await expect(queued).resolves.toEqual({ acquired: true, value: 'created' });
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      await pool.destroy();
    }
  });

  it('starts a pending job while an import holds the workspace lock', async () => {
    const id = resources.get('job')![0];
    await db.manager.update(CodingJob, id, { status: 'pending' });
    await db.query(
      'DELETE FROM journal_entries WHERE workspace_id=$1 AND event_type=$2 AND entity_id=$3',
      [workspaceId, 'CODING_JOB_UPDATED', String(id)]
    );
    const importer = db.createQueryRunner();
    await importer.connect();
    try {
      await importer.startTransaction();
      await lockWorkspaceTestResultsMutationInTransaction(importer.manager, workspaceId);
      await expect(jobs.startCodingJob(id, workspaceId, owner.id))
        .resolves.toMatchObject({ status: 'active' });
      expect(importer.isTransactionActive).toBe(true);
      expect(await db.manager.findOneByOrFail(CodingJob, { id })).toMatchObject({ status: 'active' });
      expect(await db.query(
        'SELECT actor_user_id FROM journal_entries WHERE workspace_id=$1 AND event_type=$2 AND entity_id=$3',
        [workspaceId, 'CODING_JOB_UPDATED', String(id)]
      )).toEqual([{ actor_user_id: owner.id }]);
    } finally {
      if (importer.isTransactionActive) await importer.rollbackTransaction();
      await importer.release();
    }
  }, 20000);

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
      'late-progress': () => jobs.saveCodingProgress(id, {} as never, owner.id),
      'late-notes': () => jobs.saveCodingNotes(id, {} as never, owner.id),
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

  it.each(['pause', 'resume', 'submit', 'progress', 'notes'].flatMap(action => ['assignment', 'coding-capability'].map(revoked => ({ action, revoked }))))(
    'rejects $action after $revoked was revoked while waiting for the lock', async ({ action, revoked }) => {
      const id = resources.get('job')![0];
      const status = action === 'resume' ? 'paused' : 'active';
      await db.manager.update(CodingJob, id, { status });
      // This is the successful controller-side authorization before the wait.
      await expect(jobs.assertUserCanCodeCodingJob(id, workspaceId, owner.id)).resolves.toBeUndefined();
      const holder = db.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await lockWorkspaceTestResultsMutationInTransaction(holder.manager, workspaceId);
      const actions: Record<string, () => Promise<CodingJob>> = {
        pause: () => jobs.pauseCodingJob(id, workspaceId, owner.id),
        resume: () => jobs.resumeCodingJob(id, workspaceId, owner.id),
        submit: () => jobs.submitCodingJob(id, workspaceId, owner.id),
        progress: () => jobs.saveCodingProgress(id, {} as never, owner.id),
        notes: () => jobs.saveCodingNotes(id, {} as never, owner.id)
      };
      const attempt = actions[action]();
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
        if (revoked === 'assignment') {
          await holder.manager.delete(CodingJobCoder, { coding_job_id: id, user_id: owner.id });
        } else {
          await holder.manager.update(WorkspaceUser, { workspaceId, userId: owner.id }, { canCode: false });
        }
        await holder.commitTransaction();
        await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
        expect(await db.manager.findOneByOrFail(CodingJob, { id })).toMatchObject({ status });
      } finally {
        if (holder.isTransactionActive) await holder.rollbackTransaction();
        await holder.release();
        await observed;
        await db.manager.update(WorkspaceUser, { workspaceId, userId: owner.id }, { canCode: true });
        if (!await db.manager.count(CodingJobCoder, { where: { coding_job_id: id, user_id: owner.id } })) {
          await db.manager.save(CodingJobCoder, { coding_job_id: id, user_id: owner.id });
        }
      }
    }
  );
});
