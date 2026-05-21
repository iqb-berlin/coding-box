import { ReplayStatisticsService } from './replay-statistics.service';

describe('ReplayStatisticsService', () => {
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: ReplayStatisticsService;

  beforeEach(() => {
    repository = {
      create: jest.fn(data => data),
      save: jest.fn(data => Promise.resolve({ id: 1, ...data }))
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
});
