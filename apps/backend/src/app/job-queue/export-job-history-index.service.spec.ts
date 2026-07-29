import { CacheService } from '../cache/cache.service';
import { ExportJobHistoryIndexService } from './export-job-history-index.service';

describe('ExportJobHistoryIndexService', () => {
  const cacheService = {
    executeScript: jest.fn()
  };
  let service: ExportJobHistoryIndexService;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.executeScript.mockResolvedValue(1);
    service = new ExportJobHistoryIndexService(
      cacheService as unknown as CacheService
    );
  });

  it('indexes jobs for workspace-wide and user-specific history', async () => {
    await service.addJob('job-1', {
      workspaceId: 7,
      userId: 3,
      exportType: 'coding-list'
    }, 1234);

    expect(cacheService.executeScript).toHaveBeenCalledWith(
      expect.stringMatching(/ZADD[\s\S]*ZCARD[\s\S]*entryCount > maxEntries/),
      [
        'export-job-history:v1:workspace:7:type:coding-list',
        'export-job-history:v1:workspace:7:user:3:type:coding-list'
      ],
      ['job-1', '1234', '2000', '172800']
    );
  });

  it('merges type-specific IDs by score before applying the limit', async () => {
    cacheService.executeScript.mockResolvedValue([
      'coding-older', '10',
      'coding-newer', '30',
      'matrix-middle', '20'
    ]);

    await expect(service.getRecentJobIds({
      workspaceId: 7,
      userId: 3,
      exportTypes: ['coding-list', 'item-matrix']
    }, 2)).resolves.toEqual(['coding-newer', 'matrix-middle']);

    expect(cacheService.executeScript).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('ZREVRANGE'"),
      [
        'export-job-history:v1:workspace:7:user:3:type:coding-list',
        'export-job-history:v1:workspace:7:user:3:type:item-matrix'
      ],
      ['2']
    );
  });

  it('removes stale IDs from every queried type index', async () => {
    await service.removeJobIds({
      workspaceId: 7,
      exportTypes: ['test-results', 'test-logs']
    }, ['stale-1', 'stale-2']);

    expect(cacheService.executeScript).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('ZREM'"),
      [
        'export-job-history:v1:workspace:7:type:test-results',
        'export-job-history:v1:workspace:7:type:test-logs'
      ],
      ['stale-1', 'stale-2']
    );
  });

  it('claims the legacy backfill only when it is not complete or running', async () => {
    await expect(service.claimLegacyBackfill()).resolves.toEqual({
      status: 'claimed',
      claim: expect.any(String)
    });

    expect(cacheService.executeScript).toHaveBeenCalledWith(
      expect.stringMatching(/EXISTS[\s\S]*SET[\s\S]*NX/),
      [
        'export-job-history:v2:legacy-backfill-complete',
        'export-job-history:v2:legacy-backfill-claim'
      ],
      [expect.any(String), '300']
    );

    cacheService.executeScript.mockResolvedValueOnce(0);
    await expect(service.claimLegacyBackfill()).resolves.toEqual({
      status: 'busy'
    });

    cacheService.executeScript.mockResolvedValueOnce(2);
    await expect(service.claimLegacyBackfill()).resolves.toEqual({
      status: 'complete'
    });
  });

  it('completes and releases legacy backfill claims by ownership token', async () => {
    await service.completeLegacyBackfill('claim-1');
    await service.releaseLegacyBackfillClaim('claim-2');

    expect(cacheService.executeScript).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/SET[\s\S]*DEL/),
      [
        'export-job-history:v2:legacy-backfill-complete',
        'export-job-history:v2:legacy-backfill-claim'
      ],
      ['claim-1']
    );
    expect(cacheService.executeScript).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/GET[\s\S]*DEL/),
      ['export-job-history:v2:legacy-backfill-claim'],
      ['claim-2']
    );
  });

  it('refreshes a legacy backfill claim only while it is still owned', async () => {
    await service.refreshLegacyBackfillClaim('claim-1');

    expect(cacheService.executeScript).toHaveBeenCalledWith(
      expect.stringMatching(/GET[\s\S]*EXPIRE/),
      ['export-job-history:v2:legacy-backfill-claim'],
      ['claim-1', '300']
    );

    cacheService.executeScript.mockResolvedValueOnce(0);
    await expect(service.refreshLegacyBackfillClaim('expired-claim'))
      .rejects.toThrow('claim expired');
  });
});
