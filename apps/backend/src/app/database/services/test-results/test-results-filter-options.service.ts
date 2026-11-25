import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { statusNumberToString } from '../../utils/response-status-converter';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { applyExclusionsToQuery, excludeAutocoderGeneratedResponses } from './test-results.util';

import { applyFlatResponseFilters, normalizeFlatResponseFilters } from './flat-response-filters';

@Injectable()
export class TestResultsFilterOptionsService {
  constructor(
    @InjectRepository(ResponseEntity) private readonly responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    @Inject(WorkspaceExclusionService) private readonly workspaceExclusionService: WorkspaceExclusionService
  ) {}

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

    const filters = normalizeFlatResponseFilters(options);

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

    applyFlatResponseFilters(baseQb, filters, 'options');

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
        filters.processingDurationThresholdMs
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
