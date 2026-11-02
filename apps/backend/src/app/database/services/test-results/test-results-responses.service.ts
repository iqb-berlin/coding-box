import {
  Inject,
  Injectable
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  QueryRunner,
  Repository
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
  statusNumberToString,
  statusStringToNumber
} from '../../utils/response-status-converter';
import {
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { TestResultsAnomaliesService } from './test-results-anomalies.service';
import {
  applyExclusionsToQuery, applyFlatResponseTextFilters, createGeoGebraUnitExistsCondition, excludeAutocoderGeneratedResponses
} from './test-results.util';
import { LogAnomalySummary } from './workspace-test-results.types';

@Injectable()
export class TestResultsResponsesService {
  private static readonly responseValueSearchPrefixLength = 2000;

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
}
