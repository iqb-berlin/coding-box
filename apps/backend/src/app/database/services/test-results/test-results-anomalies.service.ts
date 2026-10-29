import {
  Inject,
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ObjectLiteral,
  Repository,
  SelectQueryBuilder
} from 'typeorm';
import { Booklet } from '../../entities/booklet.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { Session } from '../../entities/session.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import {
  ResolvedWorkspaceExclusions,
  WorkspaceExclusionService,
  isExcludedByResolvedExclusions,
  normalizeExclusionBookletId,
  normalizeExclusionUnitId
} from '../workspace/workspace-exclusion.service';
import { applyIgnoredBookletsToQuery } from './test-results.util';
import {
  LogAnomalyCode, LogAnomalyDashboardSummary, LogAnomalyDetailRow, LogAnomalyDetailsResponse, LogAnomalySessionRow, LogAnomalySeverity, LogAnomalySqlFragment, LogAnomalySummary, LogAnomalyThresholds
} from './workspace-test-results.types';

@Injectable()
export class TestResultsAnomaliesService {
  private readonly logger = new Logger('WorkspaceTestResultsService');
  private static readonly logAnomalyQueryBatchSize = 1000;

  constructor(
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(BookletLog)
    private bookletLogRepository: Repository<BookletLog>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    @InjectRepository(UnitLog)
    private unitLogRepository: Repository<UnitLog>,
    @Inject(WorkspaceExclusionService)
    private readonly workspaceExclusionService: WorkspaceExclusionService
  ) {}

  buildLogAnomalyThresholds(options: {
    longLoadingThresholdMs?: number | string;
    focusLostThresholdMs?: number | string;
    sessionSpanThresholdMs?: number | string;
    repeatedStartThreshold?: number | string;
  }): LogAnomalyThresholds {
    const parseNumber = (
      raw: number | string | undefined,
      fallback: number
    ): number => {
      const parsed = Number(String(raw ?? '').trim() || fallback);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };

    return {
      longLoadingThresholdMs: parseNumber(
        options.longLoadingThresholdMs,
        5000
      ),
      focusLostThresholdMs: parseNumber(options.focusLostThresholdMs, 300000),
      sessionSpanThresholdMs: parseNumber(
        options.sessionSpanThresholdMs,
        24 * 60 * 60 * 1000
      ),
      repeatedStartThreshold: Math.max(
        2,
        Math.round(parseNumber(options.repeatedStartThreshold, 2))
      )
    };
  }

  expandLogAnomalyCodes(rawCodes: string[]): LogAnomalyCode[] {
    const allCodes: LogAnomalyCode[] = [
      'controller_error',
      'missing_termination',
      'connection_lost',
      'timestamp_zero',
      'player_stuck_loading',
      'repeated_start',
      'long_loading',
      'timer_left_on_exit',
      'timer_never_finished',
      'focus_lost_long',
      'unit_progress_incomplete',
      'progress_incomplete',
      'debug_command',
      'session_span_long',
      'orphan_logs'
    ];
    const groups: Record<string, LogAnomalyCode[]> = {
      any: allCodes,
      all: allCodes,
      critical: [
        'controller_error',
        'missing_termination',
        'connection_lost',
        'player_stuck_loading'
      ],
      warning: [
        'repeated_start',
        'long_loading',
        'timer_left_on_exit',
        'timer_never_finished',
        'focus_lost_long',
        'unit_progress_incomplete',
        'progress_incomplete'
      ],
      info: ['timestamp_zero', 'debug_command', 'session_span_long', 'orphan_logs'],
      technical: [
        'controller_error',
        'connection_lost',
        'timestamp_zero',
        'player_stuck_loading',
        'long_loading'
      ],
      incomplete: [
        'missing_termination',
        'unit_progress_incomplete',
        'progress_incomplete',
        'timer_left_on_exit',
        'timer_never_finished',
        'orphan_logs'
      ],
      connection: ['connection_lost'],
      connection_lost: ['connection_lost'],
      timer: ['timer_left_on_exit', 'timer_never_finished'],
      focus: ['focus_lost_long'],
      debug: ['debug_command'],
      reloads: ['repeated_start'],
      span: ['session_span_long']
    };
    const expanded = rawCodes.flatMap(raw => {
      const key = raw.trim().toLowerCase();
      if (groups[key]) {
        return groups[key];
      }
      return allCodes.includes(key as LogAnomalyCode) ?
        [key as LogAnomalyCode] :
        [];
    });

    return Array.from(new Set(expanded));
  }

  private getNormalizedLogAnomalyUnitSql(expression: string): string {
    return `REGEXP_REPLACE(UPPER(${expression}), '\\.XML$', '', 'i')`;
  }

  private buildLogAnomalyUnitVisibilitySql(
    unitNameExpression: string,
    exclusions: ResolvedWorkspaceExclusions | undefined,
    parameterPrefix: string,
    bookletNameExpression = 'bookletinfo.name'
  ): LogAnomalySqlFragment {
    const conditions: string[] = [];
    const params: Record<string, string | string[]> = {};
    const normalizedUnitExpression =
      this.getNormalizedLogAnomalyUnitSql(unitNameExpression);

    if (exclusions?.globalIgnoredUnits.length) {
      conditions.push(
        `${normalizedUnitExpression} NOT IN (:...${parameterPrefix}IgnoredUnits)`
      );
      params[`${parameterPrefix}IgnoredUnits`] =
        exclusions.globalIgnoredUnits.map(normalizeExclusionUnitId);
    }

    if (exclusions?.testletIgnoredUnits.length) {
      const testletCondition = exclusions.testletIgnoredUnits
        .map((_, index) => (
          `(UPPER(${bookletNameExpression}) = :${parameterPrefix}Booklet${index} ` +
          `AND ${normalizedUnitExpression} = :${parameterPrefix}Unit${index})`
        ))
        .join(' OR ');
      conditions.push(`NOT (${testletCondition})`);
      exclusions.testletIgnoredUnits.forEach((ignoredUnit, index) => {
        params[`${parameterPrefix}Booklet${index}`] =
          normalizeExclusionBookletId(ignoredUnit.bookletId);
        params[`${parameterPrefix}Unit${index}`] =
          normalizeExclusionUnitId(ignoredUnit.unitId);
      });
    }

    return {
      sql: conditions.length > 0 ? conditions.join(' AND ') : 'TRUE',
      params
    };
  }

