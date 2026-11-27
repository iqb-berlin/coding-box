import {
  Inject,
  Injectable
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  QueryRunner,
  Repository,
  SelectQueryBuilder
} from 'typeorm';
import {
  toRegexSearchException,
  toResponseValueSearchException,
  validatePostgresRegexSearchPatterns,
  withRegexSearchStatementTimeout,
  withResponseValueSearchStatementTimeout
} from '../../../utils/regex-search.util';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import {
  statusNumberToString
} from '../../utils/response-status-converter';
import {
  ResolvedWorkspaceExclusions, WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { TestResultsAnomaliesService } from './test-results-anomalies.service';
import {
  applyExclusionsToQuery, applyFlatResponseTextFilters, applyIgnoredBookletsToQuery, excludeAutocoderGeneratedResponses
} from './test-results.util';
import {
  FlatResponseOptions, FlatResponseResult, LogAnomalyCode, LogAnomalySummary, LogAnomalyThresholds
} from './workspace-test-results.types';
import {
  applyFlatResponseFilters, buildLongLoadingFilter, FlatResponseFilters, normalizeFlatResponseFilters, RESPONSE_VALUE_SEARCH_PREFIX_LENGTH
} from './flat-response-filters';

const MAX_FLAT_RESPONSE_PAGE_SIZE = 500;

@Injectable()
export class TestResultsResponsesService {
  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    @Inject(WorkspaceExclusionService)
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly anomalies: TestResultsAnomaliesService
  ) {}

  async findFlatResponses(
    workspaceId: number,
    options: FlatResponseOptions,
    queryRunner?: QueryRunner
  ): Promise<FlatResponseResult> {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    const hasRegexTextFilter = options.regexSearch === true && [
      options.code,
      options.group,
      options.login,
      options.booklet,
      options.unit,
      options.response
    ].some(value => String(value || '').trim().length > 0);
    const hasResponseValueFilter = String(options.responseValue || '')
      .trim().length > 0;

    if (hasRegexTextFilter && !queryRunner) {
      try {
        return await withRegexSearchStatementTimeout(
          this.connection,
          async runner => {
            await validatePostgresRegexSearchPatterns(runner, [
              { fieldName: 'code', pattern: options.code },
              { fieldName: 'group', pattern: options.group },
              { fieldName: 'login', pattern: options.login },
              { fieldName: 'booklet', pattern: options.booklet },
              { fieldName: 'unit', pattern: options.unit },
              { fieldName: 'response', pattern: options.response }
            ]);
            return this.findFlatResponses(workspaceId, options, runner);
          }
        );
      } catch (error) {
        const regexError = toRegexSearchException(error);
        if (regexError) {
          throw regexError;
        }
        throw error;
      }
    }

    if (hasResponseValueFilter && !queryRunner) {
      try {
        return await withResponseValueSearchStatementTimeout(
          this.connection,
          runner => this.findFlatResponses(workspaceId, options, runner)
        );
      } catch (error) {
        const searchError = toResponseValueSearchException(error);
        if (searchError) {
          throw searchError;
        }
        throw error;
      }
    }

    return this.queryFlatResponses(workspaceId, options, queryRunner);
  }

  private async queryFlatResponses(
    workspaceId: number,
    options: FlatResponseOptions,
    queryRunner?: QueryRunner
  ): Promise<FlatResponseResult> {
    const filters = normalizeFlatResponseFilters(options);
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const logAnomalyThresholds = this.anomalies.buildLogAnomalyThresholds({
      longLoadingThresholdMs: filters.longLoadingThresholdMs,
      focusLostThresholdMs: options.focusLostThresholdMs,
      sessionSpanThresholdMs: options.sessionSpanThresholdMs,
      repeatedStartThreshold: options.repeatedStartThreshold
    });
    const logAnomalyCodes = this.anomalies.expandLogAnomalyCodes(filters.logAnomalies);
    const matchingBooklets = logAnomalyCodes.length ?
      await this.findMatchingBookletIds(workspaceId, logAnomalyCodes, logAnomalyThresholds, exclusions, filters, queryRunner) :
      undefined;
    if (matchingBooklets?.length === 0) return [[], 0];

    const loadingFilter = await buildLongLoadingFilter(queryRunner || this.connection, workspaceId, filters, 'responses');
    const createQuery = () => {
      const query = this.createFlatResponseQuery(workspaceId, filters, queryRunner);
      applyExclusionsToQuery(query, exclusions, { bookletInfoAlias: 'bookletinfo' });
      if (matchingBooklets) query.andWhere('bookletEntity.id = ANY(:matchingBooklets)', { matchingBooklets });
      if (loadingFilter) query.andWhere(loadingFilter.condition, loadingFilter.parameters);
      return query;
    };
    const rowQuery = createQuery();
    const countRows = () => createQuery()
      .select('COUNT(response.id)', 'cnt')
      .getRawOne()
      .then(r => Number(r?.cnt || 0));
    const validPage = Math.max(1, Number(options.page || 1));
    const validLimit = Math.min(Math.max(1, Number(options.limit || 50)), MAX_FLAT_RESPONSE_PAGE_SIZE);
    const pageQuery = this.createFlatResponsePageQuery(rowQuery, validPage, validLimit, Boolean(filters.tags), filters.codingColumn);
    let total: number;
    let raw: Record<string, unknown>[];
    if (filters.responseValue || (filters.regexSearch && filters.response)) {
      // These searches run sequentially on one transaction. Evaluate their text predicate once.
      raw = await pageQuery.addSelect('COUNT(*) OVER()', 'matchedCount').getRawMany();
      if (raw.length) total = Number(raw[0].matchedCount);
      else total = validPage === 1 ? 0 : await countRows();
    } else if (queryRunner) {
      total = await countRows();
      raw = await pageQuery.getRawMany();
    } else {
      [total, raw] = await Promise.all([countRows(), pageQuery.getRawMany()]);
    }

    const mapped = (raw || []).map(r => {
      const tagsStr = String(r.tags || '');
      const tagList = tagsStr ?
        tagsStr
          .split(',')
          .map(t => t.trim())
          .filter(Boolean) :
        [];

      const statusNum = Number(r.responseStatus);
      const statusLabel = statusNumberToString(statusNum);
      return {
        bookletId: Number(r.bookletId),
        responseId: Number(r.responseId),
        unitId: Number(r.unitId),
        personId: Number(r.personId),
        codingCode: r.codingCode == null ? null : Number(r.codingCode),
        code: String(r.code || ''),
        group: String(r.group || ''),
        login: String(r.login || ''),
        booklet: String(r.booklet || ''),
        unit: String(r.unit || ''),
        response: String(r.response || ''),
        responseStatus: statusLabel || String(r.responseStatus ?? ''),
        responseValue: String(r.responseValue ?? ''),
        tags: tagList,
        logAnomalies: []
      };
    });

    const anomaliesByBooklet = filters.includeLogAnomalies ?
      await this.anomalies.findLogAnomaliesForBooklets(
        mapped.map(row => row.bookletId),
        logAnomalyThresholds,
        exclusions
      ) :
      new Map<number, LogAnomalySummary[]>();

    return [
      mapped.map(row => ({
        ...row,
        logAnomalies: anomaliesByBooklet.get(row.bookletId) || []
      })),
      total
    ];
  }

  private async findMatchingBookletIds(
    workspaceId: number,
    codes: LogAnomalyCode[],
    thresholds: LogAnomalyThresholds,
    exclusions: ResolvedWorkspaceExclusions,
    filters: FlatResponseFilters,
    runner?: QueryRunner
  ): Promise<number[]> {
    const query = this.connection.getRepository(Booklet).createQueryBuilder('bookletEntity', runner)
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .select('bookletEntity.id', 'id')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = TRUE');
    if (filters.unit) query.innerJoin('bookletEntity.units', 'unit').distinct(true);
    applyFlatResponseTextFilters(query, { ...filters, response: '' });
    applyIgnoredBookletsToQuery(query, exclusions.ignoredBooklets, 'bookletinfo');
    this.anomalies.applyLogAnomalyFilters(query, codes, thresholds, exclusions);
    const rows = await query.getRawMany<{ id: number }>();
    return rows.map(row => row.id);
  }

  private createFlatResponseQuery(
    workspaceId: number,
    filters: FlatResponseFilters,
    queryRunner?: QueryRunner
  ): SelectQueryBuilder<ResponseEntity> {
    const query = this.responseRepository.createQueryBuilder('response', queryRunner)
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    excludeAutocoderGeneratedResponses(query);
    applyFlatResponseFilters(query, filters);
    return query;
  }

  private createFlatResponsePageQuery(
    qb: SelectQueryBuilder<ResponseEntity>,
    validPage: number,
    validLimit: number,
    filterTags: boolean,
    codingColumn: string
  ) {
    // Only aggregate tags for the selected response rows.
    const tagPredicate = filterTags ? 'AND page_tag.tag ILIKE :tags' : '';
    return qb
      .select([
        'bookletEntity.id AS "bookletId"',
        'response.id AS "responseId"',
        'unit.id AS "unitId"',
        'person.id AS "personId"',
        `${codingColumn} AS "codingCode"`,
        'person.code AS "code"',
        'person.group AS "group"',
        'person.login AS "login"',
        'bookletinfo.name AS "booklet"',
        'COALESCE(unit.alias, unit.name) AS "unit"',
        'response.variableid AS "response"',
        'response.status AS "responseStatus"',
        'SUBSTRING(response.value, 1, :maxResponseValueLen) AS "responseValue"',
        `COALESCE((
          SELECT string_agg(DISTINCT page_tag.tag, ',')
          FROM unit_tag page_tag
          WHERE page_tag."unitId" = unit.id ${tagPredicate}
        ), '') AS "tags"`
      ])
      .setParameter(
        'maxResponseValueLen',
        RESPONSE_VALUE_SEARCH_PREFIX_LENGTH
      )
      .orderBy('person.code', 'ASC')
      .addOrderBy('bookletinfo.name', 'ASC')
      .addOrderBy('unit.alias', 'ASC')
      .addOrderBy('response.variableid', 'ASC')
      .addOrderBy('response.id', 'ASC')
      .offset((validPage - 1) * validLimit)
      .limit(validLimit);
  }
}
