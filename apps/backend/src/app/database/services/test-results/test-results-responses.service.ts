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
import { ResponseEntity } from '../../entities/response.entity';
import {
  statusNumberToString
} from '../../utils/response-status-converter';
import {
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { TestResultsAnomaliesService } from './test-results-anomalies.service';
import {
  applyExclusionsToQuery, excludeAutocoderGeneratedResponses
} from './test-results.util';
import { FlatResponseOptions, FlatResponseResult, LogAnomalySummary } from './workspace-test-results.types';
import {
  applyFlatResponseFilters, FlatResponseFilters, normalizeFlatResponseFilters, RESPONSE_VALUE_SEARCH_PREFIX_LENGTH
} from './flat-response-filters';
import {
  createFlatResponseUnitScope, findUnfilteredFlatResponseScope, findValueFilteredFlatResponsePage,
  isUnfilteredFlatResponseQuery, withFlatResponsePageUnits
} from './flat-response-query-scope';

const MAX_FLAT_RESPONSE_PAGE_SIZE = 200;

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
    const createQuery = () => {
      const query = this.createFlatResponseQuery(workspaceId, filters, queryRunner);
      applyExclusionsToQuery(query, exclusions, { bookletInfoAlias: 'bookletinfo' });
      this.anomalies.applyLogAnomalyFilters(query, logAnomalyCodes, logAnomalyThresholds, exclusions);
      return query;
    };
    const qb = createQuery();
    const validPage = Math.max(1, Number(options.page || 1));
    const validLimit = Math.min(Math.max(1, Number(options.limit || 50)), MAX_FLAT_RESPONSE_PAGE_SIZE);
    const page = { number: validPage, size: validLimit };
    const { total, raw } = filters.responseValue ?
      await findValueFilteredFlatResponsePage(
        this.connection,
        qb,
        this.projectFlatResponseRows(this.createFlatResponseJoins(queryRunner), filters.tags),
        page,
        queryRunner
      ) :
      await this.loadOtherFlatResponsePage(createQuery, qb, page, filters, exclusions, workspaceId, queryRunner);

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

  private async loadOtherFlatResponsePage(
    createQuery: () => SelectQueryBuilder<ResponseEntity>,
    qb: SelectQueryBuilder<ResponseEntity>,
    page: { number: number; size: number },
    filters: FlatResponseFilters,
    exclusions: Parameters<typeof applyExclusionsToQuery>[1],
    workspaceId: number,
    queryRunner?: QueryRunner
  ) {
    const candidateUnits = page.number * page.size;
    const units = isUnfilteredFlatResponseQuery(filters) ?
      createFlatResponseUnitScope(this.connection, workspaceId, exclusions, queryRunner) : undefined;
    const scope = units ? await findUnfilteredFlatResponseScope(
      this.connection, units, Number.isSafeInteger(candidateUnits) ? candidateUnits : undefined, queryRunner
    ) : undefined;
    const total = scope ? scope.total : await createQuery()
      .select('COUNT(response.id)', 'cnt')
      .getRawOne()
      .then(r => Number(r?.cnt || 0));

    const pageQuery = scope?.pageUnitIds ? withFlatResponsePageUnits(qb, scope.pageUnitIds) : qb;
    let raw = await this.selectFlatResponseRows(pageQuery, page.number, page.size, filters.tags);
    // Empty/auto-generated-only units can exhaust the prefix before a whole page.
    // In that case use the complete scope instead of silently dropping later rows.
    if (scope?.pageUnitIds && raw.length < page.size) {
      raw = await this.selectFlatResponseRows(qb, page.number, page.size, filters.tags);
    }
    return { total, raw };
  }

  private createFlatResponseQuery(
    workspaceId: number,
    filters: FlatResponseFilters,
    queryRunner?: QueryRunner
  ): SelectQueryBuilder<ResponseEntity> {
    const query = this.createFlatResponseJoins(queryRunner)
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    excludeAutocoderGeneratedResponses(query);
    // EXISTS filters keep one row per response. Aggregate tags only for the page,
    // rather than grouping and sorting every matching response before LIMIT.
    applyFlatResponseFilters(query, filters, 'count');
    return query;
  }

  private createFlatResponseJoins(queryRunner?: QueryRunner): SelectQueryBuilder<ResponseEntity> {
    return this.responseRepository.createQueryBuilder('response', queryRunner)
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo');
  }

  private selectFlatResponseRows(
    qb: SelectQueryBuilder<ResponseEntity>, validPage: number, validLimit: number, tags: string
  ) {
    return this.projectFlatResponseRows(qb, tags)
      .orderBy('person.code', 'ASC')
      .addOrderBy('bookletinfo.name', 'ASC')
      .addOrderBy('unit.alias', 'ASC')
      .addOrderBy('response.variableid', 'ASC')
      .addOrderBy('response.id', 'ASC')
      .offset((validPage - 1) * validLimit)
      .limit(validLimit)
      .getRawMany();
  }

  private projectFlatResponseRows(qb: SelectQueryBuilder<ResponseEntity>, tags: string) {
    const tagFilter = tags ? 'AND page_tag.tag ILIKE :tags' : '';
    return qb
      .select([
        'bookletEntity.id AS "bookletId"',
        'response.id AS "responseId"',
        'unit.id AS "unitId"',
        'person.id AS "personId"',
        'person.code AS "code"',
        'person.group AS "group"',
        'person.login AS "login"',
        'bookletinfo.name AS "booklet"',
        'COALESCE(unit.alias, unit.name) AS "unit"',
        'response.variableid AS "response"',
        'response.status AS "responseStatus"',
        'SUBSTRING(response.value, 1, :maxResponseValueLen) AS "responseValue"',
        `COALESCE((SELECT string_agg(DISTINCT page_tag.tag, ',')
          FROM unit_tag page_tag WHERE page_tag."unitId" = unit.id ${tagFilter}), '') AS "tags"`
      ])
      .setParameter(
        'maxResponseValueLen',
        RESPONSE_VALUE_SEARCH_PREFIX_LENGTH
      );
  }
}