  private getLogAnomalySql(
    code: LogAnomalyCode,
    thresholds: LogAnomalyThresholds,
    exclusions?: ResolvedWorkspaceExclusions,
    parameterPrefix = 'logAnomaly'
  ): LogAnomalySqlFragment | string {
    const longLoadingThreshold = Math.round(thresholds.longLoadingThresholdMs);
    const focusLostThreshold = Math.round(thresholds.focusLostThresholdMs);
    const sessionSpanThreshold = Math.round(thresholds.sessionSpanThresholdMs);
    const repeatedStartThreshold = Math.round(
      thresholds.repeatedStartThreshold
    );

    switch (code) {
      case 'controller_error':
        return `EXISTS (
          SELECT 1 FROM bookletlog bl
          WHERE bl.bookletid = "bookletEntity"."id"
            AND bl.key = 'CONTROLLER'
            AND bl.parameter = 'ERROR'
        )`;
      case 'missing_termination':
        return `EXISTS (
          SELECT 1 FROM bookletlog bl_started
          WHERE bl_started.bookletid = "bookletEntity"."id"
            AND bl_started.key = 'CONTROLLER'
            AND bl_started.parameter IN ('LOADING', 'RUNNING')
        )
        AND NOT EXISTS (
          SELECT 1 FROM bookletlog bl_terminated
          WHERE bl_terminated.bookletid = "bookletEntity"."id"
            AND bl_terminated.key = 'CONTROLLER'
            AND bl_terminated.parameter = 'TERMINATED'
        )`;
      case 'connection_lost':
        return `EXISTS (
          SELECT 1 FROM bookletlog bl
          WHERE bl.bookletid = "bookletEntity"."id"
            AND bl.key = 'CONNECTION'
            AND bl.parameter = 'LOST'
        )`;
      case 'timestamp_zero': {
        const unitVisibility = this.buildLogAnomalyUnitVisibilitySql(
          'u.name',
          exclusions,
          `${parameterPrefix}TimestampZero`
        );
        return {
          sql: `EXISTS (
          SELECT 1 FROM bookletlog bl
          WHERE bl.bookletid = "bookletEntity"."id"
            AND COALESCE(bl.ts, 0) = 0
        )
        OR EXISTS (
          SELECT 1 FROM unit u
          JOIN unitlog ul ON ul.unitid = u.id
          WHERE u.bookletid = "bookletEntity"."id"
            AND ${unitVisibility.sql}
            AND COALESCE(ul.ts, 0) = 0
        )`,
          params: unitVisibility.params
        };
      }
      case 'player_stuck_loading': {
        const unitVisibility = this.buildLogAnomalyUnitVisibilitySql(
          'u.name',
          exclusions,
          `${parameterPrefix}PlayerLoading`
        );
        return {
          sql: `EXISTS (
          SELECT 1 FROM unit u
          JOIN unitlog ul ON ul.unitid = u.id
          WHERE u.bookletid = "bookletEntity"."id"
            AND ${unitVisibility.sql}
          GROUP BY u.id
          HAVING COUNT(*) FILTER (
            WHERE ul.key = 'PLAYER' AND ul.parameter = 'LOADING'
          ) > COUNT(*) FILTER (
            WHERE ul.key = 'PLAYER' AND ul.parameter = 'RUNNING'
          )
        )`,
          params: unitVisibility.params
        };
      }
      case 'repeated_start':
        return `(SELECT COUNT(*)
          FROM bookletlog bl
          WHERE bl.bookletid = "bookletEntity"."id"
            AND bl.key = 'CONTROLLER'
            AND bl.parameter = 'LOADING'
        ) >= ${repeatedStartThreshold}`;
      case 'long_loading': {
        const unitVisibility = this.buildLogAnomalyUnitVisibilitySql(
          'u.name',
          exclusions,
          `${parameterPrefix}LongLoading`
        );
        return {
          sql: `EXISTS (
          SELECT 1 FROM session s
          WHERE s.bookletid = "bookletEntity"."id"
            AND COALESCE(s.loadcompletems, 0) >= ${longLoadingThreshold}
        )
        OR EXISTS (
          SELECT 1
          FROM unit u
          JOIN unitlog ul_started ON ul_started.unitid = u.id
          JOIN unitlog ul_ended ON ul_ended.unitid = u.id
          WHERE u.bookletid = "bookletEntity"."id"
            AND ${unitVisibility.sql}
            AND ul_started.key = 'STARTED'
            AND ul_ended.key = 'ENDED'
            AND (ul_ended.ts - ul_started.ts) >= ${longLoadingThreshold}
        )`,
          params: unitVisibility.params
        };
      }
      case 'timer_left_on_exit':
        return `EXISTS (
          SELECT 1 FROM bookletlog bl
          WHERE bl.bookletid = "bookletEntity"."id"
            AND bl.key = 'TESTLETS_TIMELEFT'
            AND bl.id = (
              SELECT bl_last.id
              FROM bookletlog bl_last
              WHERE bl_last.bookletid = "bookletEntity"."id"
                AND bl_last.key = 'TESTLETS_TIMELEFT'
              ORDER BY bl_last.ts DESC NULLS LAST, bl_last.id DESC
              LIMIT 1
            )
            AND COALESCE(bl.parameter, '') ~ ':[[:space:]]*(0\\.[0-9]*[1-9]|[1-9][0-9]*(\\.[0-9]+)?)'
        )`;
      case 'timer_never_finished':
        return `EXISTS (
          SELECT 1 FROM bookletlog bl
          WHERE bl.bookletid = "bookletEntity"."id"
            AND bl.key = 'TESTLETS_TIMELEFT'
            AND COALESCE(bl.parameter, '') ~ ':[[:space:]]*(0\\.[0-9]*[1-9]|[1-9][0-9]*(\\.[0-9]+)?)'
        )
        AND NOT EXISTS (
          SELECT 1 FROM bookletlog bl_zero
          WHERE bl_zero.bookletid = "bookletEntity"."id"
            AND bl_zero.key = 'TESTLETS_TIMELEFT'
            AND COALESCE(bl_zero.parameter, '') ~ ':[[:space:]]*0(\\.0+)?([,}])'
        )`;
      case 'focus_lost_long':
        return `EXISTS (
          SELECT 1 FROM bookletlog bl_lost
          WHERE bl_lost.bookletid = "bookletEntity"."id"
            AND bl_lost.key = 'FOCUS'
            AND bl_lost.parameter = 'HAS_NOT'
            AND (
              COALESCE(
                (
                  SELECT bl_has.ts
                  FROM bookletlog bl_has
                  WHERE bl_has.bookletid = bl_lost.bookletid
                    AND bl_has.key = 'FOCUS'
                    AND bl_has.parameter = 'HAS'
                    AND (
                      bl_has.ts > bl_lost.ts
                      OR (bl_has.ts = bl_lost.ts AND bl_has.id > bl_lost.id)
                    )
                  ORDER BY bl_has.ts ASC NULLS LAST, bl_has.id ASC
                  LIMIT 1
                ),
                (
                  SELECT MAX(bl_any.ts)
                  FROM bookletlog bl_any
                  WHERE bl_any.bookletid = bl_lost.bookletid
                ),
                bl_lost.ts
              ) - bl_lost.ts
            ) >= ${focusLostThreshold}
        )`;
      case 'unit_progress_incomplete': {
        const availableUnitVisibility =
          this.buildLogAnomalyUnitVisibilitySql(
            'u2.name',
            exclusions,
            `${parameterPrefix}UnitProgressAvailable`
          );
        const missingUnitVisibility =
          this.buildLogAnomalyUnitVisibilitySql(
            'u3.name',
            exclusions,
            `${parameterPrefix}UnitProgressMissing`
          );
        return {
          sql: `EXISTS (
          SELECT 1 FROM unit u2
          WHERE u2.bookletid = "bookletEntity"."id"
            AND u2.alias IS NOT NULL
            AND ${availableUnitVisibility.sql}
        )
        AND EXISTS (
          SELECT 1 FROM unit u3
          WHERE u3.bookletid = "bookletEntity"."id"
            AND u3.alias IS NOT NULL
            AND ${missingUnitVisibility.sql}
            AND NOT EXISTS (
              SELECT 1 FROM bookletlog bl
              WHERE bl.bookletid = "bookletEntity"."id"
                AND bl.key = 'CURRENT_UNIT_ID'
                AND bl.parameter = u3.alias
            )
        )`,
          params: {
            ...availableUnitVisibility.params,
            ...missingUnitVisibility.params
          }
        };
      }
      case 'progress_incomplete': {
        const unitVisibility = this.buildLogAnomalyUnitVisibilitySql(
          'u.name',
          exclusions,
          `${parameterPrefix}ProgressIncomplete`
        );
        return {
          sql: `EXISTS (
          SELECT 1 FROM unit u
          JOIN unitlog ul ON ul.unitid = u.id
          WHERE u.bookletid = "bookletEntity"."id"
            AND ${unitVisibility.sql}
            AND ul.key IN ('PRESENTATION_PROGRESS', 'RESPONSE_PROGRESS')
            AND ul.id = (
              SELECT ul_last.id
              FROM unitlog ul_last
              WHERE ul_last.unitid = ul.unitid
                AND ul_last.key = ul.key
              ORDER BY ul_last.ts DESC NULLS LAST, ul_last.id DESC
              LIMIT 1
            )
            AND COALESCE(ul.parameter, '') <> 'complete'
        )`,
          params: unitVisibility.params
        };
      }
      case 'debug_command':
        return `EXISTS (
          SELECT 1 FROM bookletlog bl
          WHERE bl.bookletid = "bookletEntity"."id"
            AND bl.key = 'command executed'
            AND COALESCE(bl.parameter, '') ILIKE '%debug%'
        )`;
      case 'session_span_long':
        return `(
          COALESCE("bookletEntity"."lastts", 0) > 0
          AND COALESCE("bookletEntity"."firstts", 0) > 0
          AND ("bookletEntity"."lastts" - "bookletEntity"."firstts") >= ${sessionSpanThreshold}
        )`;
      case 'orphan_logs':
        return `EXISTS (
          SELECT 1 FROM bookletlog bl
          WHERE bl.bookletid = "bookletEntity"."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM bookletlog bl_started
          WHERE bl_started.bookletid = "bookletEntity"."id"
            AND bl_started.key = 'CONTROLLER'
            AND bl_started.parameter IN ('LOADING', 'RUNNING')
        )`;
      default:
        return 'FALSE';
    }
  }

