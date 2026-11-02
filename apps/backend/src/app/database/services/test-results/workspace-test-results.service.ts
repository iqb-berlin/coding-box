import {
  Injectable
} from '@nestjs/common';
import { Response } from 'express';
import { Writable } from 'stream';
import {
  QueryRunner
} from 'typeorm';
import {
  TestResultsDeletePreviewDto,
  TestResultsDeleteRequestDto,
  TestResultsDeleteResultDto,
  TestResultsResponseCleanupRequestDto
} from '../../../../../../../api-dto/test-results/test-results-deletion.dto';
import Persons from '../../entities/persons.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { TestResultsAnomaliesService } from './test-results-anomalies.service';
import { TestResultsCacheService } from './test-results-cache.service';
import { TestResultsExportService } from './test-results-export.service';
import { TestResultsMutationService } from './test-results-mutation.service';
import { TestResultsQueryService } from './test-results-query.service';
import { TestResultsReplayService } from './test-results-replay.service';
import { TestResultsFrequenciesService } from './test-results-frequencies.service';
import { TestResultsFilterOptionsService } from './test-results-filter-options.service';
import { TestResultsResponsesService } from './test-results-responses.service';
import { TestResultsSearchService } from './test-results-search.service';
import {
  LogAnomalyDashboardSummary, LogAnomalyDetailsResponse, LogAnomalySummary, QuickSearchResult, ResponseSearchSortBy, ResponseSearchSortDirection, TestResultsExportFilters, WorkspaceOverviewStats
} from './workspace-test-results.types';

export type {
  FlatFrequenciesResult, ResponseSearchSortBy, ResponseSearchSortDirection, WorkspaceOverviewStats
} from './workspace-test-results.types';

/** Compatibility facade; feature providers own reads, writes and exports. */
@Injectable()
export class WorkspaceTestResultsService {
  constructor(
    private readonly anomalies: TestResultsAnomaliesService,
    private readonly cache: TestResultsCacheService,
    private readonly query: TestResultsQueryService,
    private readonly responses: TestResultsResponsesService,
    private readonly frequencies: TestResultsFrequenciesService,
    private readonly filterOptions: TestResultsFilterOptionsService,
    private readonly replay: TestResultsReplayService,
    private readonly mutation: TestResultsMutationService,
    private readonly search: TestResultsSearchService,
    private readonly exporter: TestResultsExportService
  ) {}

  async getLogAnomalySummary(
    workspaceId: number,
    options: {
      longLoadingThresholdMs?: number | string;
      focusLostThresholdMs?: number | string;
      sessionSpanThresholdMs?: number | string;
      repeatedStartThreshold?: number | string;
    } = {}
  ): Promise<LogAnomalyDashboardSummary> {
    return this.anomalies.getLogAnomalySummary(workspaceId, options);
  }

  async getLogAnomalyDetails(
    workspaceId: number,
    options: {
      longLoadingThresholdMs?: number | string;
      focusLostThresholdMs?: number | string;
      sessionSpanThresholdMs?: number | string;
      repeatedStartThreshold?: number | string;
      limit?: number | string;
    } = {}
  ): Promise<LogAnomalyDetailsResponse> {
    return this.anomalies.getLogAnomalyDetails(workspaceId, options);
  }

  async invalidateWorkspaceStatsCache(workspaceId: number): Promise<boolean> {
    return this.cache.invalidateWorkspaceStatsCache(workspaceId);
  }

  async invalidateCodingStatisticsCache(workspaceId: number): Promise<void> {
    return this.cache.invalidateCodingStatisticsCache(workspaceId);
  }

  async invalidateCodingAvailabilityCache(workspaceId: number): Promise<void> {
    return this.cache.invalidateCodingAvailabilityCache(workspaceId);
  }

