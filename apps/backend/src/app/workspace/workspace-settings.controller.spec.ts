import { Repository } from 'typeorm';
import { WorkspaceSettingsController } from './workspace-settings.controller';
import { Setting } from '../database/entities/setting.entity';

describe('WorkspaceSettingsController', () => {
  let controller: WorkspaceSettingsController;
  let settingRepository: jest.Mocked<Pick<Repository<Setting>, 'findOne'>>;

  beforeEach(() => {
    settingRepository = {
      findOne: jest.fn()
    };
    controller = new WorkspaceSettingsController(
      settingRepository as unknown as Repository<Setting>
    );
  });

  it('returns the default coding statistics auto-fetch setting disabled when it is missing', async () => {
    settingRepository.findOne.mockResolvedValue(null);

    await expect(
      controller.getWorkspaceSetting(5, 'auto-fetch-coding-statistics')
    ).resolves.toEqual({
      id: 0,
      key: 'workspace-5-auto-fetch-coding-statistics',
      value: JSON.stringify({ enabled: false }),
      description:
        'Controls whether coding statistics are automatically fetched in the coding management component'
    });
  });

  it('returns the default manual coding job auto-refresh setting when it is missing', async () => {
    settingRepository.findOne.mockResolvedValue(null);

    await expect(
      controller.getWorkspaceSetting(5, 'auto-refresh-manual-coding-jobs')
    ).resolves.toEqual({
      id: 0,
      key: 'workspace-5-auto-refresh-manual-coding-jobs',
      value: JSON.stringify({ enabled: true }),
      description:
        'Controls whether manual coding job tables refresh automatically when the browser window regains focus'
    });
  });

  it('returns DERIVE_ERROR manual coding disabled by default when it is missing', async () => {
    settingRepository.findOne.mockResolvedValue(null);

    await expect(
      controller.getWorkspaceSetting(5, 'include-derive-error-in-manual-coding')
    ).resolves.toEqual({
      id: 0,
      key: 'workspace-5-include-derive-error-in-manual-coding',
      value: JSON.stringify({ enabled: false }),
      description:
        'Controls whether DERIVE_ERROR responses can be included in manual coding jobs'
    });
  });

  it('returns regex search disabled by default when it is missing', async () => {
    settingRepository.findOne.mockResolvedValue(null);

    await expect(
      controller.getWorkspaceSetting(5, 'enable-regex-search')
    ).resolves.toEqual({
      id: 0,
      key: 'workspace-5-enable-regex-search',
      value: JSON.stringify({ enabled: false }),
      description:
        'Controls whether selected workspace search fields interpret input as regular expressions'
    });
  });
});
