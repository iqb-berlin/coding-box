import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { WorkspaceSettingsService } from '../../workspace/workspace-settings.service';
import { CacheService } from '../../cache/cache.service';
import { Setting } from '../../database/entities/setting.entity';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import { WorkspaceTestResultsAnalysisController } from './workspace-test-results-analysis.controller';
import { FlatResponseFilterOptions } from './dto/workspace-test-results.interfaces';
import { FlatResponseFilterOptionsProcessor } from '../../job-queue/processors/flat-response-filter-options.processor';

describe('WorkspaceTestResultsAnalysisController', () => {
  let controller: WorkspaceTestResultsAnalysisController;
  let workspaceTestResultsService: {
    findFlatResponses: jest.Mock;
  };
  let settingRepository: {
    findOne: jest.Mock;
  };

  beforeEach(() => {
    workspaceTestResultsService = {
      findFlatResponses: jest.fn().mockResolvedValue([[], 0])
    };
    settingRepository = {
      findOne: jest.fn()
    };
    controller = new WorkspaceTestResultsAnalysisController(
      workspaceTestResultsService as unknown as WorkspaceTestResultsService,
      {} as CacheService,
      new WorkspaceSettingsService(settingRepository as unknown as Repository<Setting>)
    );
  });

  it('shares a cold filter-options computation with the queue processor', async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const cache = new CacheService(redis as never);
    let complete!: (value: FlatResponseFilterOptions) => void;
    const findFlatResponseFilterOptions = jest.fn(() => new Promise<FlatResponseFilterOptions>(resolve => { complete = resolve; }));
    const results = { findFlatResponseFilterOptions } as unknown as WorkspaceTestResultsService;
    const api = new WorkspaceTestResultsAnalysisController(results, cache, {} as WorkspaceSettingsService);
    const processor = new FlatResponseFilterOptionsProcessor(cache, results);
    const job = { data: { workspaceId: 1, processingDurationThresholdMs: 60000 }, updateProgress: jest.fn(), id: 'test' };
    const requests = Array.from({ length: 10 }, () => api.findFlatResponseFilterOptions(1));
    const worker = processor.processWorkspaceJob(job as unknown as Job);
    // Let all asynchronous Redis reads reach the computation gate.
    await new Promise(resolve => { setImmediate(resolve); });
    expect(findFlatResponseFilterOptions).toHaveBeenCalledTimes(1);
    const value = { codes: ['before'] } as FlatResponseFilterOptions;
    complete(value);
    expect(await Promise.all(requests)).toEqual(Array(10).fill(value));
    await worker;
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('keeps pre-import filter options under their original cache version', async () => {
    const entries = new Map<string, string>();
    const redis = {
      get: jest.fn(async (key: string) => entries.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => { entries.set(key, value); })
    };
    const cache = new CacheService(redis as never);
    let completeOld!: (value: FlatResponseFilterOptions) => void;
    const old = new Promise<FlatResponseFilterOptions>(resolve => { completeOld = resolve; });
    const before = { codes: ['before'] } as FlatResponseFilterOptions;
    const after = { codes: ['after'] } as FlatResponseFilterOptions;
    const findFlatResponseFilterOptions = jest.fn().mockReturnValueOnce(old).mockResolvedValueOnce(after);
    const api = new WorkspaceTestResultsAnalysisController(
      { findFlatResponseFilterOptions } as unknown as WorkspaceTestResultsService, cache, {} as WorkspaceSettingsService
    );
    const first = api.findFlatResponseFilterOptions(1);
    await new Promise(resolve => { setImmediate(resolve); });
    entries.set(cache.generateFlatResponseFilterOptionsVersionKey(1), '2');
    await expect(api.findFlatResponseFilterOptions(1)).resolves.toEqual(after);
    completeOld(before);
    await expect(first).resolves.toEqual(before);

    expect(JSON.parse(entries.get(cache.generateFlatResponseFilterOptionsCacheKey(1, 1, 60000))!)).toEqual(before);
    expect(JSON.parse(entries.get(cache.generateFlatResponseFilterOptionsCacheKey(1, 2, 60000))!)).toEqual(after);
    await expect(api.findFlatResponseFilterOptions(1)).resolves.toEqual(after);
    expect(findFlatResponseFilterOptions).toHaveBeenCalledTimes(2);
  });

  it('enables regex only when the workspace setting is enabled', async () => {
    settingRepository.findOne.mockResolvedValue({
      content: JSON.stringify({ enabled: true })
    });

    await controller.findFlatResponses(
      1,
      1,
      50,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '^VAR$',
      true
    );

    expect(workspaceTestResultsService.findFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        response: '^VAR$',
        regexSearch: true
      })
    );
  });

  it('ignores the regex request when the workspace setting is disabled', async () => {
    settingRepository.findOne.mockResolvedValue(null);

    await controller.findFlatResponses(
      1,
      1,
      50,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '^VAR$',
      true
    );

    expect(workspaceTestResultsService.findFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ regexSearch: false })
    );
  });

  it('does not enable regex search when the query flag is omitted', async () => {
    settingRepository.findOne.mockResolvedValue({
      content: JSON.stringify({ enabled: true })
    });

    await controller.findFlatResponses(1, 1, 50);

    expect(settingRepository.findOne).not.toHaveBeenCalled();
    expect(workspaceTestResultsService.findFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ regexSearch: false })
    );
  });

  it('allows regex search to be disabled explicitly for one request', async () => {
    settingRepository.findOne.mockResolvedValue({
      content: JSON.stringify({ enabled: true })
    });

    await controller.findFlatResponses(
      1,
      1,
      50,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '^VAR$',
      false
    );

    expect(settingRepository.findOne).not.toHaveBeenCalled();
    expect(workspaceTestResultsService.findFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ regexSearch: false })
    );
  });
});
