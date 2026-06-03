import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Readable } from 'stream';
import { CodingExportService } from './coding-export.service';
import { CodingResultsExportService } from './coding-results-export.service';

type CodingVersion = 'v1' | 'v2' | 'v3';

export interface VersionedCodingResultsExportOptions {
  workspaceId: number;
  version?: CodingVersion;
  authToken?: string;
  serverUrl?: string;
  includeReplayUrl?: boolean;
  includeResponseValues?: boolean;
  includeGeoGebraResponseValues?: boolean;
  includeGeoGebraFiles?: boolean;
  onProgress?: (percentage: number) => Promise<void>;
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

@Injectable()
export class CodingExportOrchestratorService {
  constructor(
    private readonly codingExportService: CodingExportService,
    private readonly codingResultsExportService: CodingResultsExportService
  ) { }

  exportResultsByVersionAsCsv(
    options: VersionedCodingResultsExportOptions
  ): Promise<Readable> {
    return this.codingResultsExportService.exportCodingResultsByVersionAsCsv(
      options.workspaceId,
      options.version || 'v2',
      options.authToken || '',
      options.serverUrl || '',
      options.includeReplayUrl || false,
      options.onProgress,
      options.includeResponseValues !== false,
      options.includeGeoGebraResponseValues === true
    );
  }

  exportResultsByVersionAsExcel(
    options: VersionedCodingResultsExportOptions
  ): Promise<Buffer> {
    if (options.includeGeoGebraFiles) {
      return this.codingResultsExportService.exportCodingResultsByVersionAsGeoGebraZip(
        options.workspaceId,
        options.version || 'v2',
        options.authToken || '',
        options.serverUrl || '',
        options.includeReplayUrl || false,
        options.onProgress
      );
    }

    return this.codingResultsExportService.exportCodingResultsByVersionAsExcel(
      options.workspaceId,
      options.version || 'v2',
      options.authToken || '',
      options.serverUrl || '',
      options.includeReplayUrl || false,
      options.onProgress,
      options.includeResponseValues !== false,
      options.includeGeoGebraResponseValues === true
    );
  }

  exportDetailed(options: DetailedCodingResultsExportOptions): Promise<Buffer> {
    if (this.canUseSpecializedDetailedExport(options)) {
      return this.codingResultsExportService.exportCodingResultsDetailed(
        options.workspaceId,
        options.outputCommentsInsteadOfCodes || false,
        options.includeReplayUrl || false,
        options.anonymizeCoders || false,
        options.usePseudoCoders || false,
        options.authToken || '',
        options.req,
        options.excludeAutoCoded || false,
        options.checkCancellation
      );
    }

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

  private canUseSpecializedDetailedExport(
    options: DetailedCodingResultsExportOptions
  ): boolean {
    const hasScopedJobFilters = !!(
      options.jobDefinitionIds?.length ||
      options.coderTrainingIds?.length ||
      options.coderIds?.length
    );

    if (hasScopedJobFilters) {
      return false;
    }

    return !options.includeReplayUrl || !!options.req;
  }
}
