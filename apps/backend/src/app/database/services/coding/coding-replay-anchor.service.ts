import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';

export interface CodingReplayAnchorOverride {
  unitName: string;
  variableId: string;
  replayAnchor: string;
}

@Injectable()
export class CodingReplayAnchorService {
  private readonly logger = new Logger(CodingReplayAnchorService.name);
  private readonly cache = new Map<number, CodingReplayAnchorOverride[]>();

  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>
  ) {}

  async getOverrides(workspaceId: number): Promise<CodingReplayAnchorOverride[]> {
    const cached = this.cache.get(workspaceId);
    if (cached) {
      return cached;
    }

    const setting = await this.settingRepository.findOne({
      where: { key: this.getSettingKey(workspaceId) }
    });
    const overrides = this.parseOverrides(setting?.content);
    this.cache.set(workspaceId, overrides);
    return overrides;
  }

  async getVariableAnchorMap(
    unitName: string,
    workspaceId: number
  ): Promise<Map<string, string>> {
    const normalizedUnitName = this.normalizeValue(unitName);
    const overrides = await this.getOverrides(workspaceId);

    return new Map(
      overrides
        .filter(override => override.unitName === normalizedUnitName)
        .map(override => [override.variableId, override.replayAnchor])
    );
  }

  async resolveVariableAnchor(
    workspaceId: number,
    unitName: string,
    variableId: string,
    fallbackAnchor: string = variableId
  ): Promise<string> {
    const anchorMap = await this.getVariableAnchorMap(unitName, workspaceId);
    return anchorMap.get(variableId) || fallbackAnchor;
  }

  async upsertOverride(
    workspaceId: number,
    override: CodingReplayAnchorOverride
  ): Promise<CodingReplayAnchorOverride> {
    const normalizedOverride = this.normalizeOverride(override);
    const overrides = await this.getOverrides(workspaceId);
    const nextOverrides = overrides
      .filter(existing => !this.isSameVariable(existing, normalizedOverride));
    nextOverrides.push(normalizedOverride);
    await this.saveOverrides(workspaceId, nextOverrides);
    return normalizedOverride;
  }

  async deleteOverride(
    workspaceId: number,
    unitName: string,
    variableId: string
  ): Promise<{ deleted: boolean }> {
    const normalizedUnitName = this.normalizeValue(unitName);
    const normalizedVariableId = this.normalizeValue(variableId);
    const overrides = await this.getOverrides(workspaceId);
    const nextOverrides = overrides
      .filter(override => (
        override.unitName !== normalizedUnitName ||
        override.variableId !== normalizedVariableId
      ));

    if (nextOverrides.length === overrides.length) {
      return { deleted: false };
    }

    await this.saveOverrides(workspaceId, nextOverrides);
    return { deleted: true };
  }

  private getSettingKey(workspaceId: number): string {
    return `workspace-${workspaceId}-replay-anchor-overrides`;
  }

  private parseOverrides(content: string | undefined): CodingReplayAnchorOverride[] {
    if (!content) {
      return [];
    }

    try {
      const parsed = JSON.parse(content) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map(entry => this.tryNormalizeOverride(entry))
        .filter((entry): entry is CodingReplayAnchorOverride => entry !== null);
    } catch (error) {
      this.logger.warn(`Failed to parse replay anchor overrides: ${error.message}`);
      return [];
    }
  }

  private tryNormalizeOverride(entry: unknown): CodingReplayAnchorOverride | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    try {
      return this.normalizeOverride(entry as CodingReplayAnchorOverride);
    } catch {
      return null;
    }
  }

  private normalizeOverride(
    override: CodingReplayAnchorOverride
  ): CodingReplayAnchorOverride {
    const unitName = this.normalizeValue(override.unitName);
    const variableId = this.normalizeValue(override.variableId);
    const replayAnchor = this.normalizeValue(override.replayAnchor);

    if (!unitName || !variableId || !replayAnchor) {
      throw new Error('unitName, variableId and replayAnchor are required');
    }

    return { unitName, variableId, replayAnchor };
  }

  private normalizeValue(value: unknown): string {
    return String(value ?? '').trim();
  }

  private isSameVariable(
    first: CodingReplayAnchorOverride,
    second: CodingReplayAnchorOverride
  ): boolean {
    return first.unitName === second.unitName &&
      first.variableId === second.variableId;
  }

  private async saveOverrides(
    workspaceId: number,
    overrides: CodingReplayAnchorOverride[]
  ): Promise<void> {
    const settingKey = this.getSettingKey(workspaceId);
    const sortedOverrides = [...overrides].sort((a, b) => (
      a.unitName.localeCompare(b.unitName) ||
      a.variableId.localeCompare(b.variableId)
    ));
    const setting = await this.settingRepository.findOne({
      where: { key: settingKey }
    });

    if (setting) {
      setting.content = JSON.stringify(sortedOverrides);
      await this.settingRepository.save(setting);
    } else {
      await this.settingRepository.save(
        this.settingRepository.create({
          key: settingKey,
          content: JSON.stringify(sortedOverrides)
        })
      );
    }

    this.cache.set(workspaceId, sortedOverrides);
  }
}
