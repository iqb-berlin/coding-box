import { ReplayStatisticsService } from './replay-statistics.service';

describe('ReplayStatisticsService', () => {
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let service: ReplayStatisticsService;

  beforeEach(() => {
    repository = {
      create: jest.fn(data => data),
      save: jest.fn(data => Promise.resolve({ id: 1, ...data })),
      createQueryBuilder: jest.fn()
    };
    service = new ReplayStatisticsService(repository as never);
  });

  describe('storeReplayStatistics', () => {
    it('should store whitelisted client and server timings', async () => {
      await service.storeReplayStatistics({
        workspaceId: 1,
        unitId: 'UNIT-1',
        durationMilliseconds: 1234,
        clientTimings: {
          routeToVisibleMs: 100,
          payloadMs: 25.123,
          playerReadyToVisibleMs: null,
          unexpected: 999
        },
        serverTimings: {
          assetsTotalMs: 20,
          responseFindUnitResponseMs: 4.556,
          payloadTotalMs: null,
          unexpected: 999
        }
      });

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
        workspace_id: 1,
        unit_id: 'UNIT-1',
        replay_source: 'internal',
        duration_milliseconds: 1234,
        client_timings: {
          routeToVisibleMs: 100,
          payloadMs: 25.12,
          playerReadyToVisibleMs: null
        },
        server_timings: {
          assetsTotalMs: 20,
          responseFindUnitResponseMs: 4.56,
          payloadTotalMs: null
        }
      }));
    });

    it('should store coding session timings', async () => {
      await service.storeReplayStatistics({
        workspaceId: 1,
        unitId: 'UNIT-1',
        durationMilliseconds: 1234,
        clientTimings: {
          codingSessionMs: 100.123
        },
        serverTimings: {
          codingSessionLoadJobMs: 1,
          codingSessionLoadContextMs: 2,
          codingSessionReviewOverlaysMs: 3,
          codingSessionBuildUnitsMs: 4,
          codingSessionBuildProgressMs: 5,
          codingSessionBuildNotesMs: 6,
          codingSessionFinalizeResponseMs: 7,
          codingSessionTotalMs: 28.456
        }
      });

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
        client_timings: {
          codingSessionMs: 100.12
        },
        server_timings: {
          codingSessionLoadJobMs: 1,
          codingSessionLoadContextMs: 2,
          codingSessionReviewOverlaysMs: 3,
          codingSessionBuildUnitsMs: 4,
          codingSessionBuildProgressMs: 5,
          codingSessionBuildNotesMs: 6,
          codingSessionFinalizeResponseMs: 7,
          codingSessionTotalMs: 28.46
        }
      }));
    });

    it('should store external replay source when provided', async () => {
      await service.storeReplayStatistics({
        workspaceId: 1,
        unitId: 'UNIT-1',
        durationMilliseconds: 1000,
        replaySource: 'external'
      });

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
        replay_source: 'external'
      }));
    });

    it('should clamp invalid or oversized duration and timing values', async () => {
      await service.storeReplayStatistics({
        workspaceId: 1,
        unitId: 'UNIT-1',
        durationMilliseconds: Number.POSITIVE_INFINITY,
        clientTimings: {
          routeToVisibleMs: -10,
          loadToVisibleMs: 90_000_000
        }
      });

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
        duration_milliseconds: 0,
        client_timings: {
          routeToVisibleMs: 0,
          loadToVisibleMs: 86_400_000
        }
      }));
    });

    it('should truncate strings to database column lengths', async () => {
      await service.storeReplayStatistics({
        workspaceId: 1,
        unitId: 'U'.repeat(300),
        bookletId: 'B'.repeat(300),
        testPersonLogin: 'L'.repeat(300),
        testPersonCode: 'C'.repeat(300),
        durationMilliseconds: 100,
        replayUrl: `https://example.test/${'r'.repeat(2500)}`,
        errorMessage: 'E'.repeat(2500)
      });

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
        unit_id: 'U'.repeat(255),
        booklet_id: 'B'.repeat(255),
        test_person_login: 'L'.repeat(255),
        test_person_code: 'C'.repeat(255),
        replay_url: `https://example.test/${'r'.repeat(2500)}`.slice(0, 2000),
        error_message: 'E'.repeat(2000)
      }));
    });
  });

  describe('getReplaySourceSummary', () => {
    it('should return replay counts by source', async () => {
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { source: 'internal', count: '3' },
          { source: 'external', count: '2' }
        ])
      };
      repository.createQueryBuilder.mockReturnValue(queryBuilder);

      await expect(service.getReplaySourceSummary(1)).resolves.toEqual({
        internal: 3,
        external: 2,
        total: 5
      });

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('stats');
      expect(queryBuilder.select).toHaveBeenCalledWith([
        'stats.replay_source as source',
        'COUNT(*) as count'
      ]);
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'stats.workspace_id = :workspaceId',
        { workspaceId: 1 }
      );
      expect(queryBuilder.groupBy).toHaveBeenCalledWith('stats.replay_source');
    });
  });
});
