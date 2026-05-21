import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { resolveVariablePageMap } from '../../../utils/voud/resolveVariablePageMap';
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
        variablePageMap = resolveVariablePageMap(voudFile.data as string);
      } catch (error) {
        this.logger.debug(
          `Error parsing VOUD file for unit ${unitName}: ${error.message}`
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

    this.voudCache.set(cacheKey, variablePageMap);
    return variablePageMap;
  }

  private async loadVocsPageOverrides(
    unitName: string,
    workspaceId: number
  ): Promise<Map<string, string>> {
    const pageOverrides = new Map<string, string>();

    const vocsFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: `${unitName}.VOCS`
      }
    });

    if (!vocsFile) {
      return pageOverrides;
    }

    try {
      interface VocsScheme {
        variableCodings?: {
          id?: unknown;
          alias?: unknown;
          page?: unknown;
        }[];
      }

      const scheme = JSON.parse(vocsFile.data) as VocsScheme;
      const vars = Array.isArray(scheme?.variableCodings) ?
        scheme.variableCodings :
        [];

      for (const variableCoding of vars) {
        const normalizedPage = this.toVeronaPageIndex(variableCoding?.page);
        if (normalizedPage === null) {
          continue;
        }

        this.addPageOverride(pageOverrides, variableCoding?.id, normalizedPage);
        this.addPageOverride(pageOverrides, variableCoding?.alias, normalizedPage);
      }
    } catch (error) {
      this.logger.debug(
        `Error parsing VOCS page overrides for unit ${unitName}: ${error.message}`
      );
    }

    return pageOverrides;
  }

  private toVeronaPageIndex(page: unknown): string | null {
    if (page === null || page === undefined) {
      return null;
    }

    const pageText = String(page).trim();
    if (!pageText) {
      return null;
    }

    const pageNumber = Number(pageText);
    if (!Number.isInteger(pageNumber) || pageNumber < 0) {
      return null;
    }

    return String(Math.max(0, pageNumber - 1));
  }

  private addPageOverride(
    pageOverrides: Map<string, string>,
    variableId: unknown,
    page: string
  ): void {
    const normalizedVariableId = String(variableId || '').trim();
    if (normalizedVariableId) {
      pageOverrides.set(normalizedVariableId, page);
    }
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
