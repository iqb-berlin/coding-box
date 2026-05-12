import { QueryRunner } from 'typeorm';
import { ResponseManagementService } from './response-management.service';
import { ResponseEntity } from '../../entities/response.entity';

describe('ResponseManagementService', () => {
  const workspaceTestResultsService = {
    invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined),
    invalidateCodingStatisticsCache: jest.fn().mockResolvedValue(undefined)
  };

  const createQueryBuilder = (executeResult: { affected?: number } = { affected: 1 }) => ({
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(executeResult)
  });

  const createService = () => new ResponseManagementService(
    {} as never,
    {} as never,
    workspaceTestResultsService as never
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
    const upsertUpdateQueryBuilder = createQueryBuilder({ affected: 1 });
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
    const queryRunner = {
      manager,
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined)
    } as unknown as QueryRunner;

    const service = createService();

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
      { unitIds: [1], autoCoderRun: 1 }
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
    expect(manager.insert).not.toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(workspaceTestResultsService.invalidateWorkspaceStatsCache).toHaveBeenCalledWith(1);
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
      transaction: jest.fn(cb => cb(manager))
    };
    const journalService = {
      createEntry: jest.fn().mockResolvedValue(undefined)
    };
    const codingFreshnessService = {
      markUnitsStaleAfterResultChange: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ResponseManagementService(
      connection as never,
      journalService as never,
      workspaceTestResultsService as never,
      codingFreshnessService as never
    );

    const result = await service.deleteResponse(1, 50, 'user-1');

    expect(result.success).toBe(true);
    expect(codingFreshnessService.markUnitsStaleAfterResultChange)
      .toHaveBeenCalledWith(1, [7], 'RESULT_DELETED');
    expect(workspaceTestResultsService.invalidateWorkspaceStatsCache)
      .toHaveBeenCalledWith(1);
    expect(workspaceTestResultsService.invalidateCodingStatisticsCache)
      .toHaveBeenCalledWith(1);
  });
});
