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
  RESPONSE_VALUE_SEARCH_STATEMENT_TIMEOUT_MS,
  toRegexSearchException,
  toResponseValueSearchException,
  validatePostgresRegexSearchPatterns,
  withRegexSearchStatementTimeout
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
import { LRUCache } from '../shared/lru-cache';
import {
  applyFlatResponseFilters, FlatResponseFilters, normalizeFlatResponseFilters, RESPONSE_VALUE_SEARCH_PREFIX_LENGTH
} from './flat-response-filters';
import {
  countUnfilteredFlatResponses, createFlatResponseUnitScope, createIndexedFlatResponseMatches,
  findUnfilteredFlatResponsePageRows, findUnfilteredFlatResponsePageUnits, findValueFilteredFlatResponsePage,
  FlatResponsePageUnit, isUnfilteredFlatResponseQuery
} from './flat-response-query-scope';
import { findProjectedFlatResponsePage, ResponsePageProjection } from './flat-response-first-page';

const MAX_FLAT_RESPONSE_PAGE_SIZE = 200;
const MAX_CACHED_PAGE_BYTES = 512 * 1024;
const MAX_CACHED_PAGE_UNITS = 4_000;

type FlatResponsePage = Awaited<ReturnType<typeof findValueFilteredFlatResponsePage>>;

@Injectable()
export class TestResultsResponsesService {
  private readonly pendingUnfilteredCounts = new Map<string, Promise<number>>();
  private readonly completedUnfilteredCounts = new LRUCache<number>(128);
  private readonly unfilteredPageUnits = new LRUCache<FlatResponsePageUnit[]>(128);
  private readonly pendingPages = new Map<string, Promise<FlatResponsePage>>();
  private readonly completedPages = new LRUCache<FlatResponsePage>(32);

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
        return await this.queryFlatResponses(workspaceId, options);
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
    const validPage = Math.max(1, Number(options.page || 1));
    const validLimit = Math.min(Math.max(1, Number(options.limit || 50)), MAX_FLAT_RESPONSE_PAGE_SIZE);
    const page = { number: validPage, size: validLimit };
    const unfiltered = isUnfilteredFlatResponseQuery(filters);
    const valueSearch = Boolean(filters.responseValue);
    const projectedValueSearch = valueSearch && Number.isSafeInteger(page.number) &&
      isUnfilteredFlatResponseQuery({ ...filters, responseValue: '' });
    const canProject = Number.isSafeInteger(page.size) && ((unfiltered && page.number === 1) || projectedValueSearch);
    const loadPage = async (
      runner?: QueryRunner, scopeKey?: string, projection?: ResponsePageProjection | null
    ): Promise<FlatResponsePage> => {
      if (projection) {
        const firstPage = await findProjectedFlatResponsePage(
          this.connection, workspaceId, exclusions, page, projection, filters.responseValue, runner
        );
        if (firstPage) return firstPage;
      }
      const qb = await this.createFlatResponseQuery(workspaceId, filters, runner, scopeKey !== undefined);
      applyExclusionsToQuery(qb, exclusions, { bookletInfoAlias: 'bookletinfo' });
      this.anomalies.applyLogAnomalyFilters(qb, logAnomalyCodes, logAnomalyThresholds, exclusions);
      return filters.responseValue ?
        findValueFilteredFlatResponsePage(
          this.connection,
          qb,
          this.projectFlatResponseRows(this.createFlatResponseJoins(runner), filters.tags),
          page,
          runner
        ) :
        this.loadOtherFlatResponsePage(qb, page, filters, exclusions, workspaceId, runner, scopeKey);
    };
    const pageKey = valueSearch ? JSON.stringify([page, filters, logAnomalyThresholds]) : JSON.stringify(page);
    const { total, raw } = !queryRunner && (unfiltered || valueSearch) ?
      await this.loadSnapshotPage(workspaceId, exclusions, pageKey, valueSearch, canProject, loadPage) :
      await loadPage(queryRunner);

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