  applyLogAnomalyFilters(
    qb: SelectQueryBuilder<ObjectLiteral>,
    codes: LogAnomalyCode[],
    thresholds: LogAnomalyThresholds,
    exclusions?: ResolvedWorkspaceExclusions
  ): void {
    if (codes.length === 0) {
      return;
    }
    const fragments = codes.map((code, index) => {
      const fragment = this.getLogAnomalySql(
        code,
        thresholds,
        exclusions,
        `logAnomaly${index}`
      );
      return typeof fragment === 'string' ?
        { sql: fragment, params: {} } :
        fragment;
    });
    const params = fragments.reduce<Record<string, string | string[]>>(
      (acc, fragment) => ({ ...acc, ...fragment.params }),
      {}
    );
    const anomalySql = fragments.map(fragment => `(${fragment.sql})`);
    qb.andWhere(`(${anomalySql.join(' OR ')})`, params);
  }

  private ensureLogAnomalyList(
    map: Map<number, LogAnomalySummary[]>,
    bookletId: number
  ): LogAnomalySummary[] {
    const existing = map.get(bookletId);
    if (existing) {
      return existing;
    }
    const created: LogAnomalySummary[] = [];
    map.set(bookletId, created);
    return created;
  }

  private addLogAnomaly(
    map: Map<number, LogAnomalySummary[]>,
    bookletId: number,
    anomaly: LogAnomalySummary
  ): void {
    const list = this.ensureLogAnomalyList(map, bookletId);
    const existing = list.find(a => a.code === anomaly.code);
    if (existing) {
      existing.count += anomaly.count;
      return;
    }
    list.push(anomaly);
  }

