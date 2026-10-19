import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import User from '../../entities/user.entity';
import Workspace from '../../entities/workspace.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import Persons from '../../entities/persons.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { Booklet } from '../../entities/booklet.entity';
import { Unit } from '../../entities/unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import FileUpload from '../../entities/file_upload.entity';
import { CacheService } from '../../../cache/cache.service';
import { ExternalCodingImportService } from './external-coding-import.service';
import { lockWorkspaceTestResultsMutationInTransaction, withWorkspaceTestResultsMutationPoolSlot } from '../shared/workspace-test-results-lock.util';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('External coding import permissions with PostgreSQL', () => {
  let db: DataSource;
  let workspaceId: number;
  let personId: number;
  let bookletInfoId: number;
  let responseId: number;
  let manager: User;
  let coderManager: User;
  let admin: User;
  let service: ExternalCodingImportService;
  const body = {
    file: Buffer.from('unit_key,variable_id,code,score\nUNIT-IMPORT,VAR,1,1\n').toString('base64'),
    fileName: 'coding.csv',
    previewOnly: false
  };

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
    workspaceId = (await db.getRepository(Workspace).save({ name: `import-permissions-${Date.now()}` })).id;
    [manager, coderManager, admin] = await db.getRepository(User).save([3, 2, 4].map(level => ({
      identity: `import-permissions-${workspaceId}-${level}`,
      issuer: 'isolated-import-test',
      username: `import-${workspaceId}-${level}`,
      isAdmin: level === 4
    })));
    await db.getRepository(WorkspaceUser).save({
      workspaceId, userId: coderManager.id, accessLevel: 2, canCode: false
    });
    personId = (await db.getRepository(Persons).save({
      workspace_id: workspaceId,
      login: 'import',
      code: 'import',
      group: 'test',
      uploaded_at: new Date(),
      source: 'permission-test',
      booklets: [],
      consider: true
    })).id;
    bookletInfoId = (await db.getRepository(BookletInfo).save({ name: `import-permissions-${workspaceId}` })).id;
    const booklet = await db.getRepository(Booklet).save({ infoid: bookletInfoId, personid: personId });
    const unit = await db.getRepository(Unit).save({ bookletid: booklet.id, name: 'UNIT-IMPORT', alias: 'UNIT-IMPORT' });
    responseId = (await db.getRepository(ResponseEntity).save({ unitid: unit.id, variableid: 'VAR', status: 2 })).id;
    service = new ExternalCodingImportService(
      db.getRepository(ResponseEntity), db.getRepository(Persons), db.getRepository(Unit), db.getRepository(Booklet), db.getRepository(FileUpload), { incr: async () => 1, delete: async () => undefined } as unknown as CacheService
    );
    // Coding-scheme validation is independent of the real roles, transaction and persisted writes under test.
    jest.spyOn(service as unknown as { validateCodeAgainstScheme: () => Promise<unknown> }, 'validateCodeAgainstScheme')
      .mockResolvedValue({ isValid: true, score: 1, status: 'CODING_COMPLETE' });
  }, 30000);

  beforeEach(async () => {
    await db.getRepository(WorkspaceUser).save({
      workspaceId, userId: manager.id, accessLevel: 3, canCode: false
    });
    await db.getRepository(ResponseEntity).update(responseId, { status_v2: null, code_v2: null, score_v2: null });
  });

  afterAll(async () => {
    if (personId) await db.getRepository(Persons).delete(personId);
    if (bookletInfoId) await db.getRepository(BookletInfo).delete(bookletInfoId);
    if (workspaceId) {
      await db.getRepository(WorkspaceUser).delete({ workspaceId });
      await db.getRepository(Workspace).delete(workspaceId);
    }
    if (manager) await db.getRepository(User).delete([manager.id, coderManager.id, admin.id]);
    await db?.destroy();
  });

  async function expectUnchanged(): Promise<void> {
    expect(await db.getRepository(ResponseEntity).findOneByOrFail({ id: responseId }))
      .toMatchObject({ status_v2: null, code_v2: null, score_v2: null });
  }

  it('keeps a Level-2 preview read-only', async () => {
    await expect(service.importExternalCoding(workspaceId, { ...body, previewOnly: true }, undefined, coderManager.id))
      .resolves.toMatchObject({ updatedRows: 1 });
    await expectUnchanged();
  });

  it('rejects Level-2 writes without changing persisted results', async () => {
    await expect(service.importExternalCoding(workspaceId, body, undefined, coderManager.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expectUnchanged();
  });

  it('rejects a legacy queued import without a recorded requester', async () => {
    await expect(service.importExternalCoding(workspaceId, body)).rejects.toBeInstanceOf(ForbiddenException);
    await expectUnchanged();
  });

  it.each(['manager', 'admin'])('persists authorized %s imports', async role => {
    const userId = role === 'manager' ? manager.id : admin.id;
    await expect(service.importExternalCoding(workspaceId, body, undefined, userId)).resolves.toMatchObject({ updatedRows: 1 });
    const response = await db.getRepository(ResponseEntity).findOneByOrFail({ id: responseId });
    expect(String(response.code_v2)).toBe('1');
    expect(String(response.score_v2)).toBe('1');
    expect(response.status_v2).not.toBeNull();
  });

  it.each(['role', 'membership'])('keeps previews available and rechecks revoked %s after waiting for a pool slot', async revoked => {
    let releaseSlots: () => void = () => undefined;
    const pending = new Promise<void>(resolve => { releaseSlots = resolve; });
    let allStarted: () => void = () => undefined;
    const started = new Promise<void>(resolve => { allStarted = resolve; });
    let entered = 0;
    // This fixture's four-connection pool admits three blocking mutations.
    const holders = Array.from({ length: 3 }, () => withWorkspaceTestResultsMutationPoolSlot(db, async () => {
      entered += 1;
      if (entered === 3) allStarted();
      await pending;
    }));
    let observed: Promise<unknown> | undefined;
    try {
      await started;
      const attempt = service.importExternalCoding(workspaceId, body, undefined, manager.id);
      observed = attempt.catch(() => undefined);
      await expect(service.importExternalCoding(workspaceId, { ...body, previewOnly: true }, undefined, coderManager.id))
        .resolves.toMatchObject({ updatedRows: 1 });
      await expectUnchanged();
      if (revoked === 'role') {
        await db.getRepository(WorkspaceUser).update({ workspaceId, userId: manager.id }, { accessLevel: 2 });
      } else {
        await db.getRepository(WorkspaceUser).delete({ workspaceId, userId: manager.id });
      }
      releaseSlots();
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expectUnchanged();
    } finally {
      releaseSlots();
      await Promise.all(holders);
      await observed;
    }
  }, 15000);

  it.each(['role', 'membership'])('rechecks revoked %s after waiting for the workspace lock', async revoked => {
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await lockWorkspaceTestResultsMutationInTransaction(holder.manager, workspaceId);
    const attempt = service.importExternalCoding(workspaceId, body, undefined, manager.id);
    const observed = attempt.catch(() => undefined);
    try {
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (!blocked && Date.now() < deadline) {
        const [state] = await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS blocked");
        blocked = state.blocked;
        if (!blocked) await new Promise(resolve => { setTimeout(resolve, 20); });
      }
      expect(blocked).toBe(true);
      if (revoked === 'role') {
        await holder.manager.update(WorkspaceUser, { workspaceId, userId: manager.id }, { accessLevel: 2 });
      } else {
        await holder.manager.delete(WorkspaceUser, { workspaceId, userId: manager.id });
      }
      await holder.commitTransaction();
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expectUnchanged();
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
      await observed;
    }
  }, 15000);
});