  private async loadSnapshotPage(
    workspaceId: number,
    exclusions: Parameters<typeof applyExclusionsToQuery>[1],
    pageKey: string,
    valueSearch: boolean,
    canProject: boolean,
    loadPage: (runner?: QueryRunner, scopeKey?: string, projection?: ResponsePageProjection | null) => Promise<FlatResponsePage>
  ): Promise<FlatResponsePage> {
    const pageRead = await this.connection.transaction('REPEATABLE READ', async manager => {
      await manager.query('SET TRANSACTION READ ONLY');
      if (valueSearch) {
        await manager.query(`SET LOCAL statement_timeout = '${RESPONSE_VALUE_SEARCH_STATEMENT_TIMEOUT_MS}ms'`);
      }
      const projectionColumn = canProject ?
        `, CASE
              WHEN to_regclass('flat_response_first_page_workspace') IS NULL THEN NULL
              ${valueSearch ?
                "WHEN to_regclass('flat_response_value_search_workspace') IS NOT NULL THEN 'value' ELSE NULL" :
                `WHEN to_regclass('flat_response_first_page_total') IS NOT NULL THEN
                  CASE WHEN to_regclass('flat_response_first_page_response') IS NOT NULL THEN 'compact' ELSE 'totals' END
                ELSE 'units'`}
            END AS "projection"` : '';
      const [{ snapshot, postmasterStartedAt, projection }] = await manager.query(
        `SELECT pg_current_snapshot()::text AS snapshot,
          pg_postmaster_start_time()::text AS "postmasterStartedAt"${projectionColumn}`
      ) as { snapshot: string; postmasterStartedAt: string; projection?: ResponsePageProjection | null }[];
      // Reuse requires the same server, row visibility and workspace scope.
      const scopeKey = JSON.stringify([workspaceId, exclusions, postmasterStartedAt, snapshot]);
      const snapshotPageKey = JSON.stringify([scopeKey, pageKey]);
      const cached = this.completedPages.get(snapshotPageKey);
      if (cached) return { result: cached };
      const pending = this.pendingPages.get(snapshotPageKey);
      // End the follower's transaction before waiting for the shared page.
      if (pending) return { pending };

      const read = loadPage(manager.queryRunner, scopeKey, projection);
      this.pendingPages.set(snapshotPageKey, read);
      try {
        const result = await read;
        if (Buffer.byteLength(JSON.stringify(result.raw)) <= MAX_CACHED_PAGE_BYTES) {
          this.completedPages.set(snapshotPageKey, result);
        }
        return { result };
      } finally {
        this.pendingPages.delete(snapshotPageKey);
      }
    });
    return pageRead.pending ?? pageRead.result;
  }

  private async loadOtherFlatResponsePage(
    qb: SelectQueryBuilder<ResponseEntity>,
    page: { number: number; size: number },
    filters: FlatResponseFilters,
    exclusions: Parameters<typeof applyExclusionsToQuery>[1],
    workspaceId: number,
    queryRunner?: QueryRunner,
    scopeKey?: string
  ) {
    const units = isUnfilteredFlatResponseQuery(filters) ?
      createFlatResponseUnitScope(this.connection, workspaceId, exclusions, queryRunner) : undefined;
    const total = units ? await this.getUnfilteredCount(
      scopeKey, () => countUnfilteredFlatResponses(this.connection, units, queryRunner)
    ) : await qb.clone()
      .select('COUNT(response.id)', 'cnt')
      .getRawOne()
      .then(r => Number(r?.cnt || 0));

    const range = this.getFlatResponsePageRange(page, scopeKey === undefined ? undefined : total);
    if (!range) return { total, raw: [] };
    const {
      pageOffset, size, direction, candidateUnits
    } = range;
    let pageUnits: FlatResponsePageUnit[] | undefined;
    if (scopeKey !== undefined && units && Number.isSafeInteger(candidateUnits) && candidateUnits <= MAX_CACHED_PAGE_UNITS) {
      const unitsKey = JSON.stringify([scopeKey, direction, candidateUnits]);
      pageUnits = this.unfilteredPageUnits.get(unitsKey);
      if (!pageUnits) {
        pageUnits = await findUnfilteredFlatResponsePageUnits(this.connection, units, candidateUnits, direction, queryRunner);
        if (pageUnits.length <= MAX_CACHED_PAGE_UNITS) {
          this.unfilteredPageUnits.set(unitsKey, pageUnits);
        }
      }
    }
    let raw = pageUnits && await findUnfilteredFlatResponsePageRows(
      this.connection,
      this.projectFlatResponseRows(this.createFlatResponseJoins(queryRunner), ''),
      pageUnits,
      { offset: pageOffset, limit: size, direction },
      queryRunner
    );
    // Empty or generated-only units can exhaust the candidate range.
    // In that case use the complete scope instead of silently dropping later rows.
    if (!raw || raw.length < size) {
      raw = await this.selectFlatResponseRows(qb, pageOffset, size, filters.tags, direction);
    }
    return { total, raw: direction === 'DESC' ? raw.reverse() : raw };
  }

