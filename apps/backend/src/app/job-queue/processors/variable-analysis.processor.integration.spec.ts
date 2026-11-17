import { Client } from 'pg';
import { Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { CodingFactory } from '@iqb/responses';
import ExcelJS from 'exceljs';
import { ResponseEntity } from '../../database/entities/response.entity';
import { VariableAnalysisOptions } from '../../../../../../api-dto/coding/variable-analysis-options';
import { VariableAnalysisProcessor } from './variable-analysis.processor';
import { getEmptyVariableAnalysisValueSql, getVariableAnalysisColumns } from './variable-analysis-query.util';
import { isEmptyVariableAnalysisValue, isValidVariableAnalysisRawValue } from '../../../../../../api-dto/coding/variable-analysis-rules';
import { getVariableAnalysisMetadata } from './variable-analysis-metadata.util';
import { VariableDetailDto } from '../../models/unit-variable-details.dto';
import { VariableCombo, VARIABLE_ANALYSIS_RESULT_VERSION } from '../../admin/variable-analysis/dto/variable-analysis-result.dto';
import { VariableFrequencyDto } from '../../admin/variable-analysis/dto/variable-frequency.dto';
import { VariableAnalysisService } from '../../database/services/test-results/variable-analysis.service';
import { statusStringToNumber } from '../../database/utils/response-status-converter';
import { VariableAnalysisJobData } from '../job-queue.service';

// Run against a disposable PostgreSQL database, never against workspace data.
const databaseUrl = process.env.VARIABLE_ANALYSIS_TEST_DB_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Variable analysis SQL with PostgreSQL', () => {
  let client: Client;
  let processor: VariableAnalysisProcessor;
  const dataSource = new DataSource({ type: 'postgres' });

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE analysis_person (id int, consider boolean);
      CREATE TEMP TABLE analysis_booklet (id int, person_id int);
      CREATE TEMP TABLE analysis_unit (id int, name text, booklet_id int);
      CREATE TEMP TABLE analysis_response (
        id int, unitid int, variableid text, subform text, value text, status int,
        code_v1 int, status_v1 int, score_v1 int,
        code_v2 int, status_v2 int, score_v2 int,
        code_v3 int, status_v3 int, score_v3 int
      );
      INSERT INTO analysis_person SELECT n, true FROM generate_series(1, 8) n;
      INSERT INTO analysis_booklet SELECT n, n FROM generate_series(1, 8) n;
      INSERT INTO analysis_unit SELECT n, 'UNIT', n FROM generate_series(1, 8) n;
      INSERT INTO analysis_response VALUES
        (1, 1, 'VAR', '', 'shared',   3, 0, 5, 0,    1, 5, 1,    NULL, NULL, NULL),
        (2, 2, 'VAR', '', 'shared',   3, 1, 5, NULL, 0, 5, 0,    NULL, NULL, NULL),
        (3, 3, 'VAR', '', '',         3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        (4, 4, 'VAR', '', 'shared',   3, 2, 7, 0,    NULL, NULL, NULL, NULL, NULL, NULL),
        (5, 5, 'VAR', '', 'null',     3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        (6, 6, 'VAR', '', '   ',      3, 0, 5, 0,    NULL, NULL, NULL, NULL, NULL, NULL),
        (7, 7, 'VAR', '', 'x',        2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        (8, 8, 'VAR', '', 'intended', 3, 2, 12, 0,   NULL, NULL, NULL, NULL, NULL, NULL),
        (9, 1, 'VAR', '', '',         3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    `);
    for (const [index, value] of ['', '\t', '[ ]', '[false, false]', null].entries()) {
      await client.query(`INSERT INTO analysis_response
        (id, unitid, variableid, subform, value, status, code_v1, status_v1)
        VALUES ($1, 1, 'EMPTY', $2, $3, 3, 0, 5)`, [20 + index, `empty-${index}`, value]);
    }
    processor = new VariableAnalysisProcessor(
      { query: async (sql: string, parameters: unknown[]) => (await client.query(sql, parameters)).rows } as Repository<ResponseEntity>,
      {} as never,
      {} as never,
      {} as never
    );
  });

  afterAll(async () => {
    await client?.end();
  });

  const createQuery = () => dataSource.createQueryBuilder()
    .from('analysis_response', 'response')
    .innerJoin('analysis_unit', 'unit', 'unit.id = response.unitid')
    .innerJoin('analysis_booklet', 'booklet', 'booklet.id = unit.booklet_id')
    .innerJoin('analysis_person', 'person', 'person.id = booklet.person_id')
    .where('person.consider = :consider', { consider: true });

  const analyze = async (options: VariableAnalysisOptions, variableId = 'VAR') => {
    const query = createQuery();
    const internals = processor as unknown as {
      getDedupedAnalysisSql: (query: unknown, keys: string[], options: VariableAnalysisOptions) => { sql: string; parameters: unknown[] };
    };
    const source = internals.getDedupedAnalysisSql(query, [`UNIT\u001F${variableId}`], options);
    const summary = await client.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "analysisValid")::int AS valid,
        COUNT(*) FILTER (WHERE ${getEmptyVariableAnalysisValueSql('analysis_rows."rawValue"')})::int AS empty
      FROM (${source.sql}) analysis_rows
    `, source.parameters);
    const frequencies = await client.query(`
      SELECT COALESCE(value, '') AS value, COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE "analysisValid")::int AS valid
      FROM (${source.sql}) analysis_rows
      GROUP BY COALESCE(value, '') ORDER BY value
    `, source.parameters);
    return { summary: summary.rows[0], frequencies: frequencies.rows };
  };

  it('keeps raw validity independent of coding results and rejects VALUE_CHANGED with an empty value', async () => {
    const result = await analyze({ analysisMode: 'values' });
    expect(result.summary).toEqual({ total: 8, valid: 5, empty: 2 });
    expect(result.frequencies).toContainEqual({ value: 'shared', count: 3, valid: 3 });
    expect(result.frequencies).toContainEqual({ value: '', count: 1, valid: 0 });
    expect(result.frequencies).toContainEqual({ value: 'null', count: 1, valid: 1 });
  });

  it('separates codes for the same raw answer, including code zero and a code without a score', async () => {
    const result = await analyze({ analysisMode: 'codes', codingVersion: 'v1' });
    expect(result.summary).toEqual({ total: 8, valid: 4, empty: 2 });
    expect(result.frequencies).toEqual([
      { value: '', count: 3, valid: 0 },
      { value: '12:2', count: 1, valid: 1 },
      { value: '5:0', count: 2, valid: 2 },
      { value: '5:1', count: 1, valid: 1 },
      { value: '7:2', count: 1, valid: 0 }
    ]);
  });

  it('uses only the selected coding run, including a run with no assigned codes', async () => {
    expect((await analyze({ analysisMode: 'codes', codingVersion: 'v2' })).summary).toEqual({ total: 8, valid: 2, empty: 2 });
    const result = await analyze({ analysisMode: 'codes', codingVersion: 'v3' });
    expect(result.summary).toEqual({ total: 8, valid: 0, empty: 2 });
    expect(result.frequencies).toEqual([{ value: '', count: 8, valid: 0 }]);
  });

  it('counts empty and unselected raw values consistently across both analysis modes', async () => {
    expect((await analyze({ analysisMode: 'values' }, 'EMPTY')).summary).toEqual({ total: 5, valid: 0, empty: 5 });
    expect((await analyze({ analysisMode: 'codes' }, 'EMPTY')).summary).toEqual({ total: 5, valid: 5, empty: 5 });
  });

  it('keeps SQL and JavaScript emptiness consistent for long padded values', async () => {
    const padding = ' '.repeat(100000);
    const values = [padding, `${padding}["A"]`, `${padding}x`, `${padding}[ false, FALSE ]${padding}`, `[${padding}]`];
    const result = await client.query(`
      SELECT ${getEmptyVariableAnalysisValueSql('response.value')} AS empty
      FROM jsonb_to_recordset($1::jsonb) AS response(id int, value text)
      ORDER BY response.id
    `, [JSON.stringify(values.map((value, id) => ({ id, value })))]);

    expect(result.rows.map(row => row.empty)).toEqual([true, false, false, true, true]);
    expect(values.map(isEmptyVariableAnalysisValue)).toEqual([true, false, false, true, true]);
  });

  it('serves newly computed results from a legacy queued job and preserves long empty values', async () => {
    const variableId = 'LONG_EMPTY';
    const values = [' '.repeat(500), ' '.repeat(501), ' '.repeat(1000), `${' '.repeat(1000)}x`];
    for (const [index, value] of values.entries()) {
      await client.query(`INSERT INTO analysis_response (id, unitid, variableid, subform, value, status)
        VALUES ($1, $2, $3, '', $4, 3)`, [400 + index, index + 1, variableId, value]);
    }

    const options = { analysisMode: 'values' } as const;
    const combo: VariableCombo = {
      ...options, unitId: 1, unitName: 'UNIT', variableId
    };
    const entry = {
      ...getVariableAnalysisMetadata({
        id: variableId, alias: variableId, type: 'string', hasCodingScheme: false
      }),
      combo,
      comboKey: `1:${variableId}`,
      logicalKey: `UNIT\u001F${variableId}`
    };
    // Keep the real generated aggregation SQL; only workspace/scope discovery is stubbed.
    const query = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      clone: () => createQuery()
    };
    const cached = new Map<string, unknown>();
    const cache = {
      set: async (key: string, value: unknown) => { cached.set(key, value); return true; },
      get: async (key: string) => cached.get(key)
    };
    const worker = new VariableAnalysisProcessor({
      createQueryBuilder: () => query,
      query: async (sql: string, parameters: unknown[]) => (await client.query(sql, parameters)).rows
    } as unknown as Repository<ResponseEntity>, cache as never, {
      resolveExclusionsForQueries: async () => ({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] })
    } as never, {} as never);
    jest.spyOn(worker as unknown as { getAnalysisScope(): Promise<typeof entry[]> }, 'getAnalysisScope').mockResolvedValue([entry]);
    const job = {
      id: 'long-empty',
      data: { workspaceId: 1, resultVersion: 10, ...options },
      updateProgress: jest.fn()
    } as unknown as Job<VariableAnalysisJobData>;
    const result = await worker.processWorkspaceJob(job);
    expect(result.resultVersion).toBe(VARIABLE_ANALYSIS_RESULT_VERSION);
    const service = new VariableAnalysisService({
      getVariableAnalysisJob: async () => ({ data: job.data, getState: async () => 'completed', returnvalue: result })
    } as never, cache as never);

    const page = await service.getAnalysisResultsPage(job.id!, 1);
    expect(page.rows).toHaveLength(4);
    page.rows!.forEach(row => expect(row).toMatchObject({ totalCount: 4, validCount: 1, emptyCount: 3 }));
    const longEmpty = page.rows!.find(row => row.value.includes('truncated 1000 chars'))!;
    const longNonEmpty = page.rows!.find(row => row.value.includes('truncated 1001 chars'))!;
    expect(longEmpty).toMatchObject({ isEmptyValue: true, validOccurrenceCount: 0 });
    expect(longNonEmpty).toMatchObject({ isEmptyValue: false, validOccurrenceCount: 1 });
    expect(page.frequencies[entry.comboKey]).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: longEmpty.value, isEmptyValue: true })
    ]));

    const csv = await service.exportAnalysisResultsAsCsv(job.id!, 1);
    const [headers, ...csvRows] = csv.trim().split(/\r?\n/).map(row => row.split(';'));
    const flagIndex = headers.indexOf('Wert ist leer');
    expect(csvRows.map(row => row[flagIndex]).sort()).toEqual(['ja', 'ja', 'ja', 'nein']);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await service.exportAnalysisResultsAsXlsx(job.id!, 1) as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Antwortwerte')!;
    const xlsxHeaders = sheet.getRow(1).values as string[];
    expect(sheet.getRows(2, 4)!.map(row => row.getCell(xlsxHeaders.indexOf('Wert ist leer')).value).sort()).toEqual(['ja', 'ja', 'ja', 'nein']);
  });

  it.each([
    { analysisMode: 'values' },
    ...(['v1', 'v2', 'v3'] as const).map(codingVersion => ({ analysisMode: 'codes', codingVersion }))
  ] as VariableAnalysisOptions[])('uses the same rules in SQL and JavaScript for %j', async options => {
    const values = [null, '', ' \t\r\n', '\u00a0', '\u2003', '[]', '[false, FALSE]', 'null', '0', 'false', '[true,false]', '[null]', '"[]"'];
    const responses = values.flatMap(value => [null, ...Array.from({ length: 14 }, (_, status) => status)]
      .flatMap(status => [null, 0, 4].map(code => ({ value, status, code }))));
    const columns = getVariableAnalysisColumns(options);
    const result = await client.query(`
      SELECT response.id, ${getEmptyVariableAnalysisValueSql('response.value')} AS empty,
        COALESCE((${columns.valid}), false) AS valid
      FROM (
        SELECT input.*, code AS code_v1, code AS code_v2, code AS code_v3,
          status AS status_v1, status AS status_v2, status AS status_v3
        FROM jsonb_to_recordset($1::jsonb) AS input(id int, value text, status int, code int)
      ) response ORDER BY response.id
    `, [JSON.stringify(responses.map((response, id) => ({ id, ...response })))]);
    expect(result.rows).toEqual(responses.map((response, id) => ({
      id,
      empty: isEmptyVariableAnalysisValue(response.value),
      valid: options.analysisMode === 'codes' ?
        response.code !== null && (response.status === 5 || response.status === 12) :
        isValidVariableAnalysisRawValue(response.value, response.status)
    })));
  });

  it.each([
    { analysisMode: 'values' },
    ...(['v1', 'v2', 'v3'] as const).map(codingVersion => ({ analysisMode: 'codes', codingVersion }))
  ] as VariableAnalysisOptions[])('keeps empty multiple raw responses independent of the analysis mode through exports for %j', async options => {
    const variableId = `MULTI_EMPTY_${options.codingVersion ?? 'values'}`;
    const responses = [
      { value: '[null]', code: 0, status: 5 },
      { value: '["",null]', code: 0, status: 5 },
      { value: '[false,false]', code: 1, status: 7 },
      { value: null, code: null, status: null },
      { value: '["null"]', code: 1, status: 5 },
      { value: '["A","B"]', code: 1, status: 5 },
      { value: '["[]"]', code: 0, status: 5 },
      { value: '["[false]","A"]', code: 1, status: 5 }
    ];
    for (const [index, { value, code, status }] of responses.entries()) {
      await client.query(`INSERT INTO analysis_response
        (id, unitid, variableid, subform, value, status, code_v1, status_v1, code_v2, status_v2, code_v3, status_v3)
        VALUES ($1, $2, $3, '', $4, 3, $5, $6, $5, $6, $5, $6)`,
      [200 + index, index + 1, variableId, value, code, status]);
    }

    const initial = await analyze(options, variableId);
    const metadata = getVariableAnalysisMetadata({
      id: variableId,
      alias: variableId,
      type: 'string',
      multiple: true,
      hasCodingScheme: true,
      codes: [{ id: 0, label: 'Nullcode', score: 0 }, { id: 1, label: 'Eins', score: 1 }, { id: 2, label: 'Unbeobachtet' }],
      values: [
        { value: 'A', label: 'Alpha' },
        { value: 'B', label: 'Beta' },
        { value: '   ', label: 'Leeres Feld' }
      ]
    }, options);
    const combo: VariableCombo = {
      ...options,
      unitId: 1,
      unitName: 'UNIT',
      variableId,
      totalCount: initial.summary.total,
      validCount: initial.summary.valid,
      emptyCount: initial.summary.empty,
      distinctValueCount: initial.frequencies.length
    };
    const comboKey = `1:${variableId}`;
    const logicalKey = `UNIT\u001F${variableId}`;
    const entry = {
      ...metadata, combo, comboKey, logicalKey
    };
    const frequencies: Record<string, VariableFrequencyDto[]> = { [comboKey]: [] };
    const internals = processor as unknown as {
      addObservedValueFrequencies: VariableAnalysisProcessor['addObservedValueFrequencies'];
      recalculateMultipleVariableFrequencies: VariableAnalysisProcessor['recalculateMultipleVariableFrequencies'];
      addSchemaCodeFrequencies: VariableAnalysisProcessor['addSchemaCodeFrequencies'];
      finalizeFrequencies: VariableAnalysisProcessor['finalizeFrequencies'];
    };
    await internals.addObservedValueFrequencies(initial.frequencies.map(row => ({
      ...row, unitName: 'UNIT', variableId, valueLength: row.value.length, validCount: row.valid, nullCount: 0, responseId: 200
    })), new Map([[logicalKey, entry]]), frequencies);
    const counts = await internals.recalculateMultipleVariableFrequencies(
      createQuery() as never, [entry], frequencies, new Map([[comboKey, metadata]])
    );
    await internals.addSchemaCodeFrequencies(createQuery() as never, [entry], frequencies, new Map([[comboKey, metadata.categoryDefinitions]]), counts);
    internals.finalizeFrequencies([combo], frequencies);

    const validCount = options.analysisMode === 'codes' ? 6 : 4;
    expect(combo).toMatchObject({
      totalCount: 8, validCount, invalidCount: 8 - validCount, emptyCount: 4
    });
    expect(combo.emptyPercentage).toBe(50);
    const service = new VariableAnalysisService({
      getVariableAnalysisJob: async () => ({
        data: { workspaceId: 1 },
        getState: async () => 'completed',
        returnvalue: {
          resultVersion: VARIABLE_ANALYSIS_RESULT_VERSION, variableCombos: [combo], frequencies, total: 1
        }
      })
    } as never, {} as never);
    const resultOptions = { includeSchemaCodes: options.analysisMode === 'values' };
    const page = await service.getAnalysisResultsPage('job-1', 1, resultOptions);
    expect(page.rows?.length).toBeGreaterThan(0);
    page.rows?.forEach(row => expect(row).toMatchObject({ totalCount: 8, validCount, emptyCount: 4 }));
    if (options.analysisMode === 'codes') {
      expect(Object.fromEntries(page.rows!.map(row => [row.value, [row.count, row.validOccurrenceCount, row.percentageValid]]))).toEqual({
        0: [3, 3, 50],
        1: [3, 3, 50],
        '1 (INVALID)': [1, 0, 0],
        '': [1, 0, 0]
      });
    } else {
      expect(page.rows).toEqual(expect.arrayContaining(['null', 'B', '[]', '[false]'].map(value => expect.objectContaining({
        value, count: 1, validOccurrenceCount: 1, isEmptyValue: false, percentageValid: 25
      }))));
      expect(page.rows).toContainEqual(expect.objectContaining({
        value: 'A', count: 2, validOccurrenceCount: 2, percentageValid: 50
      }));
      expect(page.rows!.filter(row => row.isEmptyValue)).toEqual([expect.objectContaining({
        value: '', count: 4, validOccurrenceCount: 0, percentageValid: 0
      })]);
      expect(page.rows!.find(row => row.isEmptyValue)?.isSchemaOnly).not.toBe(true);
    }

    const csv = await service.exportAnalysisResultsAsCsv('job-1', 1, resultOptions);
    const [headers, ...csvRows] = csv.trim().split(/\r?\n/).map(row => row.split(';'));
    expect(csvRows).toHaveLength(page.rows!.length);
    csvRows.forEach(row => {
      expect(row[headers.indexOf('Leere Rohwerte')]).toBe('4');
      expect(row[headers.indexOf('Leere Rohwerte (%)')]).toBe('50');
      expect(row[headers.indexOf('Antworten gültig')]).toBe(String(validCount));
      if (options.analysisMode === 'values') {
        const isEmpty = row[headers.indexOf('Antwortwert/Kategorie oder Code')] === '';
        expect(row[headers.indexOf('Wert ist leer')]).toBe(isEmpty ? 'ja' : 'nein');
        if (isEmpty) expect(row[headers.indexOf('Anzahl Antworten')]).toBe('4');
      }
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await service.exportAnalysisResultsAsXlsx('job-1', 1, resultOptions) as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Antwortwerte')!;
    const xlsxHeaders = sheet.getRow(1).values as string[];
    expect(sheet.rowCount).toBe(page.rows!.length + 1);
    sheet.getRows(2, sheet.rowCount - 1)!.forEach(row => {
      expect(row.getCell(xlsxHeaders.indexOf('Leere Rohwerte')).value).toBe(4);
      expect(row.getCell(xlsxHeaders.indexOf('Leere Rohwerte (%)')).value).toBe(50);
      expect(row.getCell(xlsxHeaders.indexOf('Antworten gültig')).value).toBe(validCount);
      if (options.analysisMode === 'values') {
        const isEmpty = row.getCell(xlsxHeaders.indexOf('Antwortwert/Kategorie oder Code')).text === '';
        expect(row.getCell(xlsxHeaders.indexOf('Wert ist leer')).value).toBe(isEmpty ? 'ja' : 'nein');
        if (isEmpty) expect(row.getCell(xlsxHeaders.indexOf('Anzahl Antworten')).value).toBe(4);
      }
    });
  });

  it('keeps the same Boolean position in cached pages, CSV and XLSX with and without literal "1"', async () => {
    const variableId = 'BOOLEAN_POSITION';
    await client.query(`INSERT INTO analysis_response (id, unitid, variableid, subform, value, status)
      VALUES (600, 1, $1, '', '[true]', 3), (601, 2, $1, '', '["1"]', 3)`, [variableId]);
    const variable: VariableDetailDto = {
      id: variableId, alias: variableId, type: 'boolean', multiple: true, hasCodingScheme: false
    };
    const queryDatabase = async (sql: string, parameters: unknown[]) => (await client.query(sql, parameters)).rows;

    for (const unitId of [1, undefined]) {
      const combo: VariableCombo = {
        analysisMode: 'values', unitId: 1, unitName: 'UNIT', variableId
      };
      const entry = {
        ...getVariableAnalysisMetadata(variable),
        combo,
        comboKey: `1:${variableId}`,
        logicalKey: `UNIT\u001F${variableId}`
      };
      const query = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        clone: () => (unitId === undefined ? createQuery() : createQuery().andWhere('unit.id = :unitId', { unitId }))
      };
      const cached = new Map<string, unknown>();
      const cache = {
        set: async (key: string, value: unknown) => { cached.set(key, value); return true; },
        get: async (key: string) => cached.get(key)
      };
      const worker = new VariableAnalysisProcessor({
        createQueryBuilder: () => query,
        query: queryDatabase
      } as unknown as Repository<ResponseEntity>, cache as never, {
        resolveExclusionsForQueries: async () => ({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] })
      } as never, {} as never);
      jest.spyOn(worker as unknown as { getAnalysisScope(): Promise<typeof entry[]> }, 'getAnalysisScope').mockResolvedValue([entry]);
      const jobId = `boolean-position-${unitId ?? 'all'}`;
      const job = {
        id: jobId, data: { workspaceId: 1, analysisMode: 'values', unitId }, updateProgress: jest.fn()
      } as unknown as Job<VariableAnalysisJobData>;
      const result = await worker.processWorkspaceJob(job);
      const service = new VariableAnalysisService({
        getVariableAnalysisJob: async () => ({ data: job.data, getState: async () => 'completed', returnvalue: result })
      } as never, cache as never);
      const expectedCount = unitId === undefined ? 2 : 1;
      const page = await service.getAnalysisResultsPage(jobId, 1);
      expect(page.rows).toHaveLength(expectedCount);
      expect(page.rows).toContainEqual(expect.objectContaining({ value: '1', position: 1, count: 1 }));
      expect(page.frequencies[entry.comboKey]).toContainEqual(expect.objectContaining({ value: '1', position: 1, count: 1 }));
      if (unitId === undefined) {
        expect(page.rows).toContainEqual(expect.objectContaining({ value: '1', position: undefined, count: 1 }));
        const first = await service.getAnalysisResultsPage(jobId, 1, { page: 1, pageSize: 1, sortBy: 'value' });
        const second = await service.getAnalysisResultsPage(jobId, 1, { page: 2, pageSize: 1, sortBy: 'value' });
        expect(first.rows).toEqual([expect.objectContaining({ value: '1', position: 1 })]);
        expect(second.rows).toEqual([expect.objectContaining({ value: '1', position: undefined })]);
      }

      const columns = ['Antwortwert/Kategorie oder Code', 'Antwortposition', 'Anzahl Antworten'];
      const csv = await service.exportAnalysisResultsAsCsv(jobId, 1);
      const [headers, ...csvRows] = csv.trim().split(/\r?\n/).map(row => row.split(';'));
      const expectedCsv = [['1', '1', '1'], ...(unitId === undefined ? [['1', '', '1']] : [])];
      expect(csvRows.map(row => columns.map(header => row[headers.indexOf(header)])).sort()).toEqual(expectedCsv.sort());

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await service.exportAnalysisResultsAsXlsx(jobId, 1) as unknown as ExcelJS.Buffer);
      const sheet = workbook.getWorksheet('Antwortwerte')!;
      const xlsxHeaders = sheet.getRow(1).values as string[];
      const xlsxRows = sheet.getRows(2, expectedCount)!.map(row => columns.map(header => row.getCell(xlsxHeaders.indexOf(header)).value));
      const expectedXlsx = [['1', 1, 1], ...(unitId === undefined ? [['1', '', 1]] : [])];
      expect(xlsxRows.sort()).toEqual(expectedXlsx.sort());
    }
  });

  it.each([0, 4])('enriches manually assigned intended-incomplete code %i in v2 without an unobserved status duplicate', async code => {
    const variableId = `MANUAL_FALLBACK_${code}`;
    await client.query(`INSERT INTO analysis_response
      (id, unitid, variableid, subform, value, status, code_v2, status_v2, score_v2)
      VALUES (500, 1, $1, '', 'manual', 3, $2, 5, 2),
        (501, 2, $1, '', 'other', 3, 1, 5, 0)`, [variableId, code]);
    const options = { analysisMode: 'codes' as const, codingVersion: 'v2' as const };
    const combo: VariableCombo = {
      ...options, unitId: 1, unitName: 'UNIT', variableId
    };
    const entry = {
      ...getVariableAnalysisMetadata({
        id: variableId,
        alias: variableId,
        type: 'string',
        hasCodingScheme: true,
        codes: [
          {
            id: code, label: 'Manuelle Restkategorie', score: 2, type: 'INTENDED_INCOMPLETE', manualInstruction: 'Sonstige Antwort'
          },
          { id: 1, label: 'Andere Antwort', score: 0 },
          { id: 99, label: 'Unbeobachtet', score: 3 }
        ]
      }, options),
      combo,
      comboKey: `1:${variableId}`,
      logicalKey: `UNIT\u001F${variableId}`
    };
    const query = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      clone: () => createQuery()
    };
    const cached = new Map<string, unknown>();
    const cache = {
      set: async (key: string, value: unknown) => { cached.set(key, value); return true; },
      get: async (key: string) => cached.get(key)
    };
    const worker = new VariableAnalysisProcessor({
      createQueryBuilder: () => query,
      query: async (sql: string, parameters: unknown[]) => (await client.query(sql, parameters)).rows
    } as unknown as Repository<ResponseEntity>, cache as never, {
      resolveExclusionsForQueries: async () => ({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] })
    } as never, {} as never);
    jest.spyOn(worker as unknown as { getAnalysisScope(): Promise<typeof entry[]> }, 'getAnalysisScope').mockResolvedValue([entry]);
    // Code 4 falls outside this ranking limit and must retain its actual count via supplementation.
    Object.defineProperty(worker, 'MAX_VALUES_PER_VARIABLE', { value: 1 });
    const job = {
      id: `manual-fallback-${code}`,
      data: { workspaceId: 1, ...options },
      updateProgress: jest.fn()
    } as unknown as Job<VariableAnalysisJobData>;
    const result = await worker.processWorkspaceJob(job);
    const service = new VariableAnalysisService({
      getVariableAnalysisJob: async () => ({ data: job.data, getState: async () => 'completed', returnvalue: result })
    } as never, cache as never);
    const expected = {
      value: String(code),
      label: 'Manuelle Restkategorie',
      score: 2,
      count: 1,
      validOccurrenceCount: 1,
      percentageTotal: 50,
      percentageValid: 50,
      totalCount: 2,
      validCount: 2,
      invalidCount: 0,
      hiddenValueCount: 0
    };
    const page = await service.getAnalysisResultsPage(job.id!, 1);
    expect(page.rows).toHaveLength(2);
    expect(page.rows).toContainEqual(expect.objectContaining(expected));
    const withUnobserved = await service.getAnalysisResultsPage(job.id!, 1, { includeSchemaCodes: true });
    expect(withUnobserved.rows).toHaveLength(3);
    expect(withUnobserved.rows).toContainEqual(expect.objectContaining(expected));
    expect(withUnobserved.rows).toContainEqual(expect.objectContaining({ value: '99', count: 0, isSchemaOnly: true }));

    const columns = ['Antwortwert/Kategorie oder Code', 'Label', 'Score', 'Anzahl Antworten', 'Anzahl gültiger Antworten', 'Anteil gesamt (%)', 'Anteil gültig (%)'];
    const expectedExport = [String(code), 'Manuelle Restkategorie', 2, 1, 1, 50, 50];
    const csv = await service.exportAnalysisResultsAsCsv(job.id!, 1, { includeSchemaCodes: true });
    const [headers, ...csvRows] = csv.trim().split(/\r?\n/).map(row => row.split(';'));
    expect(csvRows).toHaveLength(3);
    expect(csvRows.map(row => columns.map(header => row[headers.indexOf(header)]))).toContainEqual(expectedExport.map(String));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await service.exportAnalysisResultsAsXlsx(job.id!, 1, { includeSchemaCodes: true }) as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Antwortwerte')!;
    const xlsxHeaders = sheet.getRow(1).values as string[];
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getRows(2, 3)!.map(row => columns.map(header => row.getCell(xlsxHeaders.indexOf(header)).value))).toContainEqual(expectedExport);
  });

  it.each(['v1', 'v2', 'v3'] as const)('separates special zero codes through SQL, the result page and CSV/XLSX for %s', async codingVersion => {
    const variableId = `SPECIAL_${codingVersion}`;
    const coding = {
      id: variableId,
      sourceType: 'BASE' as const,
      codes: [
        {
          id: 0, label: 'Richtig', score: 1, ruleSets: [{ rules: [{ method: 'MATCH' as const, parameters: ['richtig'] }] }]
        },
        {
          id: 'INTENDED_INCOMPLETE' as const, label: 'Unvollständig', score: 99, ruleSets: [{ rules: [{ method: 'MATCH' as const, parameters: ['teilweise'] }] }]
        },
        {
          id: 'INVALID' as const, label: 'Ungültig', score: 99, ruleSets: [{ rules: [{ method: 'MATCH' as const, parameters: ['ungültig'] }] }]
        },
        {
          id: 4, label: 'Restkategorie', score: 2, type: 'INTENDED_INCOMPLETE' as const
        },
        { id: 99, label: 'Unbeobachtet', score: 3 }
      ]
    };
    for (const [index, value] of ['richtig', 'teilweise', 'ungültig', 'rest'].entries()) {
      const coded = CodingFactory.code({ id: variableId, value, status: 'VALUE_CHANGED' }, coding);
      await client.query(`INSERT INTO analysis_response
        (id, unitid, variableid, subform, value, status, code_v1, status_v1, score_v1, code_v2, status_v2, score_v2, code_v3, status_v3, score_v3)
        VALUES ($1, $2, $3, '', $4, 3, $5, $6, $7, $5, $6, $7, $5, $6, $7)`,
      [100 + index, index + 1, variableId, value, coded.code, statusStringToNumber(coded.status), coded.score]);
    }

    const options = { analysisMode: 'codes' as const, codingVersion };
    const actual = await analyze(options, variableId);
    expect(actual.summary).toEqual({ total: 4, valid: 3, empty: 0 });
    expect(actual.frequencies).toEqual([
      { value: '12:0', count: 1, valid: 1 },
      { value: '12:4', count: 1, valid: 1 },
      { value: '5:0', count: 1, valid: 1 },
      { value: '7:0', count: 1, valid: 0 }
    ]);
    const variable: VariableDetailDto = {
      id: variableId,
      alias: variableId,
      type: 'string',
      hasCodingScheme: true,
      coding,
      codes: coding.codes.map(code => ({ ...code, label: code.label }))
    };
    const metadata = getVariableAnalysisMetadata(variable, options);
    const combo: VariableCombo = {
      ...options,
      unitId: 1,
      unitName: 'UNIT',
      variableId,
      totalCount: 4,
      validCount: 3,
      invalidCount: 1,
      emptyCount: 0,
      distinctValueCount: 4
    };
    const comboKey = `1:${variableId}`;
    const logicalKey = `UNIT\u001F${variableId}`;
    const entry = {
      ...metadata, combo, comboKey, logicalKey
    };
    const frequencies: Record<string, VariableFrequencyDto[]> = { [comboKey]: [] };
    const internals = processor as unknown as {
      addObservedValueFrequencies: VariableAnalysisProcessor['addObservedValueFrequencies'];
      addSchemaCodeFrequencies: VariableAnalysisProcessor['addSchemaCodeFrequencies'];
      finalizeFrequencies: VariableAnalysisProcessor['finalizeFrequencies'];
    };
    // Simulate a ranking limit that omitted the special codes. Schema supplementation
    // must retrieve their actual counts, not append misleading zero-frequency rows.
    await internals.addObservedValueFrequencies([{
      unitName: 'UNIT', variableId, value: '5:0', valueLength: 3, responseId: 100, count: 1, validCount: 1, nullCount: 0
    }], new Map([[logicalKey, entry]]), frequencies);
    await internals.addSchemaCodeFrequencies(createQuery() as never, [entry], frequencies, new Map([[comboKey, metadata.categoryDefinitions]]));
    internals.finalizeFrequencies([combo], frequencies);
    const result = { variableCombos: [combo], frequencies, total: 1 };
    const service = new VariableAnalysisService({
      getVariableAnalysisJob: async () => ({
        data: { workspaceId: 1 },
        getState: async () => 'completed',
        returnvalue: { ...result, resultVersion: VARIABLE_ANALYSIS_RESULT_VERSION }
      })
    } as never, {} as never);
    const page = await service.getAnalysisResultsPage('job-1', 1);
    expect(page.rows).toHaveLength(4);
    const expectedRows = [
      ['0', 'Richtig', 1, 1, 1, 25, 100 / 3],
      ['0 (INTENDED_INCOMPLETE)', 'Unvollständig', 0, 1, 1, 25, 100 / 3],
      ['0 (INVALID)', 'Ungültig', 0, 1, 0, 25, 0],
      ['4 (INTENDED_INCOMPLETE)', 'Restkategorie', 2, 1, 1, 25, 100 / 3]
    ];
    expect(page.rows?.map(row => [row.value, row.label, row.score, row.count, row.validOccurrenceCount, row.percentageTotal])).toEqual(expectedRows.map(row => row.slice(0, -1)));
    page.rows?.forEach((row, index) => expect(row.percentageValid).toBeCloseTo(Number(expectedRows[index][6]), 10));

    const csv = await service.exportAnalysisResultsAsCsv('job-1', 1);
    const [headers, ...csvRows] = csv.trim().split(/\r?\n/).map(row => row.split(';'));
    const columns = ['Antwortwert/Kategorie oder Code', 'Label', 'Score', 'Anzahl Antworten', 'Anzahl gültiger Antworten', 'Anteil gesamt (%)', 'Anteil gültig (%)'];
    const exportedRows = expectedRows.map(row => row.map(value => (typeof value === 'number' ? Math.round(value * 10) / 10 : value)));
    expect(csvRows.map(row => columns.map(header => row[headers.indexOf(header)]))).toEqual(exportedRows.map(row => row.map(String)));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await service.exportAnalysisResultsAsXlsx('job-1', 1) as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Antwortwerte')!;
    const xlsxHeaders = sheet.getRow(1).values as string[];
    expect(sheet.rowCount).toBe(5);
    expect(sheet.getRows(2, 4)?.map(row => columns.map(header => row.getCell(xlsxHeaders.indexOf(header)).value))).toEqual(exportedRows);
  });
});
