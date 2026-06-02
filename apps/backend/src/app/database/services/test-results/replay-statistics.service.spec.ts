import { Logger } from '@nestjs/common';
import { ReplayStatisticsService } from './replay-statistics.service';

describe('ReplayStatisticsService', () => {
  const createService = () => {
    const replayStatisticsRepository = {
      create: jest.fn(data => data),
      save: jest.fn(data => Promise.resolve({ id: 1, ...data }))
    };
    const service = new ReplayStatisticsService(replayStatisticsRepository as never);

    return {
      service,
      replayStatisticsRepository
    };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs sanitized client timings without adding them to persisted statistics', async () => {
    const {
      service,
      replayStatisticsRepository
    } = createService();
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await service.storeReplayStatistics({
      workspaceId: 12,
      unitId: 'DLB009',
      durationMilliseconds: 1000,
      success: true,
      clientTimings: {
        payloadToVisibleMs: 40.4,
        payloadToPlayerReadyMs: 10,
        playerReadyToVisibleMs: null,
        unexpectedTimingMs: 999,
        invalidTimingMs: -1
      }
    });

    expect(replayStatisticsRepository.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        client_timings: expect.anything()
      })
    );
    expect(logSpy).toHaveBeenCalledWith(
      'Replay client timings {"workspaceId":12,"unitId":"DLB009","success":true,"clientTimings":{"payloadToVisibleMs":40,"payloadToPlayerReadyMs":10,"playerReadyToVisibleMs":null}}'
    );
  });
});
