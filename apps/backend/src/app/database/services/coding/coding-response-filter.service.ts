import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import {
  statusStringToNumber,
  STATISTICS_IGNORED_STATUSES
} from '../../utils/response-status-converter';
import { getEffectiveCodingStatusExpression } from '../../utils/effective-coding-status-expression.util';
import { CodingFileCacheService } from './coding-file-cache.service';
// eslint-disable-next-line import/no-cycle
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
// eslint-disable-next-line import/no-cycle
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES } from '../../utils/manual-coding-candidate.util';
import { isCodingResponseCandidateByPattern } from './coding-response-candidate.util';

export interface ResponseFilterOptions {
  status?: string;
  statuses?: number[];
  version?: 'v1' | 'v2' | 'v3';
  considerOnly?: boolean;
  validCodingVariablesOnly?: boolean;
  givenResponsesOnly?: boolean;
  manualCodingCandidatesOnly?: boolean;
}

/**
 * Service responsible for filtering and validating responses for coding eligibility.
 *
 * Filters out:
 * - Media variables (image, text, audio, frame, video)
 * - Derived variables (ending with _0)
 * - Variables excluded by VOCS files (sourceType === 'BASE_NO_VALUE')
 * - Empty or null values
 */
@Injectable()
export class CodingResponseFilterService {
  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly fileCacheService: CodingFileCacheService,
    private readonly workspaceCoreService: WorkspaceCoreService,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    @Inject(forwardRef(() => WorkspaceFilesService))
    private readonly workspaceFilesService: WorkspaceFilesService
  ) { }

  /**
   * Get filtered responses for a workspace with CODING_INCOMPLETE status.
   * Includes all necessary relations (unit, booklet, person, bookletinfo).
   */
  async getFilteredResponses(
    workspaceId: number,
    options: ResponseFilterOptions = {}
  ): Promise<ResponseEntity[]> {
    const status = options.status || 'CODING_INCOMPLETE';
    const considerOnly = options.considerOnly !== false;

    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber(status)
      })
      .andWhere('person.workspace_id = :workspace_id', { workspace_id: workspaceId });

    if (considerOnly) {
      queryBuilder.andWhere('person.consider = :consider', { consider: true });
    }

    queryBuilder.orderBy('response.id', 'ASC');

    const { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits } = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyResolvedExclusionsToQuery(queryBuilder, { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits });

    const responses = await queryBuilder.getMany();

    // Filter out excluded responses
    const filtered: ResponseEntity[] = [];
    for (const response of responses) {
      if (await this.shouldIncludeResponse(response, workspaceId)) {
        filtered.push(response);
      }
    }

    return filtered;
  }

  /**
   * Count total responses matching filter for progress calculation.
   */
  async countResponses(
    workspaceId: number,
    options: ResponseFilterOptions = {}
  ): Promise<number> {
    const queryBuilder = await this.createBatchQueryBuilder(workspaceId, options);
    return queryBuilder.getCount();
  }

  private async createBatchQueryBuilder(
    workspaceId: number,
    options: ResponseFilterOptions
  ) {
    const status = options.status || 'CODING_INCOMPLETE';
    const considerOnly = options.considerOnly !== false;
    const version = options.version;

    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo');

    // Establish base conditions
    if (version) {
      const effectiveStatusExpression = getEffectiveCodingStatusExpression(version);
      queryBuilder.where(`${effectiveStatusExpression} IS NOT NULL`)
        .andWhere(
          `${effectiveStatusExpression} NOT IN (:...statisticsIgnoredStatuses)`,
          { statisticsIgnoredStatuses: STATISTICS_IGNORED_STATUSES }
        );
    } else if (options.manualCodingCandidatesOnly) {
      queryBuilder.where('response.status_v1 IN (:...statuses)', {
        statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
      });
    } else if (options.statuses?.length) {
      queryBuilder.where('response.status_v1 IN (:...statuses)', {
        statuses: options.statuses
      });
    } else {
      queryBuilder.where('response.status_v1 = :status', {
        status: statusStringToNumber(status)
      });
    }

    // Add filters
    queryBuilder
      .andWhere('person.workspace_id = :workspace_id', { workspace_id: workspaceId });

    if (considerOnly) {
      queryBuilder.andWhere('person.consider = :consider', { consider: true });
    }

    if (options.givenResponsesOnly) {
      const givenStatuses = [
        statusStringToNumber('NOT_REACHED') || 1,
        statusStringToNumber('DISPLAYED') || 2,
        statusStringToNumber('VALUE_CHANGED') || 3
      ];
      queryBuilder.andWhere('response.status IN (:...givenStatuses)', { givenStatuses });
    }

    const { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits } = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyResolvedExclusionsToQuery(queryBuilder, { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits });

    if (options.validCodingVariablesOnly) {
      const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspaceId);
      const validVariablePairKeys = Array.from(unitVariableMap.entries()).flatMap(([unitName, variableIds]) => (
        Array.from(variableIds).map(variableId => this.toVariablePairKey(unitName, variableId))
      ));

      if (validVariablePairKeys.length === 0) {
        queryBuilder.andWhere('1 = 0');
      } else {
        queryBuilder.andWhere(
          'CONCAT(unit.name, CHR(31), response.variableid) IN (:...validVariablePairKeys)',
          { validVariablePairKeys }
        );
      }
    }

    return queryBuilder;
  }

  private toVariablePairKey(unitName: string, variableId: string): string {
    return `${unitName}\u001F${variableId}`;
  }

  /**
   * Get responses in batches for streaming operations.
   * Uses cursor-based pagination for memory efficiency.
   */
  async getResponsesBatch(
    workspaceId: number,
    lastId: number,
    batchSize: number,
    options: ResponseFilterOptions = {}
  ): Promise<ResponseEntity[]> {
    const queryBuilder = await this.createBatchQueryBuilder(workspaceId, options);

    queryBuilder
      .andWhere('response.id > :lastId', { lastId })
      .orderBy('response.id', 'ASC')
      .take(batchSize);

    return queryBuilder.getMany();
  }

  /**
   * Determine if a response should be included in coding lists.
   * Filters based on:
   * - Variable ID patterns (media types, derived variables)
   * - VOCS exclusions
   * - Empty values
   */
  async shouldIncludeResponse(
    response: ResponseEntity,
    workspaceId: number
  ): Promise<boolean> {
    const unitKey = response.unit?.name || '';
    const variableId = response.variableid || '';

    if (!isCodingResponseCandidateByPattern(variableId, response.value)) {
      return false;
    }

    // Check VOCS exclusions
    const exclusions = await this.fileCacheService.loadVocsExclusions(
      unitKey,
      workspaceId
    );
    return !exclusions.has(`${unitKey}||${variableId}`);
  }

  /**
   * Check if a response should be included based on variable ID pattern only.
   * Does not check VOCS exclusions or load files.
   */
  shouldIncludeByPattern(variableId: string, value: string | null): boolean {
    return isCodingResponseCandidateByPattern(variableId, value);
  }
}