  async getWorkspaceTestResultsOverview(workspaceId: number): Promise<WorkspaceOverviewStats> {
    return this.query.getWorkspaceTestResultsOverview(workspaceId);
  }

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
          code?: number | null;
          score?: number | null;
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
    return this.query.findPersonTestResults(personId, workspaceId);
  }

  async findTestResults(
    workspace_id: number,
    options: { page: number; limit: number; searchText?: string }
  ): Promise<[Persons[], number]> {
    return this.query.findTestResults(workspace_id, options);
  }

  async quickSearchTestResults(
    workspaceId: number,
    query: string,
    limit = 8
  ): Promise<QuickSearchResult> {
    return this.query.quickSearchTestResults(workspaceId, query, limit);
  }

  async findWorkspaceResponses(
    workspace_id: number,
    options?: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    return this.query.findWorkspaceResponses(workspace_id, options);
  }

  async resolveDuplicateResponses(
    workspaceId: number,
    resolutionMap: Record<string, number>,
    userId: string
  ): Promise<{ resolvedCount: number; success: boolean }> {
    return this.mutation.resolveDuplicateResponses(workspaceId, resolutionMap, userId);
  }

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
      audioLowThreshold?: number | string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: number | string;
      longLoading?: string;
      longLoadingThresholdMs?: number | string;
      processingDurations?: string;
      processingDurationThresholdMs?: number | string;
      processingDurationMin?: string;
      processingDurationMax?: string;
      unitProgress?: string;
      sessionBrowsers?: string;
      sessionOs?: string;
      sessionScreens?: string;
      sessionIds?: string;
      logAnomalies?: string;
      includeLogAnomalies?: string;
      focusLostThresholdMs?: number | string;
      sessionSpanThresholdMs?: number | string;
      repeatedStartThreshold?: number | string;
      regexSearch?: boolean;
    },
    queryRunner?: QueryRunner
  ): Promise<
    [
      Array<{
        bookletId: number;
        responseId: number;
        unitId: number;
        personId: number;
        code: string;
        group: string;
        login: string;
        booklet: string;
        unit: string;
        response: string;
        responseStatus: string;
        responseValue: string;
        tags: string[];
        logAnomalies: LogAnomalySummary[];
      }>,
      number
    ]
  > {
    return this.responses.findFlatResponses(workspaceId, options, queryRunner);
  }

  async findFlatResponseFrequencies(
    workspaceId: number,
    combos: Array<{ unitKey: string; variableId: string; values: string[] }>
  ): Promise<
    Record<
      string,
      {
        total: number;
        values: Array<{ value: string; count: number; p: number }>;
      }
    >
  > {
    return this.frequencies.findFlatResponseFrequencies(workspaceId, combos);
  }

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
      audioLowThreshold?: number | string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: number | string;
      longLoading?: string;
      longLoadingThresholdMs?: number | string;
      processingDurations?: string;
      processingDurationThresholdMs?: number | string;
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
    return this.filterOptions.findFlatResponseFilterOptions(workspaceId, options);
  }

  async findUnitLogs(
    workspaceId: number,
    unitId: number
  ): Promise<
    { id: number; unitid: number; ts: string; key: string; parameter: string }[]
  > {
    return this.query.findUnitLogs(workspaceId, unitId);
  }

  async findBookletLogsByUnitId(
    workspaceId: number,
    unitId: number
  ): Promise<{
    bookletId: number;
    logs: {
      id: number;
      bookletid: number;
      ts: string;
      key: string;
      parameter: string;
    }[];
    sessions: {
      id: number;
      browser: string;
      os: string;
      screen: string;
      ts: string;
    }[];
    units: {
      id: number;
      bookletid: number;
      name: string;
      alias: string | null;
      logs: {
        id: number;
        unitid: number;
        ts: string;
        key: string;
        parameter: string;
      }[];
    }[];
  }> {
    return this.query.findBookletLogsByUnitId(workspaceId, unitId);
  }

  async findUnitResponse(
    workspaceId: number,
    connector: string,
    unitId: string
  ): Promise<{
    responses: {
      id: string;
      content: string;
    }[];
  }> {
    return this.replay.findUnitResponse(workspaceId, connector, unitId);
  }

  async getResponsesByStatus(
    workspace_id: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    options?: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    return this.search.getResponsesByStatus(workspace_id, status, version, options);
  }

  async deleteTestPersons(
    workspaceId: number,
    testPersonIds: string,
    userId: string
  ): Promise<{
    success: boolean;
    report: {
      deletedPersons: number[];
      warnings: string[];
    };
  }> {
    return this.mutation.deleteTestPersons(workspaceId, testPersonIds, userId);
  }

  async previewDeleteTestResults(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Promise<TestResultsDeletePreviewDto> {
    return this.mutation.previewDeleteTestResults(workspaceId, request);
  }

  async previewDeleteTestLogs(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Promise<TestResultsDeletePreviewDto> {
    return this.mutation.previewDeleteTestLogs(workspaceId, request);
  }

  async deleteTestResultsByRequest(
    workspaceId: number,
    request: TestResultsDeleteRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    return this.mutation.deleteTestResultsByRequest(workspaceId, request, userId, onProgress);
  }

  async deleteTestLogsByRequest(
    workspaceId: number,
    request: TestResultsDeleteRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    return this.mutation.deleteTestLogsByRequest(workspaceId, request, userId, onProgress);
  }

  async previewDeleteTestResultResponses(
    workspaceId: number,
    request: TestResultsResponseCleanupRequestDto
  ): Promise<TestResultsDeletePreviewDto> {
    return this.mutation.previewDeleteTestResultResponses(workspaceId, request);
  }

  async deleteTestResultResponsesByRequest(
    workspaceId: number,
    request: TestResultsResponseCleanupRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    return this.mutation.deleteTestResultResponsesByRequest(workspaceId, request, userId, onProgress);
  }

  async deleteUnit(
    workspaceId: number,
    unitId: number,
    userId: string
  ): Promise<{
    success: boolean;
    report: {
      deletedUnit: number | null;
      warnings: string[];
    };
  }> {
    return this.mutation.deleteUnit(workspaceId, unitId, userId);
  }

  async deleteResponse(
    workspaceId: number,
    responseId: number,
    userId: string
  ): Promise<{
    success: boolean;
    report: {
      deletedResponse: number | null;
      warnings: string[];
    };
  }> {
    return this.mutation.deleteResponse(workspaceId, responseId, userId);
  }

  async deleteBooklet(
    workspaceId: number,
    bookletId: number,
    userId: string
  ): Promise<{
    success: boolean;
    report: {
      deletedBooklet: number | null;
      warnings: string[];
    };
  }> {
    return this.mutation.deleteBooklet(workspaceId, bookletId, userId);
  }

  async searchResponses(
    workspaceId: number,
    searchParams: {
      value?: string;
      variableId?: string;
      unitName?: string;
      bookletName?: string;
      status?: string;
      codedStatus?: string;
      group?: string;
      code?: string;
      codingCode?: string;
      score?: string;
      version?: 'v1' | 'v2' | 'v3';
      geogebra?: boolean;
      derivedOnly?: boolean;
      responseSource?: 'base' | 'derived' | 'all';
      personLogin?: string;
      regexSearch?: boolean;
    },
    options: {
      page?: number;
      limit?: number;
      sortBy?: ResponseSearchSortBy;
      sortDirection?: ResponseSearchSortDirection;
    } = {}
  ): Promise<{
    data: {
      responseId: number;
      variableId: string;
      value: string;
      status: string;
      code?: number | null;
      score?: number | null;
      codedStatus?: string;
      unitId: number;
      unitName: string;
      unitAlias: string | null;
      bookletId: number;
      bookletName: string;
      personId: number;
      personLogin: string;
      personCode: string;
      personGroup: string;
      variablePage?: string;
    }[];
    total: number;
  }> {
    return this.search.searchResponses(workspaceId, searchParams, options);
  }

  async findUnitsByName(
    workspaceId: number,
    unitName: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<{
    data: {
      unitId: number;
      unitName: string;
      unitAlias: string | null;
      bookletId: number;
      bookletName: string;
      personId: number;
      personLogin: string;
      personCode: string;
      personGroup: string;
      tags: {
        id: number;
        unitId: number;
        tag: string;
        color?: string;
        createdAt: Date;
      }[];
      responses: {
        variableId: string;
        value: string;
        status: string;
        code?: number | null;
        score?: number | null;
        codedStatus?: string;
      }[];
    }[];
    total: number;
  }> {
    return this.query.findUnitsByName(workspaceId, unitName, options);
  }

  async findBookletsByName(
    workspaceId: number,
    bookletName: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<{
    data: {
      bookletId: number;
      bookletName: string;
      personId: number;
      personLogin: string;
      personCode: string;
      personGroup: string;
      units: {
        unitId: number;
        unitName: string;
        unitAlias: string | null;
      }[];
    }[];
    total: number;
  }> {
    return this.query.findBookletsByName(workspaceId, bookletName, options);
  }

  async exportTestResults(
    workspaceId: number,
    res: Response,
    filters?: TestResultsExportFilters
  ): Promise<void> {
    return this.exporter.exportTestResults(workspaceId, res, filters);
  }

  async exportTestResultsToFile(
    workspaceId: number,
    filePath: string,
    filters?: TestResultsExportFilters,
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    return this.exporter.exportTestResultsToFile(workspaceId, filePath, filters, progressCallback);
  }

  async exportTestResultsToStream(
    workspaceId: number,
    stream: Writable,
    filters?: TestResultsExportFilters,
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    return this.exporter.exportTestResultsToStream(workspaceId, stream, filters, progressCallback);
  }

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
    return this.exporter.exportTestLogsToFile(workspaceId, filePath, filters, progressCallback);
  }

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
    return this.exporter.exportTestLogsToStream(workspaceId, stream, filters, progressCallback);
  }

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
    return this.exporter.getExportOptions(workspaceId);
  }

  async hasGeogebraResponses(workspaceId: number): Promise<boolean> {
    return this.exporter.hasGeogebraResponses(workspaceId);
  }
}
