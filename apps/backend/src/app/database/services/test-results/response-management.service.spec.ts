import { QueryRunner } from 'typeorm';
import { ResponseManagementService } from './response-management.service';
import { AutocoderSourceRevisionStaleError } from './autocoder-source-revision-stale.error';
import { ResponseEntity } from '../../entities/response.entity';

describe('ResponseManagementService', () => {
  const workspaceTestResultsService = {
    invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined),
    invalidateCodingStatisticsCache: jest.fn().mockResolvedValue(undefined)
  };

  const createQueryBuilder = (
    executeResult: { affected?: number; raw?: unknown } = { affected: 1 }
  ) => ({
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(executeResult)
  });

  const createService = (codingFreshnessService?: unknown) => new ResponseManagementService(
    {} as never,
    {} as never,
    workspaceTestResultsService as never,
    codingFreshnessService as never
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates existing generated autocoder rows and clears stale generated rows', async () => {
    const cleanupSelectQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 10,
          unitid: 1,
          variableid: 'derived_var',
          subform: ''
        } as ResponseEntity,
        {
          id: 11,
          unitid: 1,
          variableid: 'stale_var',
          subform: ''
        } as ResponseEntity
      ])
    };
    const cleanupUpdateQueryBuilder = createQueryBuilder();
    const upsertUpdateQueryBuilder = createQueryBuilder({
      affected: 1,
      raw: [{ id: 10 }]
    });
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(cleanupSelectQueryBuilder)
      }),
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(cleanupUpdateQueryBuilder)
        .mockReturnValueOnce(upsertUpdateQueryBuilder),
      insert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      query: jest.fn().mockResolvedValue([])
    };
    const commitTransaction = jest.fn().mockResolvedValue(undefined);
    const release = jest.fn().mockResolvedValue(undefined);
    const queryRunner = {
      manager,
      commitTransaction,
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release
    } as unknown as QueryRunner;

    const codingFreshnessService = {
      markAppliedCodingJobsResultsClearedForResponseIds: jest.fn().mockResolvedValue(undefined),
      markVersionCurrent: jest.fn().mockResolvedValue(undefined)
    };
    const service = createService(codingFreshnessService);

    await service.updateResponsesInDatabase(
      1,
      [
        {
          id: -1,
          isNew: true,
          isAutocoderGenerated: true,
          unitid: 1,
          variableid: 'derived_var',
          value: 'derived value',
          status: 3,
          subform: '',
          code_v1: 1,
          status_v1: 'VALUE_CHANGED',
          score_v1: 1,
          code_v2: null,
          status_v2: null,
          score_v2: null,
          code_v3: null,
          status_v3: null,
          score_v3: null
        }
      ],
      queryRunner,
      undefined,
      undefined,
      undefined,
      undefined,
      { unitIds: [1], autoCoderRun: 1, markCurrentVersion: 'v1' }
    );

    expect(cleanupUpdateQueryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        code_v1: null,
        status_v1: null,
        score_v1: null,
        code_v3: null,
        status_v3: null,
        score_v3: null
      })
    );
    expect(cleanupUpdateQueryBuilder.where).toHaveBeenCalledWith(
      'id IN (:...staleIds)',
      { staleIds: [11] }
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM response'),
      [[11]]
    );
    expect(upsertUpdateQueryBuilder.where).toHaveBeenCalledWith(
      'unitid = :unitid',
      { unitid: 1 }
    );
    expect(upsertUpdateQueryBuilder.andWhere).toHaveBeenCalledWith(
      'is_autocoder_generated = :generated',
      { generated: true }
    );
    expect(upsertUpdateQueryBuilder.returning).toHaveBeenCalledWith('id');
    expect(manager.insert).not.toHaveBeenCalled();
    expect(codingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
      .toHaveBeenCalledWith(1, [11], 'AUTOCODE_RUN', 'stale_source', manager);
    expect(codingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
      .toHaveBeenCalledWith(1, [10], 'AUTOCODE_RUN', 'stale_source', manager);
    expect(codingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
      .toHaveBeenCalledTimes(2);
    const deleteCallIndex = manager.query.mock.calls.findIndex(
      ([sql]) => String(sql).includes('DELETE FROM response')
    );
    expect(
      codingFreshnessService
        .markAppliedCodingJobsResultsClearedForResponseIds
        .mock
        .invocationCallOrder[0]
    )
      .toBeLessThan(manager.query.mock.invocationCallOrder[deleteCallIndex]);
    expect(codingFreshnessService.markVersionCurrent)
      .toHaveBeenCalledWith(1, [1], 'v1', manager);
    expect(codingFreshnessService.markVersionCurrent.mock.invocationCallOrder[0])
      .toBeLessThan(commitTransaction.mock.invocationCallOrder[0]);
    expect(codingFreshnessService.markVersionCurrent.mock.invocationCallOrder[0])
      .toBeLessThan(release.mock.invocationCallOrder[0]);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(workspaceTestResultsService.invalidateWorkspaceStatsCache).toHaveBeenCalledWith(1);
  });

  it('marks applied jobs stale when generated autocoder upsert updates an existing row', async () => {
    const cleanupSelectQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 77,
          unitid: 1,
          variableid: 'derived_var',
          subform: ''
        } as ResponseEntity
      ])
    };
    const upsertUpdateQueryBuilder = createQueryBuilder({
      affected: 1,
      raw: [{ id: 77 }]
    });
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(cleanupSelectQueryBuilder)
      }),
      createQueryBuilder: jest.fn().mockReturnValue(upsertUpdateQueryBuilder),
      insert: jest.fn().mockResolvedValue({}),
      query: jest.fn().mockResolvedValue([])
    };
    const queryRunner = {
      manager,
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined)
    } as unknown as QueryRunner;
    const codingFreshnessService = {
      markAppliedCodingJobsResultsClearedForResponseIds: jest.fn().mockResolvedValue(undefined),
      markVersionCurrent: jest.fn().mockResolvedValue(undefined)
    };
    const service = createService(codingFreshnessService);

    await service.updateResponsesInDatabase(
      1,
      [
        {
          id: -1,
          isNew: true,
          isAutocoderGenerated: true,
          unitid: 1,
          variableid: 'derived_var',
          value: 'updated derived value',
          status: 3,
          subform: '',
          code_v1: 2,
          status_v1: 'VALUE_CHANGED',
          score_v1: 2,
          code_v2: null,
          status_v2: null,
          score_v2: null,
          code_v3: null,
          status_v3: null,
          score_v3: null
        }
      ],
      queryRunner,
      undefined,
      undefined,
      undefined,
      undefined,
      { unitIds: [1], autoCoderRun: 1, markCurrentVersion: 'v1' }
    );

    expect(upsertUpdateQueryBuilder.returning).toHaveBeenCalledWith('id');
    expect(manager.insert).not.toHaveBeenCalled();
    expect(codingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
      .toHaveBeenCalledWith(1, [77], 'AUTOCODE_RUN', 'stale_source', manager);
  });

  it('skips autocoder updates when the planned source revision is stale', async () => {
    const manager = {
      query: jest.fn().mockResolvedValue([])
    };
    const queryRunner = {
      manager,
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined)
    } as unknown as QueryRunner;
    const codingFreshnessService = {
      isRevisionCurrent: jest.fn().mockResolvedValue(false),
      markVersionCurrent: jest.fn()
    };
    const service = createService(codingFreshnessService);

    await expect(service.updateResponsesInDatabase(
      1,
      [],
      queryRunner,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        unitIds: [1],
        autoCoderRun: 1,
        markCurrentVersion: 'v1',
        expectedSourceRevision: 5
      }
    )).rejects.toBeInstanceOf(AutocoderSourceRevisionStaleError);

    expect(codingFreshnessService.isRevisionCurrent)
      .toHaveBeenCalledWith(1, 5, manager);
    expect(codingFreshnessService.markVersionCurrent).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('moves applied jobs back to completed/stale-source after auto-coding run 1 clears manual results', async () => {
    const cleanupSelectQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([])
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(cleanupSelectQueryBuilder)
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      query: jest.fn().mockResolvedValue([])
    };
    const queryRunner = {
      manager,
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined)
    } as unknown as QueryRunner;
    const codingFreshnessService = {
      markAppliedCodingJobsResultsClearedForResponseIds: jest.fn().mockResolvedValue(undefined),
      markVersionCurrent: jest.fn().mockResolvedValue(undefined)
    };
    const service = createService(codingFreshnessService);

    await service.updateResponsesInDatabase(
      1,
      [
        {
          id: 42,
          unitid: 1,
          variableid: 'VAR_1',
          code_v1: 1,
          status_v1: 'VALUE_CHANGED',
          score_v1: 1,
          code_v2: null,
          status_v2: null,
          score_v2: null,
          code_v3: null,
          status_v3: null,
          score_v3: null
        }
      ],
      queryRunner,
      undefined,
      undefined,
      undefined,
      undefined,
      { unitIds: [1], autoCoderRun: 1, markCurrentVersion: 'v1' }
    );

    expect(manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      42,
      expect.objectContaining({
        code_v2: null,
        status_v2: null,
        score_v2: null,
        code_v3: null,
        status_v3: null,
        score_v3: null
      })
    );
    expect(codingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
      .toHaveBeenCalledWith(1, [42], 'AUTOCODE_RUN', 'stale_source', manager);
    expect(codingFreshnessService.markVersionCurrent)
      .toHaveBeenCalledWith(1, [1], 'v1', manager);
  });

  it('invalidates coding statistics after deleting a response directly', async () => {
    const selectQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 50,
        unit: {
          id: 7,
          name: 'UNIT_1',
          booklet: {
            id: 3,
            person: { id: 2 }
          }
        },
        variableid: 'VAR_1',
        value: 'old'
      })
    };
    const deleteQueryBuilder = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 })
    };
    const manager = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(selectQueryBuilder)
        .mockReturnValueOnce(deleteQueryBuilder)
    };
    const connection = {
      transaction: jest.fn(cb => cb(manager)),
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue([]),
        release: jest.fn().mockResolvedValue(undefined)
      })
    };
    const journalService = {
      createEntry: jest.fn().mockResolvedValue(undefined)
    };
    const codingFreshnessService = {
      markUnitsStaleAfterResultChange: jest.fn().mockResolvedValue(undefined),
      markCodingJobsStaleForResponseIds: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ResponseManagementService(
      connection as never,
      journalService as never,
      workspaceTestResultsService as never,
      codingFreshnessService as never
    );

    const result = await service.deleteResponse(1, 50, 'user-1');

    expect(result.success).toBe(true);
    expect(codingFreshnessService.markCodingJobsStaleForResponseIds)
      .toHaveBeenCalledWith(1, [50], 'RESULT_DELETED', 'stale_source', manager);
    expect(codingFreshnessService.markUnitsStaleAfterResultChange)
      .toHaveBeenCalledWith(1, [7], 'RESULT_DELETED');
    expect(workspaceTestResultsService.invalidateWorkspaceStatsCache)
      .toHaveBeenCalledWith(1);
    expect(workspaceTestResultsService.invalidateCodingStatisticsCache)
      .toHaveBeenCalledWith(1);
  });
});
