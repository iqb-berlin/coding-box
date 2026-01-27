import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CodingFileCacheService } from './coding-file-cache.service';

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
    private readonly fileCacheService: CodingFileCacheService
  ) {}

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
   * Get responses in batches for streaming operations.
   * Uses cursor-based pagination for memory efficiency.
   */
  async getResponsesBatch(
    workspaceId: number,
    lastId: number,
    batchSize: number,
    options: ResponseFilterOptions = {}
  ): Promise<ResponseEntity[]> {
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
      queryBuilder.where(`response.status_${version} IS NOT NULL`);
    } else {
      queryBuilder.where('response.status_v1 = :status', {
        status: statusStringToNumber(status)
      });
    }

    // Add filters
    queryBuilder
      .andWhere('person.workspace_id = :workspace_id', { workspace_id: workspaceId })
      .andWhere('response.id > :lastId', { lastId });

    if (considerOnly) {
      queryBuilder.andWhere('person.consider = :consider', { consider: true });
    }

    queryBuilder
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
    return !/image|text|audio|frame|video|_0/i.test(variableId);
  }
}
