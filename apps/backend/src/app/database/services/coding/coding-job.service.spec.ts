import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { ResponseEntity } from '../../entities/response.entity';

const createRepo = () => ({
  count: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(value => value),
  save: jest.fn(value => Promise.resolve(value)),
  delete: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn()
});

const createQueryBuilder = (result: unknown = []) => {
  const qb: Record<string, jest.Mock> = {};
  [
    'select',
    'addSelect',
    'leftJoin',
    'leftJoinAndSelect',
    'innerJoin',
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'update',
    'set',
    'whereInIds'
  ].forEach(method => {
    qb[method] = jest.fn().mockReturnValue(qb);
  });
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getRawMany = jest.fn().mockResolvedValue(result);
  qb.getCount = jest.fn().mockResolvedValue(typeof result === 'number' ? result : 0);
  qb.execute = jest.fn().mockResolvedValue(result);
  return qb;
};

describe('CodingJobService', () => {
  let service: CodingJobService;
  let codingJobRepository: ReturnType<typeof createRepo>;
  let codingJobCoderRepository: ReturnType<typeof createRepo>;
  let codingJobVariableRepository: ReturnType<typeof createRepo>;
  let codingJobVariableBundleRepository: ReturnType<typeof createRepo>;
  let codingJobUnitRepository: ReturnType<typeof createRepo>;
  let variableBundleRepository: ReturnType<typeof createRepo>;
  let responseRepository: ReturnType<typeof createRepo>;
  let settingRepository: ReturnType<typeof createRepo>;
  let connection: { transaction: jest.Mock };
  let cacheService: { delete: jest.Mock };

  beforeEach(() => {
    codingJobRepository = createRepo();
    codingJobCoderRepository = createRepo();
    codingJobVariableRepository = createRepo();
    codingJobVariableBundleRepository = createRepo();
    codingJobUnitRepository = createRepo();
    variableBundleRepository = createRepo();
    responseRepository = createRepo();
    const fileUploadRepository = createRepo();
    settingRepository = createRepo();
    connection = {
      transaction: jest.fn(callback => callback({
        getRepository: (entity: unknown) => {
          if (entity === CodingJob) return codingJobRepository;
          if (entity === CodingJobCoder) return codingJobCoderRepository;
          if (entity === CodingJobVariable) return codingJobVariableRepository;
          if (entity === CodingJobVariableBundle) return codingJobVariableBundleRepository;
          if (entity === CodingJobUnit) return codingJobUnitRepository;
          if (entity === VariableBundle) return variableBundleRepository;
          if (entity === ResponseEntity) return responseRepository;
          return createRepo();
        }
      }))
    };
    cacheService = { delete: jest.fn().mockResolvedValue(undefined) };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    service = new CodingJobService(
      codingJobRepository as never,
      codingJobCoderRepository as never,
      codingJobVariableRepository as never,
      codingJobVariableBundleRepository as never,
      codingJobUnitRepository as never,
      variableBundleRepository as never,
      responseRepository as never,
      fileUploadRepository as never,
      settingRepository as never,
      connection as never,
      cacheService as never,
      {} as never,
      workspaceExclusionService as never
    );
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock } }).logger, 'warn').mockImplementation(jest.fn());
  });

  it('reports coding job progress with totals and open units', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 7, workspace_id: 3 });
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder(10))
      .mockReturnValueOnce(createQueryBuilder(6))
      .mockReturnValueOnce(createQueryBuilder(2));

    await expect(service.getCodingJobProgress(7)).resolves.toEqual({
      progress: 60,
      coded: 6,
      total: 10,
      open: 2
    });
  });

  it('returns empty progress when the job has no units', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 7, workspace_id: 3 });
    codingJobUnitRepository.createQueryBuilder.mockReturnValueOnce(createQueryBuilder(0));

    await expect(service.getCodingJobProgress(7)).resolves.toEqual({
      progress: 0,
      coded: 0,
      total: 0,
      open: 0
    });
  });

  it('loads coding jobs with assignments, bundles and progress', async () => {
    const job = { id: 11, workspace_id: 3, name: 'Job' };
    codingJobRepository.count.mockResolvedValue(1);
    codingJobRepository.find.mockResolvedValue([job]);
    codingJobCoderRepository.find.mockResolvedValue([{ coding_job_id: 11, user_id: 5 }]);
    codingJobVariableRepository.find.mockResolvedValue([{ coding_job_id: 11, unit_name: 'UNIT', variable_id: 'VAR' }]);
    codingJobVariableBundleRepository.find.mockResolvedValue([{
      coding_job_id: 11,
      variable_bundle: {
        name: 'Bundle',
        variables: [{ unitName: 'UNIT', variableId: 'VAR2' }]
      }
    }]);
    codingJobRepository.findOne.mockResolvedValue({ id: 11, workspace_id: 3 });
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder(4))
      .mockReturnValueOnce(createQueryBuilder(2))
      .mockReturnValueOnce(createQueryBuilder(1))
      .mockReturnValueOnce(createQueryBuilder(9));

    const result = await service.getCodingJobs(3, 0, 25);

    expect(result.page).toBe(1);
    expect(result.total).toBe(1);
    expect(result.totalOpenUnits).toBe(9);
    expect(result.data[0]).toMatchObject({
      id: 11,
      assignedCoders: [5],
      assignedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      assignedVariableBundles: [{ name: 'Bundle', variables: [{ unitName: 'UNIT', variableId: 'VAR2' }] }],
      progress: 50,
      codedUnits: 2,
      totalUnits: 4,
      openUnits: 1
    });
  });

  it('loads one coding job and expands bundle variables', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 12, workspace_id: 3 });
    codingJobCoderRepository.find.mockResolvedValue([{ user_id: 4 }]);
    codingJobVariableRepository.find.mockResolvedValue([{ unit_name: 'UNIT', variable_id: 'VAR' }]);
    codingJobVariableBundleRepository.find.mockResolvedValue([{ variable_bundle_id: 9 }]);
    variableBundleRepository.find.mockResolvedValue([{
      id: 9,
      name: 'Bundle',
      variables: [{ unitName: 'UNIT2', variableId: 'VAR2' }]
    }]);

    const result = await service.getCodingJob(12, 3);

    expect(result.assignedCoders).toEqual([4]);
    expect(result.variables).toEqual([
      { unitName: 'UNIT', variableId: 'VAR' },
      { unitName: 'UNIT2', variableId: 'VAR2' }
    ]);
    expect(result.variableBundles).toHaveLength(1);
  });

  it('throws when a coding job cannot be found', async () => {
    codingJobRepository.findOne.mockResolvedValue(null);

    await expect(service.getCodingJob(99, 3)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates, updates and deletes direct assignments', async () => {
    codingJobCoderRepository.save.mockImplementation(value => Promise.resolve(value));

    const result = await service.assignCoders(12, [1, 2]);

    expect(codingJobCoderRepository.delete).toHaveBeenCalledWith({ coding_job_id: 12 });
    expect(result).toEqual([
      { coding_job_id: 12, user_id: 1 },
      { coding_job_id: 12, user_id: 2 }
    ]);
  });

  it('transfers coding cases and removes duplicate target assignments', async () => {
    const sourceAssignments = [
      { id: 1, coding_job_id: 10 },
      { id: 2, coding_job_id: 20 }
    ];
    codingJobCoderRepository.createQueryBuilder
      .mockReturnValueOnce({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(sourceAssignments)
      })
      .mockReturnValueOnce(createQueryBuilder());
    codingJobCoderRepository.find.mockResolvedValue([{ coding_job_id: 20 }]);
    codingJobUnitRepository.createQueryBuilder.mockReturnValue(createQueryBuilder(8));

    const result = await service.transferCodingCases(3, 1, 2);

    expect(result).toEqual({
      sourceCoderId: 1,
      targetCoderId: 2,
      affectedJobs: 2,
      updatedAssignments: 1,
      removedDuplicateAssignments: 1,
      transferredCases: 8
    });
    expect(codingJobCoderRepository.delete).toHaveBeenCalledWith([2]);
  });

  it('rejects transfer to the same coder', async () => {
    await expect(service.transferCodingCases(3, 1, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns assigned coding jobs and coder ids', async () => {
    codingJobCoderRepository.find
      .mockResolvedValueOnce([{ coding_job: { id: 1 } }, { coding_job: { id: 2 } }])
      .mockResolvedValueOnce([{ user_id: 4 }, { user_id: 5 }]);

    await expect(service.getCodingJobsByCoder(4)).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    await expect(service.getCodersByJobId(1)).resolves.toEqual([4, 5]);
  });

  it('returns coding job details by id with assigned bundles', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 1, name: 'Job' });
    codingJobCoderRepository.find.mockResolvedValue([{ user_id: 4 }]);
    codingJobVariableRepository.find.mockResolvedValue([{ unit_name: 'UNIT', variable_id: 'VAR' }]);
    codingJobVariableBundleRepository.find.mockResolvedValue([{
      variable_bundle: { name: 'Bundle', variables: [{ unitName: 'U2', variableId: 'V2' }] }
    }]);

    await expect(service.getCodingJobById(1)).resolves.toMatchObject({
      id: 1,
      assignedCoders: [4],
      assignedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      assignedVariableBundles: [{ name: 'Bundle', variables: [{ unitName: 'U2', variableId: 'V2' }] }]
    });
  });

  it('builds response queries for coding job variables and bundles', async () => {
    const qb = createQueryBuilder([{ id: 1 }]);
    responseRepository.createQueryBuilder.mockReturnValue(qb);
    codingJobRepository.findOne.mockResolvedValue({ id: 1, workspace_id: 3 });
    codingJobVariableRepository.find.mockResolvedValue([{ unit_name: 'UNIT', variable_id: 'VAR' }]);
    codingJobVariableBundleRepository.find.mockResolvedValue([{
      variable_bundle: { variables: [{ unitName: 'UNIT2', variableId: 'VAR2' }] }
    }]);

    await expect(service.getResponsesForCodingJob(1)).resolves.toEqual([{ id: 1 }]);
    expect(qb.where).toHaveBeenCalled();
    expect(qb.andWhere).toHaveBeenCalledWith('(response.code_v2 IS NULL OR response.code_v2 != -111)');
  });

  it('returns no coding-job responses when no variables are assigned', async () => {
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);

    await expect(service.getResponsesForCodingJob(1)).resolves.toEqual([]);
  });

  it('saves progress for coded and reopened units', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      variable_id: 'VAR',
      person_login: 'login',
      person_code: 'code',
      booklet_name: 'booklet',
      is_open: true,
      code: null,
      score: null,
      coding_issue_option: null,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(job);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);
    (service as unknown as { checkAndUpdateCodingJobCompletion: jest.Mock }).checkAndUpdateCodingJobCompletion = jest.fn();

    await service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: { id: 7, score: 2, codingIssueOption: -1 },
      notes: 'note'
    } as never);

    expect(codingJobUnitRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      code: 7,
      score: 2,
      coding_issue_option: -1,
      notes: 'note',
      is_open: false
    }));

    await service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: { id: 7 },
      isOpen: true
    } as never);

    expect(codingJobUnitRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({
      code: null,
      score: null,
      coding_issue_option: null,
      is_open: true
    }));
  });

  it('does not create a discussion result when saving progress for a training job', async () => {
    const trainingJob = { id: 1, workspace_id: 3, training_id: 42 };
    const unit = {
      coding_job_id: 1,
      response_id: 99,
      unit_name: 'UNIT',
      variable_id: 'VAR',
      person_login: 'login',
      person_code: 'code',
      booklet_name: 'booklet',
      is_open: true,
      code: null,
      score: null,
      coding_issue_option: null,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(trainingJob);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);
    (service as unknown as { checkAndUpdateCodingJobCompletion: jest.Mock }).checkAndUpdateCodingJobCompletion = jest.fn();

    await service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: { id: 7, score: 2 }
    } as never);

    expect(codingJobUnitRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      code: 7,
      score: 2,
      is_open: false
    }));
    expect(service).not.toHaveProperty('discussionResultRepository');
  });

  it('maps saved coding progress and notes by composite key', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 1, workspace_id: 3 });
    codingJobUnitRepository.find.mockResolvedValueOnce([
      {
        person_login: 'login',
        person_code: 'code',
        booklet_name: 'booklet',
        unit_name: 'UNIT',
        variable_id: 'VAR',
        unit_alias: 'ALIAS',
        is_open: false,
        code: 1,
        score: 4,
        coding_issue_option: -2
      },
      {
        person_login: 'login',
        person_code: 'code',
        booklet_name: 'booklet',
        unit_name: 'UNIT',
        variable_id: 'OPEN',
        unit_alias: null,
        is_open: true,
        code: null,
        score: null,
        coding_issue_option: null
      }
    ]);
    (service as unknown as { getCodingSchemes: jest.Mock }).getCodingSchemes = jest.fn().mockResolvedValue(new Map([
      ['ALIAS', { variableCodings: [{ id: 'VAR', codes: [{ id: 1, code: 'A', label: 'Alpha' }] }] }]
    ]));

    const progress = await service.getCodingProgress(1);

    expect(progress['login@code@booklet::booklet::UNIT::VAR']).toEqual({
      id: 1,
      code: 'A',
      label: 'Alpha',
      score: 4,
      codingIssueOption: -2
    });
    expect(progress['login@code@booklet::booklet::UNIT::OPEN:open']).toEqual({
      id: -1,
      code: '',
      label: 'OPEN'
    });

    codingJobUnitRepository.find.mockResolvedValueOnce([{
      person_login: 'login',
      person_code: 'code',
      booklet_name: 'booklet',
      unit_name: 'UNIT',
      variable_id: 'VAR',
      notes: 'remember'
    }]);

    await expect(service.getCodingNotes(1)).resolves.toEqual({
      'login@code@booklet::booklet::UNIT::VAR': 'remember'
    });
  });

  it('normalizes and aggregates response values according to matching flags', () => {
    expect(service.normalizeValue(' A B ', [
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_WHITESPACE
    ])).toBe('ab');
    expect(service.normalizeValue(null, [])).toBe('');

    const responses = [
      { id: 1, value: 'AB' },
      { id: 2, value: 'a b' },
      { id: 3, value: 'CD' }
    ] as never[];

    expect(service.aggregateResponsesByValue(responses, [
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_WHITESPACE
    ])).toMatchObject([
      { normalizedValue: 'ab', totalResponses: 2 },
      { normalizedValue: 'cd', totalResponses: 1 }
    ]);
    expect(service.aggregateResponsesByValue(responses, [ResponseMatchingFlag.NO_AGGREGATION])).toHaveLength(3);
  });

  it('loads matching mode and aggregation threshold settings', async () => {
    settingRepository.findOne
      .mockResolvedValueOnce({ content: JSON.stringify({ flags: [ResponseMatchingFlag.IGNORE_CASE] }) })
      .mockResolvedValueOnce({ content: 'not-json' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ content: 'disabled' })
      .mockResolvedValueOnce({ content: '5' });

    await expect(service.getResponseMatchingMode(3)).resolves.toEqual([ResponseMatchingFlag.IGNORE_CASE]);
    await expect(service.getResponseMatchingMode(3)).resolves.toEqual([]);
    await expect(service.getAggregationThreshold(3)).resolves.toBe(2);
    await expect(service.getAggregationThreshold(3)).resolves.toBeNull();
    await expect(service.getAggregationThreshold(3)).resolves.toBe(5);

    await service.setAggregationThreshold(3, null);
    await service.setAggregationThreshold(3, 4);

    expect(settingRepository.save).toHaveBeenNthCalledWith(1, {
      key: 'workspace-3-duplicate-aggregation-threshold',
      content: 'disabled'
    });
    expect(settingRepository.save).toHaveBeenNthCalledWith(2, {
      key: 'workspace-3-duplicate-aggregation-threshold',
      content: '4'
    });
  });

  it('detects coding issues and builds bulk progress', async () => {
    codingJobRepository.findOne.mockResolvedValueOnce({ id: 1, workspace_id: 3 });
    codingJobUnitRepository.createQueryBuilder.mockReturnValueOnce(createQueryBuilder([{ code: 1 }, { code: -2 }]));
    await expect(service.hasCodingIssues(1)).resolves.toBe(true);

    codingJobRepository.find.mockResolvedValue([{ id: 1, workspace_id: 3 }, { id: 2, workspace_id: 3 }]);
    jest.spyOn(service, 'getCodingProgress')
      .mockResolvedValueOnce({ a: { id: 1 } } as never)
      .mockResolvedValueOnce({ b: { id: 2 } } as never);

    await expect(service.getBulkCodingProgress([1, 2], 3)).resolves.toEqual({
      1: { a: { id: 1 } },
      2: { b: { id: 2 } }
    });
  });
});
