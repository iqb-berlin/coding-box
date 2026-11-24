import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import type { VariableCodingData } from '@iqbspecs/coding-scheme';
import type { EmptyResponseDto } from '../../../../../../../api-dto/coding/response-analysis.dto';
import { CacheService } from '../../../cache/cache.service';
import type { CodingAnalysisJobData } from '../../../job-queue/job-queue.service';
import { CodingAnalysisProcessor } from '../../../job-queue/processors/coding-analysis.processor';
import { Booklet } from '../../entities/booklet.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import Persons from '../../entities/persons.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import Workspace from '../../entities/workspace.entity';
import { getManualCodingScopeKey } from '../../utils/manual-coding-scope.util';
import { statusNumberToString, statusStringToNumber } from '../../utils/response-status-converter';
import type { Chunk, TcMergeSubForms } from '../shared';
import { TestResultsReplayService } from '../test-results/test-results-replay.service';
import { PersonDataProcessingService } from '../test-results/person-data-processing.service';
import { PersonPersistenceService } from '../test-results/person-persistence.service';
import { ResolvedWorkspaceExclusions, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { DerivedVariableMetadataSnapshot, WORKSPACE_FILE_METADATA_READER } from '../workspace/workspace-file-metadata-reader.token';
import { AutocoderEngineService } from './autocoder-engine.service';
import { CodingAggregationPeerService } from './coding-aggregation-peer.service';
import type { FileCodingAnalysis } from './coding-analysis-cache-key.util';
import { readCodingAnalysisResult } from './coding-analysis-result-store';
import { CodingJobAggregationService } from './coding-job-aggregation.service';
import { CodingJobResponsesService } from './coding-job-responses.service';
import { CodingResultsService } from './coding-results.service';
import { EmptyResponseSelectionService } from './empty-response-selection.service';
import { IQB_STANDARD_MISSING_CODES, MissingsProfilesService } from './missings-profiles.service';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

function geometryValue(x: number): string {
  const drawing = new AdmZip();
  drawing.addFile('geogebra.xml', Buffer.from(
    `<geogebra format="5.0"><construction><element type="point" label="A"><coords x="${x}" y="0" z="1"/></element></construction></geogebra>`
  ));
  return drawing.toBuffer().toString('base64');
}

describePostgres('GeoGebra responses in manual coding preparation', () => {
  let db: DataSource;
  let module: TestingModule;
  let workspace: Workspace;
  let bookletInfoIds: number[];
  let exclusions: ResolvedWorkspaceExclusions;
  let metadata: DerivedVariableMetadataSnapshot;
  const cacheEntries = new Map<string, unknown>();
  const publishAnalysis = jest.fn().mockResolvedValue(true);

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      entities: [`${__dirname}/../../entities/*.entity.ts`],
      synchronize: false
    });
    await db.initialize();
    const repositories = new Map(db.entityMetadatas.flatMap(({ target }) => (
      typeof target === 'function' ? [[getRepositoryToken(target), db.getRepository(target)] as const] : []
    )));
    module = await Test.createTestingModule({
      providers: [TestResultsReplayService, PersonPersistenceService, CodingResultsService, EmptyResponseSelectionService,
        CodingAnalysisProcessor, CodingJobResponsesService, CodingAggregationPeerService, CodingJobAggregationService]
    }).useMocker(token => {
      if (repositories.has(token as string)) return repositories.get(token as string);
      if (token === CacheService) {
        return {
          publishIfMarkerMatches: publishAnalysis,
          generateUnitResponseCacheKey: (...parts: unknown[]) => JSON.stringify(parts),
          get: (key: string) => cacheEntries.get(key),
          set: (key: string, value: unknown) => cacheEntries.set(key, value)
        };
      }
      if (token === WORKSPACE_FILE_METADATA_READER) {
        return { getDerivedVariableMetadata: async () => metadata };
      }
      if (token === MissingsProfilesService) {
        return { getMissingByIdForProfileOrDefault: async () => ({ code: IQB_STANDARD_MISSING_CODES.mir, score: 0 }) };
      }
      if (token === WorkspaceExclusionService) {
        return { resolveExclusionsForQueries: async () => exclusions };
      }
      return createMock();
    }).compile();
  }, 30000);

  beforeEach(async () => {
    cacheEntries.clear();
    publishAnalysis.mockClear();
    exclusions = { globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] };
    metadata = { metadataAvailable: true, derivedVariableMap: new Map(), derivedVariablesBySourceMap: new Map() };
    bookletInfoIds = [];
    workspace = await db.manager.save(Workspace, { name: 'GeoGebra empty answers test' });
  });

  afterEach(async () => {
    if (workspace) await db.manager.delete(Workspace, workspace.id);
    if (bookletInfoIds?.length) await db.manager.delete(BookletInfo, bookletInfoIds);
  });

  afterAll(async () => {
    await module?.close();
    if (db?.isInitialized) await db.destroy();
  });

  async function createBooklet(label: string): Promise<Booklet> {
    const person = await db.manager.save(Persons, {
      workspace_id: workspace.id,
      login: label,
      code: 'test',
      group: 'synthetic',
      booklets: [],
      source: 'synthetic',
      uploaded_at: new Date(),
      consider: true
    });
    const info = await db.manager.save(BookletInfo, { name: `${label}-${workspace.id}`, size: 1 });
    bookletInfoIds.push(info.id);
    return db.manager.save(Booklet, { infoid: info.id, personid: person.id });
  }

  async function createUnit(booklet: Booklet, name = 'GEOGEBRA'): Promise<Unit> {
    return db.manager.save(Unit, { name, alias: name, bookletid: booklet.id });
  }

  async function analyzeEmptyResponses(): Promise<{ total: number; totalUncoded: number; items: EmptyResponseDto[] }> {
    const temp = await mkdtemp(join(tmpdir(), 'geogebra-empty-response-'));
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(temp);
    try {
      const processor = module.get(CodingAnalysisProcessor);
      await processor.handleResponseAnalysis({
        data: {
          workspaceId: workspace.id, matchingFlags: [], threshold: 2, cacheKey: 'geogebra-test', runId: 'synthetic-geogebra'
        },
        updateProgress: jest.fn()
      } as unknown as Job<CodingAnalysisJobData>);
      const analysis = publishAnalysis.mock.lastCall?.[1] as FileCodingAnalysis;
      const { total, totalUncoded } = analysis.emptyResponses;
      const items = await readCodingAnalysisResult(workspace.id, analysis.resultId, read => read<EmptyResponseDto>('empty', 0, total));
      return { total, totalUncoded, items: items ?? [] };
    } finally {
      cwd.mockRestore();
      await rm(temp, { recursive: true, force: true });
    }
  }

  function storeResponse(unit: Unit, value: string | null, status = 'DISPLAYED', variableid = 'drawing', subform: string | null = null) {
    return db.manager.save(ResponseEntity, {
      unitid: unit.id,
      variableid,
      subform,
      status: statusStringToNumber(status) ?? 0,
      status_v1: statusStringToNumber('CODING_INCOMPLETE'),
      value
    });
  }

  async function importReplayChunks(chunks: Chunk[]) {
    const unit = await createUnit(await createBooklet('chunks'));
    const importer = new PersonDataProcessingService();
    const forms = importer.extractSubforms(chunks);
    const imported = importer.createUnit({
      unitname: unit.name,
      originalUnitId: unit.name,
      groupname: 'synthetic',
      loginname: 'chunks',
      code: 'test',
      bookletname: `chunks-${workspace.id}`,
      responses: chunks,
      laststate: '{}'
    }, [], forms, importer.extractVariablesFromSubforms(forms), chunks);
    const persistence = module.get(PersonPersistenceService);
    await persistence.processChunks(imported, unit, {
      id: 'chunks', units: [imported], logs: [], sessions: []
    });
    expect((await persistence.processSubforms(imported, unit)).saved).toBe(chunks.length);
    return {
      unit,
      imported,
      replay: (id: number) => module.get(TestResultsReplayService)
        .findUnitResponse(workspace.id, `chunks@test@synthetic@chunks-${workspace.id}`, unit.name, id)
    };
  }

  const replayChunk = (id: string, subForm: string, variable: string, value: string, ts: number): Chunk => ({
    id,
    subForm,
    ts,
    responseType: 'state',
    content: JSON.stringify([{ id: variable, value, status: 'VALUE_CHANGED' }])
  });

  it.each([false, true])('keeps independent player parts in coding replay (legacy import: %s)', async legacy => {
    const { unit, replay } = await importReplayChunks([
      replayChunk('drawing-part', '', 'drawing', 'A', 1),
      replayChunk('reason-part', '', 'reason', 'because', 2)
    ]);
    if (legacy) {
      await db.manager.update(ResponseEntity, { unitid: unit.id }, { source_chunk_key: null, chunk_has_subform: null });
    }
    const selected = await db.manager.findOneByOrFail(ResponseEntity, { unitid: unit.id, variableid: 'drawing' });
    const result = await replay(selected.id);
    expect(result.responses.map(part => [part.id, JSON.parse(part.content)[0].value]).sort()).toEqual([
      ['drawing-part', 'A'], ['reason-part', 'because']
    ]);
  });

  it('loads the selected version in its original player part across explicit subforms', async () => {
    const { unit, imported, replay } = await importReplayChunks([
      replayChunk('part-A', 'A', 'drawing', 'first', 1),
      replayChunk('part-B', 'B', 'drawing', 'second', 2),
      replayChunk('shared', '', 'reason', 'because', 3),
      replayChunk('B', 'B', 'local', 'B only', 4)
    ]);
    const drawings = await db.manager.findBy(ResponseEntity, { unitid: unit.id, variableid: 'drawing' });
    expect(drawings).toHaveLength(2);
    for (const drawing of drawings) {
      const { responses } = await replay(drawing.id);
      expect(responses.map(part => part.id).sort()).toEqual(drawing.subform === 'A' ?
        ['part-A', 'shared'] : ['B', 'part-B', 'shared']);
      const part = responses.find(chunk => chunk.id === `part-${drawing.subform}`)!;
      expect(JSON.parse(part.content)).toEqual([expect.objectContaining({ id: 'drawing', value: drawing.value })]);
    }

    // A historical row has no evidence linking A/B to either differently named player part.
    await db.manager.update(ResponseEntity, { unitid: unit.id }, { source_chunk_key: null, chunk_has_subform: null });
    cacheEntries.clear();
    await expect(replay(drawings[0].id)).rejects.toThrow('Original replay chunk is ambiguous');
    await db.manager.update(ResponseEntity, drawings[0].id, { code_v2: 7 });
    const merged = await module.get(PersonPersistenceService).processSubforms(imported, unit, 'merge');
    expect(merged).toMatchObject({
      success: true, skipped: 4, saved: 0, deleted: 0
    });
    const repaired = await db.manager.findOneByOrFail(ResponseEntity, { id: drawings[0].id });
    expect(Number(repaired.code_v2)).toBe(7);
    expect((await replay(repaired.id)).responses.map(part => part.id)).toContain(`part-${repaired.subform}`);
  });

  it('replays the selected drawing with its shared inputs for both base and derived coding cases', async () => {
    const unit = await createUnit(await createBooklet('replay'));
    const connector = `replay@test@synthetic@replay-${workspace.id}`;
    const drawings = [geometryValue(1), geometryValue(2)];
    const first = await storeResponse(unit, drawings[0], 'VALUE_CHANGED', 'drawing', 'A');
    const second = await storeResponse(unit, drawings[1], 'VALUE_CHANGED', 'drawing', 'B');
    await storeResponse(unit, 'global seed', 'DISPLAYED');
    await storeResponse(unit, 'shared', 'VALUE_CHANGED', 'label');
    await db.manager.insert(ChunkEntity, ['A', 'B'].map((key, ts) => ({
      unitid: unit.id, key, ts, variables: 'drawing'
    })));
    await db.manager.insert(ChunkEntity, {
      unitid: unit.id, key: 'details', variables: 'note', ts: 2
    });
    const note = await storeResponse(unit, 'edited', 'VALUE_CHANGED', 'note', 'B');
    const target = await storeResponse(unit, '0', 'VALUE_CHANGED', 'sum', 'B');
    await db.manager.update(ResponseEntity, target.id, { is_autocoder_generated: true });
    const replay = module.get(TestResultsReplayService);
    for (const [index, responseId] of [first.id, target.id].entries()) {
      const result = await replay.findUnitResponse(workspace.id, connector, unit.name, responseId);
      expect(result.subformResponseIds).toEqual(index === 0 ? [first.id] : [second.id, note.id]);
      expect(result.responses.map(chunk => chunk.id).sort()).toEqual(index === 0 ? ['', 'A'] : ['', 'B', 'details']);
      const inputs = result.responses.flatMap(chunk => JSON.parse(chunk.content));
      expect(inputs).toHaveLength(index === 0 ? 2 : 3);
      expect(inputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'drawing', value: drawings[index] }),
        expect.objectContaining({ id: 'label', value: 'shared' })
      ]));
    }
    const sameScope = await storeResponse(unit, geometryValue(3), 'VALUE_CHANGED', 'drawing', 'A');
    const refreshed = await replay.findUnitResponse(workspace.id, connector, unit.name, sameScope.id);
    expect(refreshed.subformResponseIds).toEqual([sameScope.id]);
    expect(JSON.parse(refreshed.responses.find(chunk => chunk.id === 'A')!.content)[0].value).toBe(sameScope.value);
    expect((await replay.findUnitResponse(workspace.id, connector, unit.name, first.id)).subformResponseIds).toEqual([first.id]);
    const other = await storeResponse(await createUnit(await createBooklet('other')), drawings[0]);
    await expect(replay.findUnitResponse(workspace.id, connector, unit.name, other.id)).rejects.toThrow();
  });

  it('imports the original player status and removes only displayed drawings from new jobs after empty coding', async () => {
    const startingDrawing = geometryValue(0);
    const exportSubforms: TcMergeSubForms[] = [
      { id: 'viewed', responses: [{ id: 'drawing', status: 'DISPLAYED', value: startingDrawing }] },
      { id: 'zoomed', responses: [{ id: 'drawing', status: 'DISPLAYED', value: `data:application/vnd.geogebra.file;base64,${startingDrawing}` }] },
      { id: 'edited', responses: [{ id: 'drawing', status: 'VALUE_CHANGED', value: geometryValue(1) }] },
      { id: 'reset', responses: [{ id: 'drawing', status: 'VALUE_CHANGED', value: startingDrawing }] }
    ];
    const scheme: VariableCodingData[] = [{
      id: 'drawing',
      sourceType: 'BASE',
      sourceParameters: { processing: ['TAKE_DISPLAYED_AS_VALUE_CHANGED'] },
      codes: [{
        id: 1, type: 'FULL_CREDIT', score: 1, ruleSets: []
      }]
    }];
    const unit = await createUnit(await createBooklet('initial'));

    const result = await module.get(PersonPersistenceService).saveSubformResponsesForUnit(unit, exportSubforms);
    expect(result).toMatchObject({ success: true, saved: 4 });
    const rows = await db.manager.findBy(ResponseEntity, { unitid: unit.id });
    const engine = new AutocoderEngineService();
    for (const row of rows) {
      const status = statusNumberToString(row.status);
      expect(status).toBe(exportSubforms.find(subform => subform.id === row.subform)?.responses[0].status);
      if (status !== 'DISPLAYED' && status !== 'VALUE_CHANGED') throw new Error(`Unexpected import status: ${status}`);
      const [coded] = engine.codeAutocoderResponses([{ id: row.variableid, value: row.value, status }], scheme);
      expect(coded.status).toBe('CODING_INCOMPLETE');
      await db.manager.update(ResponseEntity, row.id, { status_v1: statusStringToNumber(coded.status) });
    }

    const variables = [{ unitName: unit.name, variableId: 'drawing' }];
    const jobs = module.get(CodingJobResponsesService);
    const jobCandidates = async () => {
      const candidates = await jobs.getSlimResponsesForVariableCoverage(workspace.id, variables, [], 2, new Map());
      return candidates.map(candidate => {
        const source = rows.find(row => row.id === candidate.id);
        expect(candidate.status).toBe(source?.status);
        return source?.subform;
      });
    };
    expect(await jobCandidates()).toEqual(['viewed', 'zoomed', 'edited', 'reset']);

    const preview = await analyzeEmptyResponses();
    expect(preview.total).toBe(2);
    expect(preview.items.map(item => [item.responseId, item.value])).toEqual(rows
      .filter(row => row.subform === 'viewed' || row.subform === 'zoomed')
      .sort((a, b) => a.id - b.id).map(row => [row.id, null]));

    const coding = module.get(CodingResultsService);
    await expect(coding.applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({ success: true, updatedCount: 2 });
    expect(await jobCandidates()).toEqual(['edited', 'reset']);
    await expect(coding.applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({ success: true, updatedCount: 0 });
    await expect(db.manager.findOneBy(ResponseEntity, { unitid: unit.id, subform: 'viewed' })).resolves.toMatchObject({
      value: startingDrawing,
      status: statusStringToNumber('DISPLAYED'),
      code_v2: IQB_STANDARD_MISSING_CODES.mir
    });
  }, 30000);

  it('applies the same unit, booklet and testlet exclusions in preview and empty coding', async () => {
    const standard = await createBooklet('standard');
    const ignored = await createBooklet('ignored');
    exclusions = {
      globalIgnoredUnits: ['GLOBAL.XML'],
      ignoredBooklets: [`ignored-${workspace.id}`],
      testletIgnoredUnits: [{ bookletId: `standard-${workspace.id}`, unitId: 'TESTLET.XML' }]
    };
    const value = geometryValue(0);
    const visible = await storeResponse(await createUnit(standard), value);
    const hidden = [
      await storeResponse(await createUnit(standard, 'GLOBAL'), value),
      await storeResponse(await createUnit(ignored), value),
      await storeResponse(await createUnit(standard, 'TESTLET'), value)
    ];
    expect((await analyzeEmptyResponses()).items.map(item => item.responseId)).toEqual([visible.id]);
    await expect(module.get(CodingResultsService).applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({
      success: true, updatedCount: 1
    });
    for (const row of hidden) {
      await expect(db.manager.findOneBy(ResponseEntity, { id: row.id })).resolves.toMatchObject({ status_v2: null, code_v2: null });
    }
  });

  it('uses each COPY_VALUE source from the matching subform of the same unit', async () => {
    metadata.derivedVariableMap.set('GEOGEBRA', new Set(['judgement']));
    metadata.derivedVariablesBySourceMap.set(getManualCodingScopeKey('GEOGEBRA', 'drawing'), new Set(['judgement']));
    const value = geometryValue(0);
    const unit = await createUnit(await createBooklet('subforms'));
    const viewedBase = await storeResponse(unit, value, 'DISPLAYED', 'drawing', 'viewed');
    const viewedTarget = await storeResponse(unit, value, 'VALUE_CHANGED', 'judgement', 'viewed');
    await storeResponse(unit, value, 'VALUE_CHANGED', 'drawing', 'reset');
    const resetTarget = await storeResponse(unit, value, 'VALUE_CHANGED', 'judgement', 'reset');
    const unmatchedTarget = await storeResponse(unit, value, 'VALUE_CHANGED', 'judgement', 'unmatched');
    const unnamedBase = await storeResponse(unit, value);
    const unnamedTarget = await storeResponse(unit, value, 'VALUE_CHANGED', 'judgement', '');

    const candidates = await module.get(CodingJobResponsesService).getSlimResponsesForVariables(
      workspace.id, [{ unitName: 'GEOGEBRA', variableId: 'judgement' }]
    );
    const selected = module.get(CodingJobAggregationService).deduplicateSlimResponsesForManualCoding(
      candidates, new Set([viewedTarget.id]), () => true
    );
    expect(selected.responses.map(row => row.id)).toEqual([viewedTarget.id, resetTarget.id, unmatchedTarget.id, unnamedTarget.id]);
    expect(selected.assignedResponseIds).toEqual(new Set([viewedTarget.id]));

    const preview = await analyzeEmptyResponses();
    const expectedIds = [viewedBase.id, unnamedBase.id, viewedTarget.id, unnamedTarget.id];
    expect(preview.items.map(row => [row.responseId, row.value])).toEqual(expectedIds.map(id => [id, null]));
    await expect(module.get(CodingResultsService).applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({
      success: true, updatedCount: 4
    });
    const jobs = await module.get(CodingJobResponsesService).getSlimResponsesForVariables(
      workspace.id, [{ unitName: 'GEOGEBRA', variableId: 'judgement' }]
    );
    expect(jobs.map(row => row.id)).toEqual([resetTarget.id, unmatchedTarget.id]);
  });

  it('reads global and local leaf sources for a named SUM_SCORE target', async () => {
    const unit = await createUnit(await createBooklet('mixed-scope'));
    const value = geometryValue(0);
    metadata.derivedVariableMap.set(unit.name, new Set(['target']));
    for (const id of ['global', 'local']) {
      metadata.derivedVariablesBySourceMap.set(getManualCodingScopeKey(unit.name, id), new Set(['target']));
    }
    const inputs = [
      { id: 'global', status: 'DISPLAYED' as const, value },
      {
        id: 'local', status: 'DISPLAYED' as const, value, subform: 'A'
      },
      {
        id: 'local', status: 'VALUE_CHANGED' as const, value, subform: 'B'
      }
    ];
    const scheme: VariableCodingData[] = ['global', 'local'].map(id => ({
      id,
      sourceType: 'BASE',
      sourceParameters: { processing: ['TAKE_DISPLAYED_AS_VALUE_CHANGED'] },
      codes: [{ id: 0, type: 'RESIDUAL_AUTO', score: 0 }]
    }));
    scheme.push({
      id: 'target',
      sourceType: 'SUM_SCORE',
      deriveSources: ['local', 'global'],
      codes: [{
        id: 1, type: 'FULL_CREDIT', score: 1, ruleSets: []
      }]
    });
    const results = new AutocoderEngineService().codeAutocoderResponses(inputs, scheme);
    for (const input of inputs) {
      const source = await storeResponse(unit, value, input.status, input.id, input.subform);
      const coded = results.find(row => row.id === input.id && row.subform === input.subform)!;
      await db.manager.update(ResponseEntity, source.id, { status_v1: statusStringToNumber(coded.status) });
    }
    const targets = results.filter(row => row.id === 'target' && row.subform);
    expect(targets.map(row => [row.subform, row.status, row.value])).toEqual([
      ['A', 'CODING_INCOMPLETE', 0], ['B', 'CODING_INCOMPLETE', 0]
    ]);
    const ids: number[] = [];
    for (const target of targets) {
      ids.push((await storeResponse(unit, String(target.value), 'VALUE_CHANGED', target.id, target.subform)).id);
    }
    const candidates = await module.get(CodingJobResponsesService).getSlimResponsesForVariables(
      workspace.id, [{ unitName: unit.name, variableId: 'target' }]
    );
    const selection = module.get(CodingJobAggregationService).deduplicateSlimResponsesForManualCoding(
      candidates, new Set([ids[0]]), () => true
    );
    expect(selection.responses.map(row => row.id)).toEqual(ids);
    expect(selection.assignedResponseIds).toEqual(new Set([ids[0]]));
    expect((await analyzeEmptyResponses()).items.map(row => row.responseId)).toEqual([ids[0]]);
    await expect(module.get(CodingResultsService).applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({ updatedCount: 1 });
    expect((await db.manager.findOneByOrFail(ResponseEntity, { id: ids[1] })).status_v2).toBeNull();
  });

  it('recognizes displayed archives and data URIs after leading whitespace in preview and update', async () => {
    const unit = await createUnit(await createBooklet('whitespace'));
    const drawing = geometryValue(0);
    const raw = await storeResponse(unit, `\r\n ${drawing}`);
    const uri = await storeResponse(unit, `\u00a0\tdata:application/zip;base64,${drawing}`);
    const edited = await storeResponse(unit, `\n${drawing}`, 'VALUE_CHANGED');
    expect((await analyzeEmptyResponses()).items.map(row => row.responseId)).toEqual([raw.id, uri.id]);
    await expect(module.get(CodingResultsService).applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({ updatedCount: 2 });
    expect((await db.manager.findOneByOrFail(ResponseEntity, { id: edited.id })).status_v2).toBeNull();
  });

  it('counts only fully uncoded V2 responses as writable and preserves partial and legacy codings', async () => {
    const unit = await createUnit(await createBooklet('existing-coding'));
    const value = geometryValue(0);
    const writable = await storeResponse(unit, value);
    const existingCodings = [
      { status_v2: statusStringToNumber('CODING_COMPLETE'), code_v2: null, score_v2: null },
      { status_v2: null, code_v2: 0, score_v2: null },
      { status_v2: null, code_v2: null, score_v2: 0 },
      { status_v2: null, code_v2: -111, score_v2: null },
      { status_v2: null, code_v2: IQB_STANDARD_MISSING_CODES.mir, score_v2: null }
    ];
    const protectedIds: number[] = [];
    for (const coding of existingCodings) {
      const response = await storeResponse(unit, value);
      await db.manager.update(ResponseEntity, response.id, coding);
      protectedIds.push(response.id);
    }

    const preview = await analyzeEmptyResponses();
    expect(preview.totalUncoded).toBe(1);
    expect(preview.items.map(({ responseId, isCoded }) => [responseId, isCoded])).toEqual([
      [writable.id, false], ...protectedIds.slice(0, 3).map(id => [id, true])
    ]);
    expect(preview.items.find(item => item.responseId === protectedIds[1])?.assignedCode).toBe(0);

    const coding = module.get(CodingResultsService);
    await expect(coding.applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({ success: true, updatedCount: 1 });
    await expect(db.manager.findOneBy(ResponseEntity, { id: writable.id })).resolves.toMatchObject({
      code_v2: IQB_STANDARD_MISSING_CODES.mir
    });
    const stored = await db.manager.findBy(ResponseEntity, { unitid: unit.id });
    existingCodings.forEach((fields, index) => {
      expect(stored.find(row => row.id === protectedIds[index])).toMatchObject(fields);
    });
    await expect(coding.applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({ success: true, updatedCount: 0 });
  });

  it('protects a V2 score saved after the response was selected for empty coding', async () => {
    const unit = await createUnit(await createBooklet('concurrent-coding'));
    const response = await storeResponse(unit, geometryValue(0));
    const selector = module.get(EmptyResponseSelectionService);
    const classify = selector.filterEffectivelyEmptyResponses.bind(selector);
    const spy = jest.spyOn(selector, 'filterEffectivelyEmptyResponses')
      .mockImplementationOnce(async (rows, context, manager) => {
        await db.manager.update(ResponseEntity, response.id, { score_v2: 0 });
        return classify(rows, context, manager);
      });
    try {
      await expect(module.get(CodingResultsService).applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({
        success: true, updatedCount: 0
      });
      await expect(db.manager.findOneBy(ResponseEntity, { id: response.id })).resolves.toMatchObject({
        status_v2: null, code_v2: null, score_v2: 0
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('reads beyond a full page of rejected archive candidates and applies only once', async () => {
    const unit = await createUnit(await createBooklet('paging'));
    await db.getRepository(ResponseEntity).insert(Array.from({ length: 500 }, () => ({
      unitid: unit.id,
      variableid: 'drawing',
      status: statusStringToNumber('DISPLAYED'),
      status_v1: statusStringToNumber('CODING_INCOMPLETE'),
      value: 'UEsD-invalid'
    })));
    const last = await storeResponse(unit, geometryValue(0));
    const classify = jest.spyOn(module.get(EmptyResponseSelectionService), 'filterEffectivelyEmptyResponses');
    try {
      const coding = module.get(CodingResultsService);
      await expect(coding.applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({ success: true, updatedCount: 1 });
      expect(classify.mock.calls.map(([rows]) => rows.length)).toEqual([500, 1]);
      await expect(db.manager.findOneBy(ResponseEntity, { id: last.id })).resolves.toMatchObject({
        code_v2: IQB_STANDARD_MISSING_CODES.mir
      });
      await expect(coding.applyEmptyResponseCoding(workspace.id)).resolves.toMatchObject({ success: true, updatedCount: 0 });
    } finally {
      classify.mockRestore();
    }
  });
});
