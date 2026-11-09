import { QueryRunner } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import { CodingProcessService } from './coding-process.service';

const createSchema = (): string => JSON.stringify({
  version: '3.4',
  variableCodings: [{
    id: 'answer',
    alias: 'answer',
    sourceType: 'BASE',
    codeModel: 'MANUAL_AND_RULES',
    codes: [{
      id: 1,
      score: 1,
      ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['ok'] }] }]
    }]
  }]
});

const createFile = (fileId: string, data: string): FileUpload => ({
  file_id: fileId,
  filename: fileId,
  data
} as FileUpload);

const createQuery = <T>(rows: T[]) => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(rows)
});

const createHarness = (secondReference = '<CodingSchemeRef>S2.VOCS</CodingSchemeRef>') => {
  const units = [1, 2].map(id => ({
    id,
    bookletid: 1,
    name: `UNIT_${id}`,
    alias: `UNIT_${id}`
  } as Unit));
  const responses = units.map(unit => ({
    id: 100 + unit.id,
    unitid: unit.id,
    variableid: 'answer',
    value: 'ok',
    status: 3,
    status_v1: null,
    code_v1: null,
    score_v1: null,
    status_v2: null,
    code_v2: null,
    score_v2: null,
    status_v3: null,
    code_v3: null,
    score_v3: null,
    subform: '',
    is_autocoder_generated: false,
    autocoder_invalidated_version: null,
    inherits_v1_for_v2: false
  } as ResponseEntity));
  const files = [
    createFile('UNIT_1', '<Unit><CodingSchemeRef>S1.VOCS</CodingSchemeRef></Unit>'),
    createFile('UNIT_2', `<Unit>${secondReference}</Unit>`),
    createFile('S1.VOCS', createSchema()),
    createFile('S2.VOCS', createSchema())
  ];
  const fileRepository = {
    find: jest.fn(async (options: {
      where: { file_id: { value: string[] } };
    }) => files.filter(file => options.where.file_id.value.includes(file.file_id)))
  };
  const responseQuery = createQuery(responses);
  const responseManagement = {
    updateResponsesInDatabase: jest.fn().mockResolvedValue(true)
  };
  const readiness = {
    filterResponsesCodeable: jest.fn(async (_id: number, rows: ResponseEntity[]) => rows)
  };
  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    isReleased: true
  };
  const service = new CodingProcessService(
    fileRepository as never,
    { find: jest.fn().mockResolvedValue([{ id: 1 }]) } as never,
    { createQueryBuilder: () => createQuery(units) } as never,
    { createQueryBuilder: () => createQuery([{ id: 1, personid: 1 }]) } as never,
    {
      createQueryBuilder: () => responseQuery,
      manager: { connection: { createQueryRunner: () => queryRunner } }
    } as never,
    { getTestPersonCodingJob: jest.fn().mockResolvedValue(undefined) } as never,
    responseManagement as never,
    {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: []
      })
    } as never,
    readiness as never,
    {
      getVariableInfoForScheme: jest.fn().mockResolvedValue([{
        id: 'answer', alias: 'answer', type: 'STRING', nullable: false, multiple: false
      }])
    } as never,
    { autocoderSchemaValidationMode: 'compatible' } as never
  );

  const prepare = (run = 1) => service.prepareAutocoderBatch(
    1, ['1'], run, undefined, 'schema-test', undefined, 42, service.createAutocoderPreflightContext()
  );

  return {
    service, files, responses, fileRepository, responseManagement, queryRunner, readiness, prepare
  };
};

