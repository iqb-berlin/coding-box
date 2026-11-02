import { SelectQueryBuilder } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { FlatResponseOptions } from './workspace-test-results.types';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { applyFlatResponseTextFilters, createGeoGebraUnitExistsCondition } from './test-results.util';

export const RESPONSE_VALUE_SEARCH_PREFIX_LENGTH = 2000;

const parseCsv = (raw: string | undefined): string[] => String(raw || '')
  .split(',').map(value => value.trim()).filter(Boolean);

const isEnabled = (raw: string | undefined): boolean => ['true', '1', 'yes']
  .includes(String(raw || '').trim().toLowerCase());

const finiteThreshold = (raw: number | string | undefined, fallback: number): number => {
  const parsed = Number(String(raw || '').trim() || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function parseMmSsToMs(raw: string | undefined): number | null {
  const match = String(raw || '').trim().match(/^(\d+):(\d{1,2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  return (minutes * 60 + seconds) * 1000;
}

function parseResponseStatus(raw: string): number | null {
  if (!raw) return null;
  return /^\d+$/.test(raw) ? Number(raw) : statusStringToNumber(raw);
}

export function normalizeFlatResponseFilters(options: FlatResponseOptions) {
  const responseStatus = (options.responseStatus || '').trim();
  return {
    code: (options.code || '').trim(),
    group: (options.group || '').trim(),
    login: (options.login || '').trim(),
    booklet: (options.booklet || '').trim(),
    unit: (options.unit || '').trim(),
    response: (options.response || '').trim(),
    responseStatus,
    responseStatusNum: parseResponseStatus(responseStatus),
    responseValue: (options.responseValue || '').trim(),
    tags: (options.tags || '').trim(),
    regexSearch: options.regexSearch === true,
    geogebraOnly: isEnabled(options.geogebra),
    audioLowOnly: isEnabled(options.audioLow),
    hasValueOnly: isEnabled(options.hasValue),
    audioLowThreshold: finiteThreshold(options.audioLowThreshold, 0.9),
    shortProcessingOnly: isEnabled(options.shortProcessing),
    shortProcessingThresholdMs: finiteThreshold(options.shortProcessingThresholdMs, 60000),
    longLoadingOnly: isEnabled(options.longLoading),
    longLoadingThresholdMs: finiteThreshold(options.longLoadingThresholdMs, 5000),
    processingDurationThresholdMs: finiteThreshold(options.processingDurationThresholdMs, 60000),
    processingDurationMinMs: parseMmSsToMs(options.processingDurationMin),
    processingDurationMaxMs: parseMmSsToMs(options.processingDurationMax),
    processingDurations: parseCsv(options.processingDurations),
    unitProgress: parseCsv(options.unitProgress).map(value => {
      const normalized = value.toLowerCase();
      if (normalized === 'vollständig') return 'complete';
      if (normalized === 'unvollständig') return 'incomplete';
      return normalized;
    }).filter(value => value === 'complete' || value === 'incomplete'),
    sessionBrowsers: parseCsv(options.sessionBrowsers),
    sessionOs: parseCsv(options.sessionOs),
    sessionScreens: parseCsv(options.sessionScreens),
    sessionIds: parseCsv(options.sessionIds).map(Number).filter(value => Number.isFinite(value) && value > 0),
    includeLogAnomalies: isEnabled(options.includeLogAnomalies),
    logAnomalies: parseCsv(options.logAnomalies)
  };
}

export type FlatResponseFilters = ReturnType<typeof normalizeFlatResponseFilters>;
type ResponseQuery = SelectQueryBuilder<ResponseEntity>;
type QueryPurpose = 'rows' | 'count';

export function applyFlatResponseFilters(qb: ResponseQuery, filters: FlatResponseFilters, purpose: QueryPurpose): void {
  applyFlatResponseTextFilters(qb, filters);
  applyResponseFilters(qb, filters, purpose);
  applyProcessingFilters(qb, filters);
  applyUnitProgressFilter(qb, filters);
  applySessionFilters(qb, filters);
  applyLongLoadingFilter(qb, filters);
}

function applyResponseFilters(qb: ResponseQuery, filters: FlatResponseFilters, purpose: QueryPurpose): void {
  const {
    responseStatus, responseStatusNum, responseValue, tags, geogebraOnly, audioLowOnly, audioLowThreshold, hasValueOnly
  } = filters;
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
      `LEFT(response.value, ${RESPONSE_VALUE_SEARCH_PREFIX_LENGTH}) ILIKE :responseValue`,
      { responseValue: `%${responseValue}%` }
    );
  }
  if (tags) {
    if (purpose === 'rows') {
      qb.andWhere('unitTag.tag ILIKE :tags', { tags: `%${tags}%` });
    } else {
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM unit_tag count_unit_tag
          WHERE count_unit_tag."unitId" = unit.id
            AND count_unit_tag.tag ILIKE :tags
        )`,
        { tags: `%${tags}%` }
      );
    }
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
}

function applyProcessingFilters(qb: ResponseQuery, filters: FlatResponseFilters): void {
  const {
    shortProcessingOnly, shortProcessingThresholdMs, processingDurationMinMs, processingDurationMaxMs
  } = filters;
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

  applyProcessingDurationCategory(qb, filters);

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
}

function applyUnitProgressFilter(qb: ResponseQuery, filters: FlatResponseFilters): void {
  const { unitProgress } = filters;
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
}

function applySessionFilters(qb: ResponseQuery, filters: FlatResponseFilters): void {
  // Dimensions deliberately use separate EXISTS clauses and can match different sessions.
  const {
    sessionBrowsers, sessionOs, sessionScreens, sessionIds
  } = filters;
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
}

function applyLongLoadingFilter(qb: ResponseQuery, filters: FlatResponseFilters): void {
  const { longLoadingOnly, longLoadingThresholdMs } = filters;
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
}

function applyProcessingDurationCategory(qb: ResponseQuery, filters: FlatResponseFilters): void {
  const { processingDurations, processingDurationThresholdMs } = filters;
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
}
