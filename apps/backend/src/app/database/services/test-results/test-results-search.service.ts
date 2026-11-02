import {
  Inject,
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  QueryRunner,
  Repository,
  SelectQueryBuilder
} from 'typeorm';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import {
  assertValidRegexSearchPattern,
  toRegexSearchException,
  withRegexSearchStatementTimeout
} from '../../../utils/regex-search.util';
import { ResponseEntity } from '../../entities/response.entity';
import {
  CodingVersion,
  getEffectiveCodingStatusExpression
} from '../../utils/effective-coding-status-expression.util';
import {
  STATISTICS_IGNORED_STATUSES,
  statusNumberToString,
  statusStringToNumber
} from '../../utils/response-status-converter';
import { CodingListService } from '../coding/coding-list.service';
import {
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import {
  applyExclusionsToQuery, createGeoGebraValueCondition, excludeAutocoderGeneratedResponses, parseQuotedExactSearchFilter
} from './test-results.util';
import {
  EFFECTIVE_CODING_STATUS_OUTPUT_ALIAS, EFFECTIVE_CODING_STATUS_SORT_ALIAS, ResponseSearchSortBy, ResponseSearchSortDirection
} from './workspace-test-results.types';

@Injectable()
export class TestResultsSearchService {
  private readonly logger = new Logger('WorkspaceTestResultsService');
  private static readonly codingResponseStatuses = [
    statusStringToNumber('NOT_REACHED') || 1,
    statusStringToNumber('DISPLAYED') || 2,
    statusStringToNumber('VALUE_CHANGED') || 3
  ];

  private static readonly ignoredDerivedCodingStatuses = STATISTICS_IGNORED_STATUSES;

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    @Inject(CodingListService)
    private readonly codingListService: CodingListService,
    @Inject(WorkspaceExclusionService)
    private readonly workspaceExclusionService: WorkspaceExclusionService
  ) {}

  async getResponsesByStatus(
    workspace_id: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    options?: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    this.logger.log(
      `Getting responses with status ${status} for workspace ${workspace_id} (version: ${version})`
    );

    try {
      const effectiveStatusExpression = getEffectiveCodingStatusExpression(version);
      const queryBuilder = this.responseRepository
        .createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.status IN (:...codingResponseStatuses)', {
          codingResponseStatuses: TestResultsSearchService.codingResponseStatuses
        })
        .andWhere('person.workspace_id = :workspace_id_param', {
          workspace_id_param: workspace_id
        })
        .andWhere('person.consider = :consider', { consider: true })
        .orderBy('response.id', 'ASC');
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspace_id);
      applyExclusionsToQuery(queryBuilder, exclusions);

      if (status === 'null') {
        return [[], 0];
      }

      const statusNumber = statusStringToNumber(status);
      if (
        statusNumber === null ||
        TestResultsSearchService.ignoredDerivedCodingStatuses.includes(statusNumber)
      ) {
        this.logger.warn(`Invalid or ignored coding status filter: ${status}`);
        return [[], 0];
      }

      queryBuilder.andWhere(`${effectiveStatusExpression} = :statusParam`, {
        statusParam: statusNumber
      });
      await this.applyValidCodingVariableFilter(queryBuilder, workspace_id);

      let result: [ResponseEntity[], number];

      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page);
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

        queryBuilder.skip((validPage - 1) * validLimit).take(validLimit);

        result = await queryBuilder.getManyAndCount();
        this.logger.log(
          `Found ${result[0].length} responses with status ${status} (page ${validPage}, limit ${validLimit}, total ${result[1]}) for workspace ${workspace_id}`
        );
      } else {
        result = await queryBuilder.getManyAndCount();
        this.logger.log(
          `Found ${result[0].length} responses with status ${status} for workspace ${workspace_id}`
        );
      }

      return result;
    } catch (error) {
      this.logger.error(`Error getting responses by status: ${getErrorMessage(error)}`);
      return [[], 0];
    }
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
    if (!workspaceId) {
      throw new Error('workspaceId is required.');
    }

    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;
    const version = this.normalizeCodingVersion(searchParams.version);

    this.logger.log(`Searching for responses in workspace ${workspaceId}`);

    try {
      this.logger.log(
        `Searching for responses in workspace: ${workspaceId} with params: ${JSON.stringify(
          searchParams
        )} (page: ${page}, limit: ${limit})`
      );

      const runSearch = async (
        queryRunner?: QueryRunner
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
      }> => {
        const query = this.responseRepository
          .createQueryBuilder('response', queryRunner)
          .innerJoinAndSelect('response.unit', 'unit')
          .innerJoinAndSelect('unit.booklet', 'booklet')
          .innerJoinAndSelect('booklet.person', 'person')
          .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true });

        const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
        applyExclusionsToQuery(query, exclusions);

        if (searchParams.value) {
          query.andWhere('response.value ILIKE :value', {
            value: `%${searchParams.value}%`
          });
        }

        if (searchParams.variableId) {
          const variableIdFilter = parseQuotedExactSearchFilter(searchParams.variableId);
          if (searchParams.regexSearch) {
            const variableIdRegex = assertValidRegexSearchPattern(searchParams.variableId, 'variableId');
            if (variableIdRegex) {
              query.andWhere('response.variableid ~ :variableIdRegex', { variableIdRegex });
            }
          } else if (variableIdFilter.exact) {
            query.andWhere('LOWER(response.variableid) = LOWER(:variableId)', {
              variableId: variableIdFilter.value
            });
          } else {
            query.andWhere('response.variableid ILIKE :variableId', {
              variableId: `%${variableIdFilter.value}%`
            });
          }
        }

        if (searchParams.unitName) {
          if (searchParams.regexSearch) {
            const unitNameRegex = assertValidRegexSearchPattern(searchParams.unitName, 'unitName');
            if (unitNameRegex) {
              query.andWhere('unit.name ~ :unitNameRegex', { unitNameRegex });
            }
          } else {
            query.andWhere('unit.name ILIKE :unitName', {
              unitName: `%${searchParams.unitName}%`
            });
          }
        }

        if (searchParams.bookletName) {
          if (searchParams.regexSearch) {
            const bookletNameRegex = assertValidRegexSearchPattern(searchParams.bookletName, 'bookletName');
            if (bookletNameRegex) {
              query.andWhere('bookletinfo.name ~ :bookletNameRegex', { bookletNameRegex });
            }
          } else {
            query.andWhere('bookletinfo.name ILIKE :bookletName', {
              bookletName: `%${searchParams.bookletName}%`
            });
          }
        }

        if (searchParams.status) {
          query.andWhere('response.status = :status', {
            status: searchParams.status
          });
        }

        if (searchParams.codedStatus) {
          const codedStatusNumber = statusStringToNumber(searchParams.codedStatus);
          if (codedStatusNumber === null) {
            query.andWhere('1=0');
          } else {
            const effectiveStatusExpression = getEffectiveCodingStatusExpression(version);
            query.andWhere(`${effectiveStatusExpression} = :codedStatus`, {
              codedStatus: codedStatusNumber
            });
          }
        }

        if (searchParams.group) {
          if (searchParams.regexSearch) {
            const groupRegex = assertValidRegexSearchPattern(searchParams.group, 'group');
            if (groupRegex) {
              query.andWhere('person.group ~ :groupRegex', { groupRegex });
            }
          } else {
            query.andWhere('person.group = :group', { group: searchParams.group });
          }
        }

        if (searchParams.code) {
          if (searchParams.regexSearch) {
            const codeRegex = assertValidRegexSearchPattern(searchParams.code, 'code');
            if (codeRegex) {
              query.andWhere('person.code ~ :codeRegex', { codeRegex });
            }
          } else {
            query.andWhere('person.code = :code', { code: searchParams.code });
          }
        }

        if (searchParams.codingCode) {
          const codingCodeFilter = searchParams.codingCode.trim();
          const codingCode = Number(codingCodeFilter);
          if (codingCodeFilter !== '' && Number.isInteger(codingCode)) {
            query.andWhere(`response.code_${version} = :codingCode`, { codingCode });
          } else {
            query.andWhere('1=0');
          }
        }

        if (searchParams.score) {
          const scoreFilter = searchParams.score.trim();
          const score = Number(scoreFilter);
          if (scoreFilter !== '' && Number.isInteger(score)) {
            query.andWhere(`response.score_${version} = :score`, { score });
          } else {
            query.andWhere('1=0');
          }
        }

        if (searchParams.personLogin) {
          if (searchParams.regexSearch) {
            const personLoginRegex = assertValidRegexSearchPattern(searchParams.personLogin, 'personLogin');
            if (personLoginRegex) {
              query.andWhere('person.login ~ :personLoginRegex', { personLoginRegex });
            }
          } else {
            query.andWhere('person.login ILIKE :personLogin', {
              personLogin: `%${searchParams.personLogin}%`
            });
          }
        }

        if (searchParams.geogebra) {
          query.andWhere(
            createGeoGebraValueCondition('response')
          );
        }

        const requestedResponseSource = searchParams.derivedOnly ? 'derived' : searchParams.responseSource || 'base';
        const responseSource = searchParams.geogebra && requestedResponseSource === 'all' ?
          'base' :
          requestedResponseSource;

        if (responseSource === 'derived') {
          const effectiveStatusExpression = getEffectiveCodingStatusExpression(version);
          query.andWhere('response.is_autocoder_generated = :derivedOnly', {
            derivedOnly: true
          });
          query.andWhere(`${effectiveStatusExpression} IS NOT NULL`);
          query.andWhere(`${effectiveStatusExpression} NOT IN (:...ignoredDerivedCodingStatuses)`, {
            ignoredDerivedCodingStatuses: TestResultsSearchService.ignoredDerivedCodingStatuses
          });
          await this.applyValidCodingVariableFilter(query, workspaceId);
        } else if (responseSource === 'all') {
          const effectiveStatusExpression = getEffectiveCodingStatusExpression(version);
          query.andWhere(`${effectiveStatusExpression} IS NOT NULL`);
          query.andWhere(`${effectiveStatusExpression} NOT IN (:...ignoredDerivedCodingStatuses)`, {
            ignoredDerivedCodingStatuses: TestResultsSearchService.ignoredDerivedCodingStatuses
          });
          await this.applyValidCodingVariableFilter(query, workspaceId);
        } else {
          excludeAutocoderGeneratedResponses(query);
        }

        const total = await query.getCount();
        this.applyResponseSearchSorting(
          query,
          version,
          searchParams.geogebra === true,
          options.sortBy,
          options.sortDirection
        );

        if (total === 0) {
          this.logger.log(
            `No responses found matching the criteria in workspace: ${workspaceId}`
          );
          return { data: [], total: 0 };
        }

        query.skip(skip).take(limit);

        query.addSelect(
          getEffectiveCodingStatusExpression(version),
          EFFECTIVE_CODING_STATUS_OUTPUT_ALIAS
        );
        const { entities: responses, raw: rawResponses } =
          await query.getRawAndEntities();

        this.logger.log(
          `Found ${total} responses matching the criteria in workspace: ${workspaceId}, returning ${responses.length} for page ${page}`
        );

        // Pre-load variable page maps for all unique units
        const uniqueUnitNames = [...new Set(responses.map(r => r.unit.name))];
        const variablePageMaps = new Map<string, Map<string, string>>();
        for (const unitName of uniqueUnitNames) {
          const pageMap = await this.codingListService.getVariablePageMap(
            unitName,
            workspaceId
          );
          variablePageMaps.set(unitName, pageMap);
        }

        const data = responses.map((response, responseIndex) => {
          const code = response[
            `code_${version}` as keyof ResponseEntity
          ] as number;
          const score = response[
            `score_${version}` as keyof ResponseEntity
          ] as number;
          const rawEffectiveCodingStatus = rawResponses[responseIndex]?.[
            EFFECTIVE_CODING_STATUS_OUTPUT_ALIAS
          ];
          const codedStatus = rawEffectiveCodingStatus === null ||
            rawEffectiveCodingStatus === undefined ?
            null :
            Number(rawEffectiveCodingStatus);
          const variablePage =
            variablePageMaps.get(response.unit.name)?.get(response.variableid) ||
          '0';

          return {
            responseId: response.id,
            variableId: response.variableid,
            value: response.value || '',
            status: statusNumberToString(response.status) || 'UNSET',
            code,
            score,
            codedStatus: statusNumberToString(codedStatus) || 'UNSET',
            code_v1: response.code_v1,
            code_v2: response.code_v2,
            code_v3: response.code_v3,
            status_v1: statusNumberToString(response.status_v1) || 'UNSET',
            status_v2: statusNumberToString(response.status_v2) || 'UNSET',
            status_v3: statusNumberToString(response.status_v3) || 'UNSET',
            unitId: response.unit.id,
            unitName: response.unit.name,
            unitAlias: response.unit.alias,
            bookletId: response.unit.booklet.id,
            bookletName: response.unit.booklet.bookletinfo.name,
            personId: response.unit.booklet.person.id,
            personLogin: response.unit.booklet.person.login,
            personCode: response.unit.booklet.person.code,
            personGroup: response.unit.booklet.person.group,
            variablePage
          };
        });

        return { data, total };
      };

      return searchParams.regexSearch ?
        await withRegexSearchStatementTimeout(this.connection, runSearch) :
        await runSearch();
    } catch (error) {
      const regexError = toRegexSearchException(error);
      if (regexError) {
        throw regexError;
      }

      this.logger.error(
        `Failed to search for responses in workspace: ${workspaceId}`,
        getErrorStack(error)
      );
      throw new Error(
        `An error occurred while searching for responses: ${getErrorMessage(error)}`
      );
    }
  }

  private applyResponseSearchSorting(
    query: SelectQueryBuilder<ResponseEntity>,
    version: CodingVersion,
    geogebra: boolean,
    sortBy?: ResponseSearchSortBy,
    sortDirection?: ResponseSearchSortDirection
  ): void {
    const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
    if (!sortBy && geogebra) {
      query
        .orderBy(`response.code_${version}`, 'ASC')
        .addOrderBy('person.code', 'ASC')
        .addOrderBy('response.id', 'ASC');
      return;
    }

    if (sortBy === 'codedstatus') {
      query.addSelect(
        getEffectiveCodingStatusExpression(version),
        EFFECTIVE_CODING_STATUS_SORT_ALIAS
      );
      query
        .orderBy(EFFECTIVE_CODING_STATUS_SORT_ALIAS, direction)
        .addOrderBy('response.id', 'ASC');
      return;
    }

    const sortExpression = this.getResponseSearchSortExpression(version, sortBy);

    query.orderBy(sortExpression, direction);
    if (sortExpression !== 'response.id') {
      query.addOrderBy('response.id', 'ASC');
    }
  }

  private getResponseSearchSortExpression(
    version: CodingVersion,
    sortBy?: ResponseSearchSortBy
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

  private async applyValidCodingVariableFilter(
    query: SelectQueryBuilder<ResponseEntity>,
    workspaceId: number
  ): Promise<void> {
    const validVariablePairKeys = await this.codingListService.getValidVariablePairKeys(workspaceId);
    if (validVariablePairKeys.length === 0) {
      query.andWhere('1 = 0');
      return;
    }

    query.andWhere(
      'CONCAT(unit.name, CHR(31), response.variableid) IN (:...validVariablePairKeys)',
      { validVariablePairKeys }
    );
  }
}
