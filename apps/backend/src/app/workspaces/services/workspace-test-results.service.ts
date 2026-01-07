import {
  Injectable
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Response } from 'express';
import { Writable } from 'stream';
import {
  Persons, ResponseEntity, Unit
} from '../../common';
import { Booklet } from '../entities/booklet.entity';
import { UnitTagService } from './unit-tag.service';
import { JournalService } from './journal.service';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceFilesService } from './workspace-files.service';
import {
  SearchResponseItem,
  BookletSearchItem,
  UnitSearchItem
} from './workspace-test-results-query.service';
import { WorkspaceTestResultsFacade } from './workspace-test-results-facade.service';

/**
 * WorkspaceTestResultsService
 *
 * LEGACY SERVICE - Being gradually migrated to use WorkspaceTestResultsFacade
 *
 * This service is being refactored. Methods are being delegated to specialized services:
 * - WorkspaceTestResultsOverviewService: Statistics and overview
 * - WorkspaceTestResultsQueryService: Data querying
 * - DuplicateResponseService: Duplicate resolution
 * - FlatResponseService: Complex flat response queries
 * - ResponseExportService: Export functionality
 *
 * New code should use WorkspaceTestResultsFacade directly.
 */
@Injectable()
export class WorkspaceTestResultsService {
  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    private readonly unitTagService: UnitTagService,
    private readonly journalService: JournalService,
    private readonly cacheService: CacheService,
    private readonly workspaceFilesService: WorkspaceFilesService,
    // Facade for delegating to refactored services
    private readonly facade: WorkspaceTestResultsFacade
  ) {}

  /**
   * Get workspace test results overview
   * DELEGATED to WorkspaceTestResultsOverviewService via facade
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
    return this.facade.getWorkspaceTestResultsOverview(workspaceId);
  }

  /**
   * Find comprehensive test results for a specific person
   * DELEGATED to WorkspaceTestResultsQueryService via facade
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
    return this.facade.findPersonTestResults(personId, workspaceId);
  }

  /**
   * Find paginated test results (persons) for a workspace
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async findTestResults(
    workspace_id: number,
    options: { page: number; limit: number; searchText?: string }
  ): Promise<[Persons[], number]> {
    return this.facade.findTestResults(workspace_id, options);
  }

  /**
   * Find workspace responses with optional pagination
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async findWorkspaceResponses(
    workspace_id: number,
    options?: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    return this.facade.findWorkspaceResponses(workspace_id, options);
  }

  /**
   * Find a specific unit response for a person and booklet
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
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
    return this.facade.findUnitResponse(workspaceId, connector, unitId);
  }

  /**
   * Find unit logs for a specific unit
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async findUnitLogs(
    workspaceId: number,
    unitId: number
  ): Promise<{ id: number; unitid: number; ts: string; key: string; parameter: string }[]> {
    return this.facade.findUnitLogs(workspaceId, unitId);
  }

  /**
   * Find booklet logs, sessions, and unit logs for a booklet containing the given unit
   * DELEGATED to WorkspaceTestResultsQueryService via facade
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
    return this.facade.findBookletLogsByUnitId(workspaceId, unitId);
  }

  /**
   * Get responses by status with pagination
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    options: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    return this.facade.getResponsesByStatus(workspaceId, status, options);
  }

  /**
   * Search responses by value, unit, or variable
   * DELEGATED to WorkspaceTestResultsQueryService via facade
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
    return this.facade.searchResponses(workspaceId, criteria, pagination);
  }

  /**
   * Find booklets by name with pagination
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async findBookletsByName(
    workspaceId: number,
    bookletName: string,
    options: { page?: number; limit?: number }
  ): Promise<{ data: BookletSearchItem[]; total: number; page: number; limit: number }> {
    return this.facade.findBookletsByName(workspaceId, bookletName, options);
  }

  /**
   * Find units by name with pagination
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async findUnitsByName(
    workspaceId: number,
    unitName: string,
    options: { page?: number; limit?: number }
  ): Promise<{ data: UnitSearchItem[]; total: number; page: number; limit: number }> {
    return this.facade.findUnitsByName(workspaceId, unitName, options);
  }

  /**
   * Delete a single response
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async deleteResponse(
    workspaceId: number,
    responseId: number,
    userId: string
  ): Promise<{ success: boolean; report: { deletedResponse: number | null; warnings: string[] } }> {
    return this.facade.deleteResponse(workspaceId, responseId, userId);
  }

  /**
   * Delete a booklet and all its associated units and responses
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async deleteBooklet(
    workspaceId: number,
    bookletId: number,
    userId: string
  ): Promise<{ success: boolean; report: { deletedBooklet: number | null; warnings: string[] } }> {
    return this.facade.deleteBooklet(workspaceId, bookletId, userId);
  }

  /**
   * Delete multiple test persons
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async deleteTestPersons(
    workspaceId: number,
    testPersonIds: string,
    userId: string
  ): Promise<{ success: boolean; report: { deletedPersons: string[]; warnings: string[] } }> {
    return this.facade.deleteTestPersons(workspaceId, testPersonIds, userId);
  }

  /**
   * Delete a single unit
   * DELEGATED to WorkspaceTestResultsQueryService via facade
   */
  async deleteUnit(
    workspaceId: number,
    unitId: number,
    userId: string
  ): Promise<{ success: boolean; report: { deletedUnit: number | null; warnings: string[] } }> {
    return this.facade.deleteUnit(workspaceId, unitId, userId);
  }

  /**
   * Resolve duplicate responses
   * DELEGATED to DuplicateResponseService via facade
   */
  async resolveDuplicateResponses(
    workspaceId: number,
    resolutionMap: Record<string, number>,
    userId: string
  ): Promise<{ resolvedCount: number; success: boolean }> {
    return this.facade.resolveDuplicateResponses(workspaceId, resolutionMap, userId);
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
    return this.facade.findFlatResponses(workspaceId, options);
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
    return this.facade.findFlatResponseFrequencies(workspaceId, combos);
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
    return this.facade.findFlatResponseFilterOptions(workspaceId, options);
  }

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
    return this.facade.exportTestResults(workspaceId, res, filters);
  }

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
    return this.facade.exportTestResultsToFile(
      workspaceId,
      filePath,
      filters,
      progressCallback
    );
  }

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
    return this.facade.exportTestResultsToStream(
      workspaceId,
      stream,
      filters,
      progressCallback
    );
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
    return this.facade.exportTestLogsToFile(
      workspaceId,
      filePath,
      filters,
      progressCallback
    );
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
    return this.facade.exportTestLogsToStream(
      workspaceId,
      stream,
      filters,
      progressCallback
    );
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
    return this.facade.getExportOptions(workspaceId);
  }
}