  private getLogAnomalySortValue(severity: LogAnomalySeverity): number {
    switch (severity) {
      case 'critical':
        return 0;
      case 'warning':
        return 1;
      case 'info':
        return 2;
      default:
        return 3;
    }
  }

  private hasResolvedExclusions(
    exclusions?: ResolvedWorkspaceExclusions
  ): exclusions is ResolvedWorkspaceExclusions {
    return !!exclusions && (
      exclusions.globalIgnoredUnits.length > 0 ||
      exclusions.ignoredBooklets.length > 0 ||
      exclusions.testletIgnoredUnits.length > 0
    );
  }

  private getLogAnomalyIdBatches(ids: number[]): number[][] {
    const batches: number[][] = [];
    for (
      let index = 0;
      index < ids.length;
      index += TestResultsAnomaliesService.logAnomalyQueryBatchSize
    ) {
      batches.push(
        ids.slice(
          index,
          index + TestResultsAnomaliesService.logAnomalyQueryBatchSize
        )
      );
    }
    return batches;
  }

  private async loadLogAnomalyRowsInBatches<T>(
    ids: number[],
    loadBatch: (batchIds: number[]) => Promise<T[]>
  ): Promise<T[]> {
    const rows: T[] = [];
    for (const batchIds of this.getLogAnomalyIdBatches(ids)) {
      rows.push(...await loadBatch(batchIds));
    }
    return rows;
  }

  private async getBookletNamesById(
    bookletIds: number[]
  ): Promise<Map<number, string>> {
    if (bookletIds.length === 0) {
      return new Map();
    }

    const rows = await this.loadLogAnomalyRowsInBatches(
      bookletIds,
      batchIds => this.bookletRepository
        .createQueryBuilder('bookletEntity')
        .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
        .select('bookletEntity.id', 'id')
        .addSelect('bookletinfo.name', 'name')
        .where('bookletEntity.id IN (:...bookletIds)', {
          bookletIds: batchIds
        })
        .getRawMany<{ id: number | string; name: string | null }>()
    );

    return new Map(
      rows.map(row => [Number(row.id), String(row.name || '')])
    );
  }

