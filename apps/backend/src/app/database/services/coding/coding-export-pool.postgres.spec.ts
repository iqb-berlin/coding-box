import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import { parseString } from 'fast-csv';
import { DataSource } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Setting } from '../../entities/setting.entity';
import { CODING_INCOMPLETE_STATUS } from '../../utils/manual-coding-candidate.util';
import type { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import type { WorkspaceFileMetadataReader } from '../workspace/workspace-file-metadata-reader.token';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingItemBuilderService } from './coding-item-builder.service';
import { CodingListStreamService } from './coding-list-stream.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import { CodingResponseFilterService } from './coding-response-filter.service';
import { KappaPostgresFixture } from './kappa-query.postgres.test.factory';
import type { MissingsProfilesService } from './missings-profiles.service';

const serverUrl = process.env.KAPPA_QUERY_TEST_DATABASE_URL;
const describePostgres = serverUrl ? describe : describe.skip;

describePostgres('Coding exports with one PostgreSQL connection', () => {
  const fixture = new KappaPostgresFixture();
  const variables = ['FIRST', 'SECOND'];
  const expected = [['FIRST', '2', 'anchor-FIRST'], ['SECOND', '3', 'anchor-SECOND']];
  let db: DataSource;
  let workspaceId: number;
  let service: CodingListStreamService;

  beforeAll(async () => {
    await fixture.open(serverUrl!);
    ({ workspaceId } = await fixture.workspace('Export pool'));
    for (const variable of variables) {
      const id = await fixture.response(workspaceId, 'UNIT', variable, variable);
      await fixture.db.getRepository(ResponseEntity).update(id, { status_v1: CODING_INCOMPLETE_STATUS, code_v1: 1 });
    }
    await fixture.insert('file_upload', {
      workspace_id: workspaceId,
      file_type: 'Resource',
      file_id: 'UNIT.VOCS',
      data: JSON.stringify({ variableCodings: variables.map((id, index) => ({ id, page: String(index + 3) })) })
    });
    db = await new DataSource({
      ...fixture.db.options,
      extra: { max: 1, connectionTimeoutMillis: 350, options: '-c lock_timeout=500' }
    }).initialize();
    const anchors = new CodingReplayAnchorService(db.getRepository(Setting));
    for (const variableId of variables) {
      await anchors.upsertOverride(workspaceId, { unitName: 'UNIT', variableId, replayAnchor: `anchor-${variableId}` });
    }
    const files = new CodingFileCacheService(db.getRepository(FileUpload));
    const metadata = {
      getUnitVariableMap: async () => new Map([['UNIT', new Set(variables)]]),
      getDerivedVariablesBySourceMap: async () => new Map()
    } as unknown as WorkspaceFileMetadataReader;
    const exclusions = {
      resolveExclusionsForQueries: async () => ({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] })
    } as unknown as WorkspaceExclusionService;
    const profiles = { getResolvedMissingsProfileForExport: async () => ({ byId: new Map(), byCode: new Map() }) } as unknown as MissingsProfilesService;
    const config = new ConfigService({ EXPORT_CODING_LIST_BATCH_SIZE: 1, EXPORT_VERSIONED_BATCH_SIZE: 1 });
    service = new CodingListStreamService(
      new CodingResponseFilterService(db.getRepository(ResponseEntity), files, exclusions, metadata),
      new CodingItemBuilderService(files, anchors),
      files,
      metadata,
      config,
      anchors,
      profiles
    );
  }, 60000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    await fixture.close();
  });

  it('writes both batches with their configured pages and anchors to Excel', async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await service.getCodingListAsExcel(workspaceId, '', 'http://localhost');
    await workbook.xlsx.read(Readable.from([buffer]));
    const sheet = workbook.worksheets[0];
    const rows: string[][] = [];
    sheet.eachRow((row, index) => {
      if (index > 1) rows.push([7, 8, 9].map(column => row.getCell(column).text));
    });
    expect(rows).toEqual(expected);
  });

  it('writes both batches with their configured pages and anchors to versioned CSV', async () => {
    const stream = await service.getCodingResultsByVersionCsvStream(workspaceId, 'v1', 1, '', 'http://localhost');
    const csv = await text(stream);
    const rows: string[][] = [];
    for await (const row of parseString(csv, { headers: true, delimiter: ';' })) {
      rows.push([row.variable_id, row.variable_page, row.variable_anchor]);
    }
    expect(rows).toEqual(expected);
  });

  it('fails the export when PostgreSQL cannot read the page metadata', async () => {
    await fixture.db.transaction(async locker => {
      await locker.query('LOCK TABLE file_upload IN ACCESS EXCLUSIVE MODE');
      await expect(service.getCodingListAsExcel(workspaceId, '', 'http://localhost')).rejects.toThrow(/lock timeout/);
      const csv = await service.getCodingResultsByVersionCsvStream(workspaceId, 'v1', 1, '', 'http://localhost');
      await expect(text(csv)).rejects.toThrow(/lock timeout/);
    });
    await expect(db.query('SELECT 1 AS available')).resolves.toEqual([{ available: 1 }]);
  });
});
