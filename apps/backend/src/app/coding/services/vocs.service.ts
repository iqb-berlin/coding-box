import { Injectable, Logger } from '@nestjs/common';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import FileUpload from '../../workspaces/entities/file_upload.entity';
import { LRUCache } from '../../utils/lru-cache';

interface VocsScheme {
  variableCodings?: { id: string; sourceType?: string }[];
}

@Injectable()
export class VocsService {
  private readonly logger = new Logger(VocsService.name);
  private vocsCache = new LRUCache<Set<string>>(50);

  constructor(
    private readonly workspacesFacadeService: WorkspacesFacadeService
  ) {}

  clearCache() {
    this.vocsCache.clear();
  }

  async getExclusions(
    unitName: string,
    workspaceId: number
  ): Promise<Set<string>> {
    const cacheKey = `${workspaceId}:${unitName}`;
    let exclusions = this.vocsCache.get(cacheKey);
    if (exclusions) {
      return exclusions;
    }

    exclusions = new Set<string>();
    const vocsFile = await this.workspacesFacadeService.findFileSpecific(
      workspaceId,
      'Resource',
      `${unitName}.VOCS`
    );

    if (vocsFile) {
      this.parseVocsContent(vocsFile, exclusions, unitName);
    }

    this.vocsCache.set(cacheKey, exclusions);
    return exclusions;
  }

  async getAllExclusions(workspaceId: number): Promise<Set<string>> {
    const vocsFiles = await this.workspacesFacadeService.findFilesByPattern(
      workspaceId,
      'Resource',
      '%.VOCS'
    );

    const excludedPairs = new Set<string>();
    for (const file of vocsFiles) {
      const unitKey = file.file_id.replace('.VOCS', '');
      this.parseVocsContent(file, excludedPairs, unitKey);
    }
    return excludedPairs;
  }

  private parseVocsContent(
    file: FileUpload,
    exclusionsAccumulator: Set<string>,
    unitKey: string
  ): void {
    try {
      const data =
        typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
      const scheme = data as VocsScheme;
      const vars = scheme?.variableCodings || [];

      for (const vc of vars) {
        if (
          vc &&
          vc.id &&
          vc.sourceType &&
          vc.sourceType === 'BASE_NO_VALUE'
        ) {
          exclusionsAccumulator.add(`${unitKey}||${vc.id}`);
        }
      }
    } catch (error) {
      this.logger.debug(
        `Error parsing VOCS file for unit ${unitKey}: ${error.message}`
      );
    }
  }
}
