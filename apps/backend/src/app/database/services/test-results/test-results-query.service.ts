import {
  Inject,
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository
} from 'typeorm';
import { CacheService } from '../../../cache/cache.service';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import { Booklet } from '../../entities/booklet.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import Persons from '../../entities/persons.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Session } from '../../entities/session.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import {
  statusNumberToString
} from '../../utils/response-status-converter';
import { UnitTagService } from '../workspace/unit-tag.service';
import { OVERVIEW_STATS_CACHE_PREFIX } from '../workspace/workspace-constants';
import {
  WorkspaceExclusionService,
  isExcludedByResolvedExclusions,
  normalizeExclusionBookletId
} from '../workspace/workspace-exclusion.service';
import {
  applyExclusionsToQuery, applyIgnoredBookletsToQuery, excludeAutocoderGeneratedResponses, nonAutocoderGeneratedResponseCondition
} from './test-results.util';
import { QuickSearchResult, WorkspaceOverviewStats } from './workspace-test-results.types';

@Injectable()
export class TestResultsQueryService {
  private readonly logger = new Logger('WorkspaceTestResultsService');

  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(BookletLog)
    private bookletLogRepository: Repository<BookletLog>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    @InjectRepository(UnitLog)
    private unitLogRepository: Repository<UnitLog>,
    private readonly unitTagService: UnitTagService,
    private readonly cacheService: CacheService,
    @Inject(WorkspaceExclusionService)
    private readonly workspaceExclusionService: WorkspaceExclusionService
  ) {}

  async getWorkspaceTestResultsOverview(workspaceId: number): Promise<WorkspaceOverviewStats> {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    const cacheKey = `${OVERVIEW_STATS_CACHE_PREFIX}${workspaceId}`;
    const cachedOverview = await this.cacheService.get<WorkspaceOverviewStats>(cacheKey);
    if (cachedOverview) {
      return cachedOverview;
    }

    const testPersonsPromise = this.personsRepository.count({
      where: { workspace_id: workspaceId, consider: true }
    });

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

    const testGroupsPromise = this.personsRepository
      .createQueryBuilder('person')
      .select('COUNT(DISTINCT person.group)', 'count')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .getRawOne()
      .then(res => Number(res?.count || 0));

    const uniqueBookletsQuery = this.bookletRepository
      .createQueryBuilder('booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('COUNT(DISTINCT bookletinfo.name)', 'count')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    applyIgnoredBookletsToQuery(uniqueBookletsQuery, exclusions.ignoredBooklets);
    const uniqueBookletsPromise = uniqueBookletsQuery
      .getRawOne()
      .then(res => Number(res?.count || 0));

    const unitKeyQuery = this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .select('DISTINCT COALESCE(unit.alias, unit.name)', 'unitKey')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    applyExclusionsToQuery(unitKeyQuery, exclusions);
    const uniqueUnitsPromise = unitKeyQuery
      .select('COUNT(DISTINCT COALESCE(unit.alias, unit.name))', 'count')
      .getRawOne()
      .then(res => Number(res?.count || 0));

    const uniqueResponsesQuery = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    applyExclusionsToQuery(uniqueResponsesQuery, exclusions);
    excludeAutocoderGeneratedResponses(uniqueResponsesQuery);
    const uniqueResponsesPromise = uniqueResponsesQuery.getCount();

    const statusRowsQuery = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .select('response.status', 'status')
      .addSelect('COUNT(response.id)', 'count')
      .groupBy('response.status');

    applyExclusionsToQuery(statusRowsQuery, exclusions);
    excludeAutocoderGeneratedResponses(statusRowsQuery);
    const statusRowsPromise = statusRowsQuery.getRawMany<{ status: string | number; count: string | number }>();

    const [
      testPersons,
      testGroups,
      uniqueBooklets,
      uniqueUnits,
      uniqueResponses,
      statusRows,
      browserRows,
      osRows,
      screenRows
    ] = await Promise.all([
      testPersonsPromise,
      testGroupsPromise,
      uniqueBookletsPromise,
      uniqueUnitsPromise,
      uniqueResponsesPromise,
      statusRowsPromise,
      this.sessionRepository
        .createQueryBuilder('session')
        .innerJoin('session.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere(exclusions.ignoredBooklets.length > 0 ? 'UPPER(bookletinfo.name) NOT IN (:...overviewIgnoredBookletsBrowser)' : '1=1', {
          overviewIgnoredBookletsBrowser: exclusions.ignoredBooklets.map(normalizeExclusionBookletId)
        })
        .select('session.browser', 'value')
        .addSelect('COUNT(session.id)', 'count')
        .groupBy('session.browser')
        .getRawMany<{ value: string | null; count: string | number }>(),
      this.sessionRepository
        .createQueryBuilder('session')
        .innerJoin('session.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere(exclusions.ignoredBooklets.length > 0 ? 'UPPER(bookletinfo.name) NOT IN (:...overviewIgnoredBookletsOs)' : '1=1', {
          overviewIgnoredBookletsOs: exclusions.ignoredBooklets.map(normalizeExclusionBookletId)
        })
        .select('session.os', 'value')
        .addSelect('COUNT(session.id)', 'count')
        .groupBy('session.os')
        .getRawMany<{ value: string | null; count: string | number }>(),
      this.sessionRepository
        .createQueryBuilder('session')
        .innerJoin('session.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere(exclusions.ignoredBooklets.length > 0 ? 'UPPER(bookletinfo.name) NOT IN (:...overviewIgnoredBookletsScreen)' : '1=1', {
          overviewIgnoredBookletsScreen: exclusions.ignoredBooklets.map(normalizeExclusionBookletId)
        })
        .select('session.screen', 'value')
        .addSelect('COUNT(session.id)', 'count')
        .groupBy('session.screen')
        .getRawMany<{ value: string | null; count: string | number }>()
    ]);

    const responseStatusCounts: Record<string, number> = {};
    (statusRows || []).forEach(r => {
      const num = Number(r.status);
      const label = statusNumberToString(num) || String(num);
      responseStatusCounts[label] = Number(r.count) || 0;
    });

    const mapSessionCounts = (
      rows: Array<{ value: string | null; count: string | number }>
    ): Record<string, number> => {
      const out: Record<string, number> = {};
      (rows || []).forEach(r => {
        const key = String((r.value || '').trim() || 'unknown');
        out[key] = Number(r.count) || 0;
      });
      return out;
    };

    const sessionBrowserCounts = mapSessionCounts(browserRows);
    const sessionOsCounts = mapSessionCounts(osRows);
    const sessionScreenCounts = mapSessionCounts(screenRows);

    const result = {
      testPersons,
      testGroups,
      uniqueBooklets,
      uniqueUnits,
      uniqueResponses,
      responseStatusCounts,
      sessionBrowserCounts,
      sessionOsCounts,
      sessionScreenCounts
    };

    await this.cacheService.set(cacheKey, result, 60); // Cache for 1 minute
    return result;
  }

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
          code?: number | null;
          score?: number | null;
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
    if (!personId || !workspaceId) {
      throw new Error('Both personId and workspaceId are required.');
    }

    this.logger.log(
      `Fetching booklet data for person ${personId} in workspace ${workspaceId}`
    );

    try {
      this.logger.log(
        `Fetching booklets, bookletInfo data, units, and test results for personId: ${personId} and workspaceId: ${workspaceId}`
      );

      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      const globalIgnoredSet = new Set(exclusions.globalIgnoredUnits.map(u => u.toUpperCase().replace(/\.XML$/i, '')));
      const ignoredBookletsSet = new Set(exclusions.ignoredBooklets.map(b => b.toUpperCase()));

      const bookletsQuery = this.bookletRepository
        .createQueryBuilder('booklet')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('booklet.personid = :personId', { personId })
        .select(['booklet.id', 'bookletinfo.name']);
      applyIgnoredBookletsToQuery(bookletsQuery, exclusions.ignoredBooklets);
      const booklets = await bookletsQuery
        .getMany();

      if (!booklets || booklets.length === 0) {
        this.logger.log(`No booklets found for personId: ${personId}`);
        return [];
      }

      const bookletIds = booklets.map(booklet => booklet.id);

      const units = await this.unitRepository
        .createQueryBuilder('unit')
        .leftJoinAndSelect(
          'unit.responses',
          'response',
          nonAutocoderGeneratedResponseCondition(
            'response'
          )
        )
        .where('unit.bookletid IN (:...bookletIds)', { bookletIds })
        .select([
          'unit.id',
          'unit.name',
          'unit.alias',
          'unit.bookletid',
          'response.id',
          'response.unitid',
          'response.variableid',
          'response.status',
          'response.value',
          'response.subform',
          'response.code_v1',
          'response.score_v1',
          'response.status_v1'
        ])
        .getMany();

      const unitIds = units.map(unit => unit.id);

      const unitResultMap = new Map<
        number,
        {
          id: number;
          unitid: number;
          variableid: string;
          status: string;
          value: string;
          subform: string;
          code?: number | null;
          score?: number | null;
          codedstatus?: string;
        }[]
      >();
      units.forEach(unit => {
        if (unit.responses) {
          const uniqueResponses = Array.from(
            new Map(
              unit.responses.map(response => [response.id, response])
            ).values()
          ).map(response => ({
            id: response.id,
            unitid: response.unitid,
            variableid: response.variableid,
            status: statusNumberToString(response.status) || 'UNSET',
            value: response.value || '',
            subform: response.subform || '',
            code: response.code_v1,
            score: response.score_v1,
            codedstatus: statusNumberToString(response.status_v1) || 'UNSET'
          }));
          unitResultMap.set(unit.id, uniqueResponses);
        }
      });

      const bookletLogs = await this.bookletLogRepository
        .createQueryBuilder('bookletLog')
        .where('bookletLog.bookletid IN (:...bookletIds)', { bookletIds })
        .select([
          'bookletLog.id',
          'bookletLog.bookletid',
          'bookletLog.ts',
          'bookletLog.parameter',
          'bookletLog.key'
        ])
        .getMany();

      const unitTagsMap = new Map<
        number,
        {
          id: number;
          unitId: number;
          tag: string;
          color?: string;
          createdAt: Date;
        }[]
      >();

      if (unitIds.length > 0) {
        const allTags = await this.unitTagService.findAllByUnitIds(workspaceId, unitIds);

        allTags.forEach(tag => {
          if (!unitTagsMap.has(tag.unitId)) {
            unitTagsMap.set(tag.unitId, []);
          }
          unitTagsMap.get(tag.unitId)?.push(tag);
        });
      }

      const bookletLogsMap = new Map<
        number,
        {
          id: number;
          bookletid: number;
          ts: string;
          key: string;
          parameter: string;
        }[]
      >();
      bookletLogs.forEach(log => {
        if (!bookletLogsMap.has(log.bookletid)) {
          bookletLogsMap.set(log.bookletid, []);
        }
        bookletLogsMap.get(log.bookletid)?.push({
          id: log.id,
          bookletid: log.bookletid,
          ts: log.ts.toString(),
          key: log.key,
          parameter: log.parameter
        });
      });

      const unitsMap = new Map<number, Unit[]>();
      units.forEach(unit => {
        if (!unitsMap.has(unit.bookletid)) {
          unitsMap.set(unit.bookletid, []);
        }
        unitsMap.get(unit.bookletid)?.push(unit);
      });

      return booklets.map(booklet => ({
        id: booklet.id,
        name: booklet.bookletinfo.name,
        logs: bookletLogsMap.get(booklet.id) || [],
        units: (unitsMap.get(booklet.id) || [])
          .filter(unit => {
            const uName = unit.name.toUpperCase().replace(/\.XML$/i, '');
            const bName = booklet.bookletinfo.name.toUpperCase();
            if (globalIgnoredSet.has(uName)) return false;
            if (ignoredBookletsSet.has(bName)) return false;
            return !exclusions.testletIgnoredUnits.some(t => t.bookletId.toUpperCase() === bName && t.unitId.toUpperCase()
              .replace(/\.XML$/i, '') === uName);
          })
          .map(unit => ({
            id: unit.id,
            name: unit.name,
            alias: unit.alias,
            results: unitResultMap.get(unit.id) || [],
            tags: unitTagsMap.get(unit.id) || []
          }))
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch booklets, bookletInfo, units, and results for personId: ${personId} and workspaceId: ${workspaceId}`,
        getErrorStack(error)
      );
      throw new Error(
        'An error occurred while fetching booklets, their info, units, and test results.'
      );
    }
  }

  async findTestResults(
    workspace_id: number,
    options: { page: number; limit: number; searchText?: string }
  ): Promise<[Persons[], number]> {
    const { page, limit, searchText } = options;

    if (!workspace_id || workspace_id <= 0) {
      throw new Error('Invalid workspace_id provided');
    }

    const MAX_LIMIT = 500;
    const validPage = Math.max(1, page); // minimum 1
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

    this.logger.log(
      `Fetching test results for workspace ${workspace_id} (page ${validPage}, limit ${validLimit})`
    );

    try {
      const queryBuilder = this.personsRepository
        .createQueryBuilder('person')
        .where('person.workspace_id = :workspace_id', { workspace_id })
        .andWhere('person.consider = :consider', { consider: true })
        .select([
          'person.id',
          'person.group',
          'person.login',
          'person.code',
          'person.uploaded_at'
        ]);

      if (searchText && searchText.trim() !== '') {
        queryBuilder.andWhere(
          '(person.code ILIKE :searchText OR person.group ILIKE :searchText OR person.login ILIKE :searchText)',
          { searchText: `%${searchText.trim()}%` }
        );
      }

      queryBuilder
        .skip((validPage - 1) * validLimit)
        .take(validLimit)
        .orderBy('person.code', 'ASC');

      const [results, total] = await queryBuilder.getManyAndCount();
      return [results, total];
    } catch (error) {
      this.logger.error(
        `Failed to fetch test results for workspace_id ${workspace_id}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw new Error('An error occurred while fetching test results');
    }
  }

  async quickSearchTestResults(
    workspaceId: number,
    query: string,
    limit = 8
  ): Promise<QuickSearchResult> {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    const normalizedQuery = String(query || '').trim();
    const validLimit = Math.min(Math.max(1, Number(limit || 8)), 20);
    const emptyResult: QuickSearchResult = {
      query: normalizedQuery,
      limit: validLimit,
      persons: [],
      booklets: [],
      units: [],
      responses: [],
      totals: {
        person: 0,
        booklet: 0,
        unit: 0,
        response: 0
      }
    };

    if (normalizedQuery.length < 2) {
      return emptyResult;
    }

    const likeQuery = `%${normalizedQuery}%`;
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );

    const personQb = this.personsRepository
      .createQueryBuilder('person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(
        '(person.code ILIKE :query OR person.group ILIKE :query OR person.login ILIKE :query)',
        { query: likeQuery }
      );

    const bookletQb = this.bookletRepository
      .createQueryBuilder('booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('bookletinfo.name ILIKE :query', { query: likeQuery });
    applyIgnoredBookletsToQuery(bookletQb, exclusions.ignoredBooklets);

    const unitQb = this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('(unit.name ILIKE :query OR unit.alias ILIKE :query)', {
        query: likeQuery
      });
    applyExclusionsToQuery(unitQb, exclusions);

    const responseQb = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(
        '(response.variableid ILIKE :query OR response.value ILIKE :query)',
        { query: likeQuery }
      );
    applyExclusionsToQuery(responseQb, exclusions);
    excludeAutocoderGeneratedResponses(responseQb);

    const [
      personTotal,
      bookletTotal,
      unitTotal,
      responseTotal,
      personRows,
      bookletRows,
      unitRows,
      responseRows
    ] = await Promise.all([
      personQb.clone().getCount(),
      bookletQb.clone().getCount(),
      unitQb.clone().getCount(),
      responseQb.clone().getCount(),
      personQb
        .clone()
        .select([
          'person.id AS "personId"',
          'person.code AS "personCode"',
          'person.group AS "personGroup"',
          'person.login AS "personLogin"'
        ])
        .orderBy('person.code', 'ASC')
        .addOrderBy('person.login', 'ASC')
        .limit(validLimit)
        .getRawMany(),
      bookletQb
        .clone()
        .select([
          'booklet.id AS "bookletId"',
          'bookletinfo.name AS "bookletName"',
          'person.id AS "personId"',
          'person.code AS "personCode"',
          'person.group AS "personGroup"',
          'person.login AS "personLogin"'
        ])
        .orderBy('bookletinfo.name', 'ASC')
        .addOrderBy('person.code', 'ASC')
        .limit(validLimit)
        .getRawMany(),
      unitQb
        .clone()
        .select([
          'unit.id AS "unitId"',
          'unit.name AS "unitName"',
          'unit.alias AS "unitAlias"',
          'booklet.id AS "bookletId"',
          'bookletinfo.name AS "bookletName"',
          'person.id AS "personId"',
          'person.code AS "personCode"',
          'person.group AS "personGroup"',
          'person.login AS "personLogin"',
          '(SELECT r.id FROM response r WHERE r.unitid = unit.id AND r.is_autocoder_generated IS NOT TRUE ORDER BY r.id ASC LIMIT 1) AS "responseId"'
        ])
        .orderBy('COALESCE(unit.alias, unit.name)', 'ASC')
        .addOrderBy('person.code', 'ASC')
        .limit(validLimit)
        .getRawMany(),
      responseQb
        .clone()
        .select([
          'response.id AS "responseId"',
          'response.variableid AS "variableId"',
          'SUBSTRING(response.value, 1, 200) AS "responseValue"',
          'response.status AS "responseStatus"',
          'unit.id AS "unitId"',
          'unit.name AS "unitName"',
          'unit.alias AS "unitAlias"',
          'booklet.id AS "bookletId"',
          'bookletinfo.name AS "bookletName"',
          'person.id AS "personId"',
          'person.code AS "personCode"',
          'person.group AS "personGroup"',
          'person.login AS "personLogin"'
        ])
        .orderBy('person.code', 'ASC')
        .addOrderBy('bookletinfo.name', 'ASC')
        .addOrderBy('COALESCE(unit.alias, unit.name)', 'ASC')
        .addOrderBy('response.variableid', 'ASC')
        .limit(validLimit)
        .getRawMany()
    ]);

    return {
      query: normalizedQuery,
      limit: validLimit,
      persons: (personRows || []).map(row => ({
        kind: 'person',
        id: Number(row.personId),
        label: String(row.personCode || row.personLogin || row.personId),
        secondaryLabel: [row.personGroup, row.personLogin]
          .filter(Boolean)
          .join(' · '),
        personId: Number(row.personId),
        personCode: String(row.personCode || ''),
        personGroup: String(row.personGroup || ''),
        personLogin: String(row.personLogin || '')
      })),
      booklets: (bookletRows || []).map(row => ({
        kind: 'booklet',
        id: Number(row.bookletId),
        label: String(row.bookletName || row.bookletId),
        secondaryLabel: [row.personCode, row.personGroup, row.personLogin]
          .filter(Boolean)
          .join(' · '),
        personId: Number(row.personId),
        personCode: String(row.personCode || ''),
        personGroup: String(row.personGroup || ''),
        personLogin: String(row.personLogin || ''),
        bookletId: Number(row.bookletId),
        bookletName: String(row.bookletName || '')
      })),
      units: (unitRows || []).map(row => ({
        kind: 'unit',
        id: Number(row.unitId),
        label: String(row.unitAlias || row.unitName || row.unitId),
        secondaryLabel: [
          row.bookletName,
          row.unitAlias && row.unitAlias !== row.unitName ?
            row.unitName :
            '',
          row.personCode
        ]
          .filter(Boolean)
          .join(' · '),
        personId: Number(row.personId),
        personCode: String(row.personCode || ''),
        personGroup: String(row.personGroup || ''),
        personLogin: String(row.personLogin || ''),
        bookletId: Number(row.bookletId),
        bookletName: String(row.bookletName || ''),
        unitId: Number(row.unitId),
        unitName: String(row.unitName || ''),
        unitAlias: row.unitAlias == null ? null : String(row.unitAlias),
        responseId: row.responseId == null ? undefined : Number(row.responseId)
      })),
      responses: (responseRows || []).map(row => {
        const responseStatus = statusNumberToString(
          Number(row.responseStatus)
        ) || String(row.responseStatus ?? '');
        return {
          kind: 'response',
          id: Number(row.responseId),
          label: String(row.variableId || row.responseId),
          secondaryLabel: [
            row.bookletName,
            row.unitAlias || row.unitName,
            row.personCode,
            responseStatus
          ]
            .filter(Boolean)
            .join(' · '),
          personId: Number(row.personId),
          personCode: String(row.personCode || ''),
          personGroup: String(row.personGroup || ''),
          personLogin: String(row.personLogin || ''),
          bookletId: Number(row.bookletId),
          bookletName: String(row.bookletName || ''),
          unitId: Number(row.unitId),
          unitName: String(row.unitName || ''),
          unitAlias: row.unitAlias == null ? null : String(row.unitAlias),
          responseId: Number(row.responseId),
          variableId: String(row.variableId || ''),
          responseValue: String(row.responseValue || ''),
          responseStatus
        };
      }),
      totals: {
        person: personTotal,
        booklet: bookletTotal,
        unit: unitTotal,
        response: responseTotal
      }
    };
  }

  async findWorkspaceResponses(
    workspace_id: number,
    options?: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    this.logger.log('Returning responses for workspace', workspace_id);

    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .innerJoinAndSelect('response.unit', 'unit')
      .innerJoinAndSelect('unit.booklet', 'booklet')
      .innerJoinAndSelect('booklet.person', 'person')
      .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspace_id', { workspace_id })
      .andWhere('person.consider = :consider', { consider: true })
      .orderBy('response.id', 'ASC');

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspace_id);
    applyExclusionsToQuery(queryBuilder, exclusions);
    excludeAutocoderGeneratedResponses(queryBuilder);

    if (options) {
      const { page, limit } = options;
      const MAX_LIMIT = 500;
      const validPage = Math.max(1, page);
      const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

      queryBuilder.skip((validPage - 1) * validLimit).take(validLimit);
      const result = await queryBuilder.getManyAndCount();

      this.logger.log(
        `Found ${result[0].length} responses (page ${validPage}, limit ${validLimit}, total ${result[1]}) for workspace ${workspace_id}`
      );
      return result;
    }

    const result = await queryBuilder.getManyAndCount();
    this.logger.log(
      `Found ${result[0].length} responses for workspace ${workspace_id}`
    );

    return result;
  }

  async findUnitLogs(
    workspaceId: number,
    unitId: number
  ): Promise<
    { id: number; unitid: number; ts: string; key: string; parameter: string }[]
  > {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }
    if (!unitId || unitId <= 0) {
      throw new Error('Invalid unitId provided');
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.unitLogRepository
      .createQueryBuilder('unitLog')
      .innerJoin('unitLog.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('unit.id = :unitId', { unitId })
      .select([
        'unitLog.id AS "id"',
        'unitLog.unitid AS "unitid"',
        'unitLog.ts AS "ts"',
        'unitLog.key AS "key"',
        'unitLog.parameter AS "parameter"'
      ])
      .orderBy('unitLog.id', 'ASC');
    applyExclusionsToQuery(query, exclusions);
    const raw = await query
      .getRawMany<{
      id: number;
      unitid: number;
      ts: number | null;
      key: string;
      parameter: string | null;
    }>();

    return (raw || []).map(r => ({
      id: Number(r.id),
      unitid: Number(r.unitid),
      ts: r.ts !== null && r.ts !== undefined ? String(r.ts) : '',
      key: String(r.key || ''),
      parameter:
        r.parameter !== null && r.parameter !== undefined ?
          String(r.parameter) :
          ''
    }));
  }

  async findBookletLogsByUnitId(
    workspaceId: number,
    unitId: number
  ): Promise<{
    bookletId: number;
    logs: {
      id: number;
      bookletid: number;
      ts: string;
      key: string;
      parameter: string;
    }[];
    sessions: {
      id: number;
      browser: string;
      os: string;
      screen: string;
      ts: string;
    }[];
    units: {
      id: number;
      bookletid: number;
      name: string;
      alias: string | null;
      logs: {
        id: number;
        unitid: number;
        ts: string;
        key: string;
        parameter: string;
      }[];
    }[];
  }> {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }
    if (!unitId || unitId <= 0) {
      throw new Error('Invalid unitId provided');
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const unitQuery = this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('unit.id = :unitId', { unitId })
      .select(['unit.id', 'unit.bookletid']);
    applyExclusionsToQuery(unitQuery, exclusions);
    const unitRow = await unitQuery
      .getOne();

    if (!unitRow) {
      throw new Error('Unit not found.');
    }

    const bookletId = Number(unitRow.bookletid);
    const unitsInBookletQuery = this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('unit.bookletid = :bookletId', { bookletId })
      .select(['unit.id', 'unit.bookletid', 'unit.name', 'unit.alias'])
      .orderBy('unit.id', 'ASC');
    applyExclusionsToQuery(unitsInBookletQuery, exclusions);

    const [bookletLogs, sessions, units] = await Promise.all([
      this.bookletLogRepository
        .createQueryBuilder('bookletLog')
        .where('bookletLog.bookletid = :bookletId', { bookletId })
        .select([
          'bookletLog.id',
          'bookletLog.bookletid',
          'bookletLog.ts',
          'bookletLog.parameter',
          'bookletLog.key'
        ])
        .orderBy('bookletLog.id', 'ASC')
        .getMany(),
      this.sessionRepository
        .createQueryBuilder('session')
        .innerJoin('session.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('booklet.id = :bookletId', { bookletId })
        .select([
          'session.id',
          'session.browser',
          'session.os',
          'session.screen',
          'session.ts'
        ])
        .orderBy('session.id', 'ASC')
        .getMany(),
      unitsInBookletQuery.getMany()
    ]);

    return {
      bookletId,
      logs: (bookletLogs || []).map(l => ({
        id: l.id,
        bookletid: l.bookletid,
        ts: l.ts !== null && l.ts !== undefined ? String(l.ts) : '',
        key: l.key,
        parameter: l.parameter || ''
      })),
      sessions: (sessions || []).map(s => ({
        id: s.id,
        browser: s.browser || '',
        os: s.os || '',
        screen: s.screen || '',
        ts: s.ts !== null && s.ts !== undefined ? String(s.ts) : ''
      })),
      units: (units || []).map(u => ({
        id: u.id,
        bookletid: u.bookletid,
        name: u.name,
        alias: u.alias,
        logs: []
      }))
    };
  }

  async findUnitsByName(
    workspaceId: number,
    unitName: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<{
    data: {
      unitId: number;
      unitName: string;
      unitAlias: string | null;
      bookletId: number;
      bookletName: string;
      personId: number;
      personLogin: string;
      personCode: string;
      personGroup: string;
      tags: {
        id: number;
        unitId: number;
        tag: string;
        color?: string;
        createdAt: Date;
      }[];
      responses: {
        variableId: string;
        value: string;
        status: string;
        code?: number | null;
        score?: number | null;
        codedStatus?: string;
      }[];
    }[];
    total: number;
  }> {
    if (!workspaceId || !unitName) {
      throw new Error('Both workspaceId and unitName are required.');
    }

    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    this.logger.log(
      `Finding units by name for workspace ${workspaceId}, unitName: ${unitName}`
    );

    try {
      this.logger.log(
        `Searching for units with name: ${unitName} in workspace: ${workspaceId} (page: ${page}, limit: ${limit})`
      );

      const query = this.unitRepository
        .createQueryBuilder('unit')
        .innerJoinAndSelect('unit.booklet', 'booklet')
        .innerJoinAndSelect('booklet.person', 'person')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .leftJoinAndSelect('unit.responses', 'response')
        .where('unit.name = :unitName', { unitName })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      applyExclusionsToQuery(query, exclusions);

      const total = await query.getCount();

      if (total === 0) {
        this.logger.log(
          `No units found with name: ${unitName} in workspace: ${workspaceId}`
        );
        return { data: [], total: 0 };
      }

      query.skip(skip).take(limit);

      const units = await query.getMany();

      this.logger.log(
        `Found ${total} units with name: ${unitName} in workspace: ${workspaceId}, returning ${units.length} for page ${page}`
      );

      const unitIds = units.map(unit => unit.id);
      const allUnitTags = await Promise.all(
        unitIds.map(unitId => this.unitTagService.findAllByUnitId(workspaceId, unitId))
      );

      const unitTagsMap = new Map<
        number,
        {
          id: number;
          unitId: number;
          tag: string;
          color?: string;
          createdAt: Date;
        }[]
      >();
      unitIds.forEach((unitId, index) => {
        unitTagsMap.set(unitId, allUnitTags[index]);
      });

      let data = units.map(unit => ({
        unitId: unit.id,
        unitName: unit.name,
        unitAlias: unit.alias,
        bookletId: unit.booklet.id,
        bookletName: unit.booklet.bookletinfo.name,
        personId: unit.booklet.person.id,
        personLogin: unit.booklet.person.login,
        personCode: unit.booklet.person.code,
        personGroup: unit.booklet.person.group,
        tags: unitTagsMap.get(unit.id) || [],
        responses: unit.responses ?
          unit.responses.map(response => ({
            variableId: response.variableid,
            value: response.value || '',
            status: statusNumberToString(response.status) || 'UNSET',
            code: response.code_v1,
            score: response.score_v1,
            codedStatus: statusNumberToString(response.status_v1) || 'UNSET'
          })) :
          []
      }));

      const uniqueMap = new Map<string, (typeof data)[number]>();
      data.forEach(item => {
        const uniqueKey = `${item.personGroup}|${item.personCode}|${item.personLogin}|${item.bookletName}|${item.unitName}`;
        if (!uniqueMap.has(uniqueKey)) {
          uniqueMap.set(uniqueKey, item);
        }
      });

      data = Array.from(uniqueMap.values());
      return { data, total: data.length };
    } catch (error) {
      this.logger.error(
        `Failed to search for units with name: ${unitName} in workspace: ${workspaceId}`,
        getErrorStack(error)
      );
      throw new Error(
        `An error occurred while searching for units with name: ${unitName}: ${getErrorMessage(error)}`
      );
    }
  }

  async findBookletsByName(
    workspaceId: number,
    bookletName: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<{
    data: {
      bookletId: number;
      bookletName: string;
      personId: number;
      personLogin: string;
      personCode: string;
      personGroup: string;
      units: {
        unitId: number;
        unitName: string;
        unitAlias: string | null;
      }[];
    }[];
    total: number;
  }> {
    if (!workspaceId || !bookletName) {
      throw new Error('Both workspaceId and bookletName are required.');
    }

    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    this.logger.log(
      `Finding booklets by name for workspace ${workspaceId}, bookletName: ${bookletName}`
    );

    try {
      this.logger.log(
        `Searching for booklets with name: ${bookletName} in workspace: ${workspaceId} (page: ${page}, limit: ${limit})`
      );

      const query = this.bookletRepository
        .createQueryBuilder('booklet')
        .innerJoinAndSelect('booklet.person', 'person')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .leftJoinAndSelect('booklet.units', 'unit')
        .where('bookletinfo.name ILIKE :bookletName', {
          bookletName: `%${bookletName}%`
        })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      applyIgnoredBookletsToQuery(query, exclusions.ignoredBooklets);

      const total = await query.getCount();

      if (total === 0) {
        this.logger.log(
          `No booklets found with name: ${bookletName} in workspace: ${workspaceId}`
        );
        return { data: [], total: 0 };
      }

      query.skip(skip).take(limit);

      const booklets = await query.getMany();

      this.logger.log(
        `Found ${total} booklets with name: ${bookletName} in workspace: ${workspaceId}, returning ${booklets.length} for page ${page}`
      );

      const data = booklets.map(booklet => ({
        bookletId: booklet.id,
        bookletName: booklet.bookletinfo.name,
        personId: booklet.person.id,
        personLogin: booklet.person.login,
        personCode: booklet.person.code,
        personGroup: booklet.person.group,
        units: booklet.units ?
          booklet.units.filter(unit => !isExcludedByResolvedExclusions(
            exclusions,
            booklet.bookletinfo.name,
            unit.name
          )).map(unit => ({
            unitId: unit.id,
            unitName: unit.name,
            unitAlias: unit.alias
          })) :
          []
      }));

      return { data, total };
    } catch (error) {
      this.logger.error(
        `Failed to search for booklets with name: ${bookletName} in workspace: ${workspaceId}`,
        getErrorStack(error)
      );
      throw new Error(
        `An error occurred while searching for booklets with name: ${bookletName}: ${getErrorMessage(error)}`
      );
    }
  }
}