  private toLogTimestamp(value: number | string | null | undefined): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private formatDurationForEvidence(ms: number): string {
    const safeMs = Math.max(0, Math.round(ms));
    const totalSeconds = Math.round(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')} min`;
  }

  private async findLogAnomaliesForBookletBatch(
    bookletIds: number[],
    thresholds: LogAnomalyThresholds,
    exclusions?: ResolvedWorkspaceExclusions
  ): Promise<Map<number, LogAnomalySummary[]>> {
    let uniqueBookletIds = Array.from(
      new Set(bookletIds.map(id => Number(id)).filter(id => id > 0))
    );
    const result = new Map<number, LogAnomalySummary[]>();
    if (uniqueBookletIds.length === 0) {
      return result;
    }

    const shouldApplyExclusions = this.hasResolvedExclusions(exclusions);
    const bookletNamesById = shouldApplyExclusions ?
      await this.getBookletNamesById(uniqueBookletIds) :
      new Map<number, string>();

    if (shouldApplyExclusions) {
      uniqueBookletIds = uniqueBookletIds.filter(bookletId => (
        !isExcludedByResolvedExclusions(
          exclusions,
          bookletNamesById.get(bookletId),
          undefined
        )
      ));
      if (uniqueBookletIds.length === 0) {
        return result;
      }
    }

    const [bookletLogs, sessions, units] = await Promise.all([
      this.loadLogAnomalyRowsInBatches(
        uniqueBookletIds,
        batchIds => this.bookletLogRepository
          .createQueryBuilder('bookletLog')
          .where('bookletLog.bookletid IN (:...bookletIds)', {
            bookletIds: batchIds
          })
          .select([
            'bookletLog.id',
            'bookletLog.bookletid',
            'bookletLog.key',
            'bookletLog.parameter',
            'bookletLog.ts'
          ])
          .orderBy('bookletLog.bookletid', 'ASC')
          .addOrderBy('bookletLog.ts', 'ASC', 'NULLS LAST')
          .addOrderBy('bookletLog.id', 'ASC')
          .getMany()
      ),
      this.loadLogAnomalyRowsInBatches(
        uniqueBookletIds,
        batchIds => this.sessionRepository
          .createQueryBuilder('session')
          .where('session.bookletid IN (:...bookletIds)', {
            bookletIds: batchIds
          })
          .select('session.id', 'id')
          .addSelect('session.bookletid', 'bookletid')
          .addSelect('session.browser', 'browser')
          .addSelect('session.os', 'os')
          .addSelect('session.screen', 'screen')
          .addSelect('session.ts', 'ts')
          .addSelect('session.loadcompletems', 'loadcompletems')
          .orderBy('session.bookletid', 'ASC')
          .addOrderBy('session.id', 'ASC')
          .getRawMany<LogAnomalySessionRow>()
      ),
      this.loadLogAnomalyRowsInBatches(
        uniqueBookletIds,
        batchIds => this.unitRepository
          .createQueryBuilder('unit')
          .where('unit.bookletid IN (:...bookletIds)', {
            bookletIds: batchIds
          })
          .select(['unit.id', 'unit.bookletid', 'unit.name', 'unit.alias'])
          .orderBy('unit.bookletid', 'ASC')
          .addOrderBy('unit.id', 'ASC')
          .getMany()
      )
    ]);

    const visibleUnits = shouldApplyExclusions ?
      (units || []).filter(unit => (
        !isExcludedByResolvedExclusions(
          exclusions,
          bookletNamesById.get(unit.bookletid),
          unit.name
        )
      )) :
      (units || []);
    const unitIds = visibleUnits.map(unit => Number(unit.id)).filter(id => id > 0);
    const unitLogs = unitIds.length > 0 ?
      await this.loadLogAnomalyRowsInBatches(
        unitIds,
        batchIds => this.unitLogRepository
          .createQueryBuilder('unitLog')
          .where('unitLog.unitid IN (:...unitIds)', { unitIds: batchIds })
          .select([
            'unitLog.id',
            'unitLog.unitid',
            'unitLog.key',
            'unitLog.parameter',
            'unitLog.ts'
          ])
          .orderBy('unitLog.unitid', 'ASC')
          .addOrderBy('unitLog.ts', 'ASC', 'NULLS LAST')
          .addOrderBy('unitLog.id', 'ASC')
          .getMany()
      ) :
      [];

    const logsByBooklet = new Map<number, BookletLog[]>();
    const sessionsByBooklet = new Map<number, LogAnomalySessionRow[]>();
    const unitsByBooklet = new Map<number, Unit[]>();
    const unitLogsByUnit = new Map<number, UnitLog[]>();

    (bookletLogs || []).forEach(log => {
      const list = logsByBooklet.get(log.bookletid) || [];
      list.push(log);
      logsByBooklet.set(log.bookletid, list);
    });
    (sessions || []).forEach(session => {
      const bookletId = Number(session.bookletid);
      const list = sessionsByBooklet.get(bookletId) || [];
      list.push(session);
      sessionsByBooklet.set(bookletId, list);
    });
    visibleUnits.forEach(unit => {
      const list = unitsByBooklet.get(unit.bookletid) || [];
      list.push(unit);
      unitsByBooklet.set(unit.bookletid, list);
    });
    (unitLogs || []).forEach(log => {
      const list = unitLogsByUnit.get(log.unitid) || [];
      list.push(log);
      unitLogsByUnit.set(log.unitid, list);
    });

    const nonZeroTimerPattern =
      /:\s*(?:0\.[0-9]*[1-9]|[1-9][0-9]*(?:\.[0-9]+)?)/;
    const zeroTimerPattern = /:\s*0(?:\.0+)?(?=[,}])/;

    uniqueBookletIds.forEach(bookletId => {
      const logs = logsByBooklet.get(bookletId) || [];
      const bookletSessions = sessionsByBooklet.get(bookletId) || [];
      const bookletUnits = unitsByBooklet.get(bookletId) || [];
      const controllerLogs = logs.filter(log => log.key === 'CONTROLLER');
      const startedLogs = controllerLogs.filter(log => ['LOADING', 'RUNNING'].includes(String(log.parameter || '')));
      const terminatedLogs = controllerLogs.filter(log => log.parameter === 'TERMINATED');
      const allTimestamps = [
        ...logs.map(log => this.toLogTimestamp(log.ts)),
        ...bookletSessions.map(session => this.toLogTimestamp(session.ts))
      ].filter((ts): ts is number => ts !== null);

      const controllerError = controllerLogs.find(log => log.parameter === 'ERROR');
      if (controllerError) {
        this.addLogAnomaly(result, bookletId, {
          code: 'controller_error',
          severity: 'critical',
          label: 'Controller-Fehler',
          evidence: `CONTROLLER : ERROR bei ${controllerError.ts || 'unbekannter Zeit'}`,
          count: 1
        });
      }

      if (startedLogs.length > 0 && terminatedLogs.length === 0) {
        this.addLogAnomaly(result, bookletId, {
          code: 'missing_termination',
          severity: 'critical',
          label: 'Kein Abschluss',
          evidence: 'CONTROLLER wurde gestartet, aber TERMINATED fehlt.',
          count: 1
        });
      }

      const connectionLostCount = logs.filter(
        log => log.key === 'CONNECTION' && log.parameter === 'LOST'
      ).length;
      if (connectionLostCount > 0) {
        this.addLogAnomaly(result, bookletId, {
          code: 'connection_lost',
          severity: 'critical',
          label: 'Verbindung verloren',
          evidence: `${connectionLostCount} CONNECTION : LOST Eintrag/Einträge`,
          count: connectionLostCount
        });
      }

      const unitLogZeroCount = bookletUnits
        .flatMap(unit => unitLogsByUnit.get(unit.id) || [])
        .filter(log => Number(log.ts || 0) === 0).length;
      const timestampZeroCount =
        logs.filter(log => Number(log.ts || 0) === 0).length + unitLogZeroCount;
      if (timestampZeroCount > 0) {
        this.addLogAnomaly(result, bookletId, {
          code: 'timestamp_zero',
          severity: 'info',
          label: 'Timestamp 0',
          evidence: `${timestampZeroCount} Logeintrag/Logeinträge ohne echte Clientzeit`,
          count: timestampZeroCount
        });
      }

      const loadingCount = controllerLogs.filter(log => log.parameter === 'LOADING').length;
      if (loadingCount >= thresholds.repeatedStartThreshold) {
        this.addLogAnomaly(result, bookletId, {
          code: 'repeated_start',
          severity: 'warning',
          label: 'Mehrfach gestartet',
          evidence: `${loadingCount} CONTROLLER : LOADING Einträge`,
          count: loadingCount
        });
      }

      const longLoadingSessions = bookletSessions
        .map(session => Number(session.loadcompletems || 0))
        .filter(loadCompleteMs => loadCompleteMs >= thresholds.longLoadingThresholdMs);
      const longLoadingUnits: Array<{ unit: Unit; durationMs: number }> = [];
      const toUnitLoadingTimestamp = (
        value: number | string | null | undefined
      ): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === 'string' && value.trim() === '') {
          return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      bookletUnits.forEach(unit => {
        const logsForUnit = unitLogsByUnit.get(unit.id) || [];
        const startedLogsForUnit = logsForUnit
          .filter(log => log.key === 'STARTED')
          .map(log => toUnitLoadingTimestamp(log.ts))
          .filter((ts): ts is number => ts !== null);
        const endedLogsForUnit = logsForUnit
          .filter(log => log.key === 'ENDED')
          .map(log => toUnitLoadingTimestamp(log.ts))
          .filter((ts): ts is number => ts !== null);
        const maxUnitDuration = Math.max(
          0,
          ...startedLogsForUnit.flatMap(startTs => endedLogsForUnit
            .filter(endTs => endTs >= startTs)
            .map(endTs => endTs - startTs))
        );
        if (maxUnitDuration >= thresholds.longLoadingThresholdMs) {
          longLoadingUnits.push({ unit, durationMs: maxUnitDuration });
        }
      });
      const maxSessionLoadTime = Math.max(0, ...longLoadingSessions);
      const maxUnitLoadTime = Math.max(
        0,
        ...longLoadingUnits.map(item => item.durationMs)
      );
      const maxLoadTime = Math.max(maxSessionLoadTime, maxUnitLoadTime);
      if (maxLoadTime >= thresholds.longLoadingThresholdMs) {
        const evidence = maxUnitLoadTime > maxSessionLoadTime ?
          `Maximale Unit-Ladezeit ${Math.round(maxUnitLoadTime)} ms` :
          `Maximale LOADCOMPLETE-Ladezeit ${Math.round(maxSessionLoadTime)} ms`;
        this.addLogAnomaly(result, bookletId, {
          code: 'long_loading',
          severity: 'warning',
          label: 'Lange Ladezeit',
          evidence,
          count: longLoadingSessions.length + longLoadingUnits.length
        });
      }

      const timerLogs = logs.filter(log => log.key === 'TESTLETS_TIMELEFT');
      const lastTimer = [...timerLogs].sort((a, b) => {
        const tsDelta = Number(b.ts || 0) - Number(a.ts || 0);
        return tsDelta || (Number(b.id || 0) - Number(a.id || 0));
      })[0];
      if (
        lastTimer &&
        nonZeroTimerPattern.test(String(lastTimer.parameter || ''))
      ) {
        this.addLogAnomaly(result, bookletId, {
          code: 'timer_left_on_exit',
          severity: 'warning',
          label: 'Restzeit am Ende',
          evidence: `Letzter Timerstatus: ${lastTimer.parameter}`,
          count: 1
        });
      }
      if (
        timerLogs.length > 0 &&
        timerLogs.some(log => nonZeroTimerPattern.test(String(log.parameter || ''))) &&
        !timerLogs.some(log => zeroTimerPattern.test(String(log.parameter || '')))
      ) {
        this.addLogAnomaly(result, bookletId, {
          code: 'timer_never_finished',
          severity: 'warning',
          label: 'Timer nicht beendet',
          evidence: 'Timer wurde gesetzt, aber kein 0-Status gefunden.',
          count: 1
        });
      }

      const focusLogs = logs.filter(log => log.key === 'FOCUS');
      let currentFocusLost: BookletLog | null = null;
      let maxFocusLostMs = 0;
      for (const log of focusLogs) {
        if (log.parameter === 'HAS_NOT' && currentFocusLost === null) {
          currentFocusLost = log;
          continue;
        }
        if (log.parameter === 'HAS' && currentFocusLost !== null) {
          const startTs = this.toLogTimestamp(currentFocusLost.ts);
          const endTs = this.toLogTimestamp(log.ts);
          if (startTs !== null && endTs !== null && endTs >= startTs) {
            maxFocusLostMs = Math.max(maxFocusLostMs, endTs - startTs);
          }
          currentFocusLost = null;
        }
      }
      if (currentFocusLost !== null && allTimestamps.length > 0) {
        const startTs = this.toLogTimestamp(currentFocusLost.ts);
        const endTs = Math.max(...allTimestamps);
        if (startTs !== null && endTs >= startTs) {
          maxFocusLostMs = Math.max(maxFocusLostMs, endTs - startTs);
        }
      }
      if (maxFocusLostMs >= thresholds.focusLostThresholdMs) {
        this.addLogAnomaly(result, bookletId, {
          code: 'focus_lost_long',
          severity: 'warning',
          label: 'Langer Fokusverlust',
          evidence: `Längste Fokus-Abwesenheit ${this.formatDurationForEvidence(maxFocusLostMs)}`,
          count: 1
        });
      }

      const visitedUnitAliases = new Set(
        logs
          .filter(log => log.key === 'CURRENT_UNIT_ID')
          .map(log => String(log.parameter || '').trim())
          .filter(Boolean)
      );
      const unitAliases = bookletUnits
        .map(unit => String(unit.alias || '').trim())
        .filter(Boolean);
      const missingUnitAliases = unitAliases.filter(alias => !visitedUnitAliases.has(alias));
      if (unitAliases.length > 0 && missingUnitAliases.length > 0) {
        this.addLogAnomaly(result, bookletId, {
          code: 'unit_progress_incomplete',
          severity: 'warning',
          label: 'Units fehlen',
          evidence: `${missingUnitAliases.length} von ${unitAliases.length} Unit-Aliasen ohne CURRENT_UNIT_ID`,
          count: missingUnitAliases.length
        });
      }

      let incompleteUnitProgressCount = 0;
      let playerStuckCount = 0;
      bookletUnits.forEach(unit => {
        const logsForUnit = unitLogsByUnit.get(unit.id) || [];
        ['PRESENTATION_PROGRESS', 'RESPONSE_PROGRESS'].forEach(key => {
          const progressLogs = logsForUnit
            .filter(log => log.key === key)
            .sort((a, b) => {
              const tsDelta = Number(b.ts || 0) - Number(a.ts || 0);
              return tsDelta || (Number(b.id || 0) - Number(a.id || 0));
            });
          const lastProgress = progressLogs[0];
          if (lastProgress && lastProgress.parameter !== 'complete') {
            incompleteUnitProgressCount += 1;
          }
        });

        const playerLoading = logsForUnit.filter(
          log => log.key === 'PLAYER' && log.parameter === 'LOADING'
        ).length;
        const playerRunning = logsForUnit.filter(
          log => log.key === 'PLAYER' && log.parameter === 'RUNNING'
        ).length;
        if (playerLoading > playerRunning) {
          playerStuckCount += 1;
        }
      });
      if (incompleteUnitProgressCount > 0) {
        this.addLogAnomaly(result, bookletId, {
          code: 'progress_incomplete',
          severity: 'warning',
          label: 'Progress unvollständig',
          evidence: `${incompleteUnitProgressCount} finale Unit-Progress-Werte nicht complete`,
          count: incompleteUnitProgressCount
        });
      }
      if (playerStuckCount > 0) {
        this.addLogAnomaly(result, bookletId, {
          code: 'player_stuck_loading',
          severity: 'critical',
          label: 'Player hängt',
          evidence: `${playerStuckCount} Unit(s) mit mehr PLAYER=LOADING als PLAYER=RUNNING`,
          count: playerStuckCount
        });
      }

      const debugCommands = logs.filter(
        log => log.key === 'command executed' &&
          String(log.parameter || '').toLowerCase().includes('debug')
      );
      if (debugCommands.length > 0) {
        this.addLogAnomaly(result, bookletId, {
          code: 'debug_command',
          severity: 'info',
          label: 'Debug-Befehl',
          evidence: `${debugCommands.length} command executed : debug Eintrag/Einträge`,
          count: debugCommands.length
        });
      }

      if (allTimestamps.length > 1) {
        const span = Math.max(...allTimestamps) - Math.min(...allTimestamps);
        if (span >= thresholds.sessionSpanThresholdMs) {
          this.addLogAnomaly(result, bookletId, {
            code: 'session_span_long',
            severity: 'info',
            label: 'Lange Zeitspanne',
            evidence: `Logs verteilen sich über ${this.formatDurationForEvidence(span)}`,
            count: 1
          });
        }
      }

      if (logs.length > 0 && startedLogs.length === 0) {
        this.addLogAnomaly(result, bookletId, {
          code: 'orphan_logs',
          severity: 'info',
          label: 'Logs ohne Start',
          evidence: 'Booklet-Logs vorhanden, aber kein CONTROLLER-Start gefunden.',
          count: 1
        });
      }
    });

    result.forEach(list => list.sort((a, b) => {
      const severityDelta =
        this.getLogAnomalySortValue(a.severity) -
        this.getLogAnomalySortValue(b.severity);
      return severityDelta || a.label.localeCompare(b.label);
    }));

    return result;
  }

