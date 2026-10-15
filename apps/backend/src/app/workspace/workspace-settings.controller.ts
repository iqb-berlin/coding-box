import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Req
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { JournalService } from '../database/services/shared/journal.service';
import { Setting } from '../database/entities/setting.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import {
  AccessLevelGuard,
  RequireAccessLevel
} from '../admin/workspace/access-level.guard';
import {
  DEFAULT_AUTH_SESSION_IDLE_TIMEOUT_MINUTES,
  DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS
} from '../../../../../api-dto/workspaces/workspace-setting-defaults';

interface WorkspaceSettingWriteDto {
  key: string;
  value: string;
  description?: string;
}

interface WorkspaceSettingsBatchDto {
  settings: WorkspaceSettingWriteDto[];
}

interface WorkspaceSettingResponse {
  id: string | number;
  key: string;
  value: string;
  description?: string;
}

const DEFAULT_WORKSPACE_SETTINGS: Record<string, {
  value: unknown;
  description: string;
}> = {
  'auto-fetch-coding-statistics': {
    value: { enabled: false },
    description:
      'Controls whether coding statistics are automatically fetched in the coding management component'
  },
  'auto-refresh-manual-coding-jobs': {
    value: { enabled: true },
    description:
      'Controls whether manual coding job tables refresh automatically when the browser window regains focus'
  },
  'evaluation-mode': {
    value: { enabled: false },
    description:
      'Controls whether expensive automatic coding refreshes are disabled for evaluation sessions'
  },
  'show-test-results-log-anomalies': {
    value: { enabled: false },
    description:
      'Controls whether log anomalies are shown as a column in the test results table'
  },
  'include-derive-error-in-manual-coding': {
    value: { enabled: false },
    description:
      'Controls whether DERIVE_ERROR responses are included in coding lists and can be selected for manual coding jobs'
  },
  'enable-regex-search': {
    value: { enabled: false },
    description:
      'Controls whether selected workspace search fields interpret input as regular expressions'
  },
  'response-matching-mode': {
    value: { flags: [] },
    description:
      'Controls how responses are aggregated by value similarity for coding case distribution'
  },
  'replay-url-export-mode': {
    value: { mode: 'auth' },
    description:
      'Controls whether exported replay URLs use temporary auth tokens or workspace login links'
  },
  'replay-url-export-token-duration-days': {
    value: { durationDays: DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS },
    description: 'Controls how many days exported auth replay URLs stay valid'
  },
  'auth-session-idle-timeout-minutes': {
    value: { timeoutMinutes: DEFAULT_AUTH_SESSION_IDLE_TIMEOUT_MINUTES },
    description: 'Controls after how many inactive minutes users must reauthenticate'
  }
};

@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('workspace/:workspaceId/settings')
export class WorkspaceSettingsController {
  constructor(
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>
  ) {}

