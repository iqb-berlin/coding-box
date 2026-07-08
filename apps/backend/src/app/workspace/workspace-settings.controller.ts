import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import {
  AccessLevelGuard,
  RequireAccessLevel
} from '../admin/workspace/access-level.guard';

interface WorkspaceSettingWriteDto {
  key: string;
  value: string;
  description?: string;
}

interface WorkspaceSettingsBatchDto {
  settings: WorkspaceSettingWriteDto[];
}

interface WorkspaceSettingResponse {
  id: string;
  key: string;
  value: string;
  description?: string;
}

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
      if (key === 'auto-fetch-coding-statistics') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ enabled: false }),
          description:
            'Controls whether coding statistics are automatically fetched in the coding management component'
        };
      }
      if (key === 'auto-refresh-manual-coding-jobs') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ enabled: true }),
          description:
            'Controls whether manual coding job tables refresh automatically when the browser window regains focus'
        };
      }
      if (key === 'evaluation-mode') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ enabled: false }),
          description:
            'Controls whether expensive automatic coding refreshes are disabled for evaluation sessions'
        };
      }
      if (key === 'show-test-results-log-anomalies') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ enabled: false }),
          description:
            'Controls whether log anomalies are shown as a column in the test results table'
        };
      }
      if (key === 'include-derive-error-in-manual-coding') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ enabled: false }),
          description:
            'Controls whether DERIVE_ERROR responses can be included in manual coding jobs'
        };
      }
      if (key === 'enable-regex-search') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ enabled: false }),
          description:
            'Controls whether selected workspace search fields interpret input as regular expressions'
        };
      }
      if (key === 'response-matching-mode') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ flags: [] }),
          description:
            'Controls how responses are aggregated by value similarity for coding case distribution'
        };
      }
      if (key === 'replay-url-export-mode') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ mode: 'auth' }),
          description:
            'Controls whether exported replay URLs use temporary auth tokens or workspace login links'
        };
      }
      throw new Error(`Setting ${key} not found for workspace ${workspaceId}`);
    }

    return {
      id: setting.key, // Using key as id since it's the primary key
      key: setting.key,
      value: setting.content,
      description: `Workspace setting: ${key}`
    };
  }

  @Post('batch')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async createWorkspaceSettings(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() createSettingsDto: WorkspaceSettingsBatchDto
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

      return savedSettings;
    });
  }

  @Post()
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async createWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() createSettingDto: WorkspaceSettingWriteDto
  ) {
    const settingKey = this.getWorkspaceSettingStorageKey(
      workspaceId,
      createSettingDto.key
    );
    const existingSetting = await this.settingRepository.findOne({
      where: { key: settingKey }
    });

    if (existingSetting) {
      existingSetting.content = createSettingDto.value;
      const updated = await this.settingRepository.save(existingSetting);
      return this.toWorkspaceSettingResponse(
        updated,
        createSettingDto.description
      );
    }

    const newSetting = this.settingRepository.create({
      key: settingKey,
      content: createSettingDto.value
    });

    const saved = await this.settingRepository.save(newSetting);
    return this.toWorkspaceSettingResponse(
      saved,
      createSettingDto.description
    );
  }

  @Put(':settingId')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async updateWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string,
    @Body() updateSettingDto: { value: string }
  ) {
    this.assertSettingIdBelongsToWorkspace(workspaceId, settingId);

    const setting = await this.settingRepository.findOne({
      where: { key: settingId }
    });

    if (!setting) {
      throw new Error(`Setting ${settingId} not found`);
    }

    setting.content = updateSettingDto.value;
    const updated = await this.settingRepository.save(setting);

    return {
      id: updated.key,
      key: updated.key,
      value: updated.content,
      description: `Workspace setting for workspace ${workspaceId}`
    };
  }

  @Delete(':settingId')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async deleteWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string
  ) {
    this.assertSettingIdBelongsToWorkspace(workspaceId, settingId);

    const result = await this.settingRepository.delete({ key: settingId });
    if (result.affected === 0) {
      throw new Error(`Setting ${settingId} not found`);
    }
    return { message: 'Setting deleted successfully' };
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
