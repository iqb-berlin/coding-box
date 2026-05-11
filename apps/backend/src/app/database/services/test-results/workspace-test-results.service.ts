import {
  Injectable, Logger, Inject, forwardRef
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder
} from 'typeorm';
import { Response } from 'express';
import * as csv from 'fast-csv';
import * as fs from 'fs';
import { Writable } from 'stream';
import { ResponseValueType } from '@iqbspecs/response/response.interface';
import Persons from '../../entities/persons.entity';
import {
  statusNumberToString,
  statusStringToNumber
} from '../../utils/response-status-converter';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { Session } from '../../entities/session.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { UnitTag } from '../../entities/unitTag.entity';
import { UnitNote } from '../../entities/unitNote.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { UnitLastState } from '../../entities/unitLastState.entity';
import { UnitTagService } from '../workspace/unit-tag.service';
import { JournalService, Chunk, TcMergeResponse } from '../shared';
import { CacheService } from '../../../cache/cache.service';
// eslint-disable-next-line import/no-cycle
import { CodingListService } from '../coding/coding-list.service';
// eslint-disable-next-line import/no-cycle
import { CodingValidationService } from '../coding/coding-validation.service';
// eslint-disable-next-line import/no-cycle
import { ResponseManagementService } from './response-management.service';
// eslint-disable-next-line import/no-cycle
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
// eslint-disable-next-line import/no-cycle
import {
  applyResolvedExclusionsToQuery,
  isExcludedByResolvedExclusions,
  normalizeExclusionBookletId,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { FLAT_FREQUENCIES_CACHE_PREFIX, OVERVIEW_STATS_CACHE_PREFIX } from '../workspace/workspace-constants';
import {
  TestResultsDeletePreviewDto,
  TestResultsDeleteRequestDto,
  TestResultsDeleteResultDto,
  TestResultsDeleteScope
} from '../../../../../../../api-dto/test-results/test-results-deletion.dto';

interface PersonWhere {
  code: string;
  login: string;
  workspace_id: number;
  consider: boolean;
  group?: string;
}

export type WorkspaceOverviewStats = {
  testPersons: number;
  testGroups: number;
  uniqueBooklets: number;
  uniqueUnits: number;
  uniqueResponses: number;
  responseStatusCounts: Record<string, number>;
  sessionBrowserCounts: Record<string, number>;
  sessionOsCounts: Record<string, number>;
  sessionScreenCounts: Record<string, number>;
};

export type FlatFrequenciesResult = Record<
string,
{
  total: number;
  values: Array<{ value: string; count: number; p: number }>;
}
>;

type TestResultsDeleteTargetKind = 'persons' | 'booklets' | 'units';

interface TestResultsDeleteTargets {
  kind: TestResultsDeleteTargetKind;
  ids: number[];
  preview: TestResultsDeletePreviewDto;
}

interface DeleteDependencySnapshot {
  bookletIds: number[];
  unitIds: number[];
  responseIds: number[];
  bookletInfoIds: number[];
}

interface LogDeleteSnapshot {
  bookletIds: number[];
  unitIds: number[];
}

interface LogDeleteCounts {
  bookletLogs: number;
  unitLogs: number;
  sessions: number;
}

@Injectable()
export class WorkspaceTestResultsService {
  private readonly logger = new Logger(WorkspaceTestResultsService.name);
  private static readonly codingResponseStatuses = [
    statusStringToNumber('NOT_REACHED') || 1,
    statusStringToNumber('DISPLAYED') || 2,
    statusStringToNumber('VALUE_CHANGED') || 3
  ];

  private static readonly ignoredDerivedCodingStatuses = [0, 1, 2, 3, 10];

  private static parseStoredResponseValue(value: string | null, variableId?: string): unknown {
    const normalizedVariableId = String(variableId || '').trim();
    const isMarkingPanel = normalizedVariableId.startsWith('marking-panel_');
    if (value === null || value === undefined) {
      if (isMarkingPanel) {
        return [];
      }
      return null;
    }

    const raw = String(value);
    const trimmed = raw.trim();
    if (trimmed === '') {
      return isMarkingPanel ? [] : '';
    }

    if (!isMarkingPanel) {
      // Most interactive controls persist values as JSON arrays.
      // Deserialize array payloads so replay players receive list-like values.
      if (!trimmed.startsWith('[')) {
        // Keep object/primitive payloads as stored text for non-marking variables.
        // Some players expect strings and perform their own parsing.
        return raw;
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          return raw;
        }

        const isPrimitiveArray = parsed.every(item => item === null ||
          ['string', 'number', 'boolean'].includes(typeof item)
        );

        return isPrimitiveArray ? parsed : raw;
      } catch {
        return raw;
      }
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        if (
          parsed.length > 0 &&
          parsed.every(token => typeof token === 'string' && /^\d+-\d+-#[0-9a-fA-F]{3,8}$/.test(token))
        ) {
          return [parsed];
        }
        return parsed;
      }
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { marks?: unknown[] }).marks)) {
        return (parsed as { marks: unknown[] }).marks;
      }
      return [];
    } catch {
      return [];
    }
  }

  private static getEffectiveCodingStatusExpression(version: 'v1' | 'v2' | 'v3' = 'v1'): string {
    if (version === 'v2') {
      return 'COALESCE(response.status_v2, response.status_v1)';
    }

    if (version === 'v3') {
      return "COALESCE(CASE WHEN response.status_v3 ~ '^-?[0-9]+$' THEN response.status_v3::smallint ELSE NULL END, response.status_v2, response.status_v1)";
    }

    return 'response.status_v1';
  }

  private static nonAutocoderGeneratedResponseCondition(responseAlias = 'response'): string {
    return `${responseAlias}.is_autocoder_generated IS NOT TRUE`;
  }

  private excludeAutocoderGeneratedResponses(
    qb: SelectQueryBuilder<unknown>,
    responseAlias = 'response'
  ): void {
    qb.andWhere(
      WorkspaceTestResultsService.nonAutocoderGeneratedResponseCondition(
        responseAlias
      )
    );
  }

  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(BookletInfo)
    private bookletInfoRepository: Repository<BookletInfo>,
    @InjectRepository(BookletLog)
    private bookletLogRepository: Repository<BookletLog>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    @InjectRepository(UnitLog)
    private unitLogRepository: Repository<UnitLog>,
    @InjectRepository(ChunkEntity)
    private chunkRepository: Repository<ChunkEntity>,
    private readonly connection: DataSource,
    private readonly unitTagService: UnitTagService,
    private readonly journalService: JournalService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => CodingListService))
    private readonly codingListService: CodingListService,
    @Inject(forwardRef(() => CodingValidationService))
    private readonly codingValidationService: CodingValidationService,
    private readonly responseManagementService: ResponseManagementService,
    private readonly workspaceCoreService: WorkspaceCoreService,
    private readonly workspaceExclusionService: WorkspaceExclusionService
  ) { }

  private applyExclusionsToQuery(qb: SelectQueryBuilder<unknown>, exclusions: { globalIgnoredUnits: string[], ignoredBooklets: string[], testletIgnoredUnits: Array<{ bookletId: string, unitId: string }> }, options: { unitAlias?: string; bookletInfoAlias?: string } = {}) {
    applyResolvedExclusionsToQuery(qb, exclusions, options);
  }

  private applyIgnoredBookletsToQuery(qb: SelectQueryBuilder<unknown>, ignoredBooklets: string[], bookletInfoAlias = 'bookletinfo'): void {
    if (ignoredBooklets.length > 0) {
      qb.andWhere(`UPPER(${bookletInfoAlias}.name) NOT IN (:...ignoredBookletsOnly)`, {
        ignoredBookletsOnly: ignoredBooklets.map(normalizeExclusionBookletId)
      });
    }
  }

  async invalidateWorkspaceStatsCache(workspaceId: number): Promise<void> {
    await Promise.all([
      this.cacheService.delete(`${OVERVIEW_STATS_CACHE_PREFIX}${workspaceId}`),
      this.cacheService.deleteByPattern(`${FLAT_FREQUENCIES_CACHE_PREFIX}${workspaceId}-*`),
      this.cacheService.delete(`flat_response_filter_options:version:${workspaceId}`),
      this.cacheService.deleteByPattern(`flat_response_filter_options:${workspaceId}:*`)
    ]);
  }

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
    this.applyIgnoredBookletsToQuery(uniqueBookletsQuery, exclusions.ignoredBooklets);
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

    this.applyExclusionsToQuery(unitKeyQuery, exclusions);
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

    this.applyExclusionsToQuery(uniqueResponsesQuery, exclusions);
    this.excludeAutocoderGeneratedResponses(uniqueResponsesQuery);
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

    this.applyExclusionsToQuery(statusRowsQuery, exclusions);
    this.excludeAutocoderGeneratedResponses(statusRowsQuery);
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
          code?: number;
          score?: number;
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
      this.applyIgnoredBookletsToQuery(bookletsQuery, exclusions.ignoredBooklets);
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
          WorkspaceTestResultsService.nonAutocoderGeneratedResponseCondition(
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
        code?: number;
        score?: number;
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
        const allTags = await this.unitTagService.findAllByUnitIds(unitIds);

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
        error.stack
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
        `Failed to fetch test results for workspace_id ${workspace_id}: ${error.message}`,
        error.stack
      );
      throw new Error('An error occurred while fetching test results');
    }
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
    this.applyExclusionsToQuery(queryBuilder, exclusions);
    this.excludeAutocoderGeneratedResponses(queryBuilder);

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

  async resolveDuplicateResponses(
    workspaceId: number,
    resolutionMap: Record<string, number>,
    userId: string
  ): Promise<{ resolvedCount: number; success: boolean }> {
    return this.responseManagementService.resolveDuplicateResponses(
      workspaceId,
      resolutionMap,
      userId
    );
  }

  async findFlatResponses(
    workspaceId: number,
    options: {
      page: number;
      limit: number;
      code?: string;
      group?: string;
      login?: string;
      booklet?: string;
      unit?: string;
      response?: string;
      responseStatus?: string;
      responseValue?: string;
      tags?: string;
      geogebra?: string;
      audioLow?: string;
      hasValue?: string;
      audioLowThreshold?: number | string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: number | string;
      longLoading?: string;
      longLoadingThresholdMs?: number | string;
      processingDurations?: string;
      processingDurationThresholdMs?: number | string;
      processingDurationMin?: string;
      processingDurationMax?: string;
      unitProgress?: string;
      sessionBrowsers?: string;
      sessionOs?: string;
      sessionScreens?: string;
      sessionIds?: string;
    }
  ): Promise<
    [
      Array<{
        responseId: number;
        unitId: number;
        personId: number;
        code: string;
        group: string;
        login: string;
        booklet: string;
        unit: string;
        response: string;
        responseStatus: string;
        responseValue: string;
        tags: string[];
      }>,
      number
    ]
    > {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    const MAX_LIMIT = 200;
    const MAX_RESPONSE_VALUE_LEN = 2000;
    const validPage = Math.max(1, Number(options.page || 1));
    const validLimit = Math.min(
      Math.max(1, Number(options.limit || 50)),
      MAX_LIMIT
    );

    const code = (options.code || '').trim();
    const group = (options.group || '').trim();
    const login = (options.login || '').trim();
    const booklet = (options.booklet || '').trim();
    const unit = (options.unit || '').trim();
    const response = (options.response || '').trim();
    const responseStatus = (options.responseStatus || '').trim();
    const responseValue = (options.responseValue || '').trim();
    const tags = (options.tags || '').trim();
    const geogebra = String(options.geogebra || '')
      .trim()
      .toLowerCase();
    const geogebraOnly =
      geogebra === 'true' || geogebra === '1' || geogebra === 'yes';
    const audioLow = String(options.audioLow || '')
      .trim()
      .toLowerCase();
    const audioLowOnly =
      audioLow === 'true' || audioLow === '1' || audioLow === 'yes';

    const hasValue = String(options.hasValue || '')
      .trim()
      .toLowerCase();
    const hasValueOnly =
      hasValue === 'true' || hasValue === '1' || hasValue === 'yes';
    const audioLowThresholdRaw = String(options.audioLowThreshold || '').trim();
    const audioLowThresholdParsed = Number(audioLowThresholdRaw || 0.9);
    const audioLowThreshold = Number.isFinite(audioLowThresholdParsed) ?
      audioLowThresholdParsed :
      0.9;

    const shortProcessing = String(options.shortProcessing || '')
      .trim()
      .toLowerCase();
    const shortProcessingOnly =
      shortProcessing === 'true' ||
      shortProcessing === '1' ||
      shortProcessing === 'yes';
    const shortProcessingThresholdRaw = String(
      options.shortProcessingThresholdMs || ''
    ).trim();
    const shortProcessingThresholdParsed = Number(
      shortProcessingThresholdRaw || 60000
    );
    const shortProcessingThresholdMs = Number.isFinite(
      shortProcessingThresholdParsed
    ) ?
      shortProcessingThresholdParsed :
      60000;

    const longLoading = String(options.longLoading || '')
      .trim()
      .toLowerCase();
    const longLoadingOnly =
      longLoading === 'true' || longLoading === '1' || longLoading === 'yes';
    const longLoadingThresholdRaw = String(
      options.longLoadingThresholdMs || ''
    ).trim();
    const longLoadingThresholdParsed = Number(longLoadingThresholdRaw || 5000);
    const longLoadingThresholdMs = Number.isFinite(longLoadingThresholdParsed) ?
      longLoadingThresholdParsed :
      5000;

    const processingDurationThresholdRaw = String(
      options.processingDurationThresholdMs || ''
    ).trim();
    const processingDurationThresholdParsed = Number(
      processingDurationThresholdRaw || 60000
    );
    const processingDurationThresholdMs = Number.isFinite(
      processingDurationThresholdParsed
    ) ?
      processingDurationThresholdParsed :
      60000;

    const parseMmSsToMs = (raw: string | undefined): number | null => {
      const v = String(raw || '').trim();
      if (!v) {
        return null;
      }
      const m = v.match(/^(\d+):(\d{1,2})$/);
      if (!m) {
        return null;
      }
      const minutes = Number(m[1]);
      const seconds = Number(m[2]);
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
        return null;
      }
      if (seconds < 0 || seconds >= 60 || minutes < 0) {
        return null;
      }
      return (minutes * 60 + seconds) * 1000;
    };

    const processingDurationMinMs = parseMmSsToMs(
      options.processingDurationMin
    );
    const processingDurationMaxMs = parseMmSsToMs(
      options.processingDurationMax
    );

    const parseCsv = (raw: string | undefined): string[] => String(raw || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

    const processingDurations = parseCsv(options.processingDurations);

    const unitProgressRaw = parseCsv(options.unitProgress);
    const unitProgress = unitProgressRaw
      .map(v => v.toLowerCase())
      .map(v => {
        if (v === 'vollständig') {
          return 'complete';
        }
        if (v === 'unvollständig') {
          return 'incomplete';
        }
        return v;
      })
      .filter(v => v === 'complete' || v === 'incomplete');

    const sessionBrowsers = parseCsv(options.sessionBrowsers);
    const sessionOs = parseCsv(options.sessionOs);
    const sessionScreens = parseCsv(options.sessionScreens);
    const sessionIds = parseCsv(options.sessionIds)
      .map(v => Number(v))
      .filter(v => Number.isFinite(v) && v > 0);

    const parseResponseStatus = (s: string): number | null => {
      const v = (s || '').trim();
      if (!v) {
        return null;
      }
      if (/^\d+$/.test(v)) {
        return Number(v);
      }
      return statusStringToNumber(v);
    };
    const responseStatusNum = parseResponseStatus(responseStatus);

    const qb = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .leftJoin('unit.tags', 'unitTag')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    this.applyExclusionsToQuery(qb, exclusions);
    this.excludeAutocoderGeneratedResponses(qb);

    if (code) {
      qb.andWhere('person.code ILIKE :code', { code: `%${code}%` });
    }
    if (group) {
      qb.andWhere('person.group ILIKE :group', { group: `%${group}%` });
    }
    if (login) {
      qb.andWhere('person.login ILIKE :login', { login: `%${login}%` });
    }
    if (booklet) {
      qb.andWhere('bookletinfo.name ILIKE :booklet', {
        booklet: `%${booklet}%`
      });
    }
    if (unit) {
      qb.andWhere('(unit.alias ILIKE :unit OR unit.name ILIKE :unit)', {
        unit: `%${unit}%`
      });
    }
    if (response) {
      qb.andWhere('response.variableid ILIKE :response', {
        response: `%${response}%`
      });
    }
    if (responseStatus) {
      if (responseStatusNum === null) {
        qb.andWhere('1=0');
      } else {
        qb.andWhere('response.status = :responseStatusNum', {
          responseStatusNum
        });
      }
    }
    if (responseValue) {
      qb.andWhere('response.value ILIKE :responseValue', {
        responseValue: `%${responseValue}%`
      });
    }
    if (tags) {
      qb.andWhere('unitTag.tag ILIKE :tags', { tags: `%${tags}%` });
    }

    if (geogebraOnly) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM response r2 WHERE r2.unitid = unit.id AND r2.value LIKE :ggPrefix)',
        { ggPrefix: 'UEsD%' }
      );
    }

    if (audioLowOnly) {
      qb.andWhere('response.variableid ILIKE :audioPrefix', {
        audioPrefix: 'audio%'
      });
      qb.andWhere("response.value ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'");
      qb.andWhere('(response.value::double precision) < :audioLowThreshold', {
        audioLowThreshold
      });
    }

    if (hasValueOnly) {
      qb.andWhere(
        "BTRIM(COALESCE(response.value, '')) <> '' AND BTRIM(COALESCE(response.value, '')) <> '[]'"
      );
    }

    if (shortProcessingOnly) {
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM bookletlog bl_running
          JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
          WHERE bl_running.bookletid = "bookletEntity"."id"
            AND bl_running.key = 'CONTROLLER'
            AND bl_running.parameter = 'RUNNING'
            AND bl_terminated.key = 'CONTROLLER'
            AND bl_terminated.parameter = 'TERMINATED'
            AND (bl_terminated.ts - bl_running.ts) < :shortProcessingThresholdMs
        )`,
        { shortProcessingThresholdMs }
      );
    }

    if (processingDurations.length > 0) {
      qb.andWhere(
        `(
          CASE
            WHEN (
              SELECT (bl_terminated.ts - bl_running.ts)
              FROM bookletlog bl_running
              JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
              WHERE bl_running.bookletid = "bookletEntity"."id"
                AND bl_running.key = 'CONTROLLER'
                AND bl_running.parameter = 'RUNNING'
                AND bl_terminated.key = 'CONTROLLER'
                AND bl_terminated.parameter = 'TERMINATED'
              ORDER BY bl_running.id ASC, bl_terminated.id ASC
              LIMIT 1
            ) IS NULL THEN 'Unbekannt'
            WHEN (
              SELECT (bl_terminated.ts - bl_running.ts)
              FROM bookletlog bl_running
              JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
              WHERE bl_running.bookletid = "bookletEntity"."id"
                AND bl_running.key = 'CONTROLLER'
                AND bl_running.parameter = 'RUNNING'
                AND bl_terminated.key = 'CONTROLLER'
                AND bl_terminated.parameter = 'TERMINATED'
              ORDER BY bl_running.id ASC, bl_terminated.id ASC
              LIMIT 1
            ) < :processingDurationThresholdMs THEN 'Kurz'
            ELSE 'Lang'
          END
        ) IN (:...processingDurations)`,
        { processingDurations, processingDurationThresholdMs }
      );
    }

    if (processingDurationMinMs !== null || processingDurationMaxMs !== null) {
      const minMs = processingDurationMinMs ?? 0;
      const maxMs = processingDurationMaxMs ?? Number.MAX_SAFE_INTEGER;
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM bookletlog bl_running
          JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
          WHERE bl_running.bookletid = "bookletEntity"."id"
            AND bl_running.key = 'CONTROLLER'
            AND bl_running.parameter = 'RUNNING'
            AND bl_terminated.key = 'CONTROLLER'
            AND bl_terminated.parameter = 'TERMINATED'
            AND (bl_terminated.ts - bl_running.ts) >= :processingDurationMinMs
            AND (bl_terminated.ts - bl_running.ts) <= :processingDurationMaxMs
        )`,
        {
          processingDurationMinMs: minMs,
          processingDurationMaxMs: maxMs
        }
      );
    }

    if (unitProgress.length > 0) {
      qb.andWhere(
        `(
          CASE
            WHEN EXISTS (
              SELECT 1 FROM unit u2
              WHERE u2.bookletid = "bookletEntity"."id"
                AND u2.alias IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM unit u3
              WHERE u3.bookletid = "bookletEntity"."id"
                AND u3.alias IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM bookletlog bl
                  WHERE bl.bookletid = "bookletEntity"."id"
                    AND bl.key = 'CURRENT_UNIT_ID'
                    AND bl.parameter = u3.alias
                )
            )
            THEN 'complete'
            ELSE 'incomplete'
          END
        ) IN (:...unitProgress)`,
        { unitProgress }
      );
    }

    if (sessionBrowsers.length > 0) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.browser IN (:...sessionBrowsers)
        )`,
        { sessionBrowsers }
      );
    }
    if (sessionOs.length > 0) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.os IN (:...sessionOs)
        )`,
        { sessionOs }
      );
    }
    if (sessionScreens.length > 0) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.screen IN (:...sessionScreens)
        )`,
        { sessionScreens }
      );
    }
    if (sessionIds.length > 0) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.id IN (:...sessionIds)
        )`,
        { sessionIds }
      );
    }

    if (longLoadingOnly) {
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM unitlog ul_started
          JOIN unitlog ul_ended ON ul_ended.unitid = ul_started.unitid
          WHERE ul_started.unitid = unit.id
            AND ul_started.key = 'STARTED'
            AND ul_ended.key = 'ENDED'
            AND (ul_ended.ts - ul_started.ts) >= :longLoadingThresholdMs
        )`,
        { longLoadingThresholdMs }
      );
    }

    const countQb = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    this.applyExclusionsToQuery(countQb, exclusions, {
      bookletInfoAlias: 'bookletinfo'
    });
    this.excludeAutocoderGeneratedResponses(countQb);

    if (code) {
      countQb.andWhere('person.code ILIKE :code', { code: `%${code}%` });
    }
    if (group) {
      countQb.andWhere('person.group ILIKE :group', { group: `%${group}%` });
    }
    if (login) {
      countQb.andWhere('person.login ILIKE :login', { login: `%${login}%` });
    }
    if (booklet) {
      countQb.andWhere('bookletinfo.name ILIKE :booklet', {
        booklet: `%${booklet}%`
      });
    }
    if (unit) {
      countQb.andWhere('(unit.alias ILIKE :unit OR unit.name ILIKE :unit)', {
        unit: `%${unit}%`
      });
    }
    if (response) {
      countQb.andWhere('response.variableid ILIKE :response', {
        response: `%${response}%`
      });
    }
    if (responseStatus) {
      if (responseStatusNum === null) {
        countQb.andWhere('1=0');
      } else {
        countQb.andWhere('response.status = :responseStatusNum', {
          responseStatusNum
        });
      }
    }
    if (responseValue) {
      countQb.andWhere('response.value ILIKE :responseValue', {
        responseValue: `%${responseValue}%`
      });
    }
    if (tags) {
      countQb.leftJoin('unit.tags', 'unitTag');
      countQb.andWhere('unitTag.tag ILIKE :tags', { tags: `%${tags}%` });
    }

    if (geogebraOnly) {
      countQb.andWhere(
        'EXISTS (SELECT 1 FROM response r2 WHERE r2.unitid = unit.id AND r2.value LIKE :ggPrefix)',
        { ggPrefix: 'UEsD%' }
      );
    }

    if (audioLowOnly) {
      countQb.andWhere('response.variableid ILIKE :audioPrefix', {
        audioPrefix: 'audio%'
      });
      countQb.andWhere("response.value ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'");
      countQb.andWhere(
        '(response.value::double precision) < :audioLowThreshold',
        {
          audioLowThreshold
        }
      );
    }

    if (shortProcessingOnly) {
      countQb.andWhere(
        `EXISTS (
          SELECT 1
          FROM bookletlog bl_running
          JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
          WHERE bl_running.bookletid = "bookletEntity"."id"
            AND bl_running.key = 'CONTROLLER'
            AND bl_running.parameter = 'RUNNING'
            AND bl_terminated.key = 'CONTROLLER'
            AND bl_terminated.parameter = 'TERMINATED'
            AND (bl_terminated.ts - bl_running.ts) < :shortProcessingThresholdMs
        )`,
        { shortProcessingThresholdMs }
      );
    }

    if (longLoadingOnly) {
      countQb.andWhere(
        `EXISTS (
          SELECT 1
          FROM unitlog ul_started
          JOIN unitlog ul_ended ON ul_ended.unitid = ul_started.unitid
          WHERE ul_started.unitid = unit.id
            AND ul_started.key = 'STARTED'
            AND ul_ended.key = 'ENDED'
            AND (ul_ended.ts - ul_started.ts) >= :longLoadingThresholdMs
        )`,
        { longLoadingThresholdMs }
      );
    }

    if (processingDurations.length > 0) {
      countQb.andWhere(
        `(
          CASE
            WHEN (
              SELECT (bl_terminated.ts - bl_running.ts)
              FROM bookletlog bl_running
              JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
              WHERE bl_running.bookletid = "bookletEntity"."id"
                AND bl_running.key = 'CONTROLLER'
                AND bl_running.parameter = 'RUNNING'
                AND bl_terminated.key = 'CONTROLLER'
                AND bl_terminated.parameter = 'TERMINATED'
              ORDER BY bl_running.id ASC, bl_terminated.id ASC
              LIMIT 1
            ) IS NULL THEN 'Unbekannt'
            WHEN (
              SELECT (bl_terminated.ts - bl_running.ts)
              FROM bookletlog bl_running
              JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
              WHERE bl_running.bookletid = "bookletEntity"."id"
                AND bl_running.key = 'CONTROLLER'
                AND bl_running.parameter = 'RUNNING'
                AND bl_terminated.key = 'CONTROLLER'
                AND bl_terminated.parameter = 'TERMINATED'
              ORDER BY bl_running.id ASC, bl_terminated.id ASC
              LIMIT 1
            ) < :processingDurationThresholdMs THEN 'Kurz'
            ELSE 'Lang'
          END
        ) IN (:...processingDurations)`,
        { processingDurations, processingDurationThresholdMs }
      );
    }

    if (unitProgress.length > 0) {
      countQb.andWhere(
        `(
          CASE
            WHEN EXISTS (
              SELECT 1 FROM unit u2
              WHERE u2.bookletid = "bookletEntity"."id"
                AND u2.alias IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM unit u3
              WHERE u3.bookletid = "bookletEntity"."id"
                AND u3.alias IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM bookletlog bl
                  WHERE bl.bookletid = "bookletEntity"."id"
                    AND bl.key = 'CURRENT_UNIT_ID'
                    AND bl.parameter = u3.alias
                )
            )
            THEN 'complete'
            ELSE 'incomplete'
          END
        ) IN (:...unitProgress)`,
        { unitProgress }
      );
    }

    if (sessionBrowsers.length > 0) {
      countQb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.browser IN (:...sessionBrowsers)
        )`,
        { sessionBrowsers }
      );
    }
    if (sessionOs.length > 0) {
      countQb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.os IN (:...sessionOs)
        )`,
        { sessionOs }
      );
    }
    if (sessionScreens.length > 0) {
      countQb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.screen IN (:...sessionScreens)
        )`,
        { sessionScreens }
      );
    }

    // Note: Session filters above are applied as separate EXISTS per dimension.

    const total = await countQb
      .select('COUNT(DISTINCT response.id)', 'cnt')
      .getRawOne()
      .then(r => Number(r?.cnt || 0));

    const raw = await qb
      .select([
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
        "COALESCE(string_agg(DISTINCT unitTag.tag, ','), '') AS \"tags\""
      ])
      .setParameter('maxResponseValueLen', MAX_RESPONSE_VALUE_LEN)
      .groupBy('response.id')
      .addGroupBy('unit.id')
      .addGroupBy('person.id')
      .addGroupBy('bookletinfo.name')
      .addGroupBy('unit.alias')
      .addGroupBy('unit.name')
      .addGroupBy('person.code')
      .addGroupBy('person.group')
      .addGroupBy('person.login')
      .addGroupBy('response.variableid')
      .addGroupBy('response.status')
      .orderBy('person.code', 'ASC')
      .addOrderBy('bookletinfo.name', 'ASC')
      .addOrderBy('unit.alias', 'ASC')
      .addOrderBy('response.variableid', 'ASC')
      .offset((validPage - 1) * validLimit)
      .limit(validLimit)
      .getRawMany();

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
        tags: tagList
      };
    });

    return [mapped, total];
  }

  async findFlatResponseFrequencies(
    workspaceId: number,
    combos: Array<{ unitKey: string; variableId: string; values: string[] }>
  ): Promise<
    Record<
    string,
    {
      total: number;
      values: Array<{ value: string; count: number; p: number }>;
    }
    >
    > {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    const normalized = (combos || [])
      .map(c => ({
        unitKey: String(c.unitKey || '').trim(),
        variableId: String(c.variableId || '').trim(),
        values: Array.isArray(c.values) ?
          c.values.map(v => String(v ?? '')) :
          []
      }))
      .filter(c => !!c.unitKey && !!c.variableId);

    if (normalized.length === 0) {
      return {};
    }

    // Sort combos for consistent cache key
    const sortedCombos = [...normalized].sort((a, b) => {
      const keyA = `${a.unitKey}:${a.variableId}`;
      const keyB = `${b.unitKey}:${b.variableId}`;
      return keyA.localeCompare(keyB);
    });

    const cacheKey = `${FLAT_FREQUENCIES_CACHE_PREFIX}${workspaceId}-${JSON.stringify(sortedCombos)}`;
    const cached = await this.cacheService.get<FlatFrequenciesResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const uniqueMap = new Map<
    string,
    { unitKey: string; variableId: string; values: string[] }
    >();
    normalized.forEach(c => {
      const key = `${encodeURIComponent(c.unitKey)}:${encodeURIComponent(
        c.variableId
      )}`;
      const prev = uniqueMap.get(key);
      if (prev) {
        prev.values = Array.from(
          new Set([...(prev.values || []), ...(c.values || [])])
        );
      } else {
        uniqueMap.set(key, {
          unitKey: c.unitKey,
          variableId: c.variableId,
          values: Array.from(new Set(c.values || []))
        });
      }
    });
    const uniqueCombos = Array.from(uniqueMap.values());

    const qb = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .innerJoin('bookletEntity.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    this.applyExclusionsToQuery(qb, exclusions, {
      bookletInfoAlias: 'bookletinfo'
    });
    this.excludeAutocoderGeneratedResponses(qb);

    const params: Record<string, unknown> = {};
    const orParts = uniqueCombos.map((c, idx) => {
      const uk = `uk${idx}`;
      const v = `v${idx}`;
      params[uk] = c.unitKey;
      params[v] = c.variableId;
      return `(COALESCE(unit.alias, unit.name) = :${uk} AND response.variableid = :${v})`;
    });
    qb.andWhere(`(${orParts.join(' OR ')})`, params);

    const allRequestedValues = Array.from(
      new Set(
        uniqueCombos.flatMap(c => (c.values || []).map(v => String(v ?? ''))
        )
      )
    );

    const totalsRaw = await qb
      .clone()
      .select([
        'COALESCE(unit.alias, unit.name) AS "unitKey"',
        'response.variableid AS "variableId"',
        'COUNT(*)::int AS "total"'
      ])
      .groupBy('COALESCE(unit.alias, unit.name)')
      .addGroupBy('response.variableid')
      .getRawMany<{
      unitKey: string;
      variableId: string;
      total: number | string;
    }>();

    const totalByKey = new Map<string, number>();
    totalsRaw.forEach(r => {
      const unitKey = String(r.unitKey || '').trim();
      const variableId = String(r.variableId || '').trim();
      totalByKey.set(
        `${encodeURIComponent(unitKey)}:${encodeURIComponent(variableId)}`,
        Number(r.total || 0)
      );
    });

    const countsQb = qb.clone();
    if (allRequestedValues.length > 0) {
      countsQb.andWhere(
        "SUBSTRING(COALESCE(response.value, ''), 1, 2000) IN (:...values)",
        { values: allRequestedValues }
      );
    }

    const countsRaw = await countsQb
      .select([
        'COALESCE(unit.alias, unit.name) AS "unitKey"',
        'response.variableid AS "variableId"',
        'SUBSTRING(COALESCE(response.value, \'\'), 1, 2000) AS "value"',
        'COUNT(*)::int AS "count"'
      ])
      .groupBy('COALESCE(unit.alias, unit.name)')
      .addGroupBy('response.variableid')
      .addGroupBy("SUBSTRING(COALESCE(response.value, ''), 1, 2000)")
      .getRawMany<{
      unitKey: string;
      variableId: string;
      value: string;
      count: number | string;
    }>();

    const countByKeyAndValue = new Map<string, number>();
    countsRaw.forEach(r => {
      const unitKey = String(r.unitKey || '').trim();
      const variableId = String(r.variableId || '').trim();
      const comboKey = `${encodeURIComponent(unitKey)}:${encodeURIComponent(
        variableId
      )}`;
      const value = String(r.value ?? '');
      countByKeyAndValue.set(`${comboKey}@@${value}`, Number(r.count || 0));
    });

    const result: Record<
    string,
    {
      total: number;
      values: Array<{ value: string; count: number; p: number }>;
    }
    > = {};
    uniqueCombos.forEach(c => {
      const key = `${encodeURIComponent(c.unitKey)}:${encodeURIComponent(
        c.variableId
      )}`;
      const total = totalByKey.get(key) || 0;
      const values = Array.from(new Set(c.values || []));

      const rows = values.map(v => {
        const count = countByKeyAndValue.get(`${key}@@${v}`) || 0;
        return {
          value: v,
          count,
          p: total > 0 ? (count / total) * 100 : 0
        };
      });
      result[key] = { total, values: rows };
    });

    await this.cacheService.set(cacheKey, result, 300); // 5 minutes cache
    return result;
  }

  async findFlatResponseFilterOptions(
    workspaceId: number,
    options: {
      code?: string;
      group?: string;
      login?: string;
      booklet?: string;
      unit?: string;
      response?: string;
      responseStatus?: string;
      responseValue?: string;
      tags?: string;
      geogebra?: string;
      audioLow?: string;
      audioLowThreshold?: number | string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: number | string;
      longLoading?: string;
      longLoadingThresholdMs?: number | string;
      processingDurations?: string;
      processingDurationThresholdMs?: number | string;
      unitProgress?: string;
      sessionBrowsers?: string;
      sessionOs?: string;
      sessionScreens?: string;
      sessionIds?: string;
    }
  ): Promise<{
      codes: string[];
      groups: string[];
      logins: string[];
      booklets: string[];
      units: string[];
      responses: string[];
      responseStatuses: string[];
      tags: string[];
      processingDurations: string[];
      unitProgresses: string[];
      sessionBrowsers: string[];
      sessionOs: string[];
      sessionScreens: string[];
      sessionIds: string[];
    }> {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    const MAX_OPTIONS = 500;

    const code = (options.code || '').trim();
    const group = (options.group || '').trim();
    const login = (options.login || '').trim();
    const booklet = (options.booklet || '').trim();
    const unit = (options.unit || '').trim();
    const response = (options.response || '').trim();
    const responseStatus = (options.responseStatus || '').trim();
    const responseValue = (options.responseValue || '').trim();
    const tags = (options.tags || '').trim();
    const geogebra = String(options.geogebra || '')
      .trim()
      .toLowerCase();
    const geogebraOnly =
      geogebra === 'true' || geogebra === '1' || geogebra === 'yes';
    const audioLow = String(options.audioLow || '')
      .trim()
      .toLowerCase();
    const audioLowOnly =
      audioLow === 'true' || audioLow === '1' || audioLow === 'yes';
    const audioLowThresholdRaw = String(options.audioLowThreshold || '').trim();
    const audioLowThresholdParsed = Number(audioLowThresholdRaw || 0.9);
    const audioLowThreshold = Number.isFinite(audioLowThresholdParsed) ?
      audioLowThresholdParsed :
      0.9;

    const shortProcessing = String(options.shortProcessing || '')
      .trim()
      .toLowerCase();
    const shortProcessingOnly =
      shortProcessing === 'true' ||
      shortProcessing === '1' ||
      shortProcessing === 'yes';
    const shortProcessingThresholdRaw = String(
      options.shortProcessingThresholdMs || ''
    ).trim();
    const shortProcessingThresholdParsed = Number(
      shortProcessingThresholdRaw || 60000
    );
    const shortProcessingThresholdMs = Number.isFinite(
      shortProcessingThresholdParsed
    ) ?
      shortProcessingThresholdParsed :
      60000;

    const longLoading = String(options.longLoading || '')
      .trim()
      .toLowerCase();
    const longLoadingOnly =
      longLoading === 'true' || longLoading === '1' || longLoading === 'yes';
    const longLoadingThresholdRaw = String(
      options.longLoadingThresholdMs || ''
    ).trim();
    const longLoadingThresholdParsed = Number(longLoadingThresholdRaw || 5000);
    const longLoadingThresholdMs = Number.isFinite(longLoadingThresholdParsed) ?
      longLoadingThresholdParsed :
      5000;

    const processingDurationThresholdRaw = String(
      options.processingDurationThresholdMs || ''
    ).trim();
    const processingDurationThresholdParsed = Number(
      processingDurationThresholdRaw || 60000
    );
    const processingDurationThresholdMs = Number.isFinite(
      processingDurationThresholdParsed
    ) ?
      processingDurationThresholdParsed :
      60000;

    const parseResponseStatus = (s: string): number | null => {
      const v = (s || '').trim();
      if (!v) {
        return null;
      }
      if (/^\d+$/.test(v)) {
        return Number(v);
      }
      return statusStringToNumber(v);
    };
    const responseStatusNum = parseResponseStatus(responseStatus);

    const baseQb = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .leftJoin('unit.tags', 'unitTag')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    this.applyExclusionsToQuery(baseQb, exclusions, {
      bookletInfoAlias: 'bookletinfo'
    });
    this.excludeAutocoderGeneratedResponses(baseQb);

    if (code) {
      baseQb.andWhere('person.code ILIKE :code', { code: `%${code}%` });
    }
    if (group) {
      baseQb.andWhere('person.group ILIKE :group', { group: `%${group}%` });
    }
    if (login) {
      baseQb.andWhere('person.login ILIKE :login', { login: `%${login}%` });
    }
    if (booklet) {
      baseQb.andWhere('bookletinfo.name ILIKE :booklet', {
        booklet: `%${booklet}%`
      });
    }
    if (unit) {
      baseQb.andWhere('(unit.alias ILIKE :unit OR unit.name ILIKE :unit)', {
        unit: `%${unit}%`
      });
    }
    if (response) {
      baseQb.andWhere('response.variableid ILIKE :response', {
        response: `%${response}%`
      });
    }
    if (responseStatus) {
      if (responseStatusNum === null) {
        baseQb.andWhere('1=0');
      } else {
        baseQb.andWhere('response.status = :responseStatusNum', {
          responseStatusNum
        });
      }
    }
    if (responseValue) {
      baseQb.andWhere('response.value ILIKE :responseValue', {
        responseValue: `%${responseValue}%`
      });
    }
    if (tags) {
      baseQb.andWhere('unitTag.tag ILIKE :tags', { tags: `%${tags}%` });
    }

    if (geogebraOnly) {
      baseQb.andWhere(
        'EXISTS (SELECT 1 FROM response r2 WHERE r2.unitid = unit.id AND r2.value LIKE :ggPrefix)',
        { ggPrefix: 'UEsD%' }
      );
    }

    if (audioLowOnly) {
      baseQb.andWhere('response.variableid ILIKE :audioPrefix', {
        audioPrefix: 'audio%'
      });
      baseQb.andWhere("response.value ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'");
      baseQb.andWhere(
        '(response.value::double precision) < :audioLowThreshold',
        {
          audioLowThreshold
        }
      );
    }

    if (shortProcessingOnly) {
      baseQb.andWhere(
        `EXISTS (
          SELECT 1
          FROM bookletlog bl_running
          JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
          WHERE bl_running.bookletid = "bookletEntity"."id"
            AND bl_running.key = 'CONTROLLER'
            AND bl_running.parameter = 'RUNNING'
            AND bl_terminated.key = 'CONTROLLER'
            AND bl_terminated.parameter = 'TERMINATED'
            AND (bl_terminated.ts - bl_running.ts) < :shortProcessingThresholdMs
        )`,
        { shortProcessingThresholdMs }
      );
    }

    if (longLoadingOnly) {
      baseQb.andWhere(
        `EXISTS (
          SELECT 1
          FROM unitlog ul_started
          JOIN unitlog ul_ended ON ul_ended.unitid = ul_started.unitid
          WHERE ul_started.unitid = unit.id
            AND ul_started.key = 'STARTED'
            AND ul_ended.key = 'ENDED'
            AND (ul_ended.ts - ul_started.ts) >= :longLoadingThresholdMs
        )`,
        { longLoadingThresholdMs }
      );
    }

    const parseCsv = (raw: string | undefined): string[] => String(raw || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

    const processingDurations = parseCsv(options.processingDurations);

    const unitProgressRaw = parseCsv(options.unitProgress);
    const unitProgress = unitProgressRaw
      .map(v => v.toLowerCase())
      .map(v => {
        if (v === 'vollständig') {
          return 'complete';
        }
        if (v === 'unvollständig') {
          return 'incomplete';
        }
        return v;
      })
      .filter(v => v === 'complete' || v === 'incomplete');

    const sessionBrowsers = parseCsv(options.sessionBrowsers);
    const sessionOs = parseCsv(options.sessionOs);
    const sessionScreens = parseCsv(options.sessionScreens);

    if (processingDurations.length > 0) {
      baseQb.andWhere(
        `(
          CASE
            WHEN (
              SELECT (bl_terminated.ts - bl_running.ts)
              FROM bookletlog bl_running
              JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
              WHERE bl_running.bookletid = "bookletEntity"."id"
                AND bl_running.key = 'CONTROLLER'
                AND bl_running.parameter = 'RUNNING'
                AND bl_terminated.key = 'CONTROLLER'
                AND bl_terminated.parameter = 'TERMINATED'
              ORDER BY bl_running.id ASC, bl_terminated.id ASC
              LIMIT 1
            ) IS NULL THEN 'Unbekannt'
            WHEN (
              SELECT (bl_terminated.ts - bl_running.ts)
              FROM bookletlog bl_running
              JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
              WHERE bl_running.bookletid = "bookletEntity"."id"
                AND bl_running.key = 'CONTROLLER'
                AND bl_running.parameter = 'RUNNING'
                AND bl_terminated.key = 'CONTROLLER'
                AND bl_terminated.parameter = 'TERMINATED'
              ORDER BY bl_running.id ASC, bl_terminated.id ASC
              LIMIT 1
            ) < :processingDurationThresholdMs THEN 'Kurz'
            ELSE 'Lang'
          END
        ) IN (:...processingDurations)`,
        { processingDurations, processingDurationThresholdMs }
      );
    }

    if (unitProgress.length > 0) {
      baseQb.andWhere(
        `(
          CASE
            WHEN EXISTS (
              SELECT 1 FROM unit u2
              WHERE u2.bookletid = "bookletEntity"."id"
                AND u2.alias IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM unit u3
              WHERE u3.bookletid = "bookletEntity"."id"
                AND u3.alias IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM bookletlog bl
                  WHERE bl.bookletid = "bookletEntity"."id"
                    AND bl.key = 'CURRENT_UNIT_ID'
                    AND bl.parameter = u3.alias
                )
            )
            THEN 'complete'
            ELSE 'incomplete'
          END
        ) IN (:...unitProgress)`,
        { unitProgress }
      );
    }

    if (sessionBrowsers.length > 0) {
      baseQb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.browser IN (:...sessionBrowsers)
        )`,
        { sessionBrowsers }
      );
    }
    if (sessionOs.length > 0) {
      baseQb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.os IN (:...sessionOs)
        )`,
        { sessionOs }
      );
    }
    if (sessionScreens.length > 0) {
      baseQb.andWhere(
        `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND s.screen IN (:...sessionScreens)
        )`,
        { sessionScreens }
      );
    }

    // Note: Session filters above are applied as separate EXISTS per dimension.

    const [
      codeRows,
      groupRows,
      loginRows,
      bookletRows,
      unitRows,
      responseRows,
      responseStatusRows,
      tagRows,
      processingDurationRows,
      unitProgressRows,
      sessionBrowserRows,
      sessionOsRows,
      sessionScreenRows,
      sessionIdRows
    ] = await Promise.all([
      baseQb
        .clone()
        .select('DISTINCT person.code', 'v')
        .orderBy('person.code', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .select('DISTINCT person.group', 'v')
        .orderBy('person.group', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .select('DISTINCT person.login', 'v')
        .orderBy('person.login', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .select('DISTINCT bookletinfo.name', 'v')
        .orderBy('bookletinfo.name', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .select('DISTINCT COALESCE(unit.alias, unit.name)', 'v')
        .orderBy('v', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .select('DISTINCT response.variableid', 'v')
        .orderBy('response.variableid', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .select('DISTINCT response.status', 'v')
        .orderBy('response.status', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string | number }>(),
      baseQb
        .clone()
        .select('DISTINCT unitTag.tag', 'v')
        .where('unitTag.tag IS NOT NULL')
        .orderBy('unitTag.tag', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .select(
          `DISTINCT (
            CASE
              WHEN (
                SELECT (bl_terminated.ts - bl_running.ts)
                FROM bookletlog bl_running
                JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
                WHERE bl_running.bookletid = "bookletEntity"."id"
                  AND bl_running.key = 'CONTROLLER'
                  AND bl_running.parameter = 'RUNNING'
                  AND bl_terminated.key = 'CONTROLLER'
                  AND bl_terminated.parameter = 'TERMINATED'
                ORDER BY bl_running.id ASC, bl_terminated.id ASC
                LIMIT 1
              ) IS NULL THEN 'Unbekannt'
              WHEN (
                SELECT (bl_terminated.ts - bl_running.ts)
                FROM bookletlog bl_running
                JOIN bookletlog bl_terminated ON bl_terminated.bookletid = bl_running.bookletid
                WHERE bl_running.bookletid = "bookletEntity"."id"
                  AND bl_running.key = 'CONTROLLER'
                  AND bl_running.parameter = 'RUNNING'
                  AND bl_terminated.key = 'CONTROLLER'
                  AND bl_terminated.parameter = 'TERMINATED'
                ORDER BY bl_running.id ASC, bl_terminated.id ASC
                LIMIT 1
              ) < :processingDurationThresholdMs THEN 'Kurz'
              ELSE 'Lang'
            END
          )`,
          'v'
        )
        .orderBy('v', 'ASC')
        .limit(MAX_OPTIONS)
        .setParameter(
          'processingDurationThresholdMs',
          processingDurationThresholdMs
        )
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .select(
          `DISTINCT (
            CASE
              WHEN EXISTS (
                SELECT 1 FROM unit u2
                WHERE u2.bookletid = "bookletEntity"."id"
                  AND u2.alias IS NOT NULL
              )
              AND NOT EXISTS (
                SELECT 1 FROM unit u3
                WHERE u3.bookletid = "bookletEntity"."id"
                  AND u3.alias IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM bookletlog bl
                    WHERE bl.bookletid = "bookletEntity"."id"
                      AND bl.key = 'CURRENT_UNIT_ID'
                      AND bl.parameter = u3.alias
                  )
              )
              THEN 'complete'
              ELSE 'incomplete'
            END
          )`,
          'v'
        )
        .orderBy('v', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .leftJoin('bookletEntity.sessions', 'session')
        .select('DISTINCT session.browser', 'v')
        .where('session.browser IS NOT NULL')
        .orderBy('session.browser', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .leftJoin('bookletEntity.sessions', 'session')
        .select('DISTINCT session.os', 'v')
        .where('session.os IS NOT NULL')
        .orderBy('session.os', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .leftJoin('bookletEntity.sessions', 'session')
        .select('DISTINCT session.screen', 'v')
        .where('session.screen IS NOT NULL')
        .orderBy('session.screen', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .leftJoin('bookletEntity.sessions', 'session')
        .select('DISTINCT session.id', 'v')
        .where('session.id IS NOT NULL')
        .orderBy('session.id', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>()
    ]);

    const mapVals = (rows: Array<{ v: string }>) => (rows || []).map(r => String(r.v || '').trim()).filter(Boolean);

    const responseStatuses = Array.from(
      new Set(
        (responseStatusRows || [])
          .map(r => statusNumberToString(Number((r as { v: string | number }).v))
          )
          .filter(
            (v): v is Exclude<ReturnType<typeof statusNumberToString>, null> => v !== null
          )
      )
    );

    const processingDurationsOut = mapVals(processingDurationRows);

    const unitProgressesOut = Array.from(
      new Set(mapVals(unitProgressRows).map(v => v.toLowerCase()))
    )
      .filter(v => v === 'complete' || v === 'incomplete')
      .map(v => (v === 'complete' ? 'Vollständig' : 'Unvollständig'));

    return {
      codes: mapVals(codeRows),
      groups: mapVals(groupRows),
      logins: mapVals(loginRows),
      booklets: mapVals(bookletRows),
      units: mapVals(unitRows),
      responses: mapVals(responseRows),
      responseStatuses,
      tags: mapVals(tagRows),
      processingDurations: processingDurationsOut,
      unitProgresses: unitProgressesOut,
      sessionBrowsers: mapVals(sessionBrowserRows),
      sessionOs: mapVals(sessionOsRows),
      sessionScreens: mapVals(sessionScreenRows),
      sessionIds: mapVals(sessionIdRows)
    };
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
    this.applyExclusionsToQuery(query, exclusions);
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
    this.applyExclusionsToQuery(unitQuery, exclusions);
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
    this.applyExclusionsToQuery(unitsInBookletQuery, exclusions);

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

  async findUnitResponse(
    workspaceId: number,
    connector: string,
    unitId: string
  ): Promise<{
      responses: {
        id: string;
        content: string;
      }[];
    }> {
    const cacheKey = `${this.cacheService.generateUnitResponseCacheKey(
      workspaceId,
      connector,
      unitId
    )}:v6`;
    const cachedResponse = await this.cacheService.get<{
      responses: {
        id: string;
        content: string;
      }[];
    }>(cacheKey);

    if (cachedResponse) {
      this.logger.log(
        `Cache hit for responses: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`
      );
      return cachedResponse;
    }

    this.logger.log(
      `Cache miss for responses: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`
    );

    const parts = connector.split('@');
    const login = parts[0];
    const code = parts[1];
    const group = parts.length >= 4 ? parts[2] : undefined;
    const bookletId = parts[parts.length - 1];
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    if (isExcludedByResolvedExclusions(exclusions, bookletId, unitId)) {
      return { responses: [] };
    }

    const createUnitLookupQuery = () => {
      const queryBuilder = this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .select('unit.id', 'unitId')
        .where('person.login = :login', { login })
        .andWhere('person.code = :code', { code });

      if (group) {
        queryBuilder.andWhere('person.group = :group', { group });
      }

      queryBuilder
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('bookletinfo.name = :bookletId', { bookletId });
      this.applyExclusionsToQuery(queryBuilder, exclusions);
      return queryBuilder;
    };

    let unitRow = await createUnitLookupQuery()
      .andWhere('unit.alias = :unitId', { unitId })
      .getRawOne<{ unitId: number }>();

    if (!unitRow) {
      unitRow = await createUnitLookupQuery()
        .andWhere('unit.name = :unitId', { unitId })
        .getRawOne<{ unitId: number }>();
    }

    const unitDbId = unitRow?.unitId;

    if (!unitDbId) {
      const personWhere: PersonWhere = {
        code,
        login,
        workspace_id: workspaceId,
        consider: true
      };
      if (group) {
        personWhere.group = group;
      }

      const person = await this.personsRepository.findOne({
        where: personWhere
      });

      if (!person) {
        const searchDescription = group ?
          `Person mit Login ${login}, Code ${code} und Gruppe ${group}` :
          `Person mit Login ${login} und Code ${code}`;
        throw new Error(`${searchDescription} wurde nicht gefunden.`);
      }

      const bookletInfo = await this.bookletInfoRepository.findOne({
        where: { name: bookletId }
      });

      if (!bookletInfo) {
        throw new Error(`Kein Booklet mit der ID ${bookletId} gefunden.`);
      }

      const booklet = await this.bookletRepository.findOne({
        where: {
          personid: person.id,
          infoid: bookletInfo.id
        }
      });

      if (!booklet) {
        throw new Error(
          `Kein Booklet für die Person mit ID ${person.id} und Booklet ID ${bookletId} gefunden.`
        );
      }

      throw new Error(
        `Keine Unit mit der ID ${unitId} für das Booklet ${bookletId} gefunden.`
      );
    }

    const chunks = await this.chunkRepository.find({
      where: { unitid: unitDbId }
    });

    if (chunks.length > 0) {
      this.logger.log(`Found ${chunks.length} chunks for unit ${unitDbId}`);
      chunks.forEach(chunk => {
        this.logger.log(
          `Chunk: key=${chunk.key}, type=${chunk.type}, variables=${chunk.variables}, ts=${chunk.ts}`
        );
      });
    } else {
      this.logger.log(`No chunks found for unit ${unitDbId}`);
    }

    const responseRows = await this.responseRepository
      .createQueryBuilder('response')
      .select([
        'response.variableid AS variableid',
        'response.value AS value',
        'response.status AS status',
        'response.subform AS subform'
      ])
      .where('response.unitid = :unitDbId', { unitDbId })
      .andWhere(
        WorkspaceTestResultsService.nonAutocoderGeneratedResponseCondition(
          'response'
        )
      )
      .getRawMany<{
      variableid: string;
      value: string | null;
      status: number;
      subform: string | null;
    }>();

    const chunkKeyMap = new Map<string, { key: string; ts: number }>();
    chunks.forEach(chunk => {
      if (chunk.variables) {
        const chunkTs = Number(chunk.ts) || 0;
        const variables = chunk.variables.split(',').map(v => v.trim());
        variables.forEach(variable => {
          const current = chunkKeyMap.get(variable);
          if (!current || chunkTs >= current.ts) {
            chunkKeyMap.set(variable, { key: chunk.key, ts: chunkTs });
          }
        });
      }
    });

    const responsesByChunk = new Map<string, Map<string, {
      id: string;
      value: unknown;
      status: number;
      chunkTs: number;
    }>>();

    responseRows.forEach(response => {
      const mappedChunk = chunkKeyMap.get(response.variableid);
      const chunkKey = mappedChunk?.key || response.subform || '';
      const chunkTs = mappedChunk?.ts || 0;
      const mappedResponse = {
        id: response.variableid,
        value: WorkspaceTestResultsService.parseStoredResponseValue(response.value, response.variableid),
        status: response.status,
        chunkTs
      };

      if (!responsesByChunk.has(chunkKey)) {
        responsesByChunk.set(chunkKey, new Map());
      }
      const chunkResponses = responsesByChunk.get(chunkKey)!;
      const existing = chunkResponses.get(mappedResponse.id);
      if (!existing || mappedResponse.chunkTs >= existing.chunkTs) {
        chunkResponses.set(mappedResponse.id, mappedResponse);
      }
    });

    const responsesArray = Array.from(responsesByChunk.entries()).map(([chunkKey, responseMap]) => ({
      id: chunkKey,
      content: JSON.stringify(Array.from(responseMap.values()).map(({
        chunkTs: _chunkTs,
        ...response
      }) => response))
    }));

    const result = {
      responses: responsesArray
    };

    await this.cacheService.set(cacheKey, result);
    this.logger.log(
      `Cached responses for: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`
    );

    return result;
  }

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
      const effectiveStatusExpression = WorkspaceTestResultsService.getEffectiveCodingStatusExpression(version);
      const queryBuilder = this.responseRepository
        .createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.status IN (:...codingResponseStatuses)', {
          codingResponseStatuses: WorkspaceTestResultsService.codingResponseStatuses
        })
        .andWhere('person.workspace_id = :workspace_id_param', {
          workspace_id_param: workspace_id
        })
        .andWhere('person.consider = :consider', { consider: true })
        .orderBy('response.id', 'ASC');
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspace_id);
      this.applyExclusionsToQuery(queryBuilder, exclusions);

      if (status === 'null') {
        queryBuilder.andWhere(`${effectiveStatusExpression} IS NULL`);
      } else {
        const statusNumber = statusStringToNumber(status);
        if (statusNumber === null) {
          this.logger.warn(`Invalid coding status filter: ${status}`);
          return [[], 0];
        }

        queryBuilder.andWhere(`${effectiveStatusExpression} = :statusParam`, {
          statusParam: statusNumber
        });
      }

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
      this.logger.error(`Error getting responses by status: ${error.message}`);
      return [[], 0];
    }
  }

  async deleteTestPersons(
    workspaceId: number,
    testPersonIds: string,
    userId: string
  ): Promise<{
      success: boolean;
      report: {
        deletedPersons: string[];
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const ids = testPersonIds.split(',').map(id => id.trim());
      const report = {
        deletedPersons: [],
        warnings: []
      };

      const existingPersons = await manager
        .createQueryBuilder(Persons, 'persons')
        .select([
          'persons.id',
          'persons.login',
          'persons.code',
          'persons.group',
          'persons.workspace_id',
          'persons.uploaded_at',
          'persons.source'
        ])
        .where('persons.id IN (:...ids)', { ids })
        .getMany();

      if (!existingPersons.length) {
        const warningMessage = `Keine Personen gefunden für die angegebenen IDs: ${testPersonIds}`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      const existingIds = existingPersons.map(person => person.id);

      await manager
        .createQueryBuilder()
        .delete()
        .from(Persons)
        .where('id IN (:...ids)', { ids: existingIds })
        .execute();

      report.deletedPersons = existingIds;

      for (const person of existingPersons) {
        try {
          await this.journalService.createEntry(
            userId,
            workspaceId,
            'delete',
            'test-person',
            person.id,
            {
              personId: person.id,
              personLogin: person.login,
              personCode: person.code,
              personGroup: person.group,
              personSource: person.source,
              personUploadedAt: person.uploaded_at,
              message: 'Test person deleted'
            }
          );
        } catch (error) {
          this.logger.error(
            `Failed to create journal entry for deleting test person ${person.id}: ${error.message}`
          );
        }
      }

      await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
      return { success: true, report };
    }).then(async result => {
      if (result.success) {
        await this.invalidateWorkspaceStatsCache(workspaceId);
      }
      return result;
    });
  }

  async previewDeleteTestResults(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Promise<TestResultsDeletePreviewDto> {
    return (await this.resolveDeleteTargets(workspaceId, request)).preview;
  }

  async previewDeleteTestLogs(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Promise<TestResultsDeletePreviewDto> {
    const targets = await this.resolveDeleteTargets(workspaceId, request);
    return this.buildLogDeletePreview(targets);
  }

  async deleteTestResultsByRequest(
    workspaceId: number,
    request: TestResultsDeleteRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    const targets = await this.resolveDeleteTargets(workspaceId, request);
    const totalTargets = targets.ids.length;

    if (totalTargets === 0) {
      return {
        ...targets.preview,
        deletedTargetCount: 0
      };
    }

    await onProgress?.(
      5,
      `Lösche ${totalTargets} Datensätze aus dem Ergebnisbrowser...`
    );

    const chunks = WorkspaceTestResultsService.chunkArray(targets.ids, 250);
    const dependencySnapshot: DeleteDependencySnapshot = {
      bookletIds: [],
      unitIds: [],
      responseIds: [],
      bookletInfoIds: []
    };
    let deletedTargetCount = 0;

    for (const [index, ids] of chunks.entries()) {
      const chunkSnapshot = await this.collectDeleteDependencySnapshot(
        targets.kind,
        ids
      );
      WorkspaceTestResultsService.mergeDeleteDependencySnapshot(
        dependencySnapshot,
        chunkSnapshot
      );

      const deleteResult = await this.connection.transaction(async manager => {
        await this.deleteKnownDeleteDependents(
          manager,
          targets.kind,
          chunkSnapshot
        );

        switch (targets.kind) {
          case 'persons':
            return manager
              .createQueryBuilder()
              .delete()
              .from(Persons)
              .where('id IN (:...ids)', { ids })
              .execute();
          case 'booklets':
            return manager
              .createQueryBuilder()
              .delete()
              .from(Booklet)
              .where('id IN (:...ids)', { ids })
              .execute();
          case 'units':
            return manager
              .createQueryBuilder()
              .delete()
              .from(Unit)
              .where('id IN (:...ids)', { ids })
              .execute();
          default:
            throw new Error('Unknown test result deletion target');
        }
      });

      deletedTargetCount += deleteResult.affected || ids.length;

      const progress = Math.min(
        90,
        10 + Math.round((deletedTargetCount / totalTargets) * 80)
      );
      await onProgress?.(
        progress,
        `Löschung läuft: ${deletedTargetCount}/${totalTargets} Datensätze verarbeitet (${index + 1}/${chunks.length} Stapel).`
      );
    }

    const finalSnapshot =
      WorkspaceTestResultsService.dedupeDeleteDependencySnapshot(
        dependencySnapshot
      );

    await onProgress?.(92, 'Verwaiste Testheft-Metadaten werden bereinigt...');
    await this.deleteOrphanedBookletInfos(finalSnapshot.bookletInfoIds);

    await onProgress?.(95, 'Löschung wird abschließend geprüft...');
    await this.assertDeleteCompleted(
      targets.kind,
      targets.ids,
      finalSnapshot
    );

    await onProgress?.(97, 'Caches und Statistiken werden aktualisiert...');
    await this.codingValidationService.invalidateIncompleteVariablesCache(
      workspaceId
    );
    await this.invalidateWorkspaceStatsCache(workspaceId);

    if (userId) {
      try {
        await this.journalService.createEntry(
          userId,
          workspaceId,
          'delete',
          'test-results',
          0,
          {
            scope: request.scope,
            deletedTargetKind: targets.kind,
            deletedTargetCount,
            preview: targets.preview,
            message: 'Test results deleted by bulk job'
          }
        );
      } catch (error) {
        this.logger.error(
          `Failed to create journal entry for bulk test result deletion: ${error.message}`,
          error.stack
        );
      }
    }

    return {
      ...targets.preview,
      deletedTargetCount
    };
  }

  async deleteTestLogsByRequest(
    workspaceId: number,
    request: TestResultsDeleteRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    const targets = await this.resolveDeleteTargets(workspaceId, request);
    const preview = await this.buildLogDeletePreview(targets);
    const totalLogRows =
      (preview.bookletLogs || 0) +
      (preview.unitLogs || 0) +
      (preview.sessions || 0);

    if (totalLogRows === 0) {
      return {
        ...preview,
        deletedTargetCount: 0,
        deletedBookletLogs: 0,
        deletedUnitLogs: 0,
        deletedSessions: 0
      };
    }

    await onProgress?.(
      5,
      `Lösche ${totalLogRows} Log- und Sitzungsdatensätze...`
    );

    const snapshot = await this.collectLogDeleteSnapshot(
      targets.kind,
      targets.ids
    );

    const deletedCounts = await this.connection.transaction(async manager => {
      const deletedUnitLogs = await this.deleteRowsByIds(
        manager,
        UnitLog,
        'unitid',
        snapshot.unitIds
      );
      const deletedBookletLogs = await this.deleteRowsByIds(
        manager,
        BookletLog,
        'bookletid',
        snapshot.bookletIds
      );
      const deletedSessions = await this.deleteRowsByIds(
        manager,
        Session,
        'bookletid',
        snapshot.bookletIds
      );

      return {
        deletedBookletLogs,
        deletedUnitLogs,
        deletedSessions
      };
    });

    await onProgress?.(90, 'Log-Löschung wird abschließend geprüft...');
    await this.assertLogDeleteCompleted(snapshot);

    await onProgress?.(97, 'Caches und Statistiken werden aktualisiert...');
    await this.invalidateWorkspaceStatsCache(workspaceId);

    const deletedTargetCount =
      deletedCounts.deletedBookletLogs +
      deletedCounts.deletedUnitLogs +
      deletedCounts.deletedSessions;

    if (userId) {
      try {
        await this.journalService.createEntry(
          userId,
          workspaceId,
          'delete',
          'test-logs',
          0,
          {
            scope: request.scope,
            deletedTargetKind: targets.kind,
            deletedTargetCount,
            ...deletedCounts,
            preview,
            message: 'Test logs deleted by bulk job'
          }
        );
      } catch (error) {
        this.logger.error(
          `Failed to create journal entry for bulk test log deletion: ${error.message}`,
          error.stack
        );
      }
    }

    return {
      ...preview,
      deletedTargetCount,
      ...deletedCounts
    };
  }

  private async buildLogDeletePreview(
    targets: TestResultsDeleteTargets
  ): Promise<TestResultsDeletePreviewDto> {
    const snapshot = await this.collectLogDeleteSnapshot(
      targets.kind,
      targets.ids
    );
    const counts = await this.getLogDeleteCounts(snapshot);
    const warnings = [...targets.preview.warnings];
    const totalLogRows = counts.bookletLogs + counts.unitLogs + counts.sessions;

    if (targets.kind === 'units') {
      warnings.push(
        'Bei Aufgaben-Auswahl werden nur Aufgaben-Logs entfernt. Booklet-Logs und Sitzungen bleiben erhalten.'
      );
    }

    if (targets.ids.length > 0 && totalLogRows === 0) {
      warnings.push('Für den ausgewählten Bereich wurden keine Logs gefunden.');
    }

    return {
      ...targets.preview,
      targetType: 'logs',
      bookletLogs: counts.bookletLogs,
      unitLogs: counts.unitLogs,
      sessions: counts.sessions,
      warnings
    };
  }

  private async collectLogDeleteSnapshot(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<LogDeleteSnapshot> {
    if (ids.length === 0) {
      return {
        bookletIds: [],
        unitIds: []
      };
    }

    const [bookletIds, unitIds] = await Promise.all([
      kind === 'units' ? Promise.resolve([]) :
        this.collectAffectedBookletIds(kind, ids),
      this.collectAffectedUnitIds(kind, ids)
    ]);

    return {
      bookletIds: WorkspaceTestResultsService.uniqueIds(bookletIds),
      unitIds: WorkspaceTestResultsService.uniqueIds(unitIds)
    };
  }

  private async getLogDeleteCounts(
    snapshot: LogDeleteSnapshot
  ): Promise<LogDeleteCounts> {
    const [bookletLogs, unitLogs, sessions] = await Promise.all([
      this.countRowsByIds(BookletLog, 'bookletid', snapshot.bookletIds),
      this.countRowsByIds(UnitLog, 'unitid', snapshot.unitIds),
      this.countRowsByIds(Session, 'bookletid', snapshot.bookletIds)
    ]);

    return {
      bookletLogs,
      unitLogs,
      sessions
    };
  }

  private async assertLogDeleteCompleted(
    snapshot: LogDeleteSnapshot
  ): Promise<void> {
    const failures: string[] = [];
    const addFailure = async (
      label: string,
      countPromise: Promise<number>
    ): Promise<void> => {
      const count = await countPromise;
      if (count > 0) {
        failures.push(`${count} ${label}`);
      }
    };

    await addFailure(
      'Booklet-Logeintrag/-einträge',
      this.countRowsByIds(BookletLog, 'bookletid', snapshot.bookletIds)
    );
    await addFailure(
      'Unit-Logeintrag/-einträge',
      this.countRowsByIds(UnitLog, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Sitzung(en)',
      this.countRowsByIds(Session, 'bookletid', snapshot.bookletIds)
    );

    if (failures.length > 0) {
      throw new Error(
        `Die Log-Löschung wurde nicht vollständig bestätigt. Verblieben: ${failures.join(', ')}.`
      );
    }
  }

  private async collectDeleteDependencySnapshot(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<DeleteDependencySnapshot> {
    if (ids.length === 0) {
      return {
        bookletIds: [],
        unitIds: [],
        responseIds: [],
        bookletInfoIds: []
      };
    }

    const [bookletIds, unitIds, bookletInfoIds] = await Promise.all([
      this.collectAffectedBookletIds(kind, ids),
      this.collectAffectedUnitIds(kind, ids),
      this.collectAffectedBookletInfoIds(kind, ids)
    ]);
    const responseIds = await this.collectIdsFromChunks(
      unitIds,
      async chunk => {
        const rows = await this.connection
          .createQueryBuilder()
          .select('response.id', 'id')
          .from(ResponseEntity, 'response')
          .where('response.unitid IN (:...ids)', { ids: chunk })
          .getRawMany<{ id: number | string }>();

        return WorkspaceTestResultsService.rawRowsToIds(rows);
      }
    );

    return {
      bookletIds,
      unitIds,
      responseIds,
      bookletInfoIds
    };
  }

  private async collectAffectedBookletIds(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<number[]> {
    if (kind === 'booklets') {
      return ids;
    }

    const query = this.connection
      .createQueryBuilder()
      .select('DISTINCT booklet.id', 'id')
      .from(Booklet, 'booklet');

    if (kind === 'persons') {
      query.where('booklet.personid IN (:...ids)', { ids });
    } else {
      query
        .innerJoin(Unit, 'unit', 'unit.bookletid = booklet.id')
        .where('unit.id IN (:...ids)', { ids });
    }

    const rows = await query.getRawMany<{ id: number | string }>();
    return WorkspaceTestResultsService.rawRowsToIds(rows);
  }

  private async collectAffectedUnitIds(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<number[]> {
    if (kind === 'units') {
      return ids;
    }

    const query = this.connection
      .createQueryBuilder()
      .select('DISTINCT unit.id', 'id')
      .from(Unit, 'unit');

    if (kind === 'persons') {
      query
        .innerJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
        .where('booklet.personid IN (:...ids)', { ids });
    } else {
      query.where('unit.bookletid IN (:...ids)', { ids });
    }

    const rows = await query.getRawMany<{ id: number | string }>();
    return WorkspaceTestResultsService.rawRowsToIds(rows);
  }

  private async collectAffectedBookletInfoIds(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<number[]> {
    const query = this.connection
      .createQueryBuilder()
      .select('DISTINCT booklet.infoid', 'id')
      .from(Booklet, 'booklet');

    if (kind === 'persons') {
      query.where('booklet.personid IN (:...ids)', { ids });
    } else if (kind === 'booklets') {
      query.where('booklet.id IN (:...ids)', { ids });
    } else {
      query
        .innerJoin(Unit, 'unit', 'unit.bookletid = booklet.id')
        .where('unit.id IN (:...ids)', { ids });
    }

    const rows = await query.getRawMany<{ id: number | string }>();
    return WorkspaceTestResultsService.rawRowsToIds(rows);
  }

  private async deleteKnownDeleteDependents(
    manager: EntityManager,
    kind: TestResultsDeleteTargetKind,
    snapshot: DeleteDependencySnapshot
  ): Promise<void> {
    await this.deleteRowsByIds(
      manager,
      CodingJobUnit,
      'response_id',
      snapshot.responseIds
    );
    await this.deleteRowsByIds(
      manager,
      CoderTrainingDiscussionResult,
      'response_id',
      snapshot.responseIds
    );
    await this.deleteRowsByIds(
      manager,
      ResponseEntity,
      'unitid',
      snapshot.unitIds
    );
    await this.deleteRowsByIds(manager, UnitNote, '"unitId"', snapshot.unitIds);
    await this.deleteRowsByIds(manager, UnitTag, '"unitId"', snapshot.unitIds);
    await this.deleteRowsByIds(manager, UnitLog, 'unitid', snapshot.unitIds);
    await this.deleteRowsByIds(
      manager,
      UnitLastState,
      'unitid',
      snapshot.unitIds
    );
    await this.deleteRowsByIds(manager, ChunkEntity, 'unitid', snapshot.unitIds);

    if (kind !== 'units') {
      await this.deleteRowsByIds(manager, Unit, 'id', snapshot.unitIds);
      await this.deleteRowsByIds(
        manager,
        Session,
        'bookletid',
        snapshot.bookletIds
      );
      await this.deleteRowsByIds(
        manager,
        BookletLog,
        'bookletid',
        snapshot.bookletIds
      );

      if (kind === 'persons') {
        await this.deleteRowsByIds(manager, Booklet, 'id', snapshot.bookletIds);
      }
    }
  }

  private async deleteRowsByIds(
    manager: EntityManager,
    entity: EntityTarget<ObjectLiteral>,
    columnExpression: string,
    ids: number[]
  ): Promise<number> {
    let affected = 0;
    for (const chunk of WorkspaceTestResultsService.chunkArray(
      WorkspaceTestResultsService.uniqueIds(ids),
      1000
    )) {
      const result = await manager
        .createQueryBuilder()
        .delete()
        .from(entity)
        .where(`${columnExpression} IN (:...ids)`, { ids: chunk })
        .execute();
      affected += result.affected || 0;
    }
    return affected;
  }

  private async deleteOrphanedBookletInfos(infoIds: number[]): Promise<number> {
    let affected = 0;
    for (const chunk of WorkspaceTestResultsService.chunkArray(
      WorkspaceTestResultsService.uniqueIds(infoIds),
      1000
    )) {
      const result = await this.connection
        .createQueryBuilder()
        .delete()
        .from(BookletInfo)
        .where('id IN (:...ids)', { ids: chunk })
        .andWhere(
          'NOT EXISTS (SELECT 1 FROM booklet WHERE booklet.infoid = bookletinfo.id)'
        )
        .execute();
      affected += result.affected || 0;
    }
    return affected;
  }

  private async assertDeleteCompleted(
    kind: TestResultsDeleteTargetKind,
    targetIds: number[],
    snapshot: DeleteDependencySnapshot
  ): Promise<void> {
    const failures: string[] = [];
    const addFailure = async (
      label: string,
      countPromise: Promise<number>
    ): Promise<void> => {
      const count = await countPromise;
      if (count > 0) {
        failures.push(`${count} ${label}`);
      }
    };

    if (kind === 'persons') {
      await addFailure(
        'Testperson(en)',
        this.countRowsByIds(Persons, 'id', targetIds)
      );
    }

    if (kind !== 'units') {
      await addFailure(
        'Testheft(e)',
        this.countRowsByIds(Booklet, 'id', snapshot.bookletIds)
      );
      await addFailure(
        'Sitzung(en)',
        this.countRowsByIds(Session, 'bookletid', snapshot.bookletIds)
      );
      await addFailure(
        'Testheft-Logeintrag/-einträge',
        this.countRowsByIds(BookletLog, 'bookletid', snapshot.bookletIds)
      );
      await addFailure(
        'verwaiste Testheft-Metadaten',
        this.countOrphanedBookletInfos(snapshot.bookletInfoIds)
      );
    }

    await addFailure(
      'Aufgabe(n)',
      this.countRowsByIds(Unit, 'id', snapshot.unitIds)
    );
    await addFailure(
      'Antwort(en)',
      this.countRowsByIds(ResponseEntity, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Unit-Notiz(en)',
      this.countRowsByIds(UnitNote, '"unitId"', snapshot.unitIds)
    );
    await addFailure(
      'Unit-Tag(s)',
      this.countRowsByIds(UnitTag, '"unitId"', snapshot.unitIds)
    );
    await addFailure(
      'Unit-Logeintrag/-einträge',
      this.countRowsByIds(UnitLog, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Unit-Zustand/Zustände',
      this.countRowsByIds(UnitLastState, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Chunk(s)',
      this.countRowsByIds(ChunkEntity, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Kodierjob-Antwortreferenz(en)',
      this.countRowsByIds(CodingJobUnit, 'response_id', snapshot.responseIds)
    );
    await addFailure(
      'Training-Diskussionsergebnis(se)',
      this.countRowsByIds(
        CoderTrainingDiscussionResult,
        'response_id',
        snapshot.responseIds
      )
    );

    if (failures.length > 0) {
      throw new Error(
        `Die Löschung wurde nicht vollständig bestätigt. Verblieben: ${failures.join(', ')}.`
      );
    }
  }

  private async countRowsByIds(
    entity: EntityTarget<ObjectLiteral>,
    columnExpression: string,
    ids: number[]
  ): Promise<number> {
    let count = 0;
    for (const chunk of WorkspaceTestResultsService.chunkArray(
      WorkspaceTestResultsService.uniqueIds(ids),
      1000
    )) {
      const raw = await this.connection
        .createQueryBuilder()
        .select('COUNT(*)', 'count')
        .from(entity, 'row')
        .where(`row.${columnExpression} IN (:...ids)`, { ids: chunk })
        .getRawOne<{ count: string }>();
      count += Number(raw?.count || 0);
    }
    return count;
  }

  private async countOrphanedBookletInfos(infoIds: number[]): Promise<number> {
    let count = 0;
    for (const chunk of WorkspaceTestResultsService.chunkArray(
      WorkspaceTestResultsService.uniqueIds(infoIds),
      1000
    )) {
      const raw = await this.connection
        .createQueryBuilder()
        .select('COUNT(*)', 'count')
        .from(BookletInfo, 'bookletinfo')
        .where('bookletinfo.id IN (:...ids)', { ids: chunk })
        .andWhere(
          'NOT EXISTS (SELECT 1 FROM booklet WHERE booklet.infoid = bookletinfo.id)'
        )
        .getRawOne<{ count: string }>();
      count += Number(raw?.count || 0);
    }
    return count;
  }

  private async collectIdsFromChunks(
    ids: number[],
    collect: (chunk: number[]) => Promise<number[]>
  ): Promise<number[]> {
    const result: number[] = [];
    for (const chunk of WorkspaceTestResultsService.chunkArray(
      WorkspaceTestResultsService.uniqueIds(ids),
      1000
    )) {
      result.push(...await collect(chunk));
    }
    return WorkspaceTestResultsService.uniqueIds(result);
  }

  private static mergeDeleteDependencySnapshot(
    target: DeleteDependencySnapshot,
    source: DeleteDependencySnapshot
  ): void {
    target.bookletIds.push(...source.bookletIds);
    target.unitIds.push(...source.unitIds);
    target.responseIds.push(...source.responseIds);
    target.bookletInfoIds.push(...source.bookletInfoIds);
  }

  private static dedupeDeleteDependencySnapshot(
    snapshot: DeleteDependencySnapshot
  ): DeleteDependencySnapshot {
    return {
      bookletIds: WorkspaceTestResultsService.uniqueIds(snapshot.bookletIds),
      unitIds: WorkspaceTestResultsService.uniqueIds(snapshot.unitIds),
      responseIds: WorkspaceTestResultsService.uniqueIds(snapshot.responseIds),
      bookletInfoIds: WorkspaceTestResultsService.uniqueIds(
        snapshot.bookletInfoIds
      )
    };
  }

  private static rawRowsToIds(
    rows: Array<{ id: number | string | null | undefined }>
  ): number[] {
    return WorkspaceTestResultsService.uniqueIds(
      rows
        .map(row => Number(row.id))
        .filter(id => Number.isInteger(id) && id > 0)
    );
  }

  private static uniqueIds(ids: number[]): number[] {
    return Array.from(new Set(ids));
  }

  private async resolveDeleteTargets(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Promise<TestResultsDeleteTargets> {
    const normalizedRequest =
      WorkspaceTestResultsService.normalizeDeleteRequest(request);
    const warnings: string[] = [];
    let kind: TestResultsDeleteTargetKind = 'persons';
    let ids: number[] = [];

    switch (normalizedRequest.scope) {
      case 'persons':
        kind = 'persons';
        if (normalizedRequest.personIds.length > 0) {
          const rows = await this.personsRepository
            .createQueryBuilder('person')
            .select(['person.id'])
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.id IN (:...personIds)', {
              personIds: normalizedRequest.personIds
            })
            .getMany();
          ids = rows.map(row => row.id);
        }
        break;
      case 'filteredPersons': {
        kind = 'persons';
        const query = this.personsRepository
          .createQueryBuilder('person')
          .select(['person.id'])
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true });

        if (normalizedRequest.searchText) {
          query.andWhere(
            '(person.code ILIKE :searchText OR person.group ILIKE :searchText OR person.login ILIKE :searchText)',
            { searchText: `%${normalizedRequest.searchText}%` }
          );
        }

        const rows = await query.getMany();
        ids = rows.map(row => row.id);
        break;
      }
      case 'groups':
        kind = 'persons';
        if (normalizedRequest.groups.length > 0) {
          const rows = await this.personsRepository
            .createQueryBuilder('person')
            .select(['person.id'])
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.consider = :consider', { consider: true })
            .andWhere('person.group IN (:...groups)', {
              groups: normalizedRequest.groups
            })
            .getMany();
          ids = rows.map(row => row.id);
        }
        break;
      case 'booklets':
        kind = 'booklets';
        if (normalizedRequest.bookletNames.length > 0) {
          const rows = await this.bookletRepository
            .createQueryBuilder('booklet')
            .select(['booklet.id'])
            .innerJoin('booklet.person', 'person')
            .innerJoin('booklet.bookletinfo', 'bookletinfo')
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.consider = :consider', { consider: true })
            .andWhere('UPPER(bookletinfo.name) IN (:...bookletNames)', {
              bookletNames: normalizedRequest.bookletNames.map(name => name.toUpperCase())
            })
            .getMany();
          ids = rows.map(row => row.id);
        }
        break;
      case 'units':
        kind = 'units';
        if (normalizedRequest.unitNames.length > 0) {
          const unitNames = normalizedRequest.unitNames.map(
            WorkspaceTestResultsService.normalizeUnitKey
          );
          const rows = await this.unitRepository
            .createQueryBuilder('unit')
            .select(['unit.id'])
            .innerJoin('unit.booklet', 'booklet')
            .innerJoin('booklet.person', 'person')
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.consider = :consider', { consider: true })
            .andWhere(
              `(REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') IN (:...unitNames)
                OR REGEXP_REPLACE(UPPER(COALESCE(unit.alias, '')), '\\.XML$', '', 'i') IN (:...unitNames))`,
              { unitNames }
            )
            .getMany();
          ids = rows.map(row => row.id);
        }
        break;
      default:
        warnings.push('Unbekannter Löschbereich.');
    }

    ids = Array.from(new Set(ids));
    if (ids.length === 0) {
      warnings.push('Keine passenden Testergebnisdaten gefunden.');
    }

    const preview = await this.buildDeletePreview(
      workspaceId,
      normalizedRequest,
      kind,
      ids,
      warnings
    );

    return { kind, ids, preview };
  }

  private async buildDeletePreview(
    workspaceId: number,
    request: Required<TestResultsDeleteRequestDto>,
    kind: TestResultsDeleteTargetKind,
    ids: number[],
    warnings: string[]
  ): Promise<TestResultsDeletePreviewDto> {
    const counts = await this.getDeleteCounts(workspaceId, kind, ids);
    const metadata = await this.getDeleteMetadata(kind, ids);

    return {
      scope: request.scope,
      label: WorkspaceTestResultsService.getDeleteLabel(request),
      persons: counts.persons,
      booklets: counts.booklets,
      units: counts.units,
      responses: counts.responses,
      groups: metadata.groups,
      bookletNames: metadata.bookletNames,
      unitNames: metadata.unitNames,
      warnings
    };
  }

  private async getDeleteCounts(
    workspaceId: number,
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<Pick<TestResultsDeletePreviewDto, 'persons' | 'booklets' | 'units' | 'responses'>> {
    if (ids.length === 0) {
      return {
        persons: 0,
        booklets: 0,
        units: 0,
        responses: 0
      };
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

    const personsQuery = this.connection
      .createQueryBuilder()
      .select('COUNT(DISTINCT person.id)', 'count')
      .from(Persons, 'person');

    if (kind === 'booklets') {
      personsQuery.innerJoin(Booklet, 'booklet', 'booklet.personid = person.id');
    } else if (kind === 'units') {
      personsQuery
        .innerJoin(Booklet, 'booklet', 'booklet.personid = person.id')
        .innerJoin(Unit, 'unit', 'unit.bookletid = booklet.id');
    }
    WorkspaceTestResultsService.applyDeleteTargetFilter(personsQuery, kind, ids);

    const bookletsQuery = this.connection
      .createQueryBuilder()
      .select('COUNT(DISTINCT bookletinfo.name)', 'count')
      .from(Booklet, 'booklet')
      .innerJoin(Persons, 'person', 'person.id = booklet.personid')
      .innerJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid');
    if (kind === 'units') {
      bookletsQuery.innerJoin(Unit, 'unit', 'unit.bookletid = booklet.id');
    }
    WorkspaceTestResultsService.applyDeleteTargetFilter(bookletsQuery, kind, ids);
    this.applyIgnoredBookletsToQuery(bookletsQuery, exclusions.ignoredBooklets);

    const unitsQuery = this.connection
      .createQueryBuilder()
      .select('COUNT(DISTINCT COALESCE(unit.alias, unit.name))', 'count')
      .from(Unit, 'unit')
      .innerJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
      .innerJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
      .innerJoin(Persons, 'person', 'person.id = booklet.personid');
    WorkspaceTestResultsService.applyDeleteTargetFilter(unitsQuery, kind, ids);
    this.applyExclusionsToQuery(unitsQuery, exclusions);

    const responsesQuery = this.connection
      .createQueryBuilder()
      .select('COUNT(DISTINCT response.id)', 'count')
      .from(ResponseEntity, 'response')
      .innerJoin(Unit, 'unit', 'unit.id = response.unitid')
      .innerJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
      .innerJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
      .innerJoin(Persons, 'person', 'person.id = booklet.personid');
    WorkspaceTestResultsService.applyDeleteTargetFilter(responsesQuery, kind, ids);
    this.applyExclusionsToQuery(responsesQuery, exclusions);
    this.excludeAutocoderGeneratedResponses(responsesQuery);

    const [personsRaw, bookletsRaw, unitsRaw, responsesRaw] = await Promise.all([
      personsQuery.getRawOne<{ count: string }>(),
      bookletsQuery.getRawOne<{ count: string }>(),
      unitsQuery.getRawOne<{ count: string }>(),
      responsesQuery.getRawOne<{ count: string }>()
    ]);

    return {
      persons: Number(personsRaw?.count || 0),
      booklets: Number(bookletsRaw?.count || 0),
      units: Number(unitsRaw?.count || 0),
      responses: Number(responsesRaw?.count || 0)
    };
  }

  private static applyDeleteTargetFilter(
    query: SelectQueryBuilder<unknown>,
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): void {
    switch (kind) {
      case 'persons':
        query.where('person.id IN (:...ids)', { ids });
        break;
      case 'booklets':
        query.where('booklet.id IN (:...ids)', { ids });
        break;
      case 'units':
        query.where('unit.id IN (:...ids)', { ids });
        break;
      default:
        query.where('1 = 0');
    }
  }

  private async getDeleteMetadata(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<Pick<TestResultsDeletePreviewDto, 'groups' | 'bookletNames' | 'unitNames'>> {
    if (ids.length === 0) {
      return {
        groups: [],
        bookletNames: [],
        unitNames: []
      };
    }

    const query = this.connection
      .createQueryBuilder()
      .select("COALESCE(array_remove(array_agg(DISTINCT person.group), NULL), '{}')", 'groups')
      .addSelect("COALESCE(array_remove(array_agg(DISTINCT bookletinfo.name), NULL), '{}')", 'bookletNames')
      .addSelect("COALESCE(array_remove(array_agg(DISTINCT COALESCE(unit.alias, unit.name)), NULL), '{}')", 'unitNames');

    if (kind === 'persons') {
      query
        .from(Persons, 'person')
        .leftJoin(Booklet, 'booklet', 'booklet.personid = person.id')
        .leftJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
        .leftJoin(Unit, 'unit', 'unit.bookletid = booklet.id')
        .where('person.id IN (:...ids)', { ids });
    } else if (kind === 'booklets') {
      query
        .from(Booklet, 'booklet')
        .leftJoin(Persons, 'person', 'person.id = booklet.personid')
        .leftJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
        .leftJoin(Unit, 'unit', 'unit.bookletid = booklet.id')
        .where('booklet.id IN (:...ids)', { ids });
    } else {
      query
        .from(Unit, 'unit')
        .leftJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
        .leftJoin(Persons, 'person', 'person.id = booklet.personid')
        .leftJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
        .where('unit.id IN (:...ids)', { ids });
    }

    const raw = await query.getRawOne<{
      groups: string[] | string | null;
      bookletNames: string[] | string | null;
      unitNames: string[] | string | null;
    }>();

    return {
      groups: WorkspaceTestResultsService.toPreviewList(raw?.groups),
      bookletNames: WorkspaceTestResultsService.toPreviewList(raw?.bookletNames),
      unitNames: WorkspaceTestResultsService.toPreviewList(raw?.unitNames)
    };
  }

  private static normalizeDeleteRequest(
    request: TestResultsDeleteRequestDto
  ): Required<TestResultsDeleteRequestDto> {
    return {
      scope: request.scope,
      personIds: WorkspaceTestResultsService.normalizeNumberList(request.personIds),
      searchText: String(request.searchText || '').trim(),
      groups: WorkspaceTestResultsService.normalizeStringList(request.groups),
      bookletNames: WorkspaceTestResultsService.normalizeStringList(request.bookletNames),
      unitNames: WorkspaceTestResultsService.normalizeStringList(request.unitNames)
    };
  }

  private static normalizeNumberList(value?: number[] | string): number[] {
    if (!value) return [];
    const values = Array.isArray(value) ? value : String(value).split(',');
    return values
      .map(v => Number(v))
      .filter(v => Number.isInteger(v) && v > 0);
  }

  private static normalizeStringList(value?: string[] | string): string[] {
    if (!value) return [];
    const values = Array.isArray(value) ? value : String(value).split(',');
    return Array.from(
      new Set(
        values
          .map(v => String(v || '').trim())
          .filter(v => v.length > 0)
      )
    );
  }

  private static normalizeUnitKey(value: string): string {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\.XML$/i, '');
  }

  private static toPreviewList(value?: string[] | string | null): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map(v => String(v)).filter(v => v.length > 0).slice(0, 30);
    }
    return String(value)
      .replace(/^{|}$/g, '')
      .split(',')
      .map(v => v.replace(/^"|"$/g, '').trim())
      .filter(v => v.length > 0)
      .slice(0, 30);
  }

  private static getDeleteLabel(
    request: Required<TestResultsDeleteRequestDto>
  ): string {
    switch (request.scope as TestResultsDeleteScope) {
      case 'persons':
        return `${request.personIds.length} ausgewählte Testperson(en)`;
      case 'filteredPersons':
        return request.searchText ?
          `alle Testpersonen mit Filter "${request.searchText}"` :
          'alle sichtbaren Testpersonen';
      case 'groups':
        return `Testgruppe(n): ${request.groups.join(', ')}`;
      case 'booklets':
        return `Testheft(e): ${request.bookletNames.join(', ')}`;
      case 'units':
        return `Aufgabe(n): ${request.unitNames.join(', ')}`;
      default:
        return 'Testergebnisdaten';
    }
  }

  private static chunkArray<T>(values: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
      chunks.push(values.slice(index, index + size));
    }
    return chunks;
  }

  async deleteUnit(
    workspaceId: number,
    unitId: number,
    userId: string
  ): Promise<{
      success: boolean;
      report: {
        deletedUnit: number | null;
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const report = {
        deletedUnit: null,
        warnings: []
      };

      const unit = await manager
        .createQueryBuilder(Unit, 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .where('unit.id = :unitId', { unitId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .getOne();

      if (!unit) {
        const warningMessage = `Keine Unit mit ID ${unitId} im Workspace ${workspaceId} gefunden`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      await manager
        .createQueryBuilder()
        .delete()
        .from(Unit)
        .where('id = :unitId', { unitId })
        .execute();

      report.deletedUnit = unitId;

      try {
        await this.journalService.createEntry(
          userId,
          workspaceId,
          'delete',
          'unit',
          unitId,
          {
            unitId,
            unitName: unit.name,
            unitAlias: unit.alias,
            bookletId: unit.booklet?.id,
            personId: unit.booklet?.person?.id,
            personLogin: unit.booklet?.person?.login,
            personCode: unit.booklet?.person?.code,
            personGroup: unit.booklet?.person?.group,
            personSource: unit.booklet?.person?.source,
            personUploadedAt: unit.booklet?.person?.uploaded_at,
            message: 'Unit deleted'
          }
        );
      } catch (error) {
        this.logger.error(
          `Failed to create journal entry for deleting unit ${unitId}: ${error.message}`
        );
      }

      await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
      return { success: true, report };
    }).then(async result => {
      if (result.success) {
        await this.invalidateWorkspaceStatsCache(workspaceId);
      }
      return result;
    });
  }

  async deleteResponse(
    workspaceId: number,
    responseId: number,
    userId: string
  ): Promise<{
      success: boolean;
      report: {
        deletedResponse: number | null;
        warnings: string[];
      };
    }> {
    const result = await this.responseManagementService.deleteResponse(
      workspaceId,
      responseId,
      userId
    );
    if (result?.success) {
      await this.codingValidationService.invalidateIncompleteVariablesCache(
        workspaceId
      );
    }
    return result;
  }

  async deleteBooklet(
    workspaceId: number,
    bookletId: number,
    userId: string
  ): Promise<{
      success: boolean;
      report: {
        deletedBooklet: number | null;
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const report = {
        deletedBooklet: null,
        warnings: []
      };

      const booklet = await manager
        .createQueryBuilder(Booklet, 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('booklet.id = :bookletId', { bookletId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .getOne();

      if (!booklet) {
        const warningMessage = `Kein Booklet mit ID ${bookletId} im Workspace ${workspaceId} gefunden`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      await manager
        .createQueryBuilder()
        .delete()
        .from(Booklet)
        .where('id = :bookletId', { bookletId })
        .execute();

      report.deletedBooklet = bookletId;

      try {
        await this.journalService.createEntry(
          userId,
          workspaceId,
          'delete',
          'booklet',
          bookletId,
          {
            bookletId,
            bookletName: booklet.bookletinfo?.name || 'Unknown',
            personId: booklet.personid,
            personLogin: booklet.person?.login || 'Unknown',
            personCode: booklet.person?.code,
            personGroup: booklet.person?.group,
            personSource: booklet.person?.source,
            personUploadedAt: booklet.person?.uploaded_at,
            message: 'Booklet deleted'
          }
        );
      } catch (error) {
        this.logger.error(
          `Failed to create journal entry for deleting booklet ${bookletId}: ${error.message}`
        );
      }

      await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
      return { success: true, report };
    }).then(async result => {
      if (result.success) {
        await this.invalidateWorkspaceStatsCache(workspaceId);
      }
      return result;
    });
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
      version?: 'v1' | 'v2' | 'v3';
      geogebra?: boolean;
      derivedOnly?: boolean;
      personLogin?: string;
    },
    options: { page?: number; limit?: number } = {}
  ): Promise<{
      data: {
        responseId: number;
        variableId: string;
        value: string;
        status: string;
        code?: number;
        score?: number;
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

    this.logger.log(`Searching for responses in workspace ${workspaceId}`);

    try {
      this.logger.log(
        `Searching for responses in workspace: ${workspaceId} with params: ${JSON.stringify(
          searchParams
        )} (page: ${page}, limit: ${limit})`
      );

      const query = this.responseRepository
        .createQueryBuilder('response')
        .innerJoinAndSelect('response.unit', 'unit')
        .innerJoinAndSelect('unit.booklet', 'booklet')
        .innerJoinAndSelect('booklet.person', 'person')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });

      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      this.applyExclusionsToQuery(query, exclusions);

      if (searchParams.value) {
        query.andWhere('response.value ILIKE :value', {
          value: `%${searchParams.value}%`
        });
      }

      if (searchParams.variableId) {
        query.andWhere('response.variableid ILIKE :variableId', {
          variableId: `%${searchParams.variableId}%`
        });
      }

      if (searchParams.unitName) {
        query.andWhere('unit.name ILIKE :unitName', {
          unitName: `%${searchParams.unitName}%`
        });
      }

      if (searchParams.bookletName) {
        query.andWhere('bookletinfo.name ILIKE :bookletName', {
          bookletName: `%${searchParams.bookletName}%`
        });
      }

      if (searchParams.status) {
        query.andWhere('response.status = :status', {
          status: searchParams.status
        });
      }

      if (searchParams.codedStatus) {
        const statusColumn = searchParams.version ?
          `status_${searchParams.version}` :
          'status_v1';
        query.andWhere(`response.${statusColumn} = :codedStatus`, {
          codedStatus: searchParams.codedStatus
        });
      }

      if (searchParams.group) {
        query.andWhere('person.group = :group', { group: searchParams.group });
      }

      if (searchParams.code) {
        query.andWhere('person.code = :code', { code: searchParams.code });
      }

      if (searchParams.personLogin) {
        query.andWhere('person.login ILIKE :personLogin', {
          personLogin: `%${searchParams.personLogin}%`
        });
      }

      if (searchParams.geogebra) {
        query.andWhere(
          'EXISTS (SELECT 1 FROM response r2 WHERE r2.unitid = unit.id AND r2.value LIKE :ggPrefix)',
          { ggPrefix: 'UEsD%' }
        );
        const version = searchParams.version || 'v1';
        query.addOrderBy(`response.code_${version}`, 'ASC');
        query.addOrderBy('person.code', 'ASC');
      }

      if (searchParams.derivedOnly) {
        const effectiveStatusExpression = WorkspaceTestResultsService.getEffectiveCodingStatusExpression(
          searchParams.version || 'v1'
        );
        query.andWhere('response.is_autocoder_generated = :derivedOnly', {
          derivedOnly: true
        });
        query.andWhere(`${effectiveStatusExpression} IS NOT NULL`);
        query.andWhere(`${effectiveStatusExpression} NOT IN (:...ignoredDerivedCodingStatuses)`, {
          ignoredDerivedCodingStatuses: WorkspaceTestResultsService.ignoredDerivedCodingStatuses
        });
      } else {
        this.excludeAutocoderGeneratedResponses(query);
      }

      const total = await query.getCount();

      if (total === 0) {
        this.logger.log(
          `No responses found matching the criteria in workspace: ${workspaceId}`
        );
        return { data: [], total: 0 };
      }

      query.skip(skip).take(limit);

      const responses = await query.getMany();

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

      const version = searchParams.version || 'v1';
      const data = responses.map(response => {
        const code = response[
          `code_${version}` as keyof ResponseEntity
        ] as number;
        const score = response[
          `score_${version}` as keyof ResponseEntity
        ] as number;
        const codedStatus = response[
          `status_${version}` as keyof ResponseEntity
        ] as number;
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
    } catch (error) {
      this.logger.error(
        `Failed to search for responses in workspace: ${workspaceId}`,
        error.stack
      );
      throw new Error(
        `An error occurred while searching for responses: ${error.message}`
      );
    }
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
          code?: number;
          score?: number;
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
      this.applyExclusionsToQuery(query, exclusions);

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
        unitIds.map(unitId => this.unitTagService.findAllByUnitId(unitId))
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
        error.stack
      );
      throw new Error(
        `An error occurred while searching for units with name: ${unitName}: ${error.message}`
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
      this.applyIgnoredBookletsToQuery(query, exclusions.ignoredBooklets);

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
        error.stack
      );
      throw new Error(
        `An error occurred while searching for booklets with name: ${bookletName}: ${error.message}`
      );
    }
  }

  async exportTestResults(
    workspaceId: number,
    res: Response,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    }
  ): Promise<void> {
    this.logger.log(`Exporting test results for workspace ${workspaceId}`);
    await this.exportTestResultsToStream(workspaceId, res, filters);
  }

  async exportTestResultsToFile(
    workspaceId: number,
    filePath: string,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    this.logger.log(
      `Exporting test results for workspace ${workspaceId} to file ${filePath}`
    );
    const fileStream = fs.createWriteStream(filePath);
    await this.exportTestResultsToStream(
      workspaceId,
      fileStream,
      filters,
      progressCallback
    );
  }

  async exportTestResultsToStream(
    workspaceId: number,
    stream: Writable,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    const csvStream = csv.format({
      headers: [
        'groupname',
        'loginname',
        'code',
        'bookletname',
        'unitname',
        'responses',
        'laststate',
        'originalUnitId'
      ],
      delimiter: ';',
      quote: '"'
    });

    csvStream.pipe(stream);

    const BATCH_SIZE = 100;
    let processedCount = 0;
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

    const createBaseQuery = () => {
      const qb = this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .select([
          'unit.id',
          'unit.name',
          'unit.alias',
          'booklet.id',
          'person.group',
          'person.login',
          'person.code',
          'bookletinfo.name'
        ])
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });
      this.applyExclusionsToQuery(qb, exclusions);

      if (filters?.groupNames?.length) {
        qb.andWhere('person.group IN (:...groupNames)', {
          groupNames: filters.groupNames
        });
      }
      if (filters?.bookletNames?.length) {
        qb.andWhere('bookletinfo.name IN (:...bookletNames)', {
          bookletNames: filters.bookletNames
        });
      }
      if (filters?.unitNames?.length) {
        qb.andWhere('unit.name IN (:...unitNames)', {
          unitNames: filters.unitNames
        });
      }
      if (filters?.personIds?.length) {
        qb.andWhere('person.id IN (:...personIds)', {
          personIds: filters.personIds
        });
      }
      return qb;
    };

    const totalCount = await createBaseQuery().getCount();
    this.logger.log(`Total units to export: ${totalCount}`);

    let lastUnitId = 0;
    let hasMore = true;

    while (hasMore) {
      const units = await createBaseQuery()
        .andWhere('unit.id > :lastUnitId', { lastUnitId })
        .orderBy('unit.id', 'ASC')
        .take(BATCH_SIZE)
        .getMany();

      if (units.length === 0) {
        hasMore = false;
        break;
      }

      lastUnitId = units[units.length - 1].id;
      const unitIds = units.map(u => u.id);

      const responses = await this.responseRepository
        .createQueryBuilder('response')
        .select([
          'response.id',
          'response.unitid',
          'response.variableid',
          'response.status',
          'response.value',
          'response.subform'
        ])
        .where('response.unitid IN (:...unitIds)', { unitIds })
        .andWhere(
          WorkspaceTestResultsService.nonAutocoderGeneratedResponseCondition(
            'response'
          )
        )
        .getMany();

      const chunks = await this.chunkRepository
        .createQueryBuilder('chunk')
        .select([
          'chunk.unitid',
          'chunk.key',
          'chunk.variables',
          'chunk.ts',
          'chunk.type'
        ])
        .where('chunk.unitid IN (:...unitIds)', { unitIds })
        .getMany();

      const lastStates = await this.connection
        .getRepository(UnitLastState)
        .createQueryBuilder('laststate')
        .select(['laststate.unitid', 'laststate.key', 'laststate.value'])
        .where('laststate.unitid IN (:...unitIds)', { unitIds })
        .getMany();

      // Create maps for quick lookup
      const responsesByUnitId = new Map<number, ResponseEntity[]>();
      const chunksByUnitId = new Map<number, ChunkEntity[]>();
      const lastStatesByUnitId = new Map<
      number,
      Array<{ key: string; value: unknown }>
      >();

      responses.forEach(r => {
        if (!responsesByUnitId.has(r.unitid)) {
          responsesByUnitId.set(r.unitid, []);
        }
        responsesByUnitId.get(r.unitid)!.push(r);
      });

      chunks.forEach(chunk => {
        if (!chunksByUnitId.has(chunk.unitid)) {
          chunksByUnitId.set(chunk.unitid, []);
        }
        chunksByUnitId.get(chunk.unitid)!.push(chunk);
      });

      lastStates.forEach(ls => {
        if (!lastStatesByUnitId.has(ls.unitid)) {
          lastStatesByUnitId.set(ls.unitid, []);
        }
        lastStatesByUnitId
          .get(ls.unitid)!
          .push({ key: ls.key, value: ls.value });
      });

      for (const unit of units) {
        const unitResponses = responsesByUnitId.get(unit.id) || [];
        const unitChunks = chunksByUnitId.get(unit.id) || [];
        const unitLastStates = lastStatesByUnitId.get(unit.id) || [];

        const chunkKeyMap = new Map<string, string>();
        const chunkMetaByKey = new Map<string, { ts: number; type: string }>();

        unitChunks.forEach(chunk => {
          if (chunk.variables) {
            const variables = chunk.variables.split(',').map(v => v.trim());
            variables.forEach(variable => {
              chunkKeyMap.set(variable, chunk.key);
            });
          }

          // Store timestamp and type for each chunk key so we can use it in the export
          if (!chunkMetaByKey.has(chunk.key)) {
            chunkMetaByKey.set(chunk.key, {
              ts: Number(chunk.ts) || 0,
              type: chunk.type || 'state'
            });
          }
        });

        const responsesByChunkKey = new Map<string, TcMergeResponse[]>();

        unitResponses.forEach(r => {
          const chunkKey = chunkKeyMap.get(r.variableid) || r.subform || '';
          if (!responsesByChunkKey.has(chunkKey)) {
            responsesByChunkKey.set(chunkKey, []);
          }

          const value = WorkspaceTestResultsService.parseStoredResponseValue(
            r.value,
            r.variableid
          ) as ResponseValueType;

          responsesByChunkKey.get(chunkKey)!.push({
            id: r.variableid,
            value: value,
            status: statusNumberToString(r.status) || 'UNSET',
            subform: r.subform
          });
        });

        const exportChunks: Chunk[] = [];
        responsesByChunkKey.forEach((chunkResponses, chunkKey) => {
          const meta = chunkMetaByKey.get(chunkKey);
          const resolvedSubForm =
            chunkResponses.find(r => r.subform && r.subform.length > 0)
              ?.subform || '';

          exportChunks.push({
            id: chunkKey,
            subForm: resolvedSubForm,
            responseType: meta?.type || 'state',
            ts: meta?.ts || 0,
            content: JSON.stringify(chunkResponses)
          });
        });

        const lastStateMap: { [key: string]: unknown } = {};
        unitLastStates.forEach(ls => {
          lastStateMap[ls.key] = ls.value;
        });

        const canContinue = csvStream.write({
          groupname: unit.booklet.person.group,
          loginname: unit.booklet.person.login,
          code: unit.booklet.person.code,
          bookletname: unit.booklet.bookletinfo.name,
          unitname: unit.name,
          responses: JSON.stringify(exportChunks),
          laststate: JSON.stringify(lastStateMap),
          originalUnitId: unit.alias || unit.name
        });

        if (!canContinue) {
          await new Promise(resolve => {
            csvStream.once('drain', resolve);
          });
        }

        processedCount += 1;
      }

      if (progressCallback && totalCount > 0) {
        await progressCallback(Math.round((processedCount / totalCount) * 100));
      }
    }

    csvStream.end();

    return new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  async exportTestLogsToFile(
    workspaceId: number,
    filePath: string,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    this.logger.log(
      `Exporting test logs for workspace ${workspaceId} to file ${filePath}`
    );
    const fileStream = fs.createWriteStream(filePath);
    await this.exportTestLogsToStream(
      workspaceId,
      fileStream,
      filters,
      progressCallback
    );
  }

  async exportTestLogsToStream(
    workspaceId: number,
    stream: Writable,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    const csvStream = csv.format({
      headers: [
        'groupname',
        'loginname',
        'code',
        'bookletname',
        'unitname',
        'originalUnitId',
        'timestamp',
        'logentry'
      ],
      delimiter: ';',
      quote: null
    });

    csvStream.pipe(stream);

    const BATCH_SIZE = 2000;
    let processedCount = 0;
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

    const hasUnitFilters = Boolean(filters?.unitNames?.length);

    // Export booklet logs (unitname must be empty string for importer)
    if (!hasUnitFilters) {
      let lastBookletLogId = 0;
      let hasMoreBookletLogs = true;

      const createBookletLogsBaseQuery = () => {
        const qb = this.bookletLogRepository
          .createQueryBuilder('bookletLog')
          .innerJoin('bookletLog.booklet', 'booklet')
          .innerJoin('booklet.person', 'person')
          .innerJoin('booklet.bookletinfo', 'bookletinfo')
          .select('bookletLog.id', 'id')
          .addSelect('bookletLog.ts', 'ts')
          .addSelect('bookletLog.key', 'key')
          .addSelect('bookletLog.parameter', 'parameter')
          .addSelect('person.group', 'groupname')
          .addSelect('person.login', 'loginname')
          .addSelect('person.code', 'code')
          .addSelect('bookletinfo.name', 'bookletname')
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true });
        this.applyIgnoredBookletsToQuery(qb, exclusions.ignoredBooklets);

        if (filters?.groupNames?.length) {
          qb.andWhere('person.group IN (:...groupNames)', {
            groupNames: filters.groupNames
          });
        }
        if (filters?.bookletNames?.length) {
          qb.andWhere('bookletinfo.name IN (:...bookletNames)', {
            bookletNames: filters.bookletNames
          });
        }
        if (filters?.personIds?.length) {
          qb.andWhere('person.id IN (:...personIds)', {
            personIds: filters.personIds
          });
        }

        return qb;
      };

      const totalBookletLogs = await createBookletLogsBaseQuery().getCount();

      while (hasMoreBookletLogs) {
        const logs = await createBookletLogsBaseQuery()
          .andWhere('bookletLog.id > :lastBookletLogId', { lastBookletLogId })
          .orderBy('bookletLog.id', 'ASC')
          .take(BATCH_SIZE)
          .getRawMany<{
          id: number;
          ts: string | number | null;
          key: string;
          parameter: string | null;
          groupname: string;
          loginname: string;
          code: string;
          bookletname: string;
        }>();

        if (logs.length === 0) {
          hasMoreBookletLogs = false;
          break;
        }

        lastBookletLogId = Number(logs[logs.length - 1].id);

        for (const log of logs) {
          const parameter = log.parameter || '';
          const logentry = `${log.key} : ${parameter}`;
          const canContinue = csvStream.write({
            groupname: log.groupname,
            loginname: log.loginname,
            code: log.code,
            bookletname: log.bookletname,
            unitname: '',
            originalUnitId: '',
            timestamp: (log.ts ?? '').toString(),
            logentry
          });

          if (!canContinue) {
            await new Promise(resolve => {
              csvStream.once('drain', resolve);
            });
          }

          processedCount += 1;
          if (progressCallback && totalBookletLogs > 0) {
            await progressCallback(
              Math.round((processedCount / totalBookletLogs) * 100)
            );
          }
        }
      }
    }

    // Export unit logs (unitname must be non-empty for importer)
    let lastUnitLogId = 0;
    let hasMoreUnitLogs = true;

    const createUnitLogsBaseQuery = () => {
      const qb = this.unitLogRepository
        .createQueryBuilder('unitLog')
        .innerJoin('unitLog.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .select('unitLog.id', 'id')
        .addSelect('unitLog.ts', 'ts')
        .addSelect('unitLog.key', 'key')
        .addSelect('unitLog.parameter', 'parameter')
        .addSelect('unit.name', 'unitname')
        .addSelect('unit.alias', 'originalUnitId')
        .addSelect('person.group', 'groupname')
        .addSelect('person.login', 'loginname')
        .addSelect('person.code', 'code')
        .addSelect('bookletinfo.name', 'bookletname')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });
      this.applyExclusionsToQuery(qb, exclusions);

      if (filters?.groupNames?.length) {
        qb.andWhere('person.group IN (:...groupNames)', {
          groupNames: filters.groupNames
        });
      }
      if (filters?.bookletNames?.length) {
        qb.andWhere('bookletinfo.name IN (:...bookletNames)', {
          bookletNames: filters.bookletNames
        });
      }
      if (filters?.unitNames?.length) {
        qb.andWhere('unit.name IN (:...unitNames)', {
          unitNames: filters.unitNames
        });
      }
      if (filters?.personIds?.length) {
        qb.andWhere('person.id IN (:...personIds)', {
          personIds: filters.personIds
        });
      }

      return qb;
    };

    const totalUnitLogs = await createUnitLogsBaseQuery().getCount();

    while (hasMoreUnitLogs) {
      const logs = await createUnitLogsBaseQuery()
        .andWhere('unitLog.id > :lastUnitLogId', { lastUnitLogId })
        .orderBy('unitLog.id', 'ASC')
        .take(BATCH_SIZE)
        .getRawMany<{
        id: number;
        ts: string | number | null;
        key: string;
        parameter: string | null;
        unitname: string;
        originalUnitId: string | null;
        groupname: string;
        loginname: string;
        code: string;
        bookletname: string;
      }>();

      if (logs.length === 0) {
        hasMoreUnitLogs = false;
        break;
      }

      lastUnitLogId = Number(logs[logs.length - 1].id);

      for (const log of logs) {
        const parameter = log.parameter || '';
        const logentry = `${log.key}=${parameter}`;

        const canContinue = csvStream.write({
          groupname: log.groupname,
          loginname: log.loginname,
          code: log.code,
          bookletname: log.bookletname,
          unitname: log.unitname,
          originalUnitId: log.originalUnitId || log.unitname,
          timestamp: (log.ts ?? '').toString(),
          logentry
        });

        if (!canContinue) {
          await new Promise(resolve => {
            csvStream.once('drain', resolve);
          });
        }

        processedCount += 1;
        if (progressCallback && totalUnitLogs > 0) {
          await progressCallback(
            Math.round((processedCount / totalUnitLogs) * 100)
          );
        }
      }
    }

    csvStream.end();

    return new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  async getExportOptions(workspaceId: number): Promise<{
    testPersons: {
      id: number;
      groupName: string;
      code: string;
      login: string;
    }[];
    groups: string[];
    booklets: string[];
    units: string[];
  }> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const testPersons = await this.personsRepository
      .createQueryBuilder('person')
      .select(['person.id', 'person.group', 'person.code', 'person.login'])
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .orderBy('person.group', 'ASC')
      .addOrderBy('person.code', 'ASC')
      .addOrderBy('person.login', 'ASC')
      .getMany();

    const groups = await this.personsRepository
      .createQueryBuilder('person')
      .select('DISTINCT person.group', 'name')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .orderBy('person.group', 'ASC')
      .getRawMany();

    const bookletsQuery = this.bookletRepository
      .createQueryBuilder('booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('DISTINCT bookletinfo.name', 'name')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    this.applyIgnoredBookletsToQuery(bookletsQuery, exclusions.ignoredBooklets);
    const booklets = await bookletsQuery
      .orderBy('bookletinfo.name', 'ASC')
      .getRawMany();

    const unitsQuery = this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('DISTINCT unit.name', 'name')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    this.applyExclusionsToQuery(unitsQuery, exclusions);
    const units = await unitsQuery
      .orderBy('unit.name', 'ASC')
      .getRawMany();

    return {
      testPersons: testPersons.map(p => ({
        id: p.id,
        groupName: p.group,
        code: p.code,
        login: p.login
      })),
      groups: groups.map(g => g.name),
      booklets: booklets.map(b => b.name),
      units: units.map(u => u.name)
    };
  }

  async hasGeogebraResponses(workspaceId: number): Promise<boolean> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.value LIKE :ggPrefix', { ggPrefix: 'UEsD%' });
    this.applyExclusionsToQuery(query, exclusions);
    const count = await query
      .getCount();

    return count > 0;
  }
}