  @Get(':key')
  async getWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('key') key: string
  ) {
    const settingKey = this.getWorkspaceSettingStorageKey(workspaceId, key);
    const setting = await this.settingRepository.findOne({
      where: { key: settingKey }
    });

    if (!setting) {
      return this.getDefaultWorkspaceSettingResponse(
        workspaceId,
        key,
        settingKey
      );
    }

    return {
      id: setting.key, // Using key as id since it's the primary key
      key: setting.key,
      value: setting.content,
      description: `Workspace setting: ${key}`
    };
  }

  private getDefaultWorkspaceSettingResponse(
    workspaceId: number,
    key: string,
    settingKey: string
  ): WorkspaceSettingResponse {
    const defaultSetting = DEFAULT_WORKSPACE_SETTINGS[key];
    if (!defaultSetting) {
      throw new NotFoundException(
        `Setting ${key} not found for workspace ${workspaceId}`
      );
    }

    return {
      id: 0,
      key: settingKey,
      value: JSON.stringify(defaultSetting.value),
      description: defaultSetting.description
    };
  }

  @Post('batch')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async createWorkspaceSettings(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() createSettingsDto: WorkspaceSettingsBatchDto,
    @Req() request?: { user: { id: number } }
  ) {
    const settings = this.validateWorkspaceSettingsBatch(createSettingsDto);

    return this.settingRepository.manager.transaction(async entityManager => {
      const transactionalSettingRepository =
        entityManager.getRepository(Setting);

      const savedSettings: WorkspaceSettingResponse[] = [];
      for (const settingDto of settings) {
        const settingKey = this.getWorkspaceSettingStorageKey(
          workspaceId,
          settingDto.key
        );
        const existingSetting = await transactionalSettingRepository.findOne({
          where: { key: settingKey }
        });

        if (existingSetting) {
          existingSetting.content = settingDto.value;
          const updated = await transactionalSettingRepository.save(existingSetting);
          savedSettings.push(this.toWorkspaceSettingResponse(
            updated,
            settingDto.description
          ));
        } else {
          const newSetting = transactionalSettingRepository.create({
            key: settingKey,
            content: settingDto.value
          });
          const saved = await transactionalSettingRepository.save(newSetting);
          savedSettings.push(this.toWorkspaceSettingResponse(
            saved,
            settingDto.description
          ));
        }
      }

      if (savedSettings.length > 0) {
        await this.recordSettingsChange(entityManager, workspaceId, savedSettings.map(setting => setting.key), 'save', request?.user.id);
      }
      return savedSettings;
    });
  }

  @Post()
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async createWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() createSettingDto: WorkspaceSettingWriteDto,
    @Req() request?: { user: { id: number } }
  ) {
    const settings = await this.createWorkspaceSettings(workspaceId, { settings: [createSettingDto] }, request);
    return settings[0];
  }

  @Put(':settingId')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async updateWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string,
    @Body() updateSettingDto: { value: string },
    @Req() request?: { user: { id: number } }
  ) {
    this.assertSettingIdBelongsToWorkspace(workspaceId, settingId);

    return this.settingRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(Setting);
      const setting = await repository.findOne({ where: { key: settingId } });

      if (!setting) {
        throw new Error(`Setting ${settingId} not found`);
      }

      setting.content = updateSettingDto.value;
      const updated = await repository.save(setting);
      await this.recordSettingsChange(manager, workspaceId, [settingId], 'update', request?.user.id);

      return {
        id: updated.key,
        key: updated.key,
        value: updated.content,
        description: `Workspace setting for workspace ${workspaceId}`
      };
    });
  }

  @Delete(':settingId')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async deleteWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string,
    @Req() request?: { user: { id: number } }
  ) {
    this.assertSettingIdBelongsToWorkspace(workspaceId, settingId);

    return this.settingRepository.manager.transaction(async manager => {
      const result = await manager.getRepository(Setting).delete({ key: settingId });
      if (result.affected === 0) {
        throw new Error(`Setting ${settingId} not found`);
      }
      await this.recordSettingsChange(manager, workspaceId, [settingId], 'delete', request?.user.id);
      return { message: 'Setting deleted successfully' };
    });
  }

  private recordSettingsChange(manager: EntityManager, workspaceId: number, keys: string[], operation: string, actorUserId?: number) {
    return JournalService.recordEventInTransaction(manager, {
      workspaceId,
      actorUserId,
      actorType: actorUserId ? 'user' : 'system',
      eventType: 'WORKSPACE_SETTINGS_CHANGED',
      entityType: 'workspace',
      entityId: workspaceId,
      result: 'success',
      summary: 'Workspace settings changed',
      details: { keys, operation }
    });
  }

  private toWorkspaceSettingResponse(
    setting: Setting,
    description?: string
  ): WorkspaceSettingResponse {
    return {
      id: setting.key,
      key: setting.key,
      value: setting.content,
      description
    };
  }

  private validateWorkspaceSettingsBatch(
    createSettingsDto: WorkspaceSettingsBatchDto
  ): WorkspaceSettingWriteDto[] {
    if (!createSettingsDto || !Array.isArray(createSettingsDto.settings)) {
      throw new BadRequestException('settings must be an array');
    }

    createSettingsDto.settings.forEach((setting, index) => {
      if (!setting ||
        typeof setting.key !== 'string' ||
        setting.key.trim().length === 0 ||
        typeof setting.value !== 'string') {
        throw new BadRequestException(
          `settings[${index}] must include a non-empty key and string value`
        );
      }
    });

    return createSettingsDto.settings;
  }

  private getWorkspaceSettingStorageKey(workspaceId: number, key: string): string {
    return `workspace-${workspaceId}-${key}`;
  }

  private assertSettingIdBelongsToWorkspace(
    workspaceId: number,
    settingId: string
  ): void {
    const workspacePrefix = `workspace-${workspaceId}-`;
    if (!settingId.startsWith(workspacePrefix)) {
      throw new BadRequestException(
        `Setting ${settingId} does not belong to workspace ${workspaceId}`
      );
    }
  }
}
