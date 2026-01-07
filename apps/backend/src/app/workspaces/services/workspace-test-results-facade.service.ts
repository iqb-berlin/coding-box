import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { Writable } from 'stream';
import { Persons, ResponseEntity } from '../../common';
import { WorkspaceTestResultsOverviewService } from './workspace-test-results-overview.service';
import {
  WorkspaceTestResultsQueryService,
  SearchResponseItem,
  BookletSearchItem,
  UnitSearchItem
} from './workspace-test-results-query.service';
import { DuplicateResponseService } from './duplicate-response.service';
import { FlatResponseService } from './flat-response.service';
import { ResponseExportService } from './response-export.service';

/**
 * WorkspaceTestResultsFacade
 *
 * Facade service that coordinates between specialized test results services.
 * This service maintains backward compatibility while delegating to focused services:
 * - WorkspaceTestResultsOverviewService: Statistics and overview
 * - WorkspaceTestResultsQueryService: Data querying and retrieval
 * - DuplicateResponseService: Duplicate resolution
 * - FlatResponseService: Complex flat response queries
 * - ResponseExportService: Export functionality
 *
 * This facade allows gradual migration from the monolithic WorkspaceTestResultsService
 * without breaking existing consumers.
 */
@Injectable()
export class WorkspaceTestResultsFacade {
  constructor(
    private readonly overviewService: WorkspaceTestResultsOverviewService,
    private readonly queryService: WorkspaceTestResultsQueryService,
    private readonly duplicateService: DuplicateResponseService,
    private readonly flatResponseService: FlatResponseService,
    private readonly exportService: ResponseExportService
  ) {}

  /**
   * Get workspace test results overview with statistics
   * Delegates to: WorkspaceTestResultsOverviewService
   */
  async getWorkspaceTestResultsOverview(workspaceId: number): Promise<{
    testPersons: number;
    testGroups: number;
    uniqueBooklets: number;
    uniqueUnits: number;
    uniqueResponses: number;
    responseStatusCounts: Record<string, number>;
    sessionBrowserCounts: Record<string, number>;
    sessionOsCounts: Record<string, number>;
    sessionScreenCounts: Record<string, number>;
  }> {
    return this.overviewService.getWorkspaceTestResultsOverview(workspaceId);
  }