  private async forEachLogAnomalyBatch(
    bookletIds: number[],
    thresholds: LogAnomalyThresholds,
    exclusions: ResolvedWorkspaceExclusions | undefined,
    consumeBatch: (
      anomaliesByBooklet: Map<number, LogAnomalySummary[]>
    ) => void | Promise<void>
  ): Promise<void> {
    const uniqueBookletIds = Array.from(
      new Set(bookletIds.map(id => Number(id)).filter(id => id > 0))
    );
    const batches = this.getLogAnomalyIdBatches(uniqueBookletIds);

    for (const [batchIndex, batchIds] of batches.entries()) {
      let phase = 'load-and-analysis';
      try {
        const anomaliesByBooklet =
          await this.findLogAnomaliesForBookletBatch(
            batchIds,
            thresholds,
            exclusions
          );
        phase = 'aggregation';
        await consumeBatch(anomaliesByBooklet);
      } catch (error) {
        this.logger.error(
          `Log anomaly batch ${batchIndex + 1}/${batches.length} failed ` +
          `for ${batchIds.length} booklet(s) during ${phase}`,
          error instanceof Error ? error.stack : String(error)
        );
        throw error;
      }
    }
  }

  async findLogAnomaliesForBooklets(
    bookletIds: number[],
    thresholds: LogAnomalyThresholds,
    exclusions?: ResolvedWorkspaceExclusions
  ): Promise<Map<number, LogAnomalySummary[]>> {
    const result = new Map<number, LogAnomalySummary[]>();
    await this.forEachLogAnomalyBatch(
      bookletIds,
      thresholds,
      exclusions,
      anomaliesByBooklet => {
        anomaliesByBooklet.forEach((anomalies, bookletId) => {
          result.set(bookletId, anomalies);
        });
      }
    );
    return result;
  }

