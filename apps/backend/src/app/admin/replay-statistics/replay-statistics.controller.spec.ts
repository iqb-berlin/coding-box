import { ReplayStatisticsController } from './replay-statistics.controller';
import { ReplayStatisticsService } from '../../database/services/test-results';
import {
  WORKSPACE_API_TOKEN_TYPE,
  WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE,
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
  WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE
} from '../../auth/workspace-token';

type ReplayStatisticsServiceMock = jest.Mocked<
Pick<ReplayStatisticsService, 'storeReplayStatistics' | 'getReplaySourceSummary'>
>;

describe('ReplayStatisticsController', () => {
  let controller: ReplayStatisticsController;
  let replayStatisticsService: ReplayStatisticsServiceMock;

  beforeEach(() => {
    replayStatisticsService = {
      storeReplayStatistics: jest.fn().mockResolvedValue({}),
      getReplaySourceSummary: jest.fn().mockResolvedValue({
        internal: 0,
        external: 0,
        total: 0
      })
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
        replaySource: 'internal',
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
        replaySource: 'internal',
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

  it('should allow read-only and statistics-write workspace tokens to store replay statistics', () => {
    expect(Reflect.getMetadata(
      'workspaceTokenScopeRequirements',
      ReplayStatisticsController.prototype.storeReplayStatistics
    )).toEqual([
      [WORKSPACE_TOKEN_SCOPE_REPLAY_READ],
      [WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE]
    ]);
  });

  it('should store read-only workspace token replay statistics as external', async () => {
    await controller.storeReplayStatistics(
      '7',
      {
        unitId: 'UNIT-1',
        durationMilliseconds: 1000
      },
      {
        user: {
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
        }
      }
    );

    expect(replayStatisticsService.storeReplayStatistics).toHaveBeenCalledWith(
      expect.objectContaining({
        replaySource: 'external'
      })
    );
  });

  it('should store privileged workspace token replay statistics as internal', async () => {
    await controller.storeReplayStatistics(
      '7',
      {
        unitId: 'UNIT-1',
        durationMilliseconds: 1000
      },
      {
        user: {
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [
            WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
            WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE,
            WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE
          ]
        }
      }
    );

    expect(replayStatisticsService.storeReplayStatistics).toHaveBeenCalledWith(
      expect.objectContaining({
        replaySource: 'internal'
      })
    );
  });

  it('should store statistics-write workspace token replay statistics as internal', async () => {
    await controller.storeReplayStatistics(
      '7',
      {
        unitId: 'UNIT-1',
        durationMilliseconds: 1000
      },
      {
        user: {
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE]
        }
      }
    );

    expect(replayStatisticsService.storeReplayStatistics).toHaveBeenCalledWith(
      expect.objectContaining({
        replaySource: 'internal'
      })
    );
  });

  it('should return replay source summary for the workspace', async () => {
    replayStatisticsService.getReplaySourceSummary.mockResolvedValue({
      internal: 3,
      external: 2,
      total: 5
    });

    await expect(
      controller.getReplaySourceSummary('7', undefined, undefined, '30')
    ).resolves.toEqual({
      internal: 3,
      external: 2,
      total: 5
    });

    expect(replayStatisticsService.getReplaySourceSummary).toHaveBeenCalledWith(
      7,
      {
        from: undefined,
        to: undefined,
        lastDays: '30'
      }
    );
  });
});
