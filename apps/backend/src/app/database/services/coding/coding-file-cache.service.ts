import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { extractVariableLocation } from '../../../utils/voud/extractVariableLocation';
import { LRUCache } from '../shared';

/**
 * Service responsible for loading, parsing, and caching VOUD and VOCS files.
 *
 * VOUD files contain variable-to-page mappings.
 * VOCS files contain variable coding schemes with exclusion rules.
 */
@Injectable()
export class CodingFileCacheService {
  private readonly logger = new Logger(CodingFileCacheService.name);
  private voudCache = new LRUCache<Map<string, string>>(50);
  private vocsCache = new LRUCache<Set<string>>(50);

  constructor(
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>
  ) {}

  /**
   * Load VOUD data for a specific unit and workspace.
   * Returns a map of variable IDs to page numbers.
   * Results are cached for performance.
   */
  async loadVoudData(
    unitName: string,
    workspaceId: number
  ): Promise<Map<string, string>> {
    const cacheKey = `${workspaceId}:${unitName}`;
    let variablePageMap = this.voudCache.get(cacheKey);
    if (variablePageMap) {
      return variablePageMap;
    }

    const voudFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: `${unitName}.VOUD`
      }
    });

    variablePageMap = new Map<string, string>();

    if (voudFile) {
      try {
        const respDefinition = { definition: voudFile.data as string };
        const variableLocation = extractVariableLocation([respDefinition]);
        if (variableLocation[0]?.variable_pages) {
          for (const pageInfo of variableLocation[0].variable_pages) {
            variablePageMap.set(
              pageInfo.variable_ref,
              pageInfo.variable_path?.pages?.toString() || '0'
            );
          }
        }
      } catch (error) {
        this.logger.debug(
          `Error parsing VOUD file for unit ${unitName}: ${error.message}`
        );
      }
    }

    this.voudCache.set(cacheKey, variablePageMap);
    return variablePageMap;
  }

  /**
   * Load VOCS exclusions for a specific unit and workspace.
   * Returns a set of excluded variable IDs (variables with sourceType === 'BASE_NO_VALUE').
   * Results are cached for performance.
   */
  async loadVocsExclusions(
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
      try {
        interface VocsScheme {
          variableCodings?: { id: string; sourceType?: string }[];
        }

        const data =
          typeof vocsFile.data === 'string' ?
            JSON.parse(vocsFile.data) :
            vocsFile.data;
        const scheme = data as VocsScheme;
        const vars = scheme?.variableCodings || [];

        for (const vc of vars) {
          if (
            vc &&
            vc.id &&
            vc.sourceType &&
            vc.sourceType === 'BASE_NO_VALUE'
          ) {
            exclusions.add(`${unitName}||${vc.id}`);
          }
        }
      } catch (error) {
        this.logger.debug(
          `Error parsing VOCS file for unit ${unitName}: ${error.message}`
        );
      }
    }

    this.vocsCache.set(cacheKey, exclusions);
    return exclusions;
  }

  /**
   * Clear all caches. Useful for freeing memory after large export operations.
   */
  clearCaches(): void {
    this.voudCache.clear();
    this.vocsCache.clear();
  }

  /**
   * Get the variable page map for a unit (alias for loadVoudData for backward compatibility).
   */
  async getVariablePageMap(
    unitName: string,
    workspaceId: number
  ): Promise<Map<string, string>> {
    return this.loadVoudData(unitName, workspaceId);
  }
}
