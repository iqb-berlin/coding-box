import { Injectable, Logger, Optional } from '@nestjs/common';
import { ResponseEntity } from '../../entities/response.entity';
import {
  statusNumberToString,
  statusStringToNumber
} from '../../utils/response-status-converter';
import { mapCodeForExport } from '../../../utils/coding-utils';
import { generateReplayUrl } from '../../../utils/replay-url.util';
import { CodingFileCacheService } from './coding-file-cache.service';
import {
  extractGeoGebraBase64,
  suppressedGeoGebraValuePlaceholder
} from './geogebra-export.util';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';

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
  status_v1?: string;
  value?: string;
  url?: string;
}

export type CodingVariableAnchorMaps = Map<string, Map<string, string>>;

export interface CodingItemVersionRow {
  id: number;
  unitKey: string;
  unitAlias: string | null;
  personLogin: string | null;
  personCode: string | null;
  personGroup: string | null;
  bookletName: string | null;
  variableId: string;
  value: string | null;
  statusV1: number | null;
  codeV1: number | null;
  scoreV1: number | null;
  statusV2: number | null;
  codeV2: number | null;
  scoreV2: number | null;
  statusV3: number | null;
  codeV3: number | null;
  scoreV3: number | null;
}

export interface CodingItemVersionExportValue {
  code: number | '';
  score: number | 'NA' | '';
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

  constructor(
    private readonly fileCacheService: CodingFileCacheService,
    @Optional() private readonly replayAnchorService?: CodingReplayAnchorService
  ) {}

  private formatStatus(status: number | string | null | undefined): string {
    if (status === null || status === undefined || status === '') {
      return '';
    }

    const statusNumber = typeof status === 'number' ?
      status :
      statusStringToNumber(String(status));
    return statusNumber === null ? '' : statusNumberToString(statusNumber) || '';
  }

  private formatResponseValue(
    value: string | null | undefined,
    includeGeoGebraResponseValues: boolean
  ): string {
    if (!includeGeoGebraResponseValues && extractGeoGebraBase64(value)) {
      return suppressedGeoGebraValuePlaceholder;
    }

    return value ?? '';
  }

