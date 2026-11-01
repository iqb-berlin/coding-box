import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import { Request, Response } from 'express';
import { ByVariableExportEstimate } from './coding-export.types';
import { CodingExportDownloadService } from './coding-export-download.service';
import { CodingVariableExportService } from './coding-variable-export.service';
import { CodingAggregatedExportService } from './coding-aggregated-export.service';
import { CodingCoderExportService } from './coding-coder-export.service';
import { CodingCompactExportService } from './coding-compact-export.service';
import { CodingDetailedExportService } from './coding-detailed-export.service';
import { CodingTimingReportExportService } from './coding-timing-report-export.service';

export type { ByVariableExportEstimate } from './coding-export.types';

/** Compatibility facade; export providers own queries, rendering and downloads. */
@Injectable()
export class CodingExportService {
  constructor(
    private readonly downloads: CodingExportDownloadService,
    private readonly byVariable: CodingVariableExportService,
    private readonly aggregated: CodingAggregatedExportService,
    private readonly byCoder: CodingCoderExportService,
    private readonly compact: CodingCompactExportService,
    private readonly detailed: CodingDetailedExportService,
    private readonly times: CodingTimingReportExportService
  ) {}

  async exportCodingListAsCsv(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    return this.downloads.exportCodingListAsCsv(workspaceId, authToken, serverUrl, res);
  }

  async exportCodingListAsExcel(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    return this.downloads.exportCodingListAsExcel(workspaceId, authToken, serverUrl, res);
  }

  async exportCodingListAsJson(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    return this.downloads.exportCodingListAsJson(workspaceId, authToken, serverUrl, res);
  }

  async exportCodingListForJobAsCsv(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<Readable> {
    return this.downloads.exportCodingListForJobAsCsv(workspaceId, authToken, serverUrl, progressCallback, trainingRequired, checkCancellation);
  }

  async exportCodingListForJobAsExcel(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.downloads.exportCodingListForJobAsExcel(workspaceId, authToken, serverUrl, progressCallback, trainingRequired, checkCancellation);
  }

  async exportCodingListForJobAsExcelToFile(
    filePath: string,
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    return this.downloads.exportCodingListForJobAsExcelToFile(filePath, workspaceId, authToken, serverUrl, progressCallback, trainingRequired, checkCancellation);
  }

  async exportCodingListForJobAsJson(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<Readable> {
    return this.downloads.exportCodingListForJobAsJson(workspaceId, authToken, serverUrl, progressCallback, trainingRequired, checkCancellation);
  }

  async exportCodingResultsByVersionAsCsv(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    missingsProfileId: number,
    authToken: string,
    serverUrl: string,
    includeReplayUrls: boolean,
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false
  ): Promise<Readable> {
    return this.downloads.exportCodingResultsByVersionAsCsv(workspaceId, version, missingsProfileId, authToken, serverUrl, includeReplayUrls, progressCallback, includeResponseValues, includeGeoGebraResponseValues);
  }

  async exportCodingResultsByVersionAsExcel(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    missingsProfileId: number,
    authToken: string,
    serverUrl: string,
    includeReplayUrls: boolean,
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false
  ): Promise<Buffer> {
    return this.downloads.exportCodingResultsByVersionAsExcel(workspaceId, version, missingsProfileId, authToken, serverUrl, includeReplayUrls, progressCallback, includeResponseValues, includeGeoGebraResponseValues);
  }

  async estimateCodingResultsByVariableExport(
    workspaceId: number,
    exportType: 'by-variable' | 'by-variable-compact' = 'by-variable',
    excludeAutoCoded = false,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<ByVariableExportEstimate> {
    return this.byVariable.estimateCodingResultsByVariableExport(workspaceId, exportType, excludeAutoCoded, jobDefinitionIds, coderTrainingIds, coderIds);
  }

  async exportCodingResultsAggregated(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent',
    includeComments = false,
    includeModalValue = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string,
    includeResponseValues = false,
    outputFilePath?: string
  ): Promise<Buffer> {
    return this.aggregated.exportCodingResultsAggregated(workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, doubleCodingMethod, includeComments, includeModalValue, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl, includeResponseValues, outputFilePath);
  }

  async exportCodingResultsAggregatedToFile(
    filePath: string,
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent',
    includeComments = false,
    includeModalValue = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string,
    includeResponseValues = false
  ): Promise<void> {
    return this.aggregated.exportCodingResultsAggregatedToFile(filePath, workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, doubleCodingMethod, includeComments, includeModalValue, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl, includeResponseValues);
  }

  async exportCodingResultsByCoder(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string,
    outputFilePath?: string
  ): Promise<Buffer> {
    return this.byCoder.exportCodingResultsByCoder(workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl, outputFilePath);
  }

  async exportCodingResultsByCoderToFile(
    filePath: string,
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<void> {
    return this.byCoder.exportCodingResultsByCoderToFile(filePath, workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl);
  }

  async exportCodingResultsByVariable(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string,
    outputFilePath?: string
  ): Promise<Buffer> {
    return this.byVariable.exportCodingResultsByVariable(workspaceId, includeModalValue, includeDoubleCoded, includeComments, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl, outputFilePath);
  }

  async exportCodingResultsByVariableToFile(
    filePath: string,
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<void> {
    return this.byVariable.exportCodingResultsByVariableToFile(filePath, workspaceId, includeModalValue, includeDoubleCoded, includeComments, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl);
  }

  exportCodingResultsByVariableCompactAsCsvStream(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Readable {
    return this.compact.exportCodingResultsByVariableCompactAsCsvStream(workspaceId, includeModalValue, includeDoubleCoded, includeComments, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl);
  }

  async exportCodingResultsByVariableCompact(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<Buffer> {
    return this.compact.exportCodingResultsByVariableCompact(workspaceId, includeModalValue, includeDoubleCoded, includeComments, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl);
  }

  async exportCodingResultsDetailed(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string,
    includeResponseValues = false,
    outputFilePath?: string
  ): Promise<Buffer> {
    return this.detailed.exportCodingResultsDetailed(workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl, includeResponseValues, outputFilePath);
  }

  async exportCodingResultsDetailedToFile(
    filePath: string,
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string,
    includeResponseValues = false
  ): Promise<void> {
    return this.detailed.exportCodingResultsDetailedToFile(filePath, workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl, includeResponseValues);
  }

  async exportCodingTimesReport(
    workspaceId: number,
    anonymizeCoders = false,
    usePseudoCoders = false,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    outputFilePath?: string
  ): Promise<Buffer> {
    return this.times.exportCodingTimesReport(workspaceId, anonymizeCoders, usePseudoCoders, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, outputFilePath);
  }

  async exportCodingTimesReportToFile(
    filePath: string,
    workspaceId: number,
    anonymizeCoders = false,
    usePseudoCoders = false,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<void> {
    return this.times.exportCodingTimesReportToFile(filePath, workspaceId, anonymizeCoders, usePseudoCoders, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds);
  }
}
