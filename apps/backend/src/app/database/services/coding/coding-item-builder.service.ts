import { Injectable, Logger } from '@nestjs/common';
import { ResponseEntity } from '../../entities/response.entity';
import { statusNumberToString } from '../../utils/response-status-converter';
import { CodingFileCacheService } from './coding-file-cache.service';

export interface CodingItem {
  unit_key: string;
  unit_alias: string;
  person_login: string;
  person_code: string;
  person_group: string;
  booklet_name: string;
  variable_id: string;
  variable_page: string;
  variable_anchor: string;
  url?: string;
}

/**
 * Service responsible for building CodingItem objects from ResponseEntity data.
 *
 * Handles:
 * - Extracting person, booklet, and unit information
 * - Building replay URLs
 * - Version-specific data (v1, v2, v3)
 * - Variable page mapping
 */
@Injectable()
export class CodingItemBuilderService {
  private readonly logger = new Logger(CodingItemBuilderService.name);

  constructor(private readonly fileCacheService: CodingFileCacheService) {}

  /**
   * Build a basic CodingItem from a ResponseEntity.
   * Used for CODING_INCOMPLETE responses.
   */
  async buildCodingItem(
    response: ResponseEntity,
    authToken: string,
    serverUrl: string,
    workspaceId: number
  ): Promise<CodingItem | null> {
    try {
      const unit = response.unit;
      if (!unit) return null;

      const booklet = unit.booklet;
      if (!booklet) return null;

      const person = booklet.person;
      const bookletInfo = booklet.bookletinfo;

      const unitKey = unit.name || '';
      const variableId = response.variableid || '';

      // Load variable page mapping
      const variablePageMap = await this.fileCacheService.loadVoudData(
        unitKey,
        workspaceId
      );
      const variablePage = variablePageMap.get(variableId) || '0';

      const loginName = person?.login || '';
      const loginCode = person?.code || '';
      const loginGroup = person?.group || '';
      const bookletId = bookletInfo?.name || '';
      const unitAlias = unit.alias || '';
      const variableAnchor = variableId;

      const url = `${serverUrl}/#/replay/${loginName}@${loginCode}@${loginGroup}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

      return {
        unit_key: unitKey,
        unit_alias: unitAlias,
        person_login: loginName,
        person_code: loginCode,
        person_group: loginGroup,
        booklet_name: bookletId,
        variable_id: variableId,
        variable_page: variablePage,
        variable_anchor: variableAnchor,
        url
      };
    } catch (error) {
      this.logger.error(
        `Error building coding item for response ${response.id}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Build a CodingItem with version-specific data (v1, v2, v3).
   * Used for coding results exports.
   */
  async buildCodingItemWithVersions(
    response: ResponseEntity,
    targetVersion: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl: string,
    workspaceId: number,
    includeReplayUrls: boolean = false
  ): Promise<CodingItem | null> {
    try {
      const unit = response.unit;
      if (!unit) return null;

      const booklet = unit.booklet;
      if (!booklet) return null;

      const person = booklet.person;
      const bookletInfo = booklet.bookletinfo;

      const unitKey = unit.name || '';
      const variableId = response.variableid || '';

      // Load variable page mapping
      const variablePageMap = await this.fileCacheService.loadVoudData(
        unitKey,
        workspaceId
      );
      const variablePage = variablePageMap.get(variableId) || '0';

      const loginName = person?.login || '';
      const loginCode = person?.code || '';
      const loginGroup = person?.group || '';
      const bookletId = bookletInfo?.name || '';
      const unitAlias = unit.alias || '';
      const variableAnchor = variableId;

      const url = `${serverUrl}/#/replay/${loginName}@${loginCode}@${loginGroup}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

      const baseItem: CodingItem & Record<string, unknown> = {
        unit_key: unitKey,
        unit_alias: unitAlias,
        person_login: loginName,
        person_code: loginCode,
        person_group: loginGroup,
        booklet_name: bookletId,
        variable_id: variableId,
        variable_page: variablePage,
        variable_anchor: variableAnchor
      };

      // Add version-specific data (include all lower versions) and convert status numbers to strings
      if (targetVersion === 'v1') {
        baseItem.status_v1 =
          response.status_v1 != null ?
            statusNumberToString(response.status_v1) || '' :
            '';
        baseItem.code_v1 = response.code_v1 || '';
        baseItem.score_v1 = response.score_v1 || '';
      } else if (targetVersion === 'v2') {
        baseItem.status_v1 =
          response.status_v1 != null ?
            statusNumberToString(response.status_v1) || '' :
            '';
        baseItem.code_v1 = response.code_v1 || '';
        baseItem.score_v1 = response.score_v1 || '';
        baseItem.status_v2 =
          response.status_v2 != null ?
            statusNumberToString(response.status_v2) || '' :
            '';
        baseItem.code_v2 = response.code_v2 || '';
        baseItem.score_v2 = response.score_v2 || '';
      } else {
        // v3
        baseItem.status_v1 =
          response.status_v1 != null ?
            statusNumberToString(response.status_v1) || '' :
            '';
        baseItem.code_v1 = response.code_v1 || '';
        baseItem.score_v1 = response.score_v1 || '';
        baseItem.status_v2 =
          response.status_v2 != null ?
            statusNumberToString(response.status_v2) || '' :
            '';
        baseItem.code_v2 = response.code_v2 || '';
        baseItem.score_v2 = response.score_v2 || '';
        baseItem.status_v3 =
          response.status_v3 != null ?
            statusNumberToString(response.status_v3) || '' :
            '';
        baseItem.code_v3 = response.code_v3 || '';
        baseItem.score_v3 = response.score_v3 || '';
      }

      // Append replay URL as the last field if requested
      if (includeReplayUrls) {
        baseItem.url = url;
      }

      return baseItem;
    } catch (error) {
      this.logger.error(
        `Error building coding item with versions for response ${response.id}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Get headers for version-specific exports.
   */
  getHeadersForVersion(version: 'v1' | 'v2' | 'v3'): string[] {
    const baseHeaders = [
      'unit_key',
      'unit_alias',
      'person_login',
      'person_code',
      'person_group',
      'booklet_name',
      'variable_id',
      'variable_page',
      'variable_anchor'
    ];

    // Add version-specific columns for comparison
    if (version === 'v1') {
      return [...baseHeaders, 'status_v1', 'code_v1', 'score_v1'];
    }
    if (version === 'v2') {
      return [
        ...baseHeaders,
        'status_v1',
        'code_v1',
        'score_v1',
        'status_v2',
        'code_v2',
        'score_v2'
      ];
    }
    // v3
    return [
      ...baseHeaders,
      'status_v1',
      'code_v1',
      'score_v1',
      'status_v2',
      'code_v2',
      'score_v2',
      'status_v3',
      'code_v3',
      'score_v3'
    ];
  }
}
