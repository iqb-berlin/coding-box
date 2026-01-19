import { Repository, DataSource } from 'typeorm';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { ResponseManagementService } from './response-management.service';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { Session } from '../../entities/session.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { UnitTagService } from '../workspace/unit-tag.service';
import { JournalService } from '../shared/journal.service';
import { CacheService } from '../../../cache/cache.service';
import { CodingListService } from '../coding/coding-list.service';

describe('WorkspaceTestResultsService', () => {
  let service: WorkspaceTestResultsService;
  let responseManagementService: ResponseManagementService;

  beforeEach(() => {
    responseManagementService = {
      resolveDuplicateResponses: jest.fn().mockResolvedValue({ resolvedCount: 1, success: true }),
      deleteResponse: jest.fn(),
      updateResponsesInDatabase: jest.fn()
    } as unknown as ResponseManagementService;

    service = new WorkspaceTestResultsService(
      {} as unknown as Repository<Persons>,
      {} as unknown as Repository<Unit>,
      {} as unknown as Repository<Booklet>,
      {} as unknown as Repository<ResponseEntity>,
      {} as unknown as Repository<BookletInfo>,
      {} as unknown as Repository<BookletLog>,
      {} as unknown as Repository<Session>,
      {} as unknown as Repository<UnitLog>,
      {} as unknown as Repository<ChunkEntity>,
      {} as unknown as DataSource,
      {} as unknown as UnitTagService,
      {} as unknown as JournalService,
      {} as unknown as CacheService,
      {} as unknown as CodingListService,
      responseManagementService
    );
  });

  describe('resolveDuplicateResponses', () => {
    it('should delegate to ResponseManagementService', async () => {
      const workspaceId = 1;
      const resolutionMap = { key: 123 };
      const userId = 'user-1';

      const result = await service.resolveDuplicateResponses(workspaceId, resolutionMap, userId);

      expect(responseManagementService.resolveDuplicateResponses).toHaveBeenCalledWith(workspaceId, resolutionMap, userId);
      expect(result).toEqual({ resolvedCount: 1, success: true });
    });
  });
});
