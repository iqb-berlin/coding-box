import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { resolveVariablePageMap } from '../../../utils/voud/resolveVariablePageMap';
import { LRUCache } from '../shared';

interface VocsVariableCoding {
  id?: unknown;
  alias?: unknown;
  page?: unknown;
  sourceType?: unknown;
}

interface VocsScheme {
  variableCodings?: VocsVariableCoding[];
}

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
    const idPageOverrides = new Map<string, string>();
    const aliasPageOverrides = new Map<string, string>();

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
      const scheme = this.parseVocsScheme(vocsFile.data);
      const vars = Array.isArray(scheme?.variableCodings) ?
        scheme.variableCodings :
        [];

      for (const variableCoding of vars) {
        const normalizedPage = this.toVeronaPageIndex(variableCoding?.page);
        if (normalizedPage === null) {
          continue;
        }

        this.addPageOverride(idPageOverrides, variableCoding?.id, normalizedPage);
        this.addPageOverride(
          aliasPageOverrides,
          variableCoding?.alias,
          normalizedPage
        );
      }
    } catch (error) {
      this.logger.debug(
        `Error parsing VOCS page overrides for unit ${unitName}: ${error.message}`
      );
    }

    return new Map<string, string>([
      ...idPageOverrides.entries(),
      ...aliasPageOverrides.entries()
    ]);
  }

  private parseVocsScheme(data: unknown): VocsScheme {
    return (typeof data === 'string' ? JSON.parse(data) : data) as VocsScheme;
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
        const scheme = this.parseVocsScheme(vocsFile.data);
        const vars = Array.isArray(scheme?.variableCodings) ?
          scheme.variableCodings :
          [];

        for (const vc of vars) {
          const variableId = String(vc?.id || '').trim();
          if (variableId && vc?.sourceType === 'BASE_NO_VALUE') {
            exclusions.add(`${unitName}||${variableId}`);
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
