import {
  Controller, Get, Post, Put, Delete, Param, Body, ParseIntPipe
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../workspaces/entities/setting.entity';

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
    const settingKey = `workspace-${workspaceId}-${key}`;
    const setting = await this.settingRepository.findOne({
      where: { key: settingKey }
    });

    if (!setting) {
      if (key === 'auto-fetch-coding-statistics') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ enabled: true }),
          description: 'Controls whether coding statistics are automatically fetched in the coding management component'
        };
      }
      if (key === 'response-matching-mode') {
        return {
          id: 0,
          key: settingKey,
          value: JSON.stringify({ flags: [] }),
          description: 'Controls how responses are aggregated by value similarity for coding case distribution'
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

  @Post()
  async createWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() createSettingDto: { key: string; value: string; description?: string }
  ) {
    const settingKey = `workspace-${workspaceId}-${createSettingDto.key}`;
    const existingSetting = await this.settingRepository.findOne({
      where: { key: settingKey }
    });

    if (existingSetting) {
      existingSetting.content = createSettingDto.value;
      const updated = await this.settingRepository.save(existingSetting);
      return {
        id: updated.key,
        key: updated.key,
        value: updated.content,
        description: createSettingDto.description
      };
    }

    const newSetting = this.settingRepository.create({
      key: settingKey,
      content: createSettingDto.value
    });

    const saved = await this.settingRepository.save(newSetting);
    return {
      id: saved.key,
      key: saved.key,
      value: saved.content,
      description: createSettingDto.description
    };
  }

  @Put(':settingId')
  async updateWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string,
    @Body() updateSettingDto: { value: string }
  ) {
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
  async deleteWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string
  ) {
    const result = await this.settingRepository.delete({ key: settingId });
    if (result.affected === 0) {
      throw new Error(`Setting ${settingId} not found`);
    }
    return { message: 'Setting deleted successfully' };
  }
}
