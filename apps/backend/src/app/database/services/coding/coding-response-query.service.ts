import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { ResponseEntity } from '../../entities/response.entity';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';

@Injectable()
export class CodingResponseQueryService {
  private readonly logger = new Logger(CodingResponseQueryService.name);
  private readonly codingResponseStatuses = [
    statusStringToNumber('NOT_REACHED') || 1,
    statusStringToNumber('DISPLAYED') || 2,
    statusStringToNumber('VALUE_CHANGED') || 3
  ];

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private workspaceExclusionService: WorkspaceExclusionService
  ) { }

  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    page: number = 1,
    limit: number = 100
  ): Promise<{
      data: ResponseEntity[];
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      const statusNumber = statusStringToNumber(status);
      if (statusNumber === null) {
        this.logger.warn(`Invalid status string: ${status}`);
        return {
          data: [],
          total: 0,
          page,
          limit
        };
      }

      const offset = (page - 1) * limit;

      const queryBuilder = this.responseRepository
        .createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.status IN (:...codingResponseStatuses)', {
          codingResponseStatuses: this.codingResponseStatuses
        })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      applyResolvedExclusionsToQuery(queryBuilder, exclusions);

      queryBuilder.andWhere(
        `${this.getEffectiveCodingStatusExpression(version)} = :status`,
        { status: statusNumber }
      );

      const total = await queryBuilder.getCount();
      const data = await queryBuilder
        .orderBy('response.id', 'ASC')
        .skip(offset)
        .take(limit)
        .getMany();

      this.logger.log(
        `Retrieved ${data.length} responses with status ${status} for version ${version} in workspace ${workspaceId}`
      );

      return {
        data,
        total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(
        `Error getting responses by status: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not retrieve responses. Please check the database connection or query.'
      );
    }
  }

  async getManualTestPersons(
    workspaceId: number,
    personIds?: string
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    this.logger.log(
      `Fetching responses for workspaceId = ${workspaceId} ${personIds ? `and personIds = ${personIds}` : ''
      }.`
    );

    try {
      const queryBuilder = this.responseRepository
        .createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v1 IN (:...statuses)', {
          statuses: [
            statusStringToNumber('CODING_INCOMPLETE'),
            statusStringToNumber('INTENDED_INCOMPLETE'),
            statusStringToNumber('CODE_SELECTION_PENDING'),
            statusStringToNumber('CODING_ERROR')
          ]
        });

      if (personIds) {
        const personIdsArray = personIds.split(',').map(id => id.trim()).filter(Boolean);
        if (!personIdsArray.length) {
          return [];
        }
        queryBuilder.andWhere('person.id IN (:...personIdsArray)', { personIdsArray });
      }

      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      applyResolvedExclusionsToQuery(queryBuilder, exclusions);

      const responses = await queryBuilder.getMany();

      const enrichedResponses = responses.map(response => ({
        ...response,
        unitname: response.unit?.name || 'Unknown Unit'
      }));

      this.logger.log(
        `Fetched ${responses.length} responses for the given criteria in workspace_id = ${workspaceId}.`
      );

      return enrichedResponses;
    } catch (error) {
      this.logger.error(
        `Failed to fetch responses: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not retrieve responses. Please check the database connection or query.'
      );
    }
  }

  private getEffectiveCodingStatusExpression(version: 'v1' | 'v2' | 'v3' = 'v1'): string {
    if (version === 'v2') {
      return 'COALESCE(response.status_v2, response.status_v1)';
    }

    if (version === 'v3') {
      return "COALESCE(CASE WHEN response.status_v3 ~ '^-?[0-9]+$' THEN response.status_v3::smallint ELSE NULL END, response.status_v2, response.status_v1)";
    }

    return 'response.status_v1';
  }
}