  private getFlatResponsePageRange(page: { number: number; size: number }, snapshotTotal?: number) {
    const offset = (page.number - 1) * page.size;
    // Count and reverse pagination must see the same rows.
    if (snapshotTotal === undefined) {
      return {
        pageOffset: offset, size: page.size, direction: 'ASC', candidateUnits: offset + page.size
      } as const;
    }
    if (offset >= snapshotTotal) return undefined;
    const reverseEnd = snapshotTotal - offset;
    const size = Math.min(page.size, reverseEnd);
    const forwardEnd = offset + size;
    return reverseEnd < forwardEnd ?
      {
        pageOffset: reverseEnd - size, size, direction: 'DESC', candidateUnits: reverseEnd
      } as const :
      {
        pageOffset: offset, size, direction: 'ASC', candidateUnits: forwardEnd
      } as const;
  }

  private getUnfilteredCount(key: string | undefined, count: () => Promise<number>): Promise<number> {
    if (key === undefined) return count();
    const cached = this.completedUnfilteredCounts.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.pendingUnfilteredCounts.get(key);
    if (pending) return pending;
    const result = count().then(total => {
      this.completedUnfilteredCounts.set(key, total);
      return total;
    }).finally(() => this.pendingUnfilteredCounts.delete(key));
    this.pendingUnfilteredCounts.set(key, result);
    return result;
  }

  private async createFlatResponseQuery(
    workspaceId: number,
    filters: FlatResponseFilters,
    queryRunner?: QueryRunner,
    useIndex = false
  ): Promise<SelectQueryBuilder<ResponseEntity>> {
    // Only select the index when readiness and links are read in our single repeatable-read snapshot.
    const indexedMatches = useIndex ?
      await createIndexedFlatResponseMatches(this.connection, workspaceId, filters, queryRunner) : undefined;
    const query = (indexedMatches || this.createFlatResponseJoins(queryRunner))
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    if (!indexedMatches) excludeAutocoderGeneratedResponses(query);
    // EXISTS filters keep one row per response. Aggregate tags only for the page,
    // rather than grouping and sorting every matching response before LIMIT.
    applyFlatResponseFilters(query, indexedMatches ? { ...filters, responseValue: '' } : filters, 'count');
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
    qb: SelectQueryBuilder<ResponseEntity>, offset: number, limit: number, tags: string, direction: 'ASC' | 'DESC'
  ) {
    return this.orderFlatResponseRows(this.projectFlatResponseRows(qb, tags), direction)
      .offset(offset)
      .limit(limit)
      .getRawMany();
  }

  private orderFlatResponseRows(qb: SelectQueryBuilder<ResponseEntity>, direction: 'ASC' | 'DESC') {
    return qb
      .orderBy('person.code', direction)
      .addOrderBy('bookletinfo.name', direction)
      .addOrderBy('unit.alias', direction)
      .addOrderBy('response.variableid', direction)
      .addOrderBy('response.id', direction);
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
