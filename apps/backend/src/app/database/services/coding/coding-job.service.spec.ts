import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';

jest.mock('../workspace/workspace-files.service', () => ({
  WorkspaceFilesService: class {}
}));

const createRepo = () => ({
  count: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(value => value),
  save: jest.fn(value => Promise.resolve(value)),
  delete: jest.fn(),
  update: jest.fn(),
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
    'setLock',
    'update',
    'set',
    'whereInIds'
  ].forEach(method => {
    qb[method] = jest.fn().mockReturnValue(qb);
  });
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getRawMany = jest.fn().mockResolvedValue(result);
  qb.getRawOne = jest.fn().mockResolvedValue(result);
  qb.getCount = jest.fn().mockResolvedValue(typeof result === 'number' ? result : 0);
  qb.execute = jest.fn().mockResolvedValue(result);
  return qb;
};

const expectManualCodingCandidateStatusFilter = (qb: Record<string, jest.Mock>) => {
  const statusFilterCall = qb.andWhere.mock.calls.find(
    ([condition]) => condition === 'response.status_v1 IN (:...statuses)'
  );
  const statuses = statusFilterCall?.[1]?.statuses;

  expect(statuses).toEqual([
    statusStringToNumber('CODING_INCOMPLETE'),
    statusStringToNumber('INTENDED_INCOMPLETE')
  ]);
  expect(statuses).not.toContain(statusStringToNumber('DERIVE_ERROR'));
};

