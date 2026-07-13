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

  it('does not read the workspace setting when regex was not requested', async () => {
    await controller.findFlatResponses(1, 1, 50);

    expect(settingRepository.findOne).not.toHaveBeenCalled();
    expect(workspaceTestResultsService.findFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ regexSearch: false })
    );
  });
});
