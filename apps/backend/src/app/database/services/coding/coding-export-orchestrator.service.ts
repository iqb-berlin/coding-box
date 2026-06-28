import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Readable } from 'stream';
import { CodingExportService } from './coding-export.service';
import { CodingListService } from './coding-list.service';
import {
  CodingItemMatrixExportService,
  ItemMatrixValue,
  ItemMatrixVersion
} from './coding-item-matrix-export.service';

type CodingVersion = 'v1' | 'v2' | 'v3';

export interface ExportProgressDetails {
  phase?: 'counting' | 'writing' | 'finalizing';
  processedRows?: number;
  totalRows?: number;
}

export type ExportProgressCallback = (
  percentage: number,
  details?: ExportProgressDetails
) => Promise<void>;

export interface VersionedCodingResultsExportOptions {
  workspaceId: number;
  version?: CodingVersion;
  authToken?: string;
  serverUrl?: string;
  includeReplayUrl?: boolean;
  includeResponseValues?: boolean;
  includeGeoGebraResponseValues?: boolean;
  includeGeoGebraFiles?: boolean;
  onProgress?: ExportProgressCallback;
  checkCancellation?: () => Promise<void>;
}

export interface DetailedCodingResultsExportOptions {
  workspaceId: number;
  outputCommentsInsteadOfCodes?: boolean;
  includeReplayUrl?: boolean;
  anonymizeCoders?: boolean;
  usePseudoCoders?: boolean;
  authToken?: string;
  req?: Request;
  excludeAutoCoded?: boolean;
  checkCancellation?: () => Promise<void>;
  jobDefinitionIds?: number[];
  coderTrainingIds?: number[];
  coderIds?: number[];
  serverUrl?: string;
}

export interface ItemMatrixExportOptions {
  workspaceId: number;
  matrixValue?: ItemMatrixValue;
  version?: ItemMatrixVersion;
  onProgress?: ExportProgressCallback;
  checkCancellation?: () => Promise<void>;
}

@Injectable()
export class CodingExportOrchestratorService {
  constructor(
    private readonly codingExportService: CodingExportService,
    private readonly codingListService: CodingListService,
    private readonly codingItemMatrixExportService: CodingItemMatrixExportService
  ) { }

  exportResultsByVersionAsCsv(
    options: VersionedCodingResultsExportOptions
  ): Promise<Readable> {
    return this.codingListService.getCodingResultsByVersionCsvStream(
      options.workspaceId,
      options.version || 'v2',
      options.authToken || '',
      options.serverUrl || '',
      options.includeReplayUrl || false,
      options.onProgress,
      options.includeResponseValues !== false,
      options.includeGeoGebraResponseValues === true,
      options.checkCancellation
    );
  }

  exportResultsByVersionAsExcel(
    options: VersionedCodingResultsExportOptions
  ): Promise<Buffer> {
    if (options.includeGeoGebraFiles) {
      return this.codingListService.getCodingResultsByVersionAsGeoGebraZip(
        options.workspaceId,
        options.version || 'v2',
        options.authToken || '',
        options.serverUrl || '',
        options.includeReplayUrl || false,
        options.onProgress,
        options.checkCancellation
      );
    }

    return this.codingListService.getCodingResultsByVersionAsExcel(
      options.workspaceId,
      options.version || 'v2',
      options.authToken || '',
      options.serverUrl || '',
      options.includeReplayUrl || false,
      options.onProgress,
      options.includeResponseValues !== false,
      options.includeGeoGebraResponseValues === true,
      options.checkCancellation
    );
  }

  async exportResultsByVersionAsExcelToFile(
    filePath: string,
    options: VersionedCodingResultsExportOptions
  ): Promise<void> {
    if (options.includeGeoGebraFiles) {
      await this.codingListService.writeCodingResultsByVersionGeoGebraZipToFile(
        filePath,
        options.workspaceId,
        options.version || 'v2',
        options.authToken || '',
        options.serverUrl || '',
        options.includeReplayUrl || false,
        options.onProgress,
        options.checkCancellation
      );
      return;
    }

    await this.codingListService.writeCodingResultsByVersionExcelToFile(
      filePath,
      options.workspaceId,
      options.version || 'v2',
      options.authToken || '',
      options.serverUrl || '',
      options.includeReplayUrl || false,
      options.onProgress,
      options.includeResponseValues !== false,
      options.includeGeoGebraResponseValues === true,
      options.checkCancellation
    );
  }

  exportDetailed(options: DetailedCodingResultsExportOptions): Promise<Buffer> {
    return this.codingExportService.exportCodingResultsDetailed(
      options.workspaceId,
      options.outputCommentsInsteadOfCodes || false,
      options.includeReplayUrl || false,
      options.anonymizeCoders || false,
      options.usePseudoCoders || false,
      options.authToken || '',
      options.req,
      options.excludeAutoCoded || false,
      options.checkCancellation,
      options.jobDefinitionIds,
      options.coderTrainingIds,
      options.coderIds,
      options.serverUrl || ''
    );
  }

  exportDetailedToFile(
    filePath: string,
    options: DetailedCodingResultsExportOptions
  ): Promise<void> {
    return this.codingExportService.exportCodingResultsDetailedToFile(
      filePath,
      options.workspaceId,
      options.outputCommentsInsteadOfCodes || false,
      options.includeReplayUrl || false,
      options.anonymizeCoders || false,
      options.usePseudoCoders || false,
      options.authToken || '',
      options.req,
      options.excludeAutoCoded || false,
      options.checkCancellation,
      options.jobDefinitionIds,
      options.coderTrainingIds,
      options.coderIds,
      options.serverUrl || ''
    );
  }

  exportItemMatrixAsCsv(options: ItemMatrixExportOptions): Promise<Readable> {
    return Promise.resolve(this.codingItemMatrixExportService.exportItemMatrixAsCsvStream(
      options.workspaceId,
      options.matrixValue || 'score',
      options.version || 'v2',
      options.onProgress,
      options.checkCancellation
    ) as Readable);
  }

  exportItemMatrixAsExcel(options: ItemMatrixExportOptions): Promise<Buffer> {
    return this.codingItemMatrixExportService.exportItemMatrixAsExcel(
      options.workspaceId,
      options.matrixValue || 'score',
      options.version || 'v2',
      options.onProgress,
      options.checkCancellation
    );
  }

  exportItemMatrixAsExcelToFile(
    filePath: string,
    options: ItemMatrixExportOptions
  ): Promise<void> {
    return this.codingItemMatrixExportService.writeItemMatrixExcelToFile(
      filePath,
      options.workspaceId,
      options.matrixValue || 'score',
      options.version || 'v2',
      options.onProgress,
      options.checkCancellation
    );
  }
}
