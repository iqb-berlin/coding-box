import { DataSource } from 'typeorm';
import { WorkspaceTestResultsService } from './workspace-test-results.service';

describe('WorkspaceTestResultsService.resolveDuplicateResponses', () => {
  it('should delete only non-selected duplicates for the same unit+variable+subform+login', async () => {
    const responsesByGroup: Record<string, number[]> = {
      '10|V1|S1|login1': [1, 2],
      '10|V1|S2|login1': [3, 4]
    };

    const journalService = {
      createEntry: jest.fn().mockResolvedValue(undefined)
    };

    let deletedIds: number[] = [];

    const manager = {
      createQueryBuilder: jest.fn()
    } as any;

    const makeSelectQb = () => {
      const state: { params: Record<string, any> } = { params: {} };
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn((_: string, params?: Record<string, any>) => {
          state.params = { ...state.params, ...(params || {}) };
          return qb;
        }),
        andWhere: jest.fn((_: string, params?: Record<string, any>) => {
          state.params = { ...state.params, ...(params || {}) };
          return qb;
        }),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => {
          const key = `${state.params.unitId}|${state.params.variableId}|${state.params.subform}|${state.params.testTakerLogin}`;
          const ids = responsesByGroup[key] || [];
          return ids.map(id => ({ id }));
        })
      };
      return qb;
    };

    const makeDeleteQb = () => {
      const state: { deleteIds: number[] } = { deleteIds: [] };
      const qb: any = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn((_: string, params?: Record<string, any>) => {
          state.deleteIds = (params?.deleteIds || []) as number[];
          deletedIds = state.deleteIds;
          return qb;
        }),
        execute: jest.fn(async () => ({ affected: state.deleteIds.length }))
      };
      return qb;
    };

    manager.createQueryBuilder.mockImplementation((entity?: unknown) => {
      if (entity) {
        return makeSelectQb();
      }
      return makeDeleteQb();
    });

    const dataSource: DataSource = {
      transaction: (fn: any) => fn(manager)
    } as any;

    const service = new WorkspaceTestResultsService(
      {} as any as any, // personsRepository
      {} as any as any, // unitRepository
      {} as any as any, // bookletRepository
      {} as any as any, // responseRepository
      {} as any as any, // bookletInfoRepository
      {} as any as any, // bookletLogRepository
      {} as any as any, // sessionRepository
      {} as any as any, // unitLogRepository
      {} as any as any, // chunkRepository
      dataSource,
      {} as any, // unitTagService
      journalService as any,
      {} as any, // cacheService
      {} as any // codingListService
    );

    const resolutionMap = {
      [`10|${encodeURIComponent('V1')}|${encodeURIComponent('S1')}|${encodeURIComponent('login1')}`]: 1
    };

    const result = await service.resolveDuplicateResponses(1, resolutionMap, 'user-1');

    expect(result.success).toBe(true);
    expect(result.resolvedCount).toBe(1);

    expect(deletedIds).toEqual([2]);
    expect(journalService.createEntry).toHaveBeenCalled();
  });
});
