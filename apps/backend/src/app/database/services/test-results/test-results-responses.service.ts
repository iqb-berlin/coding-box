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
import { CacheService } from '../../../cache/cache.service';
import {
  toRegexSearchException,
  toResponseValueSearchException,
  validatePostgresRegexSearchPatterns,
  withRegexSearchStatementTimeout,
  withResponseValueSearchStatementTimeout
} from '../../../utils/regex-search.util';
import { ResponseEntity } from '../../entities/response.entity';
import {
  statusNumberToString,
  statusStringToNumber
} from '../../utils/response-status-converter';
import { FLAT_FREQUENCIES_CACHE_PREFIX } from '../workspace/workspace-constants';
import {
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { TestResultsAnomaliesService } from './test-results-anomalies.service';
import {
  applyExclusionsToQuery, applyFlatResponseTextFilters, createGeoGebraUnitExistsCondition, excludeAutocoderGeneratedResponses
} from './test-results.util';
import { FlatFrequenciesResult, LogAnomalySummary } from './workspace-test-results.types';

@Injectable()
export class TestResultsResponsesService {
  private static readonly responseValueSearchPrefixLength = 2000;

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    private readonly cacheService: CacheService,
    @Inject(WorkspaceExclusionService)
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly anomalies: TestResultsAnomaliesService
  ) {}

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
      logAnomalies?: string;
      includeLogAnomalies?: string;
      focusLostThresholdMs?: number | string;
      sessionSpanThresholdMs?: number | string;
      repeatedStartThreshold?: number | string;
      regexSearch?: boolean;
    },
    queryRunner?: QueryRunner
  ): Promise<
    [
      Array<{
        bookletId: number;
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
        logAnomalies: LogAnomalySummary[];
      }>,
      number
    ]
  > {
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

    const MAX_LIMIT = 200;
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
    const regexSearch = options.regexSearch === true;
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
    const logAnomalyThresholds = this.anomalies.buildLogAnomalyThresholds({
      longLoadingThresholdMs,
      focusLostThresholdMs: options.focusLostThresholdMs,
      sessionSpanThresholdMs: options.sessionSpanThresholdMs,
      repeatedStartThreshold: options.repeatedStartThreshold
    });
    const logAnomalyCodes = this.anomalies.expandLogAnomalyCodes(
      parseCsv(options.logAnomalies)
    );
    const includeLogAnomaliesRaw = String(options.includeLogAnomalies || '')
      .trim()
      .toLowerCase();
    const includeLogAnomalies =
      includeLogAnomaliesRaw === 'true' ||
      includeLogAnomaliesRaw === '1' ||
      includeLogAnomaliesRaw === 'yes';

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
      .createQueryBuilder('response', queryRunner)
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .leftJoin('unit.tags', 'unitTag')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyExclusionsToQuery(qb, exclusions);
    excludeAutocoderGeneratedResponses(qb);

    applyFlatResponseTextFilters(qb, {
      code,
      group,
      login,
      booklet,
      unit,
      response,
      regexSearch
    });
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
      qb.andWhere(
        `LEFT(response.value, ${TestResultsResponsesService.responseValueSearchPrefixLength}) ILIKE :responseValue`,
        { responseValue: `%${responseValue}%` }
      );
    }
    if (tags) {
      qb.andWhere('unitTag.tag ILIKE :tags', { tags: `%${tags}%` });
    }

    if (geogebraOnly) {
      qb.andWhere(
        createGeoGebraUnitExistsCondition('unit')
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
        `(EXISTS (
          SELECT 1
          FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND COALESCE(s.loadcompletems, 0) >= :longLoadingThresholdMs
        )
        OR EXISTS (
          SELECT 1
          FROM unitlog ul_started
          JOIN unitlog ul_ended ON ul_ended.unitid = ul_started.unitid
          WHERE ul_started.unitid = unit.id
            AND ul_started.key = 'STARTED'
            AND ul_ended.key = 'ENDED'
            AND (ul_ended.ts - ul_started.ts) >= :longLoadingThresholdMs
        ))`,
        { longLoadingThresholdMs }
      );
    }

    this.anomalies.applyLogAnomalyFilters(
      qb,
      logAnomalyCodes,
      logAnomalyThresholds,
      exclusions
    );

    const countQb = this.responseRepository
      .createQueryBuilder('response', queryRunner)
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    applyExclusionsToQuery(countQb, exclusions, {
      bookletInfoAlias: 'bookletinfo'
    });
    excludeAutocoderGeneratedResponses(countQb);

    applyFlatResponseTextFilters(countQb, {
      code,
      group,
      login,
      booklet,
      unit,
      response,
      regexSearch
    });
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
      countQb.andWhere(
        `LEFT(response.value, ${TestResultsResponsesService.responseValueSearchPrefixLength}) ILIKE :responseValue`,
        { responseValue: `%${responseValue}%` }
      );
    }
    if (tags) {
      countQb.andWhere(
        `EXISTS (
          SELECT 1
          FROM unit_tag count_unit_tag
          WHERE count_unit_tag."unitId" = unit.id
            AND count_unit_tag.tag ILIKE :tags
        )`,
        { tags: `%${tags}%` }
      );
    }

    if (geogebraOnly) {
      countQb.andWhere(
        createGeoGebraUnitExistsCondition('unit')
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
        `(EXISTS (
          SELECT 1
          FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND COALESCE(s.loadcompletems, 0) >= :longLoadingThresholdMs
        )
        OR EXISTS (
          SELECT 1
          FROM unitlog ul_started
          JOIN unitlog ul_ended ON ul_ended.unitid = ul_started.unitid
          WHERE ul_started.unitid = unit.id
            AND ul_started.key = 'STARTED'
            AND ul_ended.key = 'ENDED'
            AND (ul_ended.ts - ul_started.ts) >= :longLoadingThresholdMs
        ))`,
        { longLoadingThresholdMs }
      );
    }

    this.anomalies.applyLogAnomalyFilters(
      countQb,
      logAnomalyCodes,
      logAnomalyThresholds,
      exclusions
    );

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
      .select('COUNT(response.id)', 'cnt')
      .getRawOne()
      .then(r => Number(r?.cnt || 0));

    const raw = await qb
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
        "COALESCE(string_agg(DISTINCT unitTag.tag, ','), '') AS \"tags\""
      ])
      .setParameter(
        'maxResponseValueLen',
        TestResultsResponsesService.responseValueSearchPrefixLength
      )
      .groupBy('response.id')
      .addGroupBy('unit.id')
      .addGroupBy('bookletEntity.id')
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

    const anomaliesByBooklet = includeLogAnomalies ?
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
    applyExclusionsToQuery(qb, exclusions, {
      bookletInfoAlias: 'bookletinfo'
    });
    excludeAutocoderGeneratedResponses(qb);

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
          p: total > 0 ? count / total : 0
        };
      });
      result[key] = { total, values: rows };
    });

    await this.cacheService.set(cacheKey, result, 300); // 5 minutes cache
    return result;
  }

  private buildFlatResponseFilteredBookletsSubquery(
    baseQb: SelectQueryBuilder<ResponseEntity>
  ): [string, unknown[]] {
    return baseQb
      .clone()
      .select('"bookletEntity"."id"', 'bookletId')
      .distinct(true)
      .getQueryAndParameters();
  }

  private async queryFlatResponseProcessingDurationOptions(
    baseQb: SelectQueryBuilder<ResponseEntity>,
    maxOptions: number,
    processingDurationThresholdMs: number
  ): Promise<Array<{ v: string }>> {
    const [filteredBookletsSql, filteredBookletsParams] =
      this.buildFlatResponseFilteredBookletsSubquery(baseQb);
    const thresholdParam = `$${filteredBookletsParams.length + 1}`;
    const limit = Math.max(1, Math.floor(maxOptions));

    return this.connection.query(
      `
        SELECT DISTINCT
          CASE
            WHEN first_duration.duration_ms IS NULL THEN 'Unbekannt'
            WHEN first_duration.duration_ms < ${thresholdParam} THEN 'Kurz'
            ELSE 'Lang'
          END AS v
        FROM (${filteredBookletsSql}) filtered_booklets
        LEFT JOIN LATERAL (
          SELECT (bl_terminated.ts - bl_running.ts) AS duration_ms
          FROM bookletlog bl_running
          JOIN bookletlog bl_terminated
            ON bl_terminated.bookletid = bl_running.bookletid
          WHERE bl_running.bookletid = filtered_booklets."bookletId"
            AND bl_running.key = 'CONTROLLER'
            AND bl_running.parameter = 'RUNNING'
            AND bl_terminated.key = 'CONTROLLER'
            AND bl_terminated.parameter = 'TERMINATED'
          ORDER BY bl_running.id ASC, bl_terminated.id ASC
          LIMIT 1
        ) first_duration ON TRUE
        ORDER BY v ASC
        LIMIT ${limit}
      `,
      [...filteredBookletsParams, processingDurationThresholdMs]
    );
  }

  private async queryFlatResponseUnitProgressOptions(
    baseQb: SelectQueryBuilder<ResponseEntity>,
    maxOptions: number
  ): Promise<Array<{ v: string }>> {
    const [filteredBookletsSql, filteredBookletsParams] =
      this.buildFlatResponseFilteredBookletsSubquery(baseQb);
    const limit = Math.max(1, Math.floor(maxOptions));

    return this.connection.query(
      `
        SELECT DISTINCT progress.v AS v
        FROM (${filteredBookletsSql}) filtered_booklets
        CROSS JOIN LATERAL (
          SELECT
            CASE
              WHEN COUNT(DISTINCT progress_unit.id) > 0
                AND COUNT(DISTINCT progress_unit.id) =
                  COUNT(DISTINCT CASE
                    WHEN progress_log.id IS NOT NULL THEN progress_unit.id
                  END)
              THEN 'complete'
              ELSE 'incomplete'
            END AS v
          FROM unit progress_unit
          LEFT JOIN bookletlog progress_log
            ON progress_log.bookletid = filtered_booklets."bookletId"
            AND progress_log.key = 'CURRENT_UNIT_ID'
            AND progress_log.parameter = progress_unit.alias
          WHERE progress_unit.bookletid = filtered_booklets."bookletId"
            AND progress_unit.alias IS NOT NULL
        ) progress
        ORDER BY progress.v ASC
        LIMIT ${limit}
      `,
      filteredBookletsParams
    );
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
    applyExclusionsToQuery(baseQb, exclusions, {
      bookletInfoAlias: 'bookletinfo'
    });
    excludeAutocoderGeneratedResponses(baseQb);

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
      baseQb.andWhere(
        `LEFT(response.value, ${TestResultsResponsesService.responseValueSearchPrefixLength}) ILIKE :responseValue`,
        { responseValue: `%${responseValue}%` }
      );
    }
    if (tags) {
      baseQb.andWhere('unitTag.tag ILIKE :tags', { tags: `%${tags}%` });
    }

    if (geogebraOnly) {
      baseQb.andWhere(
        createGeoGebraUnitExistsCondition('unit')
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
        .andWhere('unitTag.tag IS NOT NULL')
        .orderBy('unitTag.tag', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .leftJoin('bookletEntity.sessions', 'session')
        .select('DISTINCT session.browser', 'v')
        .andWhere('session.browser IS NOT NULL')
        .orderBy('session.browser', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .leftJoin('bookletEntity.sessions', 'session')
        .select('DISTINCT session.os', 'v')
        .andWhere('session.os IS NOT NULL')
        .orderBy('session.os', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .leftJoin('bookletEntity.sessions', 'session')
        .select('DISTINCT session.screen', 'v')
        .andWhere('session.screen IS NOT NULL')
        .orderBy('session.screen', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>(),
      baseQb
        .clone()
        .leftJoin('bookletEntity.sessions', 'session')
        .select('DISTINCT session.id', 'v')
        .andWhere('session.id IS NOT NULL')
        .orderBy('session.id', 'ASC')
        .limit(MAX_OPTIONS)
        .getRawMany<{ v: string }>()
    ]);

    const [processingDurationRows, unitProgressRows] = await Promise.all([
      this.queryFlatResponseProcessingDurationOptions(
        baseQb,
        MAX_OPTIONS,
        processingDurationThresholdMs
      ),
      this.queryFlatResponseUnitProgressOptions(baseQb, MAX_OPTIONS)
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
}
