import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AggregatedExportService } from './aggregated-export.service';
import { CoderExportService } from './coder-export.service';
import { VariableExportService } from './variable-export.service';
import { DetailedExportService } from './detailed-export.service';
import { CodingTimesExportService } from './coding-times-export.service';

@Injectable()
export class CodingExportFacade {
  constructor(
    private aggregatedExportService: AggregatedExportService,
    private coderExportService: CoderExportService,
    private variableExportService: VariableExportService,
    private detailedExportService: DetailedExportService,
    private codingTimesExportService: CodingTimesExportService
  ) {}

  exportCodingResultsAggregated(
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
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.aggregatedExportService.exportCodingResultsAggregated(
      workspaceId,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      doubleCodingMethod,
      includeComments,
      includeModalValue,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation
    );
  }

  exportCodingResultsByCoder(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.coderExportService.exportCodingResultsByCoder(
      workspaceId,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation
    );
  }

  exportCodingResultsByVariable(
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
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.variableExportService.exportCodingResultsByVariable(
      workspaceId,
      includeModalValue,
      includeDoubleCoded,
      includeComments,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation
    );
  }

  exportCodingResultsDetailed(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.detailedExportService.exportCodingResultsDetailed(
      workspaceId,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation
    );
  }

  exportCodingTimesReport(
    workspaceId: number,
    anonymizeCoders = false,
    usePseudoCoders = false,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.codingTimesExportService.exportCodingTimesReport(
      workspaceId,
      anonymizeCoders,
      usePseudoCoders,
      excludeAutoCoded,
      checkCancellation
    );
  }
}
