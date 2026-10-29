import { Client } from 'pg';
import { DataSource, Repository } from 'typeorm';
import { ResponseEntity } from '../../database/entities/response.entity';
import { VariableAnalysisOptions } from '../../../../../../api-dto/coding/variable-analysis-options';
import { VariableAnalysisProcessor } from './variable-analysis.processor';

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
      {} as Repository<ResponseEntity>, {} as never, {} as never, {} as never
    );
  });

  afterAll(async () => {
    await client?.end();
  });

  const analyze = async (options: VariableAnalysisOptions, variableId = 'VAR') => {
    const query = dataSource.createQueryBuilder()
      .from('analysis_response', 'response')
      .innerJoin('analysis_unit', 'unit', 'unit.id = response.unitid')
      .innerJoin('analysis_booklet', 'booklet', 'booklet.id = unit.booklet_id')
      .innerJoin('analysis_person', 'person', 'person.id = booklet.person_id')
      .where('person.consider = :consider', { consider: true });
    const internals = processor as unknown as {
      getDedupedAnalysisSql: (query: unknown, keys: string[], options: VariableAnalysisOptions) => { sql: string; parameters: unknown[] };
      getEmptyValueSql: (alias: string, column: string) => string;
    };
    const source = internals.getDedupedAnalysisSql(query, [`UNIT\u001F${variableId}`], options);
    const summary = await client.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "analysisValid")::int AS valid,
        COUNT(*) FILTER (WHERE ${internals.getEmptyValueSql('analysis_rows', 'rawValue')})::int AS empty
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
      { value: '0', count: 2, valid: 2 },
      { value: '1', count: 1, valid: 1 },
      { value: '2', count: 2, valid: 1 }
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
});
