import { ReplayStatisticsController } from './replay-statistics.controller';
import { ReplayStatisticsService } from '../../database/services/test-results';

describe('ReplayStatisticsController', () => {
  let controller: ReplayStatisticsController;
  let replayStatisticsService: jest.Mocked<Pick<ReplayStatisticsService, 'storeReplayStatistics'>>;

  beforeEach(() => {
    replayStatisticsService = {
      storeReplayStatistics: jest.fn().mockResolvedValue({})
    };
    controller = new ReplayStatisticsController(
      replayStatisticsService as unknown as ReplayStatisticsService
    );
  });

  it('should remove sensitive replay query params before storing statistics', async () => {
    await controller.storeReplayStatistics('7', {
      unitId: 'UNIT-1',
      durationMilliseconds: 1000,
      replayUrl: 'https://example.test/#/replay/person/unit/0/0?auth=secret&workspaceId=7&unitsData=large&mode=coding'
    });

    expect(replayStatisticsService.storeReplayStatistics).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        replayUrl: 'https://example.test/#/replay/person/unit/0/0?workspaceId=7&mode=coding'
      })
    );
  });

  it('should sanitize relative replay URLs and keep non-sensitive params', async () => {
    await controller.storeReplayStatistics('7', {
      unitId: 'UNIT-1',
      durationMilliseconds: 1000,
      replayUrl: '/#/replay/person/unit/0/0?auth=secret&workspaceId=7&unitsData=large&mode=coding'
    });

    expect(replayStatisticsService.storeReplayStatistics).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        replayUrl: '/#/replay/person/unit/0/0?workspaceId=7&mode=coding'
      })
    );
  });

  it('should truncate sanitized replay URLs', async () => {
    await controller.storeReplayStatistics('7', {
      unitId: 'UNIT-1',
      durationMilliseconds: 1000,
      replayUrl: `https://example.test/#/replay/person/unit/0/0?workspaceId=7&mode=${'x'.repeat(3000)}&auth=secret`
    });

    const storedReplayUrl = replayStatisticsService.storeReplayStatistics.mock.calls[0][0].replayUrl;
    expect(storedReplayUrl).toHaveLength(2048);
    expect(storedReplayUrl).not.toContain('auth=');
  });
});