  /**
   * Build a basic CodingItem from a ResponseEntity.
   * Used for CODING_INCOMPLETE responses.
   */
  async buildCodingItem(
    response: ResponseEntity,
    authToken: string,
    serverUrl: string,
    workspaceId: number,
    variableAnchorMaps?: CodingVariableAnchorMaps
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
      const variableAnchor = await this.resolveVariableAnchor(
        workspaceId,
        unitKey,
        variableId,
        variableAnchorMaps
      );

      const url = generateReplayUrl({
        serverUrl,
        loginName,
        loginCode,
        loginGroup,
        bookletId,
        unitId: unitKey,
        variablePage,
        variableAnchor,
        authToken,
        workspaceId: authToken ? undefined : workspaceId
      });

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
        status_v1: this.formatStatus(response.status_v1),
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
    includeReplayUrls: boolean = false,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    variableAnchorMaps?: CodingVariableAnchorMaps
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
      const variableAnchor = await this.resolveVariableAnchor(
        workspaceId,
        unitKey,
        variableId,
        variableAnchorMaps
      );

      const url = generateReplayUrl({
        serverUrl,
        loginName,
        loginCode,
        loginGroup,
        bookletId,
        unitId: unitKey,
        variablePage,
        variableAnchor,
        authToken,
        workspaceId: authToken ? undefined : workspaceId
      });

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

      if (includeResponseValues) {
        baseItem.value = this.formatResponseValue(
          response.value,
          includeGeoGebraResponseValues
        );
      }

      // Add version-specific data (include all lower versions) and convert status numbers to strings
      if (targetVersion === 'v1') {
        baseItem.status_v1 = this.formatStatus(response.status_v1);
        baseItem.code_v1 = mapCodeForExport(response.code_v1) ?? '';
        baseItem.score_v1 = response.score_v1 ?? '';
      } else if (targetVersion === 'v2') {
        baseItem.status_v1 = this.formatStatus(response.status_v1);
        baseItem.code_v1 = mapCodeForExport(response.code_v1) ?? '';
        baseItem.score_v1 = response.score_v1 ?? '';
        baseItem.status_v2 = this.formatStatus(response.status_v2);
        baseItem.code_v2 = mapCodeForExport(response.code_v2) ?? '';
        baseItem.score_v2 = response.score_v2 ?? '';
      } else {
        // v3
        baseItem.status_v1 = this.formatStatus(response.status_v1);
        baseItem.code_v1 = mapCodeForExport(response.code_v1) ?? '';
        baseItem.score_v1 = response.score_v1 ?? '';
        baseItem.status_v2 = this.formatStatus(response.status_v2);
        baseItem.code_v2 = mapCodeForExport(response.code_v2) ?? '';
        baseItem.score_v2 = response.score_v2 ?? '';
        baseItem.status_v3 = this.formatStatus(response.status_v3);
        baseItem.code_v3 = mapCodeForExport(response.code_v3) ?? '';
        baseItem.score_v3 = response.score_v3 ?? '';
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

  async buildCodingItemWithVersionRow(
    row: CodingItemVersionRow,
    targetVersion: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl: string,
    workspaceId: number,
    includeReplayUrls: boolean = false,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    variableAnchorMaps?: CodingVariableAnchorMaps,
    resolvedV1Value?: CodingItemVersionExportValue
  ): Promise<CodingItem | null> {
    try {
      const unitKey = row.unitKey || '';
      const variableId = row.variableId || '';

      if (!unitKey || !variableId) {
        return null;
      }

      const variablePageMap = await this.fileCacheService.loadVoudData(
        unitKey,
        workspaceId
      );
      const variablePage = variablePageMap.get(variableId) || '0';
      const variableAnchor = await this.resolveVariableAnchor(
        workspaceId,
        unitKey,
        variableId,
        variableAnchorMaps
      );

      const loginName = row.personLogin || '';
      const loginCode = row.personCode || '';
      const loginGroup = row.personGroup || '';
      const bookletId = row.bookletName || '';
      const url = generateReplayUrl({
        serverUrl,
        loginName,
        loginCode,
        loginGroup,
        bookletId,
        unitId: unitKey,
        variablePage,
        variableAnchor,
        authToken,
        workspaceId: authToken ? undefined : workspaceId
      });

      const baseItem: CodingItem & Record<string, unknown> = {
        unit_key: unitKey,
        unit_alias: row.unitAlias || '',
        person_login: loginName,
        person_code: loginCode,
        person_group: loginGroup,
        booklet_name: bookletId,
        variable_id: variableId,
        variable_page: variablePage,
        variable_anchor: variableAnchor
      };

      if (includeResponseValues) {
        baseItem.value = this.formatResponseValue(
          row.value,
          includeGeoGebraResponseValues
        );
      }

      if (targetVersion === 'v1') {
        baseItem.status_v1 = this.formatStatus(row.statusV1);
        baseItem.code_v1 = resolvedV1Value?.code ?? mapCodeForExport(row.codeV1) ?? '';
        baseItem.score_v1 = resolvedV1Value?.score ?? row.scoreV1 ?? '';
      } else if (targetVersion === 'v2') {
        baseItem.status_v1 = this.formatStatus(row.statusV1);
        baseItem.code_v1 = mapCodeForExport(row.codeV1) ?? '';
        baseItem.score_v1 = row.scoreV1 ?? '';
        baseItem.status_v2 = this.formatStatus(row.statusV2);
        baseItem.code_v2 = mapCodeForExport(row.codeV2) ?? '';
        baseItem.score_v2 = row.scoreV2 ?? '';
      } else {
        baseItem.status_v1 = this.formatStatus(row.statusV1);
        baseItem.code_v1 = mapCodeForExport(row.codeV1) ?? '';
        baseItem.score_v1 = row.scoreV1 ?? '';
        baseItem.status_v2 = this.formatStatus(row.statusV2);
        baseItem.code_v2 = mapCodeForExport(row.codeV2) ?? '';
        baseItem.score_v2 = row.scoreV2 ?? '';
        baseItem.status_v3 = this.formatStatus(row.statusV3);
        baseItem.code_v3 = mapCodeForExport(row.codeV3) ?? '';
        baseItem.score_v3 = row.scoreV3 ?? '';
      }

      if (includeReplayUrls) {
        baseItem.url = url;
      }

      return baseItem;
    } catch (error) {
      this.logger.error(
        `Error building coding item with versions for response ${row.id}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Get headers for version-specific exports.
   */
  getHeadersForVersion(
    version: 'v1' | 'v2' | 'v3',
    includeResponseValues: boolean = true
  ): string[] {
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
    const headers = includeResponseValues ? [...baseHeaders, 'value'] : baseHeaders;

    // Add version-specific columns for comparison
    if (version === 'v1') {
      return [...headers, 'status_v1', 'code_v1', 'score_v1'];
    }
    if (version === 'v2') {
      return [
        ...headers,
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
      ...headers,
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

  private async resolveVariableAnchor(
    workspaceId: number,
    unitName: string,
    variableId: string,
    variableAnchorMaps?: CodingVariableAnchorMaps
  ): Promise<string> {
    if (variableAnchorMaps) {
      return variableAnchorMaps.get(unitName)?.get(variableId) || variableId;
    }

    return this.replayAnchorService ?
      this.replayAnchorService.resolveVariableAnchor(workspaceId, unitName, variableId) :
      variableId;
  }
}