  async getLogAnomalySummary(
    workspaceId: number,
    options: {
      longLoadingThresholdMs?: number | string;
      focusLostThresholdMs?: number | string;
      sessionSpanThresholdMs?: number | string;
      repeatedStartThreshold?: number | string;
    } = {}
  ): Promise<LogAnomalyDashboardSummary> {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    const emptySummary: LogAnomalyDashboardSummary = {
      totalBooklets: 0,
      affectedBooklets: 0,
      criticalBooklets: 0,
      warningBooklets: 0,
      infoBooklets: 0,
      totalAnomalyRules: 0,
      totalAnomalyEvents: 0,
      byCode: {}
    };

    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    const qb = this.bookletRepository
      .createQueryBuilder('bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .select('bookletEntity.id', 'id')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    applyIgnoredBookletsToQuery(qb, exclusions.ignoredBooklets, 'bookletinfo');

    const bookletRows = await qb.getRawMany<{ id: number | string }>();
    const bookletIds = bookletRows
      .map(row => Number(row.id))
      .filter(id => Number.isFinite(id) && id > 0);

    if (bookletIds.length === 0) {
      return emptySummary;
    }

    const summary: LogAnomalyDashboardSummary = {
      ...emptySummary,
      totalBooklets: bookletIds.length,
      byCode: {}
    };

    await this.forEachLogAnomalyBatch(
      bookletIds,
      this.buildLogAnomalyThresholds(options),
      exclusions,
      anomaliesByBooklet => {
        anomaliesByBooklet.forEach(anomalies => {
          if (anomalies.length === 0) {
            return;
          }
          summary.affectedBooklets += 1;
          summary.totalAnomalyRules += anomalies.length;

          if (anomalies.some(anomaly => anomaly.severity === 'critical')) {
            summary.criticalBooklets += 1;
          }
          if (anomalies.some(anomaly => anomaly.severity === 'warning')) {
            summary.warningBooklets += 1;
          }
          if (anomalies.some(anomaly => anomaly.severity === 'info')) {
            summary.infoBooklets += 1;
          }

          anomalies.forEach(anomaly => {
            summary.totalAnomalyEvents += anomaly.count;
            summary.byCode[anomaly.code] =
              (summary.byCode[anomaly.code] || 0) + 1;
          });
        });
      });

    return summary;
  }

  async getLogAnomalyDetails(
    workspaceId: number,
    options: {
      longLoadingThresholdMs?: number | string;
      focusLostThresholdMs?: number | string;
      sessionSpanThresholdMs?: number | string;
      repeatedStartThreshold?: number | string;
      limit?: number | string;
    } = {}
  ): Promise<LogAnomalyDetailsResponse> {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    const parsedLimit = Number(String(options.limit ?? '').trim() || 200);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ?
      Math.min(Math.round(parsedLimit), 1000) :
      200;

    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    const rows = await this.bookletRepository
      .createQueryBuilder('bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .select('bookletEntity.id', 'bookletId')
      .addSelect('bookletinfo.name', 'booklet')
      .addSelect('person.id', 'personId')
      .addSelect('person.code', 'code')
      .addSelect('person.group', 'group')
      .addSelect('person.login', 'login')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .orderBy('person.code', 'ASC')
      .addOrderBy('bookletinfo.name', 'ASC')
      .getRawMany<{
      bookletId: number | string;
      booklet: string | null;
      personId: number | string;
      code: string | null;
      group: string | null;
      login: string | null;
    }>();

    const ignoredBooklets = new Set(
      exclusions.ignoredBooklets.map(normalizeExclusionBookletId)
    );
    const filteredRows = rows.filter(row => {
      if (ignoredBooklets.size === 0) {
        return true;
      }
      const normalizedBooklet = normalizeExclusionBookletId(
        String(row.booklet || '')
      );
      return !ignoredBooklets.has(normalizedBooklet);
    });
    const bookletIds = filteredRows
      .map(row => Number(row.bookletId))
      .filter(id => Number.isFinite(id) && id > 0);

    const anomaliesByBooklet = await this.findLogAnomaliesForBooklets(
      bookletIds,
      this.buildLogAnomalyThresholds(options),
      exclusions
    );

    const details = filteredRows
      .map((row): LogAnomalyDetailRow | null => {
        const bookletId = Number(row.bookletId);
        const anomalies = anomaliesByBooklet.get(bookletId) || [];
        if (anomalies.length === 0) {
          return null;
        }
        const maxSeverity = anomalies.reduce<LogAnomalySeverity>(
          (current, anomaly) => {
            const anomalySort = this.getLogAnomalySortValue(anomaly.severity);
            const currentSort = this.getLogAnomalySortValue(current);
            return anomalySort < currentSort ? anomaly.severity : current;
          },
          'info'
        );
        return {
          bookletId,
          booklet: String(row.booklet || ''),
          personId: Number(row.personId),
          code: String(row.code || ''),
          group: String(row.group || ''),
          login: String(row.login || ''),
          maxSeverity,
          anomalies
        };
      })
      .filter((row): row is LogAnomalyDetailRow => row !== null)
      .sort((a, b) => {
        const severityDelta =
          this.getLogAnomalySortValue(a.maxSeverity) -
          this.getLogAnomalySortValue(b.maxSeverity);
        return severityDelta ||
          a.code.localeCompare(b.code) ||
          a.booklet.localeCompare(b.booklet);
      });

    return {
      total: details.length,
      data: details.slice(0, limit)
    };
  }
}
