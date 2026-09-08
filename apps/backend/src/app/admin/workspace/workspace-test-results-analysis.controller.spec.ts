import { Repository } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { Setting } from '../../database/entities/setting.entity';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import { WorkspaceTestResultsAnalysisController } from './workspace-test-results-analysis.controller';

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
      settingRepository as unknown as Repository<Setting>
    );
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
      'true'
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
      'true'
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
      'false'
    );

    expect(settingRepository.findOne).not.toHaveBeenCalled();
    expect(workspaceTestResultsService.findFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ regexSearch: false })
    );
  });
});

describe('filter options cache generations', () => {
  it('keeps an in-flight result out of the next generation and expires old entries', async () => {
    let generation = 0;
    let finish: () => void;
    const started = new Promise<void>(resolve => {
      finish = resolve;
    });
    let finishQuery: (value: unknown) => void;
    const database = {
      findFlatResponseFilterOptions: jest.fn(() => {
        finish();
        return new Promise(resolve => { finishQuery = resolve; });
      })
    };
    const cache = {
      generateFlatResponseFilterOptionsVersionKey: () => 'version',
      generateFlatResponseFilterOptionsCacheKey: (_workspace: number, version: number) => `options:v${version}`,
      getNumber: jest.fn(async () => generation),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true)
    };
    const subject = new WorkspaceTestResultsAnalysisController(database as never, cache as never, {} as never);
    const pending = subject.findFlatResponseFilterOptions(1);
    await started;
    generation = 1;
    finishQuery({ units: ['before mutation'] });
    await pending;
    expect(cache.set).toHaveBeenCalledWith('options:v0', { units: ['before mutation'] }, 300);
    expect(cache.set).not.toHaveBeenCalledWith('options:v1', expect.anything(), expect.anything());
    expect(cache.getNumber).toHaveBeenCalledWith('version', 0);
  });
});
