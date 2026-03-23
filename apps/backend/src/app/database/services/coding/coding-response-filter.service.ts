import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { statusStringToNumber, EXCLUDED_STATUSES } from '../../utils/response-status-converter';
import { CodingFileCacheService } from './coding-file-cache.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

export interface ResponseFilterOptions {
  status?: string;
  version?: 'v1' | 'v2' | 'v3';
  considerOnly?: boolean;
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
    private readonly workspaceExclusionService: WorkspaceExclusionService
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

    if (globalIgnoredUnits.length > 0) {
      queryBuilder.andWhere('unit.name NOT IN (:...ignoredUnits)', { ignoredUnits: globalIgnoredUnits });
    }
    if (ignoredBooklets.length > 0) {
      queryBuilder.andWhere('bookletinfo.name NOT IN (:...ignoredBooklets)', { ignoredBooklets });
    }
    if (testletIgnoredUnits.length > 0) {
      const condition = testletIgnoredUnits.map((_, i) => `(bookletinfo.name = :bId${i} AND unit.name = :uId${i})`).join(' OR ');
      const params: Record<string, string> = {};
      testletIgnoredUnits.forEach((t, i) => {
        params[`bId${i}`] = t.bookletId;
        params[`uId${i}`] = t.unitId;
      });
      queryBuilder.andWhere(`NOT (${condition})`, params);
    }

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
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo');

    // Establish base conditions
    if (version) {
      queryBuilder.where(`response.status_${version} IS NOT NULL`)
        .andWhere(`response.status_${version} NOT IN (:...excludedStatuses)`, { excludedStatuses: EXCLUDED_STATUSES });
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

    const { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits } = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    if (globalIgnoredUnits.length > 0) {
      queryBuilder.andWhere('unit.name NOT IN (:...ignoredUnits)', { ignoredUnits: globalIgnoredUnits });
    }
    if (ignoredBooklets.length > 0) {
      queryBuilder.andWhere('bookletinfo.name NOT IN (:...ignoredBooklets)', { ignoredBooklets });
    }
    if (testletIgnoredUnits.length > 0) {
      const condition = testletIgnoredUnits.map((_, i) => `(bookletinfo.name = :bId${i} AND unit.name = :uId${i})`).join(' OR ');
      const params: Record<string, string> = {};
      testletIgnoredUnits.forEach((t, i) => {
        params[`bId${i}`] = t.bookletId;
        params[`uId${i}`] = t.unitId;
      });
      queryBuilder.andWhere(`NOT (${condition})`, params);
    }

    return queryBuilder;
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

    // Add selections for relations needed in result
    // Note: relations joined in createBatchQueryBuilder need to be selected if we want them.
    // createBatchQueryBuilder uses leftJoin.
    // getMany needs selections.

    // Re-apply joins with selection? Or just addSelect?
    // addSelect needs alias.
    queryBuilder
      .addSelect(['unit', 'booklet', 'person'])
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo');

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

    // Check if value is empty
    const hasValue = response.value != null && response.value.trim() !== '';
    if (!hasValue) {
      return false;
    }

    // Check for excluded variable patterns
    // eslint-disable-next-line
    if (/image|text|audio|frame|video|_0/i.test(variableId)) {
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
    // Check if value is empty
    const hasValue = value != null && value.trim() !== '';
    if (!hasValue) {
      return false;
    }

    // Check for excluded variable patterns
    // eslint-disable-next-line
    return !/image|text|audio|frame|video|_0/i.test(variableId);
  }
}
