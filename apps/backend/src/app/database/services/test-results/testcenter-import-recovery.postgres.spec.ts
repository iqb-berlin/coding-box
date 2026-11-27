import { CodingScheme } from '@iqbspecs/coding-scheme';
import {
  mkdtemp, readFile, rm, writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { writeToBuffer } from 'fast-csv';
import { createServer, Server } from 'node:http';
import { createMock } from '@golevelup/ts-jest';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { DataSource, In } from 'typeorm';
import { AutocoderDerivedService } from '../coding/autocoder-derived.service';
import { AutocoderResponseService } from '../coding/autocoder-response.service';
import { ResponseManagementService } from './response-management.service';
import { AutocoderEngineService } from '../coding/autocoder-engine.service';
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
import { Chunk, Response, TcMergeResponse } from '../shared';
import { TestResultsExportService } from './test-results-export.service';
import { UploadResultsService } from './upload-results.service';
import { TestResultsUploadJobData } from '../../../job-queue/job-queue.service';
import { responseMatchesChunkCondition } from './test-results-deletion.util';
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

  const repository = <T extends object>(entity: new () => T) => connection.getRepository(entity);
  const createPersonService = () => {
    const persistence = new PersonPersistenceService(
      repository(Persons), repository(Booklet), repository(Unit), repository(UnitLastState), repository(BookletInfo), repository(ResponseEntity), repository(ChunkEntity), repository(BookletLog), repository(Session), repository(UnitLog)
    );
    const query = new PersonQueryService(
      repository(Persons), repository(Booklet), repository(Unit), repository(ResponseEntity), repository(BookletLog), createMock<WorkspaceExclusionService>()
    );
    return new PersonService(query, persistence);
  };
  const createService = () => new TestcenterService(
    createPersonService(), new HttpService(), createMock<WorkspaceFilesService>(), createMock<CacheService>({ get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(false) }), createMock<WorkspaceTestResultsService>(), connection, undefined, undefined, new ConfigService({ TESTCENTER_ALLOWED_URLS: upstreamUrl })
  );

  const importRun = (service: TestcenterService, runId: string, mode: 'skip' | 'merge' | 'replace' = 'skip') => service.importWorkspaceFiles(
    String(workspaceId), 'tc', '', upstreamUrl, 'fixture-token', options, 'g1', true, undefined, runId, mode, 7
  );

  const storedResponses = (target = workspaceId) => repository(ResponseEntity).createQueryBuilder('r')
    .innerJoin('r.unit', 'u').innerJoin('u.booklet', 'b')
    .innerJoin('b.person', 'p')
    .where('p.workspace_id = :target', { target })
    .orderBy('r.id')
    .getMany();

  const answer = (id: string, value: string, subform?: string): TcMergeResponse => ({
    id, value, subform, status: 'VALUE_CHANGED'
  });
  const part = (id: string, ts: number, answers: TcMergeResponse[], subForm?: string, responseType = 'state'): Chunk => ({
    id, ts, subForm, responseType, content: JSON.stringify(answers)
  });

  const exportCsv = async () => {
    const exporter = new TestResultsExportService(
      repository(Persons), repository(Unit), repository(Booklet), repository(ResponseEntity), repository(BookletLog), repository(Session), repository(UnitLog), repository(ChunkEntity), connection, createMock<WorkspaceExclusionService>({
        resolveExclusionsForQueries: jest.fn().mockResolvedValue({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] })
      }), createMock()
    );
    const directory = await mkdtemp(join(tmpdir(), 'response-export-'));
    try {
      const file = join(directory, 'responses.csv');
      await exporter.exportTestResultsToFile(workspaceId, file);
      return await readFile(file);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  const uploadCsv = async (csv: Buffer, mode: 'skip' | 'merge' | 'replace', target = workspaceId, scopeFilters?: TestResultsUploadJobData['scopeFilters']) => {
    const directory = await mkdtemp(join(tmpdir(), 'response-import-'));
    try {
      const path = join(directory, 'responses.csv');
      await writeFile(path, csv);
      const service = new UploadResultsService(createPersonService(), createMock(), createMock(), connection);
      const result = await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: 'csv-reimport',
        data: {
          workspaceId: target,
          overwriteMode: mode,
          resultType: 'responses',
          scope: scopeFilters ? 'response' : 'person',
          scopeFilters,
          personMatchMode: 'strict',
          file: {
            path, size: csv.length, mimetype: 'text/csv', originalname: 'responses.csv'
          }
        }
      }));
      expect(result.importSummary?.responseRows).toBe(1);
      return (result.issues || []).filter(issue => issue.level === 'error').map(issue => issue.message);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  const addManualCases = async (assignments: { id: number; code: number }[]) => {
    const [job] = await connection.query('INSERT INTO coding_job (workspace_id, name) VALUES ($1, $2) RETURNING id', [workspaceId, 'manual']);
    for (const { id, code } of assignments) {
      await repository(ResponseEntity).update(id, { code_v2: code });
      await connection.query(`INSERT INTO coding_job_unit (coding_job_id, response_id, unit_name, variable_id,
        variable_anchor, booklet_name, person_login, person_code, code)
        SELECT $1,id,'U1',variableid,'','B','L','C',$2 FROM response WHERE id=$3`, [job.id, code, id]);
    }
    return job.id;
  };

  const manualCases = (job: number) => connection.query(
    'SELECT response_id AS id, code FROM coding_job_unit WHERE coding_job_id=$1 ORDER BY code', [job]
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

  it('codes SUM_CODE across persisted aspect data parts and keeps equal variable IDs in separate subforms', async () => {
    const numericAnswer = (id: string, subform?: string) => ({
      id, value: 1, status: 'VALUE_CHANGED', subform
    });
    rows = [rows[0]];
    rows[0].responses = [
      {
        id: 'elementCodes', responseType: 'state', ts: 1, content: JSON.stringify([numericAnswer('a'), numericAnswer('x', 'left')])
      },
      {
        id: 'stateVariableCodes', responseType: 'state', ts: 2, content: JSON.stringify([numericAnswer('s'), numericAnswer('x', 'right')])
      }
    ];
    expect((await importRun(createService(), 'split')).success).toBe(true);
    const stored = await connection.getRepository(ResponseEntity).createQueryBuilder('r').innerJoin('r.unit', 'u')
      .innerJoin('u.booklet', 'b')
      .innerJoin('b.person', 'p')
      .where('p.workspace_id = :workspaceId', { workspaceId })
      .getMany();
    expect(stored.map(r => [r.variableid, r.subform, r.source_chunk_key]).sort()).toEqual([
      ['a', '', 'elementCodes'], ['s', '', 'stateVariableCodes'], ['x', 'left', 'elementCodes'], ['x', 'right', 'stateVariableCodes']
    ]);
    const scheme = new CodingScheme({
      variableCodings: [
        ...['a', 's'].map(id => ({
          id,
          sourceType: 'BASE',
          codes: [{
            id: 1, type: 'FULL_CREDIT', score: 1, ruleSets: [{ rules: [{ method: 'NUMERIC_MATCH', parameters: ['1'] }] }]
          }]
        })),
        {
          id: 'd',
          sourceType: 'SUM_CODE',
          deriveSources: ['a', 's'],
          sourceParameters: { processing: [] },
          codes: [{
            id: 2, type: 'FULL_CREDIT', score: 2, ruleSets: [{ rules: [{ method: 'NUMERIC_MATCH', parameters: ['2'] }] }]
          }]
        }
      ]
    });
    const inputs = stored.filter(r => r.variableid !== 'x').map(r => ({
      id: r.variableid, value: r.value, status: 'VALUE_CHANGED' as const, subform: r.subform || undefined
    }));
    const engine = new AutocoderEngineService();
    expect(engine.codeAutocoderResponses(inputs.map((r, i) => ({ ...r, subform: String(i) })), scheme.variableCodings))
      .not.toContainEqual(expect.objectContaining({ id: 'd', code: 2 }));
    const unit = await connection.getRepository(Unit).findOneByOrFail({ id: stored[0].unitid });
    const coding = new AutocoderResponseService(engine, new AutocoderDerivedService(engine), createMock());
    const { allCodedResponses } = await coding.processAndCodeResponses({
      workspaceId,
      units: [unit],
      unitToResponsesMap: new Map([[unit.id, stored]]),
      unitToCodingSchemeRefMap: new Map([[unit.id, 'scheme']]),
      fileIdToCodingSchemeMap: new Map([['scheme', scheme]]),
      statistics: { totalResponses: 0, statusCounts: {} },
      autoCoderRun: 1
    });
    const writer = new ResponseManagementService(connection, createMock(), createMock(), createMock());
    await connection.transaction(manager => writer.updateResponsesInDatabase(
      workspaceId, allCodedResponses, manager.queryRunner!, undefined, undefined, undefined, undefined, { unitIds: [unit.id], autoCoderRun: 1 }, { managedExternally: true }
    ));
    const derived = await connection.getRepository(ResponseEntity).findOneByOrFail({ unitid: unit.id, variableid: 'd' });
    expect(derived.value).toBe('2');
    expect(Number(derived.code_v1)).toBe(2);
    expect(Number(derived.score_v1)).toBe(2);
    expect(derived.is_autocoder_generated).toBe(true);
  });

  it.each(['skip', 'merge', 'replace'] as const)('retains a legacy manual assignment on %s reimport', async mode => {
    rows = rows.slice(0, 1);
    const service = createService();
    expect((await importRun(service, 'seed')).success).toBe(true);
    const repo = connection.getRepository(ResponseEntity);
    const original = await repo.createQueryBuilder('r').innerJoin('r.unit', 'u')
      .innerJoin('u.booklet', 'b').innerJoin('b.person', 'p')
      .where('p.workspace_id = :workspaceId', { workspaceId })
      .getOneOrFail();
    await repo.update(original.id, { source_chunk_key: null, subform: 'main', code_v2: 7 });
    const [job] = await connection.query('INSERT INTO coding_job (workspace_id, name) VALUES ($1, $2) RETURNING id', [workspaceId, 'manual']);
    await connection.query(`INSERT INTO coding_job_unit (coding_job_id, response_id, unit_name, variable_id,
      variable_anchor, booklet_name, person_login, person_code, code) VALUES ($1,$2,'U1','VAR','','B','L','C',7)`, [job.id, original.id]);
    try {
      rows[0].responses = [{
        id: 'main',
        responseType: 'state',
        ts: 42,
        content: JSON.stringify([{
          id: 'VAR', status: 'VALUE_CHANGED', value: original.value, subform: 'A'
        }])
      }];
      expect((await importRun(service, 'reimport', mode)).success).toBe(true);
      expect(await repo.findBy({ unitid: original.unitid })).toEqual([expect.objectContaining({
        id: original.id,
        code_v2: 7,
        value: original.value,
        source_chunk_key: mode === 'skip' ? null : 'main',
        subform: mode === 'skip' ? 'main' : 'A'
      })]);
      expect(await connection.query('SELECT code, response_id FROM coding_job_unit WHERE coding_job_id=$1', [job.id]))
        .toEqual([{ code: 7, response_id: original.id }]);
    } finally {
      await connection.query('DELETE FROM coding_job WHERE id=$1', [job.id]);
    }
  });

  it.each(['skip', 'merge', 'replace'] as const)('keeps both manual cases with crossed historical wrapper names on %s', async mode => {
    rows = rows.slice(0, 1);
    rows[0].responses = [part('A', 10, [answer('x', 'first', 'left')], 'B'), part('B', 11, [answer('x', 'second', 'right')], 'A')];
    const service = createService();
    expect((await importRun(service, 'seed')).success).toBe(true);
    const normalizedCsv = await exportCsv();
    const [left, right] = await storedResponses();
    await repository(ChunkEntity).update({ unitid: left.unitid }, { subform: null });
    await repository(ResponseEntity).update(left.id, { source_chunk_key: null, subform: 'B' });
    await repository(ResponseEntity).update(right.id, { source_chunk_key: null, subform: 'A' });
    const cases = [{ id: left.id, code: 7 }, { id: right.id, code: 9 }];
    const job = await addManualCases(cases);
    try {
      const first = part('A', 20, [answer('x', 'first', 'left')], 'B');
      rows[0].responses = [first];
      if (mode !== 'skip') {
        await expect(exportCsv()).rejects.toThrow('nicht eindeutig');
        expect(await uploadCsv(normalizedCsv, mode)).toEqual([expect.stringContaining('nicht eindeutig')]);
        expect((await importRun(service, 'partial', mode)).success).toBe(false);
        expect(await storedResponses()).toMatchObject([{ id: left.id, subform: 'B' }, { id: right.id, subform: 'A' }]);
      }
      rows[0].responses = [part('B', 21, [answer('x', 'second', 'right')], 'A'), first];
      expect((await importRun(service, 'crossed', mode)).success).toBe(true);
      expect(await storedResponses()).toMatchObject([
        {
          id: left.id, subform: mode === 'skip' ? 'B' : 'left', source_chunk_key: mode === 'skip' ? null : 'A', code_v2: 7, value: 'first'
        },
        {
          id: right.id, subform: mode === 'skip' ? 'A' : 'right', source_chunk_key: mode === 'skip' ? null : 'B', code_v2: 9, value: 'second'
        }
      ]);
      expect(await manualCases(job)).toEqual(cases);
    } finally {
      await connection.query('DELETE FROM coding_job WHERE id=$1', [job]);
    }
  });

  it.each(['skip', 'merge', 'replace'] as const)('round-trips unresolved history through CSV %s and reconciles the same manual case with raw data', async mode => {
    rows = rows.slice(0, 1);
    rows[0].responses = [part('elementCodes', 10, [answer('x', 'old'), answer('y', 'genuine', 'elementCodes')])];
    const service = createService();
    expect((await importRun(service, 'seed')).success).toBe(true);
    const [old, genuine] = await storedResponses();
    await repository(ResponseEntity).update(old.id, { source_chunk_key: null, subform: 'elementCodes' });
    await repository(ChunkEntity).update({ unitid: old.unitid, variables: 'x' }, { subform: null });
    const cases = [{ id: old.id, code: 7 }];
    const job = await addManualCases(cases);
    try {
      const csv = await exportCsv();
      expect(await uploadCsv(csv, mode)).toEqual([]);
      expect(await storedResponses()).toMatchObject([
        {
          id: old.id, subform: 'elementCodes', source_chunk_key: null, code_v2: 7
        },
        { id: genuine.id, subform: 'elementCodes', source_chunk_key: 'elementCodes' }
      ]);
      expect((await importRun(service, 'raw-again', 'merge')).success).toBe(true);
      expect(await storedResponses()).toMatchObject([
        {
          id: old.id, subform: '', source_chunk_key: 'elementCodes', code_v2: 7
        },
        { id: genuine.id, subform: 'elementCodes', source_chunk_key: 'elementCodes' }
      ]);
      expect(await manualCases(job)).toEqual(cases);
    } finally {
      await connection.query('DELETE FROM coding_job WHERE id=$1', [job]);
    }
  });

  it.each(['merge', 'replace'] as const)('restores an old CSV in an empty workspace and reconciles the original on %s', async mode => {
    rows = rows.slice(0, 1);
    const archived = [part('elementCodes', 10, [
      answer('x', 'original', 'elementCodes'), answer('y', 'other', 'historical-wrapper')
    ], 'elementCodes')];
    const csv = await writeToBuffer([{ ...rows[0], responses: JSON.stringify(archived) }], { headers: true, delimiter: ';' });
    expect(await uploadCsv(csv, mode)).toEqual([]);
    const [original, other] = await storedResponses();
    expect(original).toMatchObject({ subform: 'elementCodes', source_chunk_key: null });
    expect(other).toMatchObject({ subform: 'historical-wrapper', source_chunk_key: null });
    const memberships = await repository(ChunkEntity).findBy({ unitid: original.unitid });
    expect(memberships.map(chunk => [chunk.variables, chunk.subform, Number(chunk.ts)]).sort()).toEqual([['x', null, 10], ['y', null, 10]]);
    const cases = [{ id: original.id, code: 7 }];
    const job = await addManualCases(cases);
    try {
      rows[0].responses = [
        part('elementCodes', 20, [answer('x', 'original')]),
        part('elementCodes', 20, [answer('y', 'other', 'real-form')], 'historical-wrapper')
      ];
      expect((await importRun(createService(), 'raw-after-csv', mode)).success).toBe(true);
      expect(await storedResponses()).toMatchObject([
        {
          id: original.id, subform: '', source_chunk_key: 'elementCodes', code_v2: 7
        },
        { id: other.id, subform: 'real-form', source_chunk_key: 'elementCodes' }
      ]);
      expect(await manualCases(job)).toEqual(cases);
    } finally {
      await connection.query('DELETE FROM coding_job WHERE id=$1', [job]);
    }
  });

  it('rejects changed values and raw statuses on scored responses and rolls back the whole replacement', async () => {
    rows = rows.slice(0, 1);
    rows[0].responses = [part('page', 10, [answer('free', 'before'), answer('scored', 'correct')])];
    const service = createService();
    expect((await importRun(service, 'seed')).success).toBe(true);
    const [free, scored] = await storedResponses();
    await repository(ResponseEntity).update(scored.id, { status_v1: 5, code_v1: 1, score_v1: 1 });
    for (const replacement of [answer('scored', 'wrong'), { ...answer('scored', 'correct'), status: 'DISPLAYED' as const }]) {
      const parts = [part('page', 20, [answer('free', 'after'), replacement])];
      const csv = await writeToBuffer([{ ...rows[0], responses: JSON.stringify(parts) }], { headers: true, delimiter: ';' });
      expect(await uploadCsv(csv, 'replace')).toEqual([expect.stringContaining('Antwort scored')]);
      expect(await storedResponses()).toMatchObject([
        { id: free.id, value: 'before' },
        {
          id: scored.id, value: 'correct', status: 3, status_v1: 5, code_v1: '1', score_v1: '1'
        }
      ]);
      expect(await repository(ChunkEntity).findBy({ unitid: scored.unitid })).toMatchObject([{ ts: '10' }]);
    }
  });

  it('protects a manual job result before it has been transferred to the response', async () => {
    rows = rows.slice(0, 1);
    const service = createService();
    expect((await importRun(service, 'seed')).success).toBe(true);
    const [original] = await storedResponses();
    const cases = [{ id: original.id, code: 0 }];
    const job = await addManualCases(cases);
    try {
      await repository(ResponseEntity).update(original.id, { code_v2: null });
      rows[0].responses = [part('main', 20, [answer('VAR', 'changed')])];
      expect((await importRun(service, 'changed-assigned', 'replace')).success).toBe(false);
      expect(await storedResponses()).toMatchObject([{ id: original.id, value: original.value, code_v2: null }]);
      expect(await manualCases(job)).toEqual(cases);
    } finally {
      await connection.query('DELETE FROM coding_job WHERE id=$1', [job]);
    }
  });

  it('restores marked archives and rejects unmarked repeated labels that conflict with a manual case', async () => {
    rows = rows.slice(0, 1);
    rows[0].responses = [part('page', 10, [answer('x', 'old')])];
    const service = createService();
    expect((await importRun(service, 'seed')).success).toBe(true);
    const [old] = await storedResponses();
    await repository(ResponseEntity).update(old.id, { source_chunk_key: null, subform: 'page' });
    await repository(ChunkEntity).update({ unitid: old.unitid }, { subform: null });
    const cases = [{ id: old.id, code: 7 }];
    const job = await addManualCases(cases);
    const other = await repository(Workspace).save({ name: 'unmarked-archive' });
    try {
      const archived = [part('page', 10, [answer('x', 'old', 'page')], 'page')];
      const oldCsv = await writeToBuffer([{ ...rows[0], responses: JSON.stringify(archived) }], { headers: true, delimiter: ';' });
      expect(await uploadCsv(oldCsv, 'replace')).toEqual([expect.stringContaining('nicht eindeutig')]);
      expect(await storedResponses()).toMatchObject([{ id: old.id, subform: 'page', source_chunk_key: null }]);
      const markedCsv = await exportCsv();
      expect(await uploadCsv(markedCsv, 'merge', other.id)).toEqual([]);
      expect(await storedResponses(other.id)).toMatchObject([{ subform: 'page', source_chunk_key: null }]);
      expect((await importRun(service, 'raw-again', 'merge')).success).toBe(true);
      expect(await uploadCsv(markedCsv, 'replace')).toEqual([expect.stringContaining('nicht eindeutig')]);
      expect(await uploadCsv(oldCsv, 'replace')).toEqual([expect.stringContaining('nicht eindeutig')]);
      expect(await storedResponses()).toMatchObject([{ id: old.id, subform: '', source_chunk_key: 'page' }]);
      expect(await manualCases(job)).toEqual(cases);
    } finally {
      await connection.query('DELETE FROM coding_job WHERE id=$1', [job]);
      await repository(JournalEntry).delete({ workspaceId: other.id });
      await repository(Workspace).delete(other.id);
    }
  });

  it('preserves per-response timestamps and types across partial replacement and CSV import into a fresh workspace', async () => {
    rows = rows.slice(0, 1);
    rows[0].responses = [part('page', 10, [answer('x', 'first'), answer('y', 'second'), answer('v', 'left', 'L'), answer('v', 'right', 'R')])];
    const service = createService();
    expect((await importRun(service, 'seed')).success).toBe(true);
    rows[0].responses = [part('page', 20, [answer('y', 'updated'), answer('v', 'right updated', 'R')], undefined, 'updated-type')];
    expect((await importRun(service, 'partial', 'replace')).success).toBe(true);
    const expected = [
      ['v', 'L', 'left', 10, 'state'], ['v', 'R', 'right updated', 20, 'updated-type'],
      ['x', '', 'first', 10, 'state'], ['y', '', 'updated', 20, 'updated-type']
    ];
    const memberships = async (target: number) => {
      const [row] = await storedResponses(target);
      const data = await connection.query(`SELECT r.variableid, r.subform, r.value, c.ts, c.type
        FROM response r JOIN chunk c ON r.unitid = c.unitid AND ${responseMatchesChunkCondition('c', 'r')}
        WHERE r.unitid = $1 ORDER BY r.variableid, r.subform`, [row.unitid]);
      return data.map(r => [r.variableid, r.subform, r.value, Number(r.ts), r.type]);
    };
    expect(await memberships(workspaceId)).toEqual(expected);
    const other = await repository(Workspace).save({ name: 'csv-roundtrip' });
    try {
      expect(await uploadCsv(await exportCsv(), 'replace', other.id)).toEqual([]);
      expect(await memberships(other.id)).toEqual(expected);
      rows[0].responses = [part('page', 30, [answer('v', 'new left', 'L'), answer('v', 'new right', 'R')])];
      expect((await importRun(service, 'both-forms', 'replace')).success).toBe(true);
      expect(await uploadCsv(await exportCsv(), 'replace', other.id, { variableId: 'v', subform: 'R' })).toEqual([]);
      expect(await memberships(other.id)).toEqual([expected[0], ['v', 'R', 'new right', 30, 'state'], ...expected.slice(2)]);
    } finally {
      await repository(JournalEntry).delete({ workspaceId: other.id });
      await repository(Workspace).delete(other.id);
    }
  });

  it('rolls back ambiguous reimports when two real subforms share one historical response', async () => {
    rows = rows.slice(0, 1);
    const service = createService();
    expect((await importRun(service, 'seed')).success).toBe(true);
    const repo = connection.getRepository(ResponseEntity);
    const original = await repo.createQueryBuilder('r').innerJoin('r.unit', 'u')
      .innerJoin('u.booklet', 'b').innerJoin('b.person', 'p')
      .where('p.workspace_id = :workspaceId', { workspaceId })
      .getOneOrFail();
    await repo.update(original.id, { source_chunk_key: null, subform: 'main', code_v2: 7 });
    rows[0].responses = [{
      id: 'main',
      responseType: 'state',
      ts: 2,
      content: JSON.stringify(['A', 'B'].map(subform => ({
        id: 'VAR', value: 'new', status: 'VALUE_CHANGED', subform
      })))
    }];
    expect((await importRun(service, 'ambiguous', 'replace')).success).toBe(false);
    expect(await repo.findBy({ unitid: original.unitid })).toEqual([expect.objectContaining({
      id: original.id, subform: 'main', source_chunk_key: null, code_v2: 7, value: original.value
    })]);
    // A real subform named like the old chunk is not evidence of a manual case's origin.
    rows[0].responses = [{
      id: 'another-part',
      responseType: 'state',
      ts: 3,
      content: JSON.stringify([{
        id: 'VAR', value: 'unrelated', status: 'VALUE_CHANGED', subform: 'main'
      }])
    }];
    expect((await importRun(service, 'colliding-name', 'merge')).success).toBe(false);
    expect(await repo.findBy({ unitid: original.unitid })).toEqual([expect.objectContaining({
      id: original.id, value: original.value, source_chunk_key: null, subform: 'main'
    })]);
  });
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
