import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
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
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>
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
    const vocsFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: `${unitName}.VOCS`
      }
    });

    if (vocsFile) {
      this.parseVocsContent(vocsFile, exclusions, unitName);
    }

    this.vocsCache.set(cacheKey, exclusions);
    return exclusions;
  }

  async getAllExclusions(workspaceId: number): Promise<Set<string>> {
    const vocsFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: Like('%.VOCS')
      },
      select: ['file_id', 'data']
    });

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
