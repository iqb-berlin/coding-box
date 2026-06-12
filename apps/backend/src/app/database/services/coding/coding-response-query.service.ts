import {
  Inject, Injectable, Logger, forwardRef
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  STATISTICS_IGNORED_STATUSES,
  statusStringToNumber
} from '../../utils/response-status-converter';
import {
  CodingVersion,
  getEffectiveCodingStatusExpression
} from '../../utils/effective-coding-status-expression.util';
import { ResponseEntity } from '../../entities/response.entity';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
// eslint-disable-next-line import/no-cycle
import { WorkspaceFilesService } from '../workspace/workspace-files.service';

export type CodingResponseSortBy =
  'unitname' |
  'variableid' |
  'value' |
  'codedstatus' |
  'code' |
  'score' |
  'person_code' |
  'person_login' |
  'person_group' |
  'booklet_id';
export type CodingResponseSortDirection = 'asc' | 'desc';
const EFFECTIVE_CODING_STATUS_SORT_ALIAS = 'effective_coding_status_sort';

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
    private workspaceExclusionService: WorkspaceExclusionService,
    @Inject(forwardRef(() => WorkspaceFilesService))
    private readonly workspaceFilesService: WorkspaceFilesService
  ) { }

  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    page: number = 1,
    limit: number = 100,
    sortBy?: CodingResponseSortBy,
    sortDirection?: CodingResponseSortDirection
  ): Promise<{
      data: ResponseEntity[];
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      const codingVersion = this.normalizeCodingVersion(version);
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
      if (STATISTICS_IGNORED_STATUSES.includes(statusNumber)) {
        this.logger.warn(`Ignored statistics status requested: ${status}`);
        return {
          data: [],
          total: 0,
          page,
          limit
        };
      }

      const offset = (page - 1) * limit;
      const validVariablePairKeys = await this.getValidVariablePairKeys(workspaceId);
      if (validVariablePairKeys.length === 0) {
        return {
          data: [],
          total: 0,
          page,
          limit
        };
      }

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
        `${getEffectiveCodingStatusExpression(codingVersion)} = :status`,
        { status: statusNumber }
      );
      queryBuilder.andWhere(
        'CONCAT(unit.name, CHR(31), response.variableid) IN (:...validVariablePairKeys)',
        { validVariablePairKeys }
      );

      const total = await queryBuilder.getCount();
      this.applySorting(queryBuilder, codingVersion, sortBy, sortDirection);
      const data = await queryBuilder
        .skip(offset)
        .take(limit)
        .getMany();

      this.logger.log(
        `Retrieved ${data.length} responses with status ${status} for version ${codingVersion} in workspace ${workspaceId}`
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

  private async getValidVariablePairKeys(workspaceId: number): Promise<string[]> {
    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspaceId);
    return Array.from(unitVariableMap.entries()).flatMap(([unitName, variableIds]) => (
      Array.from(variableIds).map(variableId => this.toVariablePairKey(unitName, variableId))
    ));
  }

  private toVariablePairKey(unitName: string, variableId: string): string {
    return `${unitName}\u001F${variableId}`;
  }

  private applySorting(
    queryBuilder: SelectQueryBuilder<ResponseEntity>,
    version: CodingVersion,
    sortBy?: CodingResponseSortBy,
    sortDirection?: CodingResponseSortDirection
  ): void {
    const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
    if (sortBy === 'codedstatus') {
      queryBuilder.addSelect(
        getEffectiveCodingStatusExpression(version),
        EFFECTIVE_CODING_STATUS_SORT_ALIAS
      );
      queryBuilder
        .orderBy(EFFECTIVE_CODING_STATUS_SORT_ALIAS, direction)
        .addOrderBy('response.id', 'ASC');
      return;
    }

    const sortExpression = this.getSortExpression(version, sortBy);

    queryBuilder.orderBy(sortExpression, direction);
    if (sortExpression !== 'response.id') {
      queryBuilder.addOrderBy('response.id', 'ASC');
    }
  }

  private getSortExpression(
    version: CodingVersion,
    sortBy?: CodingResponseSortBy
  ): string {
    switch (sortBy) {
      case 'unitname':
        return 'unit.name';
      case 'variableid':
        return 'response.variableid';
      case 'value':
        return 'response.value';
      case 'code':
        return `response.code_${version}`;
      case 'score':
        return `response.score_${version}`;
      case 'person_code':
        return 'person.code';
      case 'person_login':
        return 'person.login';
      case 'person_group':
        return 'person.group';
      case 'booklet_id':
        return 'bookletinfo.name';
      default:
        return 'response.id';
    }
  }

  private normalizeCodingVersion(version: unknown): CodingVersion {
    return version === 'v2' || version === 'v3' ? version : 'v1';
  }

  async getManualTestPersons(
    workspaceId: number,
    personIds?: string,
    codedStatus?: string
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
        .andWhere('person.consider = :consider', { consider: true });

      if (codedStatus) {
        const statusNumber = statusStringToNumber(codedStatus);
        if (statusNumber === null) {
          this.logger.warn(`Invalid manual coding status filter: ${codedStatus}`);
          return [];
        }

        queryBuilder.andWhere('response.status_v1 = :codedStatus', {
          codedStatus: statusNumber
        });
      } else {
        queryBuilder.andWhere('response.status_v1 IN (:...statuses)', {
          statuses: [
            statusStringToNumber('CODING_INCOMPLETE'),
            statusStringToNumber('INTENDED_INCOMPLETE'),
            statusStringToNumber('CODE_SELECTION_PENDING'),
            statusStringToNumber('CODING_ERROR')
          ]
        });
      }

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
}