describe('Autocoder coding scheme resolution', () => {
  it('trims and normalizes a reference before loading and coding it', async () => {
    const { prepare, files, fileRepository } = createHarness();
    files[0].data = '<Unit><CodingSchemeRef> \n s1.vocs\t </CodingSchemeRef></Unit>';

    const plan = await prepare();

    expect(plan?.unitIds).toEqual([1, 2]);
    expect(plan?.codedResponses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 101, status_v1: 'CODING_COMPLETE', code_v1: 1 }),
      expect.objectContaining({ id: 102, status_v1: 'CODING_COMPLETE', code_v1: 1 })
    ]));
    expect(fileRepository.find.mock.calls[1][0].where.file_id.value)
      .toEqual(['S1.VOCS', 'S2.VOCS']);
  });

  it.each([
    '',
    '<CodingSchemeRef/>',
    '<CodingSchemeRef> \n\t </CodingSchemeRef>'
  ])('skips tasks without an intended schema and leaves them out of the plan (%s)', async reference => {
    const { prepare, responseManagement } = createHarness(reference);

    const plan = await prepare();

    expect(plan?.unitIds).toEqual([1]);
    expect(plan?.statistics.totalResponses).toBe(1);
    expect(plan?.codedResponses).toHaveLength(1);
    expect(plan?.codedResponses[0].id).toBe(101);
    expect(responseManagement.updateResponsesInDatabase).not.toHaveBeenCalled();
  });

  it.each([1, 2])('excludes skipped tasks from cleanup and freshness in run %s', async run => {
    const { service, prepare, responseManagement } = createHarness('');
    const plan = await prepare(run);
    expect(plan).not.toBeNull();

    await service.persistAutocoderBatchPlan(plan!, {} as QueryRunner);

    expect(responseManagement.updateResponsesInDatabase).toHaveBeenCalledWith(
      1, expect.any(Array), expect.anything(), undefined, expect.any(Function), undefined, expect.any(Object), {
        unitIds: [1],
        autoCoderRun: run,
        markCurrentVersion: run === 1 ? 'v1' : 'v3',
        expectedSourceRevision: 42
      }, { managedExternally: true }
    );
  });

  it('does not create a persistence plan when all tasks have no referenced schema', async () => {
    const {
      prepare, files, responseManagement, queryRunner
    } = createHarness('');
    files[0].data = '<Unit><CodingSchemeRef>\n</CodingSchemeRef></Unit>';

    await expect(prepare()).resolves.toBeNull();

    expect(responseManagement.updateResponsesInDatabase).not.toHaveBeenCalled();
    expect(queryRunner.connect).not.toHaveBeenCalled();
  });

  it('scopes cleanup and freshness in the direct processing path as well', async () => {
    const { service, responseManagement } = createHarness('');

    await service.processTestPersonsBatch(1, ['1'], 1);

    expect(responseManagement.updateResponsesInDatabase).toHaveBeenCalledWith(
      1, expect.any(Array), expect.anything(), undefined, expect.any(Function), undefined, expect.any(Object), expect.objectContaining({ unitIds: [1] })
    );
  });

  it('fails before persistence if one referenced schema is missing in a mixed batch', async () => {
    const {
      prepare, files, responseManagement, queryRunner
    } = createHarness();
    files.splice(3, 1);

    await expect(prepare()).rejects.toThrow('could not find referenced coding scheme "S2.VOCS"');

    expect(responseManagement.updateResponsesInDatabase).not.toHaveBeenCalled();
    expect(queryRunner.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{invalid'],
    ['missing variable codings', '{}'],
    ['empty variable codings', '{"variableCodings":[]}'],
    ['invalid variable codings', '{"variableCodings":"invalid"}']
  ])('rejects a referenced schema with %s', async (_label, data) => {
    const { prepare, files, responseManagement } = createHarness();
    files[3].data = data;

    await expect(prepare()).rejects.toThrow('could not load coding scheme "S2.VOCS"');

    expect(responseManagement.updateResponsesInDatabase).not.toHaveBeenCalled();
  });

  it('does not cache an unusable scheme and loads its corrected replacement', async () => {
    const { prepare, files } = createHarness();
    files[3].data = '{"variableCodings":[]}';
    await expect(prepare()).rejects.toThrow('contains no variable codings');

    files[3].data = createSchema();

    const plan = await prepare();
    expect(plan?.unitIds).toEqual([1, 2]);
    expect(plan?.codedResponses).toHaveLength(2);
  });

  it('rejects a missing Unit file rather than treating it as an intentional omission', async () => {
    const { prepare, files } = createHarness();
    files.splice(1, 1);

    await expect(prepare()).rejects.toThrow('could not find Unit file "UNIT_2"');
  });

  it('does not resolve or mark tasks that have no selected responses', async () => {
    const { prepare, files, responses } = createHarness();
    files.splice(1, 1);
    responses.splice(1, 1);

    const plan = await prepare();

    expect(plan?.unitIds).toEqual([1]);
    expect(plan?.codedResponses).toHaveLength(1);
  });

  it('does not mark tasks whose answers the readiness filter excluded', async () => {
    const { prepare, responses, readiness } = createHarness();
    readiness.filterResponsesCodeable.mockResolvedValue([responses[0]]);

    const plan = await prepare();

    expect(plan?.unitIds).toEqual([1]);
    expect(plan?.codedResponses).toHaveLength(1);
  });

  it('keeps manual results on a skipped task outside the reset and cleanup scope', async () => {
    const {
      service, prepare, responses, responseManagement
    } = createHarness('');
    Object.assign(responses[1], { status_v2: 5, code_v2: 7, score_v2: 1 });
    const before = { ...responses[1] };

    const plan = await prepare();
    await service.persistAutocoderBatchPlan(plan!, {} as QueryRunner);

    expect(plan?.unitIds).toEqual([1]);
    expect(plan?.codedResponses.some(row => row.id === 102)).toBe(false);
    expect(responseManagement.updateResponsesInDatabase.mock.calls[0][7].unitIds).toEqual([1]);
    expect(responses[1]).toEqual(before);
  });
});
