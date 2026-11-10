import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getErrorMessage } from '../../../utils/error.util';
import FileUpload from '../../entities/file_upload.entity';
import { resolveVariablePageMap } from '../../../utils/voud/resolveVariablePageMap';
import { LRUCache } from '../shared';
import { codingSchemePageOverrides, parseCodingSchemeVariables } from '../../../utils/voud/coding-scheme-metadata.util';

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
  private readonly voudInFlight = new Map<string, Promise<Map<string, string>>>();
  private readonly vocsInFlight = new Map<string, Promise<Set<string>>>();
  private cacheGeneration = 0;

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
    const variablePageMap = this.voudCache.get(cacheKey);
    if (variablePageMap) {
      return variablePageMap;
    }

    const inFlight = this.voudInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const generation = this.cacheGeneration;
    const request = this.loadVoudDataUncached(unitName, workspaceId)
      .then(result => {
        if (generation === this.cacheGeneration) {
          this.voudCache.set(cacheKey, result);
        }
        return result;
      })
      .finally(() => {
        if (this.voudInFlight.get(cacheKey) === request) {
          this.voudInFlight.delete(cacheKey);
        }
      });
    this.voudInFlight.set(cacheKey, request);
    return request;
  }

  private async loadVoudDataUncached(
    unitName: string,
    workspaceId: number
  ): Promise<Map<string, string>> {
    const voudFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: `${unitName}.VOUD`
      }
    });

    let variablePageMap = new Map<string, string>();

    if (voudFile) {
      try {
        variablePageMap = resolveVariablePageMap(voudFile.data as string);
      } catch (error) {
        this.logger.debug(
          `Error parsing VOUD file for unit ${unitName}: ${getErrorMessage(error)}`
        );
      }
    }

    const vocsPageOverrides = await this.loadVocsPageOverrides(
      unitName,
      workspaceId
    );
    vocsPageOverrides.forEach((page, variableId) => {
      variablePageMap.set(variableId, page);
    });

    return variablePageMap;
  }

  private async loadVocsPageOverrides(
    unitName: string,
    workspaceId: number
  ): Promise<Map<string, string>> {
    const vocsFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: `${unitName}.VOCS`
      }
    });

    if (!vocsFile) {
      return new Map<string, string>();
    }

    try {
      return codingSchemePageOverrides(parseCodingSchemeVariables(vocsFile.data));
    } catch (error) {
      this.logger.debug(
        `Error parsing VOCS page overrides for unit ${unitName}: ${getErrorMessage(error)}`
      );
    }

    return new Map();
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

    const exclusions = this.vocsCache.get(cacheKey);
    if (exclusions) {
      return exclusions;
    }

    const inFlight = this.vocsInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const generation = this.cacheGeneration;
    const request = this.loadVocsExclusionsUncached(unitName, workspaceId)
      .then(result => {
        if (generation === this.cacheGeneration) {
          this.vocsCache.set(cacheKey, result);
        }
        return result;
      })
      .finally(() => {
        if (this.vocsInFlight.get(cacheKey) === request) {
          this.vocsInFlight.delete(cacheKey);
        }
      });
    this.vocsInFlight.set(cacheKey, request);
    return request;
  }

  private async loadVocsExclusionsUncached(
    unitName: string,
    workspaceId: number
  ): Promise<Set<string>> {
    const exclusions = new Set<string>();
    const vocsFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: `${unitName}.VOCS`
      }
    });

    if (vocsFile) {
      try {
        const vars = parseCodingSchemeVariables(vocsFile.data);

        for (const vc of vars) {
          const variableId = String(vc?.id || '').trim();
          if (variableId && vc?.sourceType === 'BASE_NO_VALUE') {
            exclusions.add(`${unitName}||${variableId}`);
          }
        }
      } catch (error) {
        this.logger.debug(
          `Error parsing VOCS file for unit ${unitName}: ${getErrorMessage(error)}`
        );
      }
    }

    return exclusions;
  }

  /**
   * Clear all caches. Useful for freeing memory after large export operations.
   */
  clearCaches(): void {
    this.cacheGeneration += 1;
    this.voudCache.clear();
    this.vocsCache.clear();
    this.voudInFlight.clear();
    this.vocsInFlight.clear();
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
