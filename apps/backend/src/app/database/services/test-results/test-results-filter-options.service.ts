import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Booklet } from '../../entities/booklet.entity';
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

  private async queryFlatResponseProcessingDurationOptions(
    bookletIds: number[],
    maxOptions: number,
    processingDurationThresholdMs: number
  ): Promise<Array<{ v: string }>> {
    const limit = Math.max(1, Math.floor(maxOptions));

    return this.connection.query(
      `
        SELECT DISTINCT
          CASE
            WHEN first_duration.duration_ms IS NULL THEN 'Unbekannt'
            WHEN first_duration.duration_ms < $2 THEN 'Kurz'
            ELSE 'Lang'
          END AS v
        FROM unnest($1::int[]) AS filtered_booklets("bookletId")
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
      [bookletIds, processingDurationThresholdMs]
    );
  }

  private async queryFlatResponseUnitProgressOptions(
    bookletIds: number[],
    maxOptions: number
  ): Promise<Array<{ v: string }>> {
    const limit = Math.max(1, Math.floor(maxOptions));

    return this.connection.query(
      `
        SELECT DISTINCT progress.v AS v
        FROM unnest($1::int[]) AS filtered_booklets("bookletId")
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
      [bookletIds]
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
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyExclusionsToQuery(baseQb, exclusions, {
      bookletInfoAlias: 'bookletinfo'
    });
    excludeAutocoderGeneratedResponses(baseQb);

    if (filters.tags) baseQb.innerJoin('unit.tags', 'unitTag');
    applyFlatResponseFilters(baseQb, filters, 'options');

    // Person, booklet, session and log options depend only on which booklets
    // contain a matching response. Resolve that set once before reading those lists.
    const matches = await baseQb.clone().select('DISTINCT bookletEntity.id', 'id').getRawMany<{ id: number }>();
    const bookletIds = matches.map(row => row.id);
    const booklets = this.connection.createQueryBuilder(Booklet, 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('bookletEntity.id = ANY(:bookletIds)', { bookletIds });

    const sessions = booklets.clone().innerJoin('bookletEntity.sessions', 'session');
    const tagged = filters.tags ? baseQb : baseQb.clone().innerJoin('unit.tags', 'unitTag');
    const distinctValues = (source: SelectQueryBuilder<ResponseEntity | Booklet>, column: string, nonNull = false) => {
      const query = source.clone().select(`DISTINCT ${column}`, 'v').orderBy('v', 'ASC').limit(MAX_OPTIONS);
      if (nonNull) query.andWhere(`${column} IS NOT NULL`);
      return query.getRawMany<{ v: string }>();
    };

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
      distinctValues(booklets, 'person.code'),
      distinctValues(booklets, 'person.group'),
      distinctValues(booklets, 'person.login'),
      distinctValues(booklets, 'bookletinfo.name'),
      distinctValues(baseQb, 'COALESCE(unit.alias, unit.name)'),
      distinctValues(baseQb, 'response.variableid'),
      distinctValues(baseQb, 'response.status'),
      distinctValues(tagged, 'unitTag.tag', true),
      distinctValues(sessions, 'session.browser', true),
      distinctValues(sessions, 'session.os', true),
      distinctValues(sessions, 'session.screen', true),
      distinctValues(sessions, 'session.id', true)
    ]);

    const [processingDurationRows, unitProgressRows] = await Promise.all([
      this.queryFlatResponseProcessingDurationOptions(
        bookletIds,
        MAX_OPTIONS,
        filters.processingDurationThresholdMs
      ),
      this.queryFlatResponseUnitProgressOptions(bookletIds, MAX_OPTIONS)
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
