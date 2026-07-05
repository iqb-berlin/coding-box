import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { WorkspaceSettingsController } from './workspace-settings.controller';
import { Setting } from '../database/entities/setting.entity';

interface TransactionalSettingRepositoryMock {
  findOne: jest.Mock<Promise<Setting | null>, [unknown]>;
  create: jest.Mock<Setting, [Partial<Setting>]>;
  save: jest.Mock<Promise<Setting>, [Setting]>;
}

interface SettingRepositoryMock extends TransactionalSettingRepositoryMock {
  manager: {
    transaction: jest.Mock;
  };
}

describe('WorkspaceSettingsController', () => {
  let controller: WorkspaceSettingsController;
  let transactionalSettingRepository: TransactionalSettingRepositoryMock;
  let settingRepository: SettingRepositoryMock;

  beforeEach(() => {
    transactionalSettingRepository = {
      findOne: jest.fn(),
      create: jest.fn((setting: Partial<Setting>) => setting as Setting),
      save: jest.fn((setting: Setting) => Promise.resolve(setting))
    };
    settingRepository = {
      findOne: jest.fn(),
      create: jest.fn((setting: Partial<Setting>) => setting as Setting),
      save: jest.fn((setting: Setting) => Promise.resolve(setting)),
      manager: {
        transaction: jest.fn((
          callback: (entityManager: {
            getRepository: () => TransactionalSettingRepositoryMock;
          }) => unknown
        ) => callback({
          getRepository: () => transactionalSettingRepository
        }))
      }
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

  it('returns evaluation mode disabled by default when it is missing', async () => {
    settingRepository.findOne.mockResolvedValue(null);

    await expect(
      controller.getWorkspaceSetting(5, 'evaluation-mode')
    ).resolves.toEqual({
      id: 0,
      key: 'workspace-5-evaluation-mode',
      value: JSON.stringify({ enabled: false }),
      description:
        'Controls whether expensive automatic coding refreshes are disabled for evaluation sessions'
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

  it('saves workspace settings in a single transaction', async () => {
    transactionalSettingRepository.findOne.mockResolvedValue(null);

    await expect(
      controller.createWorkspaceSettings(5, {
        settings: [
          {
            key: 'evaluation-mode',
            value: JSON.stringify({ enabled: true }),
            description: 'Evaluation mode'
          },
          {
            key: 'auto-refresh-manual-coding-jobs',
            value: JSON.stringify({ enabled: false }),
            description: 'Auto refresh'
          }
        ]
      })
    ).resolves.toEqual([
      {
        id: 'workspace-5-evaluation-mode',
        key: 'workspace-5-evaluation-mode',
        value: JSON.stringify({ enabled: true }),
        description: 'Evaluation mode'
      },
      {
        id: 'workspace-5-auto-refresh-manual-coding-jobs',
        key: 'workspace-5-auto-refresh-manual-coding-jobs',
        value: JSON.stringify({ enabled: false }),
        description: 'Auto refresh'
      }
    ]);

    expect(settingRepository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(transactionalSettingRepository.save).toHaveBeenCalledWith({
      key: 'workspace-5-evaluation-mode',
      content: JSON.stringify({ enabled: true })
    });
    expect(transactionalSettingRepository.save).toHaveBeenCalledWith({
      key: 'workspace-5-auto-refresh-manual-coding-jobs',
      content: JSON.stringify({ enabled: false })
    });
  });

  it('rejects a batch request without a settings array', async () => {
    await expect(
      controller.createWorkspaceSettings(5, {} as never)
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(settingRepository.manager.transaction).not.toHaveBeenCalled();
  });

  it('rejects a batch request with invalid setting entries', async () => {
    await expect(
      controller.createWorkspaceSettings(5, {
        settings: [
          {
            key: '',
            value: JSON.stringify({ enabled: true })
          }
        ]
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(settingRepository.manager.transaction).not.toHaveBeenCalled();
  });
});
