import { Injectable } from '@nestjs/common';
import { CodingFileCacheService } from './coding-file-cache.service';
// eslint-disable-next-line import/no-cycle
import { CodingListQueryService } from './coding-list-query.service';
import { CodingListStreamService } from './coding-list-stream.service';

// Re-export interfaces for backward compatibility
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

interface JsonStream {
  on(event: 'data', listener: (item: CodingItem) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

/**
 * Facade service for coding list operations.
 *
 * This service maintains backward compatibility by delegating to specialized services:
 * - CodingFileCacheService: VOUD/VOCS file caching
 * - CodingListQueryService: Coding list queries
 * - CodingListStreamService: Streaming exports
 *
 * All public methods maintain their original signatures for zero breaking changes.
 */
@Injectable()
export class CodingListService {
  constructor(
    private readonly fileCacheService: CodingFileCacheService,
    private readonly queryService: CodingListQueryService,
    private readonly streamService: CodingListStreamService
  ) { }

  /**
   * Get variable page map for a unit.
   * Delegates to CodingFileCacheService.
   */
  async getVariablePageMap(
    unitName: string,
    workspaceId: number
  ): Promise<Map<string, string>> {
    return this.fileCacheService.getVariablePageMap(unitName, workspaceId);
  }

  async getValidVariablePairKeys(workspaceId: number): Promise<string[]> {
    return this.queryService.getValidVariablePairKeys(workspaceId);
  }

  /**
   * Get the complete coding list for a workspace.
   * Delegates to CodingListQueryService.
   */
  async getCodingList(
    workspace_id: number,
    authToken: string,
    serverUrl?: string,
    trainingRequired?: boolean
  ): Promise<{
      items: CodingItem[];
      total: number;
    }> {
    return this.queryService.getCodingList(workspace_id, authToken, serverUrl, trainingRequired);
  }

  /**
   * Stream coding list as CSV.
   * Delegates to CodingListStreamService.
   */
  async getCodingListCsvStream(
    workspace_id: number,
    authToken: string,
    serverUrl?: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ) {
    return this.streamService.getCodingListCsvStream(
      workspace_id,
      authToken,
      serverUrl,
      progressCallback,
      trainingRequired,
      checkCancellation
    );
  }

  /**
   * Export coding list as Excel.
   * Delegates to CodingListStreamService.
   */
  async getCodingListAsExcel(
    workspace_id: number,
    authToken?: string,
    serverUrl?: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.streamService.getCodingListAsExcel(
      workspace_id,
      authToken,
      serverUrl,
      progressCallback,
      trainingRequired,
      checkCancellation
    );
  }

  async writeCodingListExcelToFile(
    filePath: string,
    workspace_id: number,
    authToken?: string,
    serverUrl?: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    return this.streamService.writeCodingListExcelToFile(
      filePath,
      workspace_id,
      authToken,
      serverUrl,
      progressCallback,
      trainingRequired,
      checkCancellation
    );
  }

  /**
   * Stream coding list as JSON.
   * Delegates to CodingListStreamService.
   */
  getCodingListJsonStream(
    workspace_id: number,
    authToken: string,
    serverUrl?: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): JsonStream {
    return this.streamService.getCodingListJsonStream(
      workspace_id,
      authToken,
      serverUrl,
      progressCallback,
      trainingRequired,
      checkCancellation
    );
  }

  /**
   * Get all variables that need coding.
   * Delegates to CodingListQueryService.
   */
  async getCodingListVariables(
    workspaceId: number,
    trainingRequired?: boolean
  ): Promise<Array<{ unitName: string; variableId: string }>> {
    return this.queryService.getCodingListVariables(workspaceId, trainingRequired);
  }

  /**
   * Stream coding results by version as CSV.
   * Delegates to CodingListStreamService.
   */
  async getCodingResultsByVersionCsvStream(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ) {
    return this.streamService.getCodingResultsByVersionCsvStream(
      workspace_id,
      version,
      authToken,
      serverUrl,
      includeReplayUrls,
      progressCallback,
      includeResponseValues,
      includeGeoGebraResponseValues,
      checkCancellation,
      missingsProfileId
    );
  }

  /**
   * Export coding results by version as Excel.
   * Delegates to CodingListStreamService.
   */
  async getCodingResultsByVersionAsExcel(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ): Promise<Buffer> {
    return this.streamService.getCodingResultsByVersionAsExcel(
      workspace_id,
      version,
      authToken,
      serverUrl,
      includeReplayUrls,
      progressCallback,
      includeResponseValues,
      includeGeoGebraResponseValues,
      checkCancellation,
      missingsProfileId
    );
  }

  async writeCodingResultsByVersionExcelToFile(
    filePath: string,
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ): Promise<void> {
    return this.streamService.writeCodingResultsByVersionExcelToFile(
      filePath,
      workspace_id,
      version,
      authToken,
      serverUrl,
      includeReplayUrls,
      progressCallback,
      includeResponseValues,
      includeGeoGebraResponseValues,
      checkCancellation,
      missingsProfileId
    );
  }

  async getCodingResultsByVersionAsGeoGebraZip(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ): Promise<Buffer> {
    return this.streamService.getCodingResultsByVersionAsGeoGebraZip(
      workspace_id,
      version,
      authToken,
      serverUrl,
      includeReplayUrls,
      progressCallback,
      checkCancellation,
      missingsProfileId
    );
  }

  async writeCodingResultsByVersionGeoGebraZipToFile(
    filePath: string,
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ): Promise<void> {
    return this.streamService.writeCodingResultsByVersionGeoGebraZipToFile(
      filePath,
      workspace_id,
      version,
      authToken,
      serverUrl,
      includeReplayUrls,
      progressCallback,
      checkCancellation,
      missingsProfileId
    );
  }
}