  /**
   * Find comprehensive test results for a specific person
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async findPersonTestResults(
    personId: number,
    workspaceId: number
  ): Promise<
    {
      id: number;
      name: string;
      logs: {
        id: number;
        bookletid: number;
        ts: string;
        parameter: string;
        key: string;
      }[];
      units: {
        id: number;
        name: string;
        alias: string | null;
        results: {
          id: number;
          unitid: number;
          variableid: string;
          status: string;
          value: string;
          subform: string;
          code?: number;
          score?: number;
          codedstatus?: string;
        }[];
        tags: {
          id: number;
          unitId: number;
          tag: string;
          color?: string;
          createdAt: Date;
        }[];
      }[];
    }[]
    > {
    return this.queryService.findPersonTestResults(personId, workspaceId);
  }

  /**
   * Find paginated test results (persons) for a workspace
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async findTestResults(
    workspace_id: number,
    options: { page: number; limit: number; searchText?: string }
  ): Promise<[Persons[], number]> {
    return this.queryService.findTestResults(workspace_id, options);
  }

  /**
   * Find workspace responses with optional pagination
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async findWorkspaceResponses(
    workspace_id: number,
    options?: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    return options ?
      this.queryService.findWorkspaceResponses(workspace_id, options) :
      this.queryService.findWorkspaceResponses(workspace_id);
  }

  async findUnitResponse(
    workspaceId: number,
    connector: string,
    unitId: string
  ): Promise<{
      responses: {
        id: string;
        content: { id: string; value: string; status: string }[];
      }[];
    }> {
    return this.queryService.findUnitResponse(workspaceId, connector, unitId);
  }

  /**
   * Find unit logs for a specific unit
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async findUnitLogs(
    workspaceId: number,
    unitId: number
  ): Promise<{ id: number; unitid: number; ts: string; key: string; parameter: string }[]> {
    return this.queryService.findUnitLogs(workspaceId, unitId);
  }

  /**
   * Find booklet logs, sessions, and unit logs for a booklet containing the given unit
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async findBookletLogsByUnitId(
    workspaceId: number,
    unitId: number
  ): Promise<{
      bookletId: number;
      logs: { id: number; bookletid: number; ts: string; key: string; parameter: string }[];
      sessions: { id: number; browser: string; os: string; screen: string; ts: string }[];
      units: {
        id: number;
        bookletid: number;
        name: string;
        alias: string | null;
        logs: { id: number; unitid: number; ts: string; key: string; parameter: string }[];
      }[];
    }> {
    return this.queryService.findBookletLogsByUnitId(workspaceId, unitId);
  }

  /**
   * Get responses by status with pagination
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    options: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    return this.queryService.getResponsesByStatus(workspaceId, status, options);
  }

  /**
   * Search responses by value, unit, or variable
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async searchResponses(
    workspaceId: number,
    criteria: {
      value?: string;
      variableId?: string;
      unitName?: string;
      bookletName?: string;
      status?: string;
      codedStatus?: string;
      group?: string;
      code?: string;
      version?: 'v1' | 'v2' | 'v3';
    },
    pagination: { page?: number; limit?: number }
  ): Promise<{ data: SearchResponseItem[]; total: number; page: number; limit: number }> {
    return this.queryService.searchResponses(workspaceId, criteria, pagination);
  }

  /**
   * Find booklets by name with pagination
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async findBookletsByName(
    workspaceId: number,
    bookletName: string,
    options: { page?: number; limit?: number }
  ): Promise<{ data: BookletSearchItem[]; total: number; page: number; limit: number }> {
    return this.queryService.findBookletsByName(workspaceId, bookletName, options);
  }

  /**
   * Find units by name with pagination
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async findUnitsByName(
    workspaceId: number,
    unitName: string,
    options: { page?: number; limit?: number }
  ): Promise<{ data: UnitSearchItem[]; total: number; page: number; limit: number }> {
    return this.queryService.findUnitsByName(workspaceId, unitName, options);
  }

  /**
   * Delete a single response
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async deleteResponse(
    workspaceId: number,
    responseId: number,
    userId: string
  ): Promise<{ success: boolean; report: { deletedResponse: number | null; warnings: string[] } }> {
    return this.queryService.deleteResponse(workspaceId, responseId, userId);
  }

  /**
   * Delete a booklet and all its associated units and responses
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async deleteBooklet(
    workspaceId: number,
    bookletId: number,
    userId: string
  ): Promise<{ success: boolean; report: { deletedBooklet: number | null; warnings: string[] } }> {
    return this.queryService.deleteBooklet(workspaceId, bookletId, userId);
  }

  /**
   * Delete multiple test persons
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async deleteTestPersons(
    workspaceId: number,
    testPersonIds: string,
    userId: string
  ): Promise<{ success: boolean; report: { deletedPersons: string[]; warnings: string[] } }> {
    return this.queryService.deleteTestPersons(workspaceId, testPersonIds, userId);
  }

  /**
   * Delete a single unit
   * Delegates to: WorkspaceTestResultsQueryService
   */
  async deleteUnit(
    workspaceId: number,
    unitId: number,
    userId: string
  ): Promise<{ success: boolean; report: { deletedUnit: number | null; warnings: string[] } }> {
    return this.queryService.deleteUnit(workspaceId, unitId, userId);
  }

  /**
   * Resolve duplicate responses
   * Delegates to: DuplicateResponseService
   */
  async resolveDuplicateResponses(
    workspaceId: number,
    resolutionMap: Record<string, number>,
    userId: string
  ): Promise<{ resolvedCount: number; success: boolean }> {
    return this.duplicateService.resolveDuplicateResponses(
      workspaceId,
      resolutionMap,
      userId
    );
  }

