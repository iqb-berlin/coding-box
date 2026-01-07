import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { CodingExportFacade } from './coding-export-facade.service';

@Injectable()
export class CodingExportService {
  constructor(
    private codingExportFacade: CodingExportFacade
  ) {}

  /**
   * Delegates to AggregatedExportService via Facade
   */
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
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.codingExportFacade.exportCodingResultsAggregated(
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

  /**
   * Delegates to CoderExportService via Facade
   */
  async exportCodingResultsByCoder(
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
    return this.codingExportFacade.exportCodingResultsByCoder(
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

  /**
   * Delegates to VariableExportService via Facade
   */
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
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.codingExportFacade.exportCodingResultsByVariable(
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

  /**
   * Delegates to DetailedExportService via Facade
   */
  async exportCodingResultsDetailed(
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
    return this.codingExportFacade.exportCodingResultsDetailed(
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

  /**
   * Delegates to CodingTimesExportService via Facade
   */
  async exportCodingTimesReport(
    workspaceId: number,
    anonymizeCoders = false,
    usePseudoCoders = false,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.codingExportFacade.exportCodingTimesReport(
      workspaceId,
      anonymizeCoders,
      usePseudoCoders,
      excludeAutoCoded,
      checkCancellation
    );
  }
}
