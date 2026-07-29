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
});
