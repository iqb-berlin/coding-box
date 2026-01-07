import { DataSource, EntityManager, Repository } from 'typeorm';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { UnitTagService } from './unit-tag.service';
import { JournalService } from './journal.service';
import { CacheService } from '../../cache/cache.service';
import { CodingListService } from '../../coding/services/coding-list.service';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { BookletInfo } from '../entities/bookletInfo.entity';
import { BookletLog } from '../entities/bookletLog.entity';
import { Session } from '../entities/session.entity';
import { UnitLog } from '../entities/unitLog.entity';
import { ChunkEntity } from '../entities/chunk.entity';

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

    type ManagerMock = {
      createQueryBuilder: jest.MockedFunction<(entity?: unknown) => unknown>;
    };

    const manager: ManagerMock = {
      createQueryBuilder: jest.fn<unknown, [unknown?]>() as unknown as jest.MockedFunction<(entity?: unknown) => unknown>
    };

    const makeSelectQb = () => {
      const state: { params: Record<string, unknown> } = { params: {} };
      const qb: {
        innerJoin: jest.Mock;
        where: jest.Mock;
        andWhere: jest.Mock;
        select: jest.Mock;
        getMany: jest.Mock;
      } = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn((_: string, params?: Record<string, unknown>) => {
          state.params = { ...state.params, ...(params || {}) };
          return qb;
        }),
        andWhere: jest.fn((_: string, params?: Record<string, unknown>) => {
          state.params = { ...state.params, ...(params || {}) };
          return qb;
        }),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => {
          const key = `${String(state.params.unitId)}|${String(state.params.variableId)}|${String(state.params.subform)}|${String(state.params.testTakerLogin)}`;
          const ids = responsesByGroup[key] || [];
          return ids.map(id => ({ id }));
        })
      };
      return qb;
    };

    const makeDeleteQb = () => {
      const state: { deleteIds: number[] } = { deleteIds: [] };
      const qb: {
        delete: jest.Mock;
        from: jest.Mock;
        where: jest.Mock;
        execute: jest.Mock;
      } = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn((_: string, params?: { deleteIds?: number[] }) => {
          state.deleteIds = params?.deleteIds || [];
          deletedIds = state.deleteIds;
          return qb;
        }),
        execute: jest.fn(async () => ({ affected: state.deleteIds.length }))
      };
      return qb;
    };

    manager.createQueryBuilder.mockImplementation((entity?: unknown) => {
      if (entity) {
        return makeSelectQb() as unknown;
      }
      return makeDeleteQb() as unknown;
    });

    const dataSource = {
      transaction: async <T>(fn: (entityManager: EntityManager) => Promise<T> | T): Promise<T> => fn(manager as unknown as EntityManager)
    } as unknown as DataSource;

    const service = new WorkspaceTestResultsService(
      {} as unknown as Repository<Persons>,
      {} as unknown as Repository<Unit>,
      {} as unknown as Repository<Booklet>,
      {} as unknown as Repository<ResponseEntity>,
      {} as unknown as Repository<BookletInfo>,
      {} as unknown as Repository<BookletLog>,
      {} as unknown as Repository<Session>,
      {} as unknown as Repository<UnitLog>,
      {} as unknown as Repository<ChunkEntity>,
      dataSource,
      {} as unknown as UnitTagService,
      journalService as unknown as JournalService,
      {} as unknown as CacheService,
      {} as unknown as CodingListService
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