  /**
   * Find flat responses with extensive filtering and pagination
   * Delegates to: FlatResponseService
   */
  async findFlatResponses(
    workspaceId: number,
    options: {
      page: number;
      limit: number;
      code?: string;
      group?: string;
      login?: string;
      booklet?: string;
      unit?: string;
      response?: string;
      responseStatus?: string;
      responseValue?: string;
      tags?: string;
      geogebra?: string;
      audioLow?: string;
      hasValue?: string;
      audioLowThreshold?: string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: string;
      longLoading?: string;
      longLoadingThresholdMs?: string;
      processingDurations?: string;
      processingDurationThresholdMs?: string;
      processingDurationMin?: string;
      processingDurationMax?: string;
      unitProgress?: string;
      sessionBrowsers?: string;
      sessionOs?: string;
      sessionScreens?: string;
      sessionIds?: string;
    }
  ): Promise<[unknown[], number]> {
    return this.flatResponseService.findFlatResponses(workspaceId, options);
  }

  /**
   * Calculate response frequencies for specific unit/variable combinations
   * Delegates to: FlatResponseService
   */
  async findFlatResponseFrequencies(
    workspaceId: number,
    combos: Array<{ unitKey: string; variableId: string; values: string[] }>
  ): Promise<Record<string, { total: number; values: Array<{ value: string; count: number; p: number }> }>> {
    return this.flatResponseService.findFlatResponseFrequencies(workspaceId, combos);
  }

  /**
   * Get available filter options based on current workspace data
   * Delegates to: FlatResponseService
   */
  async findFlatResponseFilterOptions(
    workspaceId: number,
    options: {
      code?: string;
      group?: string;
      login?: string;
      booklet?: string;
      unit?: string;
      response?: string;
      responseStatus?: string;
      responseValue?: string;
      tags?: string;
      geogebra?: string;
      audioLow?: string;
      audioLowThreshold?: string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: string;
      longLoading?: string;
      longLoadingThresholdMs?: string;
      processingDurations?: string;
      processingDurationThresholdMs?: string;
      unitProgress?: string;
      sessionBrowsers?: string;
      sessionOs?: string;
      sessionScreens?: string;
      sessionIds?: string;
    }
  ): Promise<{
      codes: string[];
      groups: string[];
      logins: string[];
      booklets: string[];
      units: string[];
      responses: string[];
      responseStatuses: string[];
      tags: string[];
      processingDurations: string[];
      unitProgresses: string[];
      sessionBrowsers: string[];
      sessionOs: string[];
      sessionScreens: string[];
      sessionIds: string[];
    }> {
    return this.flatResponseService.findFlatResponseFilterOptions(workspaceId, options);
  }

  /**
   * Export test results to response
   * Delegates to: ResponseExportService
   */
  async exportTestResults(
    workspaceId: number,
    res: Response,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    }
  ): Promise<void> {
    return this.exportService.exportTestResults(workspaceId, res, filters);
  }

  /**
   * Export test results to file
   * Delegates to: ResponseExportService
   */
  async exportTestResultsToFile(
    workspaceId: number,
    filePath: string,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    return this.exportService.exportTestResultsToFile(
      workspaceId,
      filePath,
      filters,
      progressCallback
    );
  }

  /**
   * Export test results to stream
   * Delegates to: ResponseExportService
   */
  async exportTestResultsToStream(
    workspaceId: number,
    stream: Writable,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    return this.exportService.exportTestResultsToStream(
      workspaceId,
      stream,
      filters,
      progressCallback
    );
  }

  /**
   * Export test logs to file
   * Delegates to: ResponseExportService
   */
  async exportTestLogsToFile(
    workspaceId: number,
    filePath: string,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    return this.exportService.exportTestLogsToFile(
      workspaceId,
      filePath,
      filters,
      progressCallback
    );
  }

  /**
   * Export test logs to stream
   * Delegates to: ResponseExportService
   */
  async exportTestLogsToStream(
    workspaceId: number,
    stream: Writable,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    return this.exportService.exportTestLogsToStream(
      workspaceId,
      stream,
      filters,
      progressCallback
    );
  }

  /**
   * Get export options for a workspace
   * Delegates to: ResponseExportService
   */
  async getExportOptions(workspaceId: number): Promise<{
    testPersons: {
      id: number;
      groupName: string;
      code: string;
      login: string;
    }[];
    groups: string[];
    booklets: string[];
    units: string[];
  }> {
    return this.exportService.getExportOptions(workspaceId);
  }
}