describe('CodingJobService', () => {
  let service: CodingJobService;
  let codingJobRepository: ReturnType<typeof createRepo>;
  let codingJobCoderRepository: ReturnType<typeof createRepo>;
  let codingJobVariableRepository: ReturnType<typeof createRepo>;
  let codingJobVariableBundleRepository: ReturnType<typeof createRepo>;
  let codingJobUnitRepository: ReturnType<typeof createRepo>;
  let jobDefinitionRepository: ReturnType<typeof createRepo>;
  let variableBundleRepository: ReturnType<typeof createRepo>;
  let responseRepository: ReturnType<typeof createRepo>;
  let fileUploadRepository: ReturnType<typeof createRepo>;
  let settingRepository: ReturnType<typeof createRepo>;
  let connection: { transaction: jest.Mock };
  let cacheService: { delete: jest.Mock };
  let codingFreshnessService: { reconcileAppliedManualCodingJobs: jest.Mock };
  let codingFileCacheService: { getVariablePageMap: jest.Mock };
  let missingsProfilesService: {
    resolveMissingsProfileId: jest.Mock;
    getMissingByIdForProfileOrDefault: jest.Mock;
  };
  let coderTrainingDiscussionResultRepository: ReturnType<typeof createRepo>;
  let workspaceFilesService: {
    getDerivedVariableMap: jest.Mock;
  };
  let usersService: {
    getUserIsAdmin: jest.Mock;
    getUserAccessLevel: jest.Mock;
    assertUsersCanCodeInWorkspace: jest.Mock;
    canUserCodeInWorkspace: jest.Mock;
  };

  const mockCodingScheme = (
    {
      unitFileId = 'ALIAS',
      schemeRef = 'SCHEME',
      fileId = schemeRef,
      variableId = 'VAR',
      variableAlias,
      codeId = 7,
      score = 2
    }: {
      unitFileId?: string;
      schemeRef?: string;
      fileId?: string;
      variableId?: string;
      variableAlias?: string;
      codeId?: number;
      score?: number | null;
    } = {}
  ) => {
    fileUploadRepository.find
      .mockResolvedValueOnce([{
        file_id: unitFileId,
        data: `<Unit><CodingSchemeRef>${schemeRef}</CodingSchemeRef></Unit>`
      }])
      .mockResolvedValueOnce([{
        file_id: fileId,
        data: {
          variableCodings: [{
            id: variableId,
            ...(variableAlias !== undefined ? { alias: variableAlias } : {}),
            codes: [{
              id: codeId,
              code: String(codeId),
              label: `Code ${codeId}`,
              score
            }]
          }]
        }
      }]);
  };

  beforeEach(() => {
    codingJobRepository = createRepo();
    codingJobCoderRepository = createRepo();
    codingJobVariableRepository = createRepo();
    codingJobVariableBundleRepository = createRepo();
    codingJobUnitRepository = createRepo();
    jobDefinitionRepository = createRepo();
    variableBundleRepository = createRepo();
    responseRepository = createRepo();
    fileUploadRepository = createRepo();
    settingRepository = createRepo();
    coderTrainingDiscussionResultRepository = createRepo();
    connection = {
      transaction: jest.fn(callback => callback({
        query: jest.fn().mockResolvedValue([]),
        getRepository: (entity: unknown) => {
          if (entity === CodingJob) return codingJobRepository;
          if (entity === CodingJobCoder) return codingJobCoderRepository;
          if (entity === CodingJobVariable) return codingJobVariableRepository;
          if (entity === CodingJobVariableBundle) return codingJobVariableBundleRepository;
          if (entity === CodingJobUnit) return codingJobUnitRepository;
          if (entity === JobDefinition) return jobDefinitionRepository;
          if (entity === VariableBundle) return variableBundleRepository;
          if (entity === ResponseEntity) return responseRepository;
          return createRepo();
        }
      }))
    };
    cacheService = { delete: jest.fn().mockResolvedValue(undefined) };
    jobDefinitionRepository.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 1,
        workspace_id: 3,
        status: 'approved'
      })
    });
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    workspaceFilesService = {
      getDerivedVariableMap: jest.fn().mockResolvedValue(new Map())
    };
    usersService = {
      getUserIsAdmin: jest.fn().mockResolvedValue(false),
      getUserAccessLevel: jest.fn().mockResolvedValue(1),
      assertUsersCanCodeInWorkspace: jest.fn().mockResolvedValue(undefined),
      canUserCodeInWorkspace: jest.fn().mockResolvedValue(true)
    };
    codingFreshnessService = {
      reconcileAppliedManualCodingJobs: jest.fn().mockResolvedValue(0)
    };
    codingFileCacheService = {
      getVariablePageMap: jest.fn().mockResolvedValue(new Map())
    };
    missingsProfilesService = {
      resolveMissingsProfileId: jest.fn(async (_workspaceId: number, profileId?: number | null) => profileId || 55),
      getMissingByIdForProfileOrDefault: jest.fn().mockResolvedValue({ code: -99 })
    };
    coderTrainingDiscussionResultRepository.count.mockResolvedValue(0);

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
      workspaceFilesService as never,
      workspaceExclusionService as never,
      usersService as never,
      codingFreshnessService as never,
      codingFileCacheService as never,
      missingsProfilesService as never,
      coderTrainingDiscussionResultRepository as never
    );
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock } }).logger, 'warn').mockImplementation(jest.fn());
  });

  it('allows assigned coder access only when coding capability is active', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 12, workspace_id: 7 });
    codingJobCoderRepository.count.mockResolvedValue(1);

    await expect(service.assertUserCanAccessCodingJob(12, 7, 5)).resolves.toBeUndefined();

    expect(usersService.canUserCodeInWorkspace).toHaveBeenCalledWith(5, 7);
    expect(codingJobCoderRepository.count).toHaveBeenCalledWith({
      where: {
        coding_job_id: 12,
        user_id: 5
      }
    });
  });

  it('does not materialize open job assignments as v2 coding results', async () => {
    await (service as unknown as {
      saveCodingJobUnitsSubset: (
        codingJobId: number,
        workspaceId: number,
        responses: Array<{
          id: number;
          variableid: string;
          unitName: string;
          unitAlias: string | null;
          bookletName: string;
          personLogin: string;
          personCode: string;
          personGroup: string;
          variableBundleId?: number;
        }>
      ) => Promise<void>;
    }).saveCodingJobUnitsSubset(44, 7, [{
      id: 123,
      variableid: 'VAR',
      unitName: 'UNIT',
      unitAlias: 'ALIAS',
      bookletName: 'BOOKLET',
      personLogin: 'coder-login',
      personCode: 'P001',
      personGroup: 'G1'
    }]);

    expect(codingJobUnitRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        coding_job_id: 44,
        workspace_id: 7,
        response_id: 123,
        unit_name: 'UNIT',
        variable_id: 'VAR'
      })
    ]);
    expect(responseRepository.update).not.toHaveBeenCalled();
  });

  it('rejects duplicate assigned coder ids before saving assignments', async () => {
    await expect(service.assignCoders(12, [5, 5], undefined, 7))
      .rejects.toThrow(BadRequestException);

    expect(usersService.assertUsersCanCodeInWorkspace).not.toHaveBeenCalled();
    expect(codingJobCoderRepository.delete).not.toHaveBeenCalled();
    expect(codingJobCoderRepository.save).not.toHaveBeenCalled();
  });

  it('rejects missings profile changes after coding work exists', async () => {
    codingJobRepository.findOne.mockResolvedValue({
      id: 12,
      workspace_id: 7,
      status: 'active',
      missings_profile_id: 55
    });
    codingJobCoderRepository.find.mockResolvedValue([]);
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);
    codingJobUnitRepository.createQueryBuilder.mockReturnValue(createQueryBuilder(1));

    await expect(service.updateCodingJob(12, 7, { missingsProfileId: 77 }))
      .rejects.toThrow('coding work already exists');

    expect(missingsProfilesService.resolveMissingsProfileId).toHaveBeenCalledWith(7, 55);
    expect(missingsProfilesService.resolveMissingsProfileId).toHaveBeenCalledWith(7, 77);
    expect(codingJobRepository.save).not.toHaveBeenCalled();
  });

  it('rejects missings profile changes after training discussion results exist', async () => {
    codingJobRepository.findOne.mockResolvedValue({
      id: 12,
      workspace_id: 7,
      training_id: 5,
      status: 'active',
      missings_profile_id: 55
    });
    codingJobCoderRepository.find.mockResolvedValue([]);
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);
    codingJobUnitRepository.createQueryBuilder.mockReturnValue(createQueryBuilder(0));
    coderTrainingDiscussionResultRepository.count.mockResolvedValueOnce(1);

    await expect(service.updateCodingJob(12, 7, { missingsProfileId: 77 }))
      .rejects.toThrow('training discussions already exist');

    expect(coderTrainingDiscussionResultRepository.count).toHaveBeenCalledWith({
      where: {
        workspace_id: 7,
        training_id: 5
      }
    });
    expect(codingJobRepository.save).not.toHaveBeenCalled();
  });

  it('sets variable bundle ids on distributed bundle job units', async () => {
    codingJobRepository.save.mockImplementation(value => Promise.resolve({ ...value, id: 44 }));
    jest.spyOn(service, 'getCurrentAggregationSettingsSnapshot').mockResolvedValue({
      aggregationEnabled: false,
      aggregationThreshold: null,
      responseMatchingFlags: [ResponseMatchingFlag.NO_AGGREGATION],
      aggregationSettingsVersion: 1,
      fromJobSnapshot: false
    });
    variableBundleRepository.find.mockResolvedValue([{
      id: 9,
      variables: [{ unitName: 'UNIT', variableId: 'VAR' }]
    }]);

    await (service as unknown as {
      createCodingJobWithUnitSubsetInManager: (
        workspaceId: number,
        createCodingJobDto: {
          name: string;
          assignedCoders: number[];
          jobDefinitionId: number;
          variableBundleIds: number[];
        },
        unitSubset: Array<{
          id: number;
          variableid: string;
          unitName: string;
          unitAlias: string | null;
          bookletName: string;
          personLogin: string;
          personCode: string;
          personGroup: string;
        }>,
        manager: {
          getRepository: (entity: unknown) => unknown;
        }
      ) => Promise<CodingJob>;
    }).createCodingJobWithUnitSubsetInManager(
      7,
      {
        name: 'Bundle job',
        assignedCoders: [5],
        jobDefinitionId: 42,
        variableBundleIds: [9]
      },
      [{
        id: 123,
        variableid: 'VAR',
        unitName: 'UNIT',
        unitAlias: 'ALIAS',
        bookletName: 'BOOKLET',
        personLogin: 'coder-login',
        personCode: 'P001',
        personGroup: 'G1'
      }],
      {
        getRepository: (entity: unknown) => {
          if (entity === CodingJob) return codingJobRepository;
          if (entity === CodingJobCoder) return codingJobCoderRepository;
          if (entity === CodingJobVariableBundle) return codingJobVariableBundleRepository;
          if (entity === CodingJobUnit) return codingJobUnitRepository;
          if (entity === VariableBundle) return variableBundleRepository;
          return createRepo();
        }
      }
    );

    expect(codingJobRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      job_definition_id: 42
    }));
    expect(codingJobVariableBundleRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        coding_job_id: 44,
        variable_bundle_id: 9
      })
    ]);
    expect(codingJobUnitRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        response_id: 123,
        variable_bundle_id: 9
      })
    ]);
  });

  it('passes job-definition missings profiles to distributed coding jobs', async () => {
    codingJobRepository.save.mockImplementation(value => Promise.resolve({ ...value, id: 45 }));
    jest.spyOn(service, 'getCurrentAggregationSettingsSnapshot').mockResolvedValue({
      aggregationEnabled: false,
      aggregationThreshold: null,
      responseMatchingFlags: [ResponseMatchingFlag.NO_AGGREGATION],
      aggregationSettingsVersion: 1,
      fromJobSnapshot: false
    });

    await (service as unknown as {
      createDistributedCodingJobsFromPlanInManager: (
        workspaceId: number,
        request: {
          selectedVariables: Array<{ unitName: string; variableId: string }>;
          selectedCoders: Array<{ id: number; name: string }>;
          jobDefinitionId: number;
          missingsProfileId: number;
        },
        plan: {
          jobsToCreate: Array<{
            coder: { id: number; name: string };
            item: {
              type: 'variable';
              item: { unitName: string; variableId: string };
              itemKey: string;
              itemLabel: string;
              itemVariables: Array<{ unitName: string; variableId: string }>;
              itemCaseOrderingMode: 'continuous' | 'alternating';
            };
            unitSubset: Array<{
              id: number;
              variableid: string;
              unitName: string;
              unitAlias: string | null;
              bookletName: string;
              personLogin: string;
              personCode: string;
              personGroup: string;
            }>;
          }>;
        },
        manager: {
          getRepository: (entity: unknown) => unknown;
        }
      ) => Promise<unknown[]>;
    }).createDistributedCodingJobsFromPlanInManager(
      7,
      {
        selectedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
        selectedCoders: [{ id: 5, name: 'Coder 5' }],
        jobDefinitionId: 42,
        missingsProfileId: 77
      },
      {
        jobsToCreate: [{
          coder: { id: 5, name: 'Coder 5' },
          item: {
            type: 'variable',
            item: { unitName: 'UNIT', variableId: 'VAR' },
            itemKey: 'UNIT::VAR',
            itemLabel: 'UNIT - VAR',
            itemVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
            itemCaseOrderingMode: 'continuous'
          },
          unitSubset: [{
            id: 123,
            variableid: 'VAR',
            unitName: 'UNIT',
            unitAlias: 'ALIAS',
            bookletName: 'BOOKLET',
            personLogin: 'coder-login',
            personCode: 'P001',
            personGroup: 'G1'
          }]
        }]
      },
      {
        getRepository: (entity: unknown) => {
          if (entity === CodingJob) return codingJobRepository;
          if (entity === CodingJobCoder) return codingJobCoderRepository;
          if (entity === CodingJobVariable) return codingJobVariableRepository;
          if (entity === CodingJobUnit) return codingJobUnitRepository;
          return createRepo();
        }
      }
    );

    expect(codingJobRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      job_definition_id: 42,
      missings_profile_id: 77
    }));
  });

  it('rejects assigned coder access when coding capability was revoked', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 12, workspace_id: 7 });
    usersService.canUserCodeInWorkspace.mockResolvedValueOnce(false);

    await expect(service.assertUserCanAccessCodingJob(12, 7, 5)).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersService.canUserCodeInWorkspace).toHaveBeenCalledWith(5, 7);
    expect(codingJobCoderRepository.count).not.toHaveBeenCalled();
  });

  it('keeps manager access independent from coding capability for management actions', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 12, workspace_id: 7 });
    usersService.getUserAccessLevel.mockResolvedValueOnce(2);

    await expect(service.assertUserCanAccessCodingJob(12, 7, 5)).resolves.toBeUndefined();

    expect(usersService.canUserCodeInWorkspace).not.toHaveBeenCalled();
    expect(codingJobCoderRepository.count).not.toHaveBeenCalled();
  });

  it('requires coding capability for coding actions even when the user has manager access', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 12, workspace_id: 7 });
    usersService.getUserAccessLevel.mockResolvedValueOnce(2);
    usersService.canUserCodeInWorkspace.mockResolvedValueOnce(false);

    await expect(service.assertUserCanCodeCodingJob(12, 7, 5)).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersService.getUserAccessLevel).not.toHaveBeenCalled();
    expect(usersService.canUserCodeInWorkspace).toHaveBeenCalledWith(5, 7);
    expect(codingJobCoderRepository.count).not.toHaveBeenCalled();
  });

  it('allows coding actions for assigned users with active coding capability', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 12, workspace_id: 7 });
    codingJobCoderRepository.count.mockResolvedValue(1);

    await expect(service.assertUserCanCodeCodingJob(12, 7, 5)).resolves.toBeUndefined();

    expect(usersService.canUserCodeInWorkspace).toHaveBeenCalledWith(5, 7);
    expect(codingJobCoderRepository.count).toHaveBeenCalledWith({
      where: {
        coding_job_id: 12,
        user_id: 5
      }
    });
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

  it('marks a coding job open when every unit is coded or flagged open', async () => {
    (service as unknown as { getCodingJobProgress: jest.Mock }).getCodingJobProgress = jest.fn().mockResolvedValue({
      progress: 50,
      coded: 5,
      total: 10,
      open: 5
    });

    await (service as unknown as { checkAndUpdateCodingJobCompletion: (codingJobId: number) => Promise<void> })
      .checkAndUpdateCodingJobCompletion(7);

    expect(codingJobRepository.update).toHaveBeenCalledWith(7, { status: 'open' });
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
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([
        {
          jobId: '11',
          total: '4',
          coded: '2',
          open: '1'
        }
      ]))
      .mockReturnValueOnce(createQueryBuilder(9));

    const result = await service.getCodingJobs(3, 0, 25);

    expect(codingFreshnessService.reconcileAppliedManualCodingJobs)
      .toHaveBeenCalledWith(3, 'RESET', 'current');
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

  it('filters coding jobs by assigned coder before loading assignments and progress', async () => {
    const job = { id: 11, workspace_id: 3, name: 'Assigned job' };
    const assignedJobsQueryBuilder = createQueryBuilder([{ codingJobId: 11 }]);
    codingJobCoderRepository.createQueryBuilder.mockReturnValueOnce(assignedJobsQueryBuilder);
    codingJobCoderRepository.find.mockResolvedValueOnce([{ coding_job_id: 11, user_id: 5 }]);
    codingJobRepository.count.mockResolvedValue(1);
    codingJobRepository.find.mockResolvedValue([job]);
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([
        {
          jobId: 11,
          total: 2,
          coded: 1,
          open: 0
        }
      ]))
      .mockReturnValueOnce(createQueryBuilder(0));

    const result = await service.getCodingJobs(3, 1, 25, 5);

    expect(codingJobCoderRepository.createQueryBuilder).toHaveBeenCalledWith('coder');
    expect(assignedJobsQueryBuilder.innerJoin).toHaveBeenCalledWith('coder.coding_job', 'coding_job');
    expect(assignedJobsQueryBuilder.where).toHaveBeenCalledWith('coder.user_id = :userId', { userId: 5 });
    expect(assignedJobsQueryBuilder.andWhere).toHaveBeenCalledWith(
      'coding_job.workspace_id = :workspaceId',
      { workspaceId: 3 }
    );
    expect(codingJobRepository.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspace_id: 3 }),
      relations: ['training']
    }));
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 11,
      assignedCoders: [5],
      progress: 50,
      codedUnits: 1,
      totalUnits: 2
    });
  });

  it('returns an empty coding job page when assigned coder has no jobs', async () => {
    codingJobCoderRepository.createQueryBuilder.mockReturnValueOnce(createQueryBuilder([]));

    const result = await service.getCodingJobs(3, 1, 25, 5);

    expect(result).toEqual({
      data: [],
      total: 0,
      totalOpenUnits: 0,
      page: 1,
      limit: 25
    });
    expect(codingJobRepository.count).not.toHaveBeenCalled();
    expect(codingJobRepository.find).not.toHaveBeenCalled();
  });

  it('counts coding jobs by job definition id', async () => {
    const queryBuilder = createQueryBuilder([
      { jobDefinitionId: '3', jobsCount: '2' },
      { jobDefinitionId: 5, jobsCount: 1 }
    ]);
    codingJobRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(
      service.getCodingJobCountsByDefinitionIds(7, [3, 3, 5])
    ).resolves.toEqual(new Map([
      [3, 2],
      [5, 1]
    ]));

    expect(codingJobRepository.createQueryBuilder).toHaveBeenCalledWith('coding_job');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'coding_job.job_definition_id IN (:...definitionIds)',
      { definitionIds: [3, 5] }
    );
  });

  it('does not query coding job counts without definition ids', async () => {
    await expect(
      service.getCodingJobCountsByDefinitionIds(7, [])
    ).resolves.toEqual(new Map());

    expect(codingJobRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('counts coding jobs that still block job definition deletion by job definition id', async () => {
    const queryBuilder = createQueryBuilder([
      { jobDefinitionId: '3', jobsCount: '1' }
    ]);
    codingJobRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(
      service.getBlockingCodingJobCountsByDefinitionIds(7, [3, 3, 5])
    ).resolves.toEqual(new Map([[3, 1]]));

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'coding_job.status NOT IN (:...deleteReadyStatuses)',
      { deleteReadyStatuses: ['results_applied', 'review'] }
    );
  });

  it('counts task deltas for retained cases in job definition refresh previews', async () => {
    jest.spyOn(
      service as unknown as { buildDistributionPlan: jest.Mock },
      'buildDistributionPlan'
    ).mockResolvedValue({
      plannedCases: [
        { response: { id: 10 }, assignedCoderIds: [1, 2] },
        { response: { id: 20 }, assignedCoderIds: [1] }
      ],
      jobsToCreate: [],
      distribution: {},
      distributionByCoderId: {},
      doubleCodingInfo: {},
      aggregationInfo: {},
      matchingFlags: [],
      warnings: [],
      pairDistribution: {},
      tasksPerCoder: {},
      coderWeights: {}
    });

    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([
        { responseId: 10, taskCount: '1' },
        { responseId: 30, taskCount: '2' }
      ]))
      .mockReturnValueOnce(createQueryBuilder(0));
    codingJobRepository.createQueryBuilder.mockReturnValueOnce(createQueryBuilder({
      existingJobsCount: '2',
      staleJobsCount: '1'
    }));

    await expect(service.previewJobDefinitionRefresh(3, {
      jobDefinitionId: 9,
      selectedVariables: [],
      selectedCoders: []
    })).resolves.toMatchObject({
      retainedCases: 1,
      addedCases: 1,
      removedCases: 1,
      addedCodingTasks: 2,
      removedCodingTasks: 2,
      canApply: true
    });
  });

  it('blocks job definition refresh when any coding work exists, including excluded units', async () => {
    jest.spyOn(
      service as unknown as { buildDistributionPlan: jest.Mock },
      'buildDistributionPlan'
    ).mockResolvedValue({
      plannedCases: [
        { response: { id: 10 }, assignedCoderIds: [1] }
      ],
      jobsToCreate: [],
      distribution: {},
      distributionByCoderId: {},
      doubleCodingInfo: {},
      aggregationInfo: {},
      matchingFlags: [],
      warnings: [],
      pairDistribution: {},
      tasksPerCoder: {},
      coderWeights: {}
    });
    const applyExclusionsSpy = jest.spyOn(
      service as unknown as {
        applyCodingJobUnitExclusions: (...args: unknown[]) => Promise<void>;
      },
      'applyCodingJobUnitExclusions'
    );

    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([
        { responseId: 10, taskCount: '1' }
      ]))
      .mockReturnValueOnce(createQueryBuilder(1));
    codingJobRepository.createQueryBuilder.mockReturnValueOnce(createQueryBuilder({
      existingJobsCount: '1',
      staleJobsCount: '1'
    }));

    await expect(service.previewJobDefinitionRefresh(3, {
      jobDefinitionId: 9,
      selectedVariables: [],
      selectedCoders: []
    })).resolves.toMatchObject({
      canApply: false,
      blockingReason: expect.stringContaining('Kodierarbeit')
    });
    expect(applyExclusionsSpy.mock.calls.some(call => call[2] === 'jobDefinitionCodingWork'))
      .toBe(false);
  });

  it('builds the refresh distribution plan inside the locked transaction context', async () => {
    const callOrder: string[] = [];
    const transactionManager = {
      getRepository: jest.fn(),
      query: jest.fn().mockImplementation(async () => {
        callOrder.push('advisory-lock');
      })
    };
    const plan = {
      plannedCases: [],
      jobsToCreate: [],
      distribution: {},
      distributionByCoderId: {},
      doubleCodingInfo: {},
      aggregationInfo: {},
      matchingFlags: [],
      warnings: [],
      pairDistribution: {},
      tasksPerCoder: {},
      coderWeights: {}
    };

    connection.transaction.mockImplementationOnce(callback => callback(transactionManager));
    jest.spyOn(
      service as unknown as { assertApprovedJobDefinitionCanBeUsed: (...args: unknown[]) => Promise<number> },
      'assertApprovedJobDefinitionCanBeUsed'
    ).mockImplementation(async () => {
      callOrder.push('assert');
      return 9;
    });
    jest.spyOn(
      service as unknown as { lockCodingJobUnitsForDefinition: (...args: unknown[]) => Promise<void> },
      'lockCodingJobUnitsForDefinition'
    ).mockImplementation(async () => {
      callOrder.push('lock');
    });
    jest.spyOn(
      service as unknown as { getJobDefinitionExistingTaskRows: (...args: unknown[]) => Promise<[]> },
      'getJobDefinitionExistingTaskRows'
    ).mockImplementation(async (_workspaceId, _jobDefinitionId, manager) => {
      callOrder.push('existing');
      expect(manager).toBe(transactionManager);
      return [];
    });
    jest.spyOn(
      service as unknown as {
        getJobDefinitionJobCounts: (...args: unknown[]) => Promise<{ existingJobsCount: number; staleJobsCount: number }>
      },
      'getJobDefinitionJobCounts'
    ).mockImplementation(async (_workspaceId, _jobDefinitionId, manager) => {
      callOrder.push('counts');
      expect(manager).toBe(transactionManager);
      return { existingJobsCount: 1, staleJobsCount: 1 };
    });
    jest.spyOn(
      service as unknown as { jobDefinitionHasAnyCodingWork: (...args: unknown[]) => Promise<boolean> },
      'jobDefinitionHasAnyCodingWork'
    ).mockImplementation(async (_workspaceId, _jobDefinitionId, manager) => {
      callOrder.push('work');
      expect(manager).toBe(transactionManager);
      return false;
    });
    const buildPlanSpy = jest.spyOn(
      service as unknown as { buildDistributionPlan: (...args: unknown[]) => Promise<typeof plan> },
      'buildDistributionPlan'
    ).mockImplementation(async (_workspaceId, _request, manager) => {
      callOrder.push('plan');
      expect(manager).toBe(transactionManager);
      return plan;
    });
    const deleteSpy = jest.spyOn(
      service as unknown as { deleteCodingJobsByDefinitionInManager: (...args: unknown[]) => Promise<number> },
      'deleteCodingJobsByDefinitionInManager'
    ).mockImplementation(async manager => {
      callOrder.push('delete');
      expect(manager).toBe(transactionManager);
      return 1;
    });
    const createSpy = jest.spyOn(
      service as unknown as { createDistributedCodingJobsFromPlanInManager: (...args: unknown[]) => Promise<[]> },
      'createDistributedCodingJobsFromPlanInManager'
    ).mockImplementation(async (_workspaceId, _request, _plan, manager) => {
      callOrder.push('create');
      expect(manager).toBe(transactionManager);
      return [];
    });

    await expect(service.refreshDistributedCodingJobs(3, {
      jobDefinitionId: 9,
      selectedVariables: [],
      selectedCoders: []
    })).resolves.toMatchObject({
      success: true,
      preview: {
        canApply: true,
        existingJobsCount: 1
      }
    });

    expect(buildPlanSpy).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ jobDefinitionId: 9 }),
      transactionManager
    );
    expect(callOrder).toEqual([
      'advisory-lock',
      'assert',
      'lock',
      'existing',
      'counts',
      'work',
      'plan',
      'delete',
      'create'
    ]);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('does not delete or recreate refresh jobs when the locked recheck finds coding work', async () => {
    const transactionManager = {
      getRepository: jest.fn(),
      query: jest.fn().mockResolvedValue([])
    };
    const plan = {
      plannedCases: [],
      jobsToCreate: [],
      distribution: {},
      distributionByCoderId: {},
      doubleCodingInfo: {},
      aggregationInfo: {},
      matchingFlags: [],
      warnings: [],
      pairDistribution: {},
      tasksPerCoder: {},
      coderWeights: {}
    };

    connection.transaction.mockImplementationOnce(callback => callback(transactionManager));
    jest.spyOn(
      service as unknown as { assertApprovedJobDefinitionCanBeUsed: (...args: unknown[]) => Promise<number> },
      'assertApprovedJobDefinitionCanBeUsed'
    ).mockResolvedValue(9);
    jest.spyOn(
      service as unknown as { lockCodingJobUnitsForDefinition: (...args: unknown[]) => Promise<void> },
      'lockCodingJobUnitsForDefinition'
    ).mockResolvedValue();
    jest.spyOn(
      service as unknown as { getJobDefinitionExistingTaskRows: (...args: unknown[]) => Promise<[]> },
      'getJobDefinitionExistingTaskRows'
    ).mockResolvedValue([]);
    jest.spyOn(
      service as unknown as {
        getJobDefinitionJobCounts: (...args: unknown[]) => Promise<{ existingJobsCount: number; staleJobsCount: number }>
      },
      'getJobDefinitionJobCounts'
    ).mockResolvedValue({ existingJobsCount: 1, staleJobsCount: 1 });
    jest.spyOn(
      service as unknown as { jobDefinitionHasAnyCodingWork: (...args: unknown[]) => Promise<boolean> },
      'jobDefinitionHasAnyCodingWork'
    ).mockResolvedValue(true);
    jest.spyOn(
      service as unknown as { buildDistributionPlan: (...args: unknown[]) => Promise<typeof plan> },
      'buildDistributionPlan'
    ).mockResolvedValue(plan);
    const deleteSpy = jest.spyOn(
      service as unknown as { deleteCodingJobsByDefinitionInManager: (...args: unknown[]) => Promise<number> },
      'deleteCodingJobsByDefinitionInManager'
    ).mockResolvedValue(1);
    const createSpy = jest.spyOn(
      service as unknown as { createDistributedCodingJobsFromPlanInManager: (...args: unknown[]) => Promise<[]> },
      'createDistributedCodingJobsFromPlanInManager'
    ).mockResolvedValue([]);

    await expect(service.refreshDistributedCodingJobs(3, {
      jobDefinitionId: 9,
      selectedVariables: [],
      selectedCoders: []
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('does not persist jobDefinitionId from direct coding job creates', async () => {
    await service.createCodingJob(7, {
      name: 'Direct job',
      jobDefinitionId: 42
    } as never);

    expect(codingJobRepository.create).toHaveBeenCalledWith(expect.not.objectContaining({
      job_definition_id: 42
    }));
    expect(codingJobRepository.create.mock.calls[0][0]).not.toHaveProperty('job_definition_id');
    expect(cacheService.delete).toHaveBeenCalledWith('coding_incomplete_variables_v5:7');
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
    codingJobRepository.findOne.mockResolvedValue({ id: 12, workspace_id: 7 });
    codingJobCoderRepository.save.mockImplementation(value => Promise.resolve(value));

    const result = await service.assignCoders(12, [1, 2]);

    expect(codingJobRepository.findOne).toHaveBeenCalledWith({
      where: { id: 12 },
      select: ['id', 'workspace_id']
    });
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

    expect(usersService.assertUsersCanCodeInWorkspace).toHaveBeenCalledWith([2], 3);
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

  it('rejects transfer when target user is not enabled as coder', async () => {
    usersService.assertUsersCanCodeInWorkspace.mockRejectedValueOnce(
      new BadRequestException('User is not enabled as coder')
    );

    await expect(service.transferCodingCases(3, 1, 2)).rejects.toBeInstanceOf(BadRequestException);

    expect(usersService.assertUsersCanCodeInWorkspace).toHaveBeenCalledWith([2], 3);
    expect(connection.transaction).not.toHaveBeenCalled();
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

  it('rejects status changes away from completed coding jobs', async () => {
    codingJobRepository.findOne.mockResolvedValue({
      id: 1,
      workspace_id: 3,
      status: 'completed'
    });
    codingJobCoderRepository.find.mockResolvedValue([]);
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);

    await expect(service.updateCodingJob(1, 3, { status: 'paused' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(codingJobRepository.save).not.toHaveBeenCalled();
  });

  it('validates updated coders before saving job fields or deleting existing assignments', async () => {
    codingJobRepository.findOne.mockResolvedValue({
      id: 1,
      workspace_id: 3,
      status: 'active'
    });
    codingJobCoderRepository.find.mockResolvedValue([]);
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);
    usersService.assertUsersCanCodeInWorkspace.mockRejectedValueOnce(
      new BadRequestException('User is not enabled as coder')
    );

    await expect(service.updateCodingJob(1, 3, {
      name: 'Changed',
      assignedCoders: [99]
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(usersService.assertUsersCanCodeInWorkspace).toHaveBeenCalledWith([99], 3);
    expect(codingJobRepository.save).not.toHaveBeenCalled();
    expect(codingJobCoderRepository.delete).not.toHaveBeenCalled();
  });

  it('rejects unsupported coding job statuses', async () => {
    codingJobRepository.findOne.mockResolvedValue({
      id: 1,
      workspace_id: 3,
      status: 'active'
    });
    codingJobCoderRepository.find.mockResolvedValue([]);
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);

    await expect(service.updateCodingJob(1, 3, { status: 'review' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(codingJobRepository.save).not.toHaveBeenCalled();
  });

  it('rejects public updates that try to mark completed coding jobs as results applied', async () => {
    codingJobRepository.findOne.mockResolvedValue({
      id: 1,
      workspace_id: 3,
      status: 'completed'
    });
    codingJobCoderRepository.find.mockResolvedValue([]);
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);

    await expect(service.updateCodingJob(1, 3, { status: 'results_applied' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(codingJobRepository.save).not.toHaveBeenCalled();
  });

  it('allows the internal apply flow to mark completed coding jobs as results applied', async () => {
    codingJobRepository.findOne.mockResolvedValue({
      id: 1,
      workspace_id: 3,
      status: 'completed'
    });
    codingJobCoderRepository.find.mockResolvedValue([]);
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);

    await expect(service.markCodingJobResultsApplied(1, 3))
      .resolves.toMatchObject({ status: 'results_applied' });
    expect(codingJobRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      status: 'results_applied'
    }));
  });

  it('uses the provided transaction manager when marking coding job results applied', async () => {
    const transactionalCodingJobRepository = createRepo();
    transactionalCodingJobRepository.findOne.mockResolvedValue({
      id: 1,
      workspace_id: 3,
      status: 'completed'
    });
    const manager = {
      getRepository: jest.fn().mockReturnValue(transactionalCodingJobRepository)
    };

    await expect(service.markCodingJobResultsApplied(1, 3, manager as never))
      .resolves.toMatchObject({ status: 'results_applied' });

    expect(manager.getRepository).toHaveBeenCalledWith(CodingJob);
    expect(transactionalCodingJobRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      status: 'results_applied'
    }));
    expect(codingJobRepository.save).not.toHaveBeenCalled();
  });

  it('rejects applying results for coding jobs that are not completed', async () => {
    codingJobRepository.findOne.mockResolvedValue({
      id: 1,
      workspace_id: 3,
      status: 'active'
    });
    codingJobCoderRepository.find.mockResolvedValue([]);
    codingJobVariableRepository.find.mockResolvedValue([]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);

    await expect(service.markCodingJobResultsApplied(1, 3))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(codingJobRepository.save).not.toHaveBeenCalled();
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

  it('does not include DERIVE_ERROR responses in coding-job variable selection', async () => {
    const qb = createQueryBuilder([]);
    responseRepository.createQueryBuilder.mockReturnValue(qb);

    await expect(service.getResponsesForVariables(3, [{ unitName: 'UNIT', variableId: 'VAR' }])).resolves.toEqual([]);

    expectManualCodingCandidateStatusFilter(qb);
  });

  it('does not include DERIVE_ERROR responses in slim variable selection', async () => {
    const qb = createQueryBuilder([]);
    responseRepository.createQueryBuilder.mockReturnValue(qb);

    await expect(service.getSlimResponsesForVariables(3, [{ unitName: 'UNIT', variableId: 'VAR' }])).resolves.toEqual([]);

    expectManualCodingCandidateStatusFilter(qb);
  });

  it('includes DERIVE_ERROR responses for job-definition variables that opt into manual coding', async () => {
    const qb = createQueryBuilder([]);
    responseRepository.createQueryBuilder.mockReturnValue(qb);

    await expect(service.getResponsesForVariables(3, [{
      unitName: 'UNIT',
      variableId: 'VAR',
      includeDeriveError: true
    }])).resolves.toEqual([]);

    const bracketCall = qb.andWhere.mock.calls.find(
      ([condition]) => condition instanceof Brackets
    );
    expect(bracketCall).toBeDefined();

    const bracketBuilder: Record<string, jest.Mock> = {
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis()
    };
    (bracketCall?.[0] as Brackets).whereFactory(bracketBuilder as never);

    expect(bracketBuilder.where).toHaveBeenCalledWith(
      'response.status_v1 IN (:...statuses)',
      {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      }
    );
    expect(bracketBuilder.orWhere).toHaveBeenCalledWith(
      expect.stringContaining('response.status_v1 = :deriveErrorStatus'),
      {
        deriveErrorStatus: statusStringToNumber('DERIVE_ERROR'),
        deriveErrorManualCodingPairKeys: ['UNIT\u001FVAR']
      }
    );
  });

  it('does not include DERIVE_ERROR responses when saving coding-job units', async () => {
    const qb = createQueryBuilder([]);
    responseRepository.createQueryBuilder.mockReturnValue(qb);
    codingJobRepository.save.mockResolvedValue({ id: 1, workspace_id: 3 });
    codingJobRepository.findOne.mockResolvedValue({ id: 1, workspace_id: 3 });
    codingJobVariableRepository.find.mockResolvedValue([{ unit_name: 'UNIT', variable_id: 'VAR' }]);
    codingJobVariableBundleRepository.find.mockResolvedValue([]);

    await service.createCodingJob(3, {
      name: 'Direct job',
      variables: [{ unitName: 'UNIT', variableId: 'VAR' }]
    } as never);

    expectManualCodingCandidateStatusFilter(qb);
  });

  it('counts DERIVE_ERROR distribution cases only for variables with job-definition opt-in', () => {
    const calculateFromContext = (
      service as unknown as {
        calculateDistributionVariableUsageFromContext: (
          workspaceId: number,
          request: {
            selectedVariables: { unitName: string; variableId: string; includeDeriveError?: boolean }[];
            selectedVariableBundles?: [];
          },
          context: unknown
        ) => Map<string, number>;
      }
    ).calculateDistributionVariableUsageFromContext.bind(service);
    const context = {
      matchingFlags: [ResponseMatchingFlag.NO_AGGREGATION],
      aggregationThreshold: null,
      derivedVariableSets: new Map(),
      assignedResponseIds: new Set(),
      allResponses: [
        {
          id: 1,
          variableid: 'VAR',
          value: 'A',
          statusV1: statusStringToNumber('CODING_INCOMPLETE'),
          unitName: 'UNIT',
          unitAlias: null,
          bookletName: 'BOOKLET',
          personLogin: 'LOGIN',
          personCode: 'CODE',
          personGroup: 'GROUP'
        },
        {
          id: 2,
          variableid: 'VAR',
          value: 'B',
          statusV1: statusStringToNumber('DERIVE_ERROR'),
          unitName: 'UNIT',
          unitAlias: null,
          bookletName: 'BOOKLET',
          personLogin: 'LOGIN2',
          personCode: 'CODE2',
          personGroup: 'GROUP'
        }
      ]
    };

    expect(calculateFromContext(3, {
      selectedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      selectedVariableBundles: []
    }, context).get('UNIT::VAR')).toBe(1);
    expect(calculateFromContext(3, {
      selectedVariables: [{ unitName: 'UNIT', variableId: 'VAR', includeDeriveError: true }],
      selectedVariableBundles: []
    }, context).get('UNIT::VAR')).toBe(2);
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
      unit_alias: 'ALIAS',
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
    mockCodingScheme();
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

  it('saves a selected code when clients explicitly send isOpen false', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      unit_alias: 'ALIAS',
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
    mockCodingScheme();
    (service as unknown as { checkAndUpdateCodingJobCompletion: jest.Mock }).checkAndUpdateCodingJobCompletion = jest.fn();

    await service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: { id: 7, score: 2 },
      isOpen: false
    } as never);

    expect(codingJobUnitRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      code: 7,
      score: 2,
      is_open: false
    }));
  });

  it('clears saved progress when selectedCode is null', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      unit_alias: 'ALIAS',
      variable_id: 'VAR',
      person_login: 'login',
      person_code: 'code',
      booklet_name: 'booklet',
      is_open: true,
      code: 7,
      score: 2,
      coding_issue_option: -1,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(job);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);
    (service as unknown as { checkAndUpdateCodingJobCompletion: jest.Mock }).checkAndUpdateCodingJobCompletion = jest.fn();

    await service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: null
    } as never);

    expect(codingJobUnitRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      code: null,
      score: null,
      coding_issue_option: null,
      is_open: false
    }));
  });

  it('rejects unsupported negative coding issue codes', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      variable_id: 'VAR',
      person_login: 'login',
      person_code: 'code',
      booklet_name: 'booklet',
      is_open: false,
      code: null,
      score: null,
      coding_issue_option: null,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(job);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);

    await expect(service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: { id: -99 }
    } as never)).rejects.toThrow('Unsupported coding issue code');

    expect(codingJobUnitRepository.save).not.toHaveBeenCalled();
  });

  it('rejects unknown positive code ids for the coding scheme variable', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      unit_alias: 'ALIAS',
      variable_id: 'VAR',
      person_login: 'login',
      person_code: 'code',
      booklet_name: 'booklet',
      is_open: false,
      code: null,
      score: null,
      coding_issue_option: null,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(job);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);
    mockCodingScheme({ codeId: 7, score: 2 });

    await expect(service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: { id: 999 }
    } as never)).rejects.toThrow('Unsupported code for variable VAR: 999');

    expect(codingJobUnitRepository.save).not.toHaveBeenCalled();
  });

  it('uses the coding scheme score instead of a client-provided score', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      unit_alias: 'ALIAS',
      variable_id: 'VAR',
      person_login: 'login',
      person_code: 'code',
      booklet_name: 'booklet',
      is_open: false,
      code: null,
      score: null,
      coding_issue_option: null,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(job);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);
    mockCodingScheme({ codeId: 7, score: 2 });
    (service as unknown as { checkAndUpdateCodingJobCompletion: jest.Mock }).checkAndUpdateCodingJobCompletion = jest.fn();

    await service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: { id: 7, score: 999 }
    } as never);

    expect(codingJobUnitRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      code: 7,
      score: 2,
      is_open: false
    }));
  });

  it('validates selected codes through the unit CodingSchemeRef instead of unit_alias', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      unit_alias: 'UNIT_FILE',
      variable_id: 'VAR',
      person_login: 'login',
      person_code: 'code',
      booklet_name: 'booklet',
      is_open: false,
      code: null,
      score: null,
      coding_issue_option: null,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(job);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);
    mockCodingScheme({
      unitFileId: 'UNIT_FILE',
      schemeRef: 'SEPARATE_SCHEME',
      fileId: 'SEPARATE_SCHEME.VOCS',
      codeId: 7,
      score: 3
    });
    (service as unknown as { checkAndUpdateCodingJobCompletion: jest.Mock }).checkAndUpdateCodingJobCompletion = jest.fn();

    await service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: { id: 7, score: 999 }
    } as never);

    expect(codingJobUnitRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      code: 7,
      score: 3,
      is_open: false
    }));
  });

  it('validates selected codes through coding scheme variable aliases', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      unit_alias: 'UNIT_FILE',
      variable_id: 'VAR_ALIAS',
      person_login: 'login',
      person_code: 'code',
      booklet_name: 'booklet',
      is_open: false,
      code: null,
      score: null,
      coding_issue_option: null,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(job);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);
    mockCodingScheme({
      unitFileId: 'UNIT_FILE',
      schemeRef: 'SEPARATE_SCHEME',
      fileId: 'SEPARATE_SCHEME.VOCS',
      variableId: 'SCHEME_VAR',
      variableAlias: 'VAR_ALIAS',
      codeId: 7,
      score: 5
    });
    (service as unknown as { checkAndUpdateCodingJobCompletion: jest.Mock }).checkAndUpdateCodingJobCompletion = jest.fn();

    await service.saveCodingProgress(1, {
      testPerson: 'login@code@booklet',
      unitId: 'UNIT',
      variableId: 'VAR_ALIAS',
      selectedCode: { id: 7, score: 999 }
    } as never);

    expect(codingJobUnitRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      code: 7,
      score: 5,
      is_open: false
    }));
  });

  it('uses the group segment when saving grouped test person progress', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      unit_alias: 'ALIAS',
      variable_id: 'VAR',
      person_login: 'login',
      person_code: 'code',
      person_group: 'group',
      booklet_name: 'booklet',
      is_open: false,
      code: null,
      score: null,
      coding_issue_option: null,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(job);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);
    mockCodingScheme();
    (service as unknown as { checkAndUpdateCodingJobCompletion: jest.Mock }).checkAndUpdateCodingJobCompletion = jest.fn();

    await service.saveCodingProgress(1, {
      testPerson: 'login@code@group@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      selectedCode: { id: 7 }
    } as never);

    expect(codingJobUnitRepository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        person_login: 'login',
        person_code: 'code',
        person_group: 'group',
        booklet_name: 'booklet'
      })
    });
  });

  it('saves notes without changing code progress', async () => {
    const job = { id: 1, workspace_id: 3 };
    const unit = {
      coding_job_id: 1,
      unit_name: 'UNIT',
      variable_id: 'VAR',
      person_login: 'login',
      person_code: 'code',
      person_group: 'group',
      booklet_name: 'booklet',
      is_open: false,
      code: null,
      score: null,
      coding_issue_option: null,
      notes: null
    };
    codingJobRepository.findOne.mockResolvedValue(job);
    codingJobUnitRepository.findOne.mockResolvedValue(unit);

    await service.saveCodingNotes(1, {
      testPerson: 'login@code@group@booklet',
      unitId: 'UNIT',
      variableId: 'VAR',
      notes: ' remember '
    });

    expect(codingJobUnitRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      notes: 'remember',
      code: null,
      score: null,
      coding_issue_option: null
    }));
    expect(codingJobRepository.update).not.toHaveBeenCalled();
  });

  it('does not create a discussion result when saving progress for a training job', async () => {
    const trainingJob = { id: 1, workspace_id: 3, training_id: 42 };
    const unit = {
      coding_job_id: 1,
      response_id: 99,
      unit_name: 'UNIT',
      unit_alias: 'ALIAS',
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
    mockCodingScheme();
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
        person_group: 'group',
        booklet_name: 'booklet',
        unit_name: 'UNIT',
        variable_id: 'GROUPED',
        unit_alias: null,
        is_open: false,
        code: 2,
        score: 1,
        coding_issue_option: null
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
    fileUploadRepository.find
      .mockResolvedValueOnce([{
        file_id: 'ALIAS',
        data: '<Unit><CodingSchemeRef>SCHEME</CodingSchemeRef></Unit>'
      }])
      .mockResolvedValueOnce([{
        file_id: 'SCHEME',
        data: { variableCodings: [{ id: 'VAR', codes: [{ id: 1, code: 'A', label: 'Alpha' }] }] }
      }]);

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
    expect(progress['login@code@group@booklet::booklet::UNIT::GROUPED']).toEqual({
      id: 2,
      code: undefined,
      label: undefined,
      score: 1
    });

    codingJobUnitRepository.find.mockResolvedValueOnce([{
      person_login: 'login',
      person_code: 'code',
      person_group: 'group',
      booklet_name: 'booklet',
      unit_name: 'UNIT',
      variable_id: 'VAR',
      notes: 'remember'
    }]);

    await expect(service.getCodingNotes(1)).resolves.toEqual({
      'login@code@group@booklet::booklet::UNIT::VAR': 'remember'
    });
  });

  it('enriches saved progress through the unit CodingSchemeRef instead of unit_alias', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 1, workspace_id: 3 });
    codingJobUnitRepository.find.mockResolvedValueOnce([
      {
        person_login: 'login',
        person_code: 'code',
        booklet_name: 'booklet',
        unit_name: 'UNIT',
        variable_id: 'VAR',
        unit_alias: 'UNIT_FILE',
        is_open: false,
        code: 7,
        score: 3,
        coding_issue_option: null
      }
    ]);
    fileUploadRepository.find
      .mockResolvedValueOnce([{
        file_id: 'UNIT_FILE',
        data: '<Unit><CodingSchemeRef>SEPARATE_SCHEME</CodingSchemeRef></Unit>'
      }])
      .mockResolvedValueOnce([{
        file_id: 'SEPARATE_SCHEME.VOCS',
        data: { variableCodings: [{ id: 'VAR', codes: [{ id: '7', code: 'S7', label: 'Scheme 7' }] }] }
      }]);

    const progress = await service.getCodingProgress(1);

    expect(progress['login@code@booklet::booklet::UNIT::VAR']).toEqual({
      id: 7,
      code: 'S7',
      label: 'Scheme 7',
      score: 3
    });
  });

  it('enriches saved progress through coding scheme variable aliases', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 1, workspace_id: 3 });
    codingJobUnitRepository.find.mockResolvedValueOnce([
      {
        person_login: 'login',
        person_code: 'code',
        booklet_name: 'booklet',
        unit_name: 'UNIT',
        variable_id: 'VAR_ALIAS',
        unit_alias: 'UNIT_FILE',
        is_open: false,
        code: 7,
        score: 5,
        coding_issue_option: null
      }
    ]);
    fileUploadRepository.find
      .mockResolvedValueOnce([{
        file_id: 'UNIT_FILE',
        data: '<Unit><CodingSchemeRef>SEPARATE_SCHEME</CodingSchemeRef></Unit>'
      }])
      .mockResolvedValueOnce([{
        file_id: 'SEPARATE_SCHEME.VOCS',
        data: {
          variableCodings: [{
            id: 'SCHEME_VAR',
            alias: 'VAR_ALIAS',
            codes: [{ id: '7', code: 'S7', label: 'Scheme Alias 7' }]
          }]
        }
      }]);

    const progress = await service.getCodingProgress(1);

    expect(progress['login@code@booklet::booklet::UNIT::VAR_ALIAS']).toEqual({
      id: 7,
      code: 'S7',
      label: 'Scheme Alias 7',
      score: 5
    });
  });

  it('enriches saved progress for regular code id zero', async () => {
    codingJobRepository.findOne.mockResolvedValue({ id: 1, workspace_id: 3 });
    codingJobUnitRepository.find.mockResolvedValueOnce([
      {
        person_login: 'login',
        person_code: 'code',
        booklet_name: 'booklet',
        unit_name: 'UNIT',
        variable_id: 'VAR',
        unit_alias: 'UNIT_FILE',
        is_open: false,
        code: 0,
        score: 0,
        coding_issue_option: null
      }
    ]);
    fileUploadRepository.find
      .mockResolvedValueOnce([{
        file_id: 'UNIT_FILE',
        data: '<Unit><CodingSchemeRef>SEPARATE_SCHEME</CodingSchemeRef></Unit>'
      }])
      .mockResolvedValueOnce([{
        file_id: 'SEPARATE_SCHEME.VOCS',
        data: { variableCodings: [{ id: 'VAR', codes: [{ id: 0, code: 'S0', label: 'Scheme 0' }] }] }
      }]);

    const progress = await service.getCodingProgress(1);

    expect(progress['login@code@booklet::booklet::UNIT::VAR']).toEqual({
      id: 0,
      code: 'S0',
      label: 'Scheme 0',
      score: 0
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
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ content: 'not-json' })
      .mockResolvedValueOnce(null)
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
    await service.setResponseMatchingMode(3, [
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_CASE,
      'UNKNOWN' as ResponseMatchingFlag
    ]);

    expect(settingRepository.save).toHaveBeenNthCalledWith(1, {
      key: 'workspace-3-duplicate-aggregation-threshold',
      content: 'disabled'
    });
    expect(settingRepository.save).toHaveBeenNthCalledWith(2, {
      key: 'workspace-3-duplicate-aggregation-threshold',
      content: '4'
    });
    expect(settingRepository.save).toHaveBeenNthCalledWith(3, {
      key: 'workspace-3-response-matching-mode',
      content: JSON.stringify({ flags: [ResponseMatchingFlag.IGNORE_CASE] })
    });
  });

  it('treats legacy disabled thresholds as no aggregation matching mode', async () => {
    settingRepository.findOne
      .mockResolvedValueOnce({ content: JSON.stringify({ flags: [ResponseMatchingFlag.IGNORE_CASE] }) })
      .mockResolvedValueOnce({ content: 'disabled' });

    await expect(service.getResponseMatchingMode(3)).resolves.toEqual([
      ResponseMatchingFlag.NO_AGGREGATION
    ]);
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

  it('filters current coder and unrelated scopes from double-coding markers', async () => {
    codingJobRepository.findOne.mockResolvedValue({
      id: 10,
      workspace_id: 3,
      job_definition_id: 5,
      training_id: null,
      case_ordering_mode: 'continuous',
      codingJobCoders: [{ user_id: 2, user: { username: 'coder2' } }]
    });
    codingJobVariableBundleRepository.find.mockResolvedValue([]);
    codingJobUnitRepository.find
      .mockResolvedValueOnce([{
        response_id: 99,
        unit_name: 'UNIT',
        unit_alias: 'UNIT',
        variable_id: 'VAR',
        variable_anchor: 'VAR',
        booklet_name: 'BOOKLET',
        person_login: 'login',
        person_code: '',
        person_group: 'group',
        notes: null,
        variable_bundle_id: null
      }])
      .mockResolvedValueOnce([
        {
          response_id: 99,
          coding_job: {
            id: 11,
            workspace_id: 3,
            job_definition_id: 5,
            training_id: null,
            codingJobCoders: [{ user_id: 1, user: { username: 'coder1' } }]
          }
        },
        {
          response_id: 99,
          coding_job: {
            id: 12,
            workspace_id: 3,
            job_definition_id: 5,
            training_id: null,
            codingJobCoders: [{ user_id: 2, user: { username: 'coder2' } }]
          }
        },
        {
          response_id: 99,
          coding_job: {
            id: 13,
            workspace_id: 3,
            job_definition_id: 6,
            training_id: null,
            codingJobCoders: [{ user_id: 3, user: { username: 'coder3' } }]
          }
        }
      ]);
    codingFileCacheService.getVariablePageMap.mockResolvedValue(new Map([['VAR', '0']]));

    const result = await service.getCodingJobUnits(10);

    expect(result[0].variablePage).toBe('0');
    expect(result[0].isDoubleCoded).toBe(true);
    expect(result[0].otherCoders).toEqual(['coder1']);
  });
});
