import { createServer, Server } from 'node:http';
import { createMock } from '@golevelup/ts-jest';
import { HttpService } from '@nestjs/axios';
import { DataSource, In } from 'typeorm';
import Workspace from '../../entities/workspace.entity';
import Persons from '../../entities/persons.entity';
import { TestcenterImportRun } from '../../entities/testcenter-import-run.entity';
import { JournalEntry } from '../../entities/journal-entry.entity';
import { Booklet } from '../../entities/booklet.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLastState } from '../../entities/unitLastState.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { Session } from '../../entities/session.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { UnitNote } from '../../entities/unitNote.entity';
import { UnitTag } from '../../entities/unitTag.entity';
import { TestcenterService } from './testcenter.service';
import { PersonService } from './person.service';
import { PersonPersistenceService } from './person-persistence.service';
import { PersonQueryService } from './person-query.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { JournalService } from '../shared/journal.service';
import { Response } from '../shared';
import { CacheService } from '../../../cache/cache.service';
import { ImportOptionsDto } from '../../../../../../../api-dto/files/import-options.dto';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

// Uses the Liquibase schema without synchronize. Only the synthetic upstream,
// optional cache and downstream cache invalidation are replaced.
describePostgres('Testcenter import recovery against PostgreSQL', () => {
  let connection: DataSource;
  let workspaceId: number;
  let server: Server;
  let upstreamUrl: string;
  let requests: number;
  let rows: Response[];
  let releaseUpstream: (() => void) | undefined;
  let upstreamStarted: (() => void) | undefined;
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

  const createService = () => {
    const repo = <T extends object>(entity: new () => T) => connection.getRepository(entity);
    const persistence = new PersonPersistenceService(
      repo(Persons), repo(Booklet), repo(Unit), repo(UnitLastState), repo(BookletInfo), repo(ResponseEntity), repo(ChunkEntity), repo(BookletLog), repo(Session), repo(UnitLog)
    );
    const query = new PersonQueryService(
      repo(Persons), repo(Booklet), repo(Unit), repo(ResponseEntity), repo(BookletLog), createMock<WorkspaceExclusionService>()
    );
    return new TestcenterService(
      new PersonService(query, persistence), new HttpService(), createMock<WorkspaceFilesService>(), createMock<CacheService>({ get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(false) }), createMock<WorkspaceTestResultsService>(), connection
    );
  };

  const importRun = (service: TestcenterService, runId: string) => service.importWorkspaceFiles(
    String(workspaceId), 'tc', '', upstreamUrl, 'fixture-token', options, 'g1', true, undefined, runId, 'skip', 7
  );

  const counts = async () => {
    const units = await connection.getRepository(Unit).createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet').innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .getMany();
    const unitid = In(units.map(unit => unit.id));
    return {
      persons: await connection.getRepository(Persons).countBy({ workspace_id: workspaceId }),
      units: units.length,
      responses: await connection.getRepository(ResponseEntity).countBy({ unitid }),
      chunks: await connection.getRepository(ChunkEntity).countBy({ unitid }),
      lastStates: await connection.getRepository(UnitLastState).countBy({ unitid })
    };
  };

  beforeAll(async () => {
    connection = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      entities: [Workspace, TestcenterImportRun, JournalEntry, Persons, Booklet, BookletInfo,
        Unit, UnitLastState, ChunkEntity, ResponseEntity, BookletLog, Session, UnitLog, UnitNote, UnitTag],
      synchronize: false
    });
    await connection.initialize();
    server = createServer((_request, response) => {
      requests += 1;
      const send = () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(rows));
      };
      if (upstreamStarted) {
        releaseUpstream = send;
        const notify = upstreamStarted;
        upstreamStarted = undefined;
        notify();
      } else send();
    });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a loopback server address');
    upstreamUrl = `http://127.0.0.1:${address.port}`;
  }, 30000);

  beforeEach(async () => {
    const workspace = await connection.getRepository(Workspace).save({ name: `import-recovery-${Date.now()}` });
    workspaceId = workspace.id;
    requests = 0;
    rows = ['U1', 'U2', 'U3'].map(unitname => ({
      groupname: 'g1',
      loginname: 'fixture-person',
      code: 'fixture-code',
      bookletname: `durable-import-${workspaceId}`,
      unitname,
      originalUnitId: unitname,
      responses: [{
        id: 'main', subForm: '', responseType: 'application/json', content: JSON.stringify([{ id: 'VAR', status: 'VALUE_CHANGED', value: unitname }]), ts: 123
      }],
      laststate: JSON.stringify({ PRESENTATIONCOMPLETE: 'yes' })
    }));
  });

  afterEach(async () => {
    releaseUpstream?.();
    releaseUpstream = undefined;
    upstreamStarted = undefined;
    jest.restoreAllMocks();
    if (workspaceId && connection?.isInitialized) {
      await connection.getRepository(JournalEntry).delete({ workspaceId });
      await connection.getRepository(Persons).delete({ workspace_id: workspaceId });
      await connection.getRepository(BookletInfo).delete({ name: `durable-import-${workspaceId}` });
      await connection.getRepository(Workspace).delete(workspaceId);
    }
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => { server.close(error => (error ? reject(error) : resolve())); });
    if (connection?.isInitialized) await connection.destroy();
  });

  it('commits real responses, chunks, last state and audit, then recovers after a service restart without Redis', async () => {
    const first = await importRun(createService(), 'committed-run');
    expect(first).toMatchObject({
      success: true, persons: 1, booklets: 1, units: 3, completedSteps: ['responses']
    });
    expect(await counts()).toEqual({
      persons: 1, units: 3, responses: 3, chunks: 3, lastStates: 3
    });
    expect(await connection.getRepository(ResponseEntity).createQueryBuilder('response')
      .innerJoin('response.unit', 'unit').innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('response.value', 'value')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .orderBy('unit.name')
      .getRawMany())
      .toEqual(['U1', 'U2', 'U3'].map(unitName => ({ unitName, variableId: 'VAR', value: unitName })));
    const events = await connection.getRepository(JournalEntry).findBy({ workspaceId });
    expect(events).toContainEqual(expect.objectContaining({
      eventType: 'TEST_RESULTS_IMPORTED', actorUserId: 7, correlationId: 'committed-run', result: 'success'
    }));
    expect(JSON.stringify(events)).not.toContain('fixture-token');
    const restarted = createService();
    expect(await restarted.getImportWorkspaceFilesProgress(String(workspaceId), 'committed-run')).toMatchObject({ status: 'completed', result: first });
    expect(await importRun(restarted, 'committed-run')).toEqual(first);
    expect(requests).toBe(1);
    expect(await counts()).toEqual({
      persons: 1, units: 3, responses: 3, chunks: 3, lastStates: 3
    });
    expect(await connection.getRepository(JournalEntry).countBy({ workspaceId })).toBe(events.length);
  }, 30000);

  it('rolls back concurrent unit writes on a real PostgreSQL audit error, then safely imports a new run', async () => {
    const auditFailure = jest.spyOn(JournalService, 'recordEventInTransaction').mockImplementationOnce(async manager => {
      await manager.query('SELECT 1 / 0');
      throw new Error('Expected PostgreSQL to reject the statement');
    });
    let failed;
    try {
      failed = await importRun(createService(), 'failed-run');
    } finally {
      auditFailure.mockRestore();
    }
    expect(failed.success).toBe(false);
    expect(await counts()).toEqual({
      persons: 0, units: 0, responses: 0, chunks: 0, lastStates: 0
    });
    expect(await importRun(createService(), 'failed-run')).toEqual(failed);
    expect(requests).toBe(1);
    expect((await importRun(createService(), 'retry-run')).success).toBe(true);
    expect(await counts()).toEqual({
      persons: 1, units: 3, responses: 3, chunks: 3, lastStates: 3
    });
  }, 30000);

  it('rejects a concurrent run using the real cross-connection workspace lock', async () => {
    const started = new Promise<void>(resolve => { upstreamStarted = resolve; });
    const first = importRun(createService(), 'active-run');
    try {
      await started;
      await expect(importRun(createService(), 'concurrent-run')).rejects.toMatchObject({ status: 409 });
      expect(await connection.getRepository(TestcenterImportRun).findOneBy({ workspace_id: workspaceId, import_run_id: 'concurrent-run' })).toBeNull();
      expect(requests).toBe(1);
    } finally {
      releaseUpstream?.();
      releaseUpstream = undefined;
      await first;
    }
    expect((await importRun(createService(), 'active-run')).success).toBe(true);
    expect(requests).toBe(1);
  }, 30000);

  it('retains an unconfirmed durable run and refuses replay after all terminal status writes fail', async () => {
    const writes = jest.spyOn(connection.getRepository(TestcenterImportRun), 'update').mockRejectedValue(new Error('status storage unavailable'));
    try {
      const result = await importRun(createService(), 'unconfirmed-run');
      expect(result.success).toBe(true);
      expect(result.issues).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('nicht dauerhaft gespeichert') }));
    } finally {
      writes.mockRestore();
    }
    expect(await connection.getRepository(TestcenterImportRun).findOneBy({ workspace_id: workspaceId, import_run_id: 'unconfirmed-run' }))
      .toMatchObject({ progress: { status: 'running' } });
    await expect(importRun(createService(), 'unconfirmed-run')).rejects.toMatchObject({ status: 409 });
    expect(requests).toBe(1);
    expect((await counts()).responses).toBe(3);
  }, 30000);

  it('uses the migrated workspace-scoped key and cascades only the deleted workspace run', async () => {
    const other = await connection.getRepository(Workspace).save({ name: `other-import-${workspaceId}` });
    const progress = {
      importRunId: 'same-id', status: 'running' as const, totalPlanned: 0, totalProcessed: 0, totalUploaded: 0, totalFailed: 0, options: [], updatedAt: Date.now()
    };
    try {
      await connection.getRepository(TestcenterImportRun).insert([
        { workspace_id: workspaceId, import_run_id: 'same-id', progress },
        { workspace_id: other.id, import_run_id: 'same-id', progress }
      ]);
      await expect(connection.getRepository(TestcenterImportRun).insert({ workspace_id: workspaceId, import_run_id: 'same-id', progress })).rejects.toMatchObject({ code: '23505' });
      await connection.getRepository(Workspace).delete(other.id);
      expect(await connection.getRepository(TestcenterImportRun).findOneBy({ workspace_id: other.id, import_run_id: 'same-id' })).toBeNull();
      expect(await connection.getRepository(TestcenterImportRun).findOneBy({ workspace_id: workspaceId, import_run_id: 'same-id' })).not.toBeNull();
    } finally {
      await connection.getRepository(Workspace).delete(other.id);
    }
  });
});
