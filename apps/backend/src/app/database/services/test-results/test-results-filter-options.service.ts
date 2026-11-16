import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { statusNumberToString, statusStringToNumber } from '../../utils/response-status-converter';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { queryFlatResponseOptionRows } from './flat-response-facet-queries';
import { applyExclusionsToQuery, createGeoGebraUnitExistsCondition, excludeAutocoderGeneratedResponses } from './test-results.util';

@Injectable()
export class TestResultsFilterOptionsService {
  private static readonly responseValueSearchPrefixLength = 2000;

  constructor(
    @InjectRepository(ResponseEntity) private readonly responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    @Inject(WorkspaceExclusionService) private readonly workspaceExclusionService: WorkspaceExclusionService
  ) {}

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
        `LEFT(response.value, ${TestResultsFilterOptionsService.responseValueSearchPrefixLength}) ILIKE :responseValue`,
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

    const {
      codeRows, groupRows, loginRows, bookletRows, unitRows, responseRows,
      responseStatusRows, tagRows, sessionBrowserRows, sessionOsRows, sessionScreenRows, sessionIdRows,
      processingDurationRows, unitProgressRows
    } = await queryFlatResponseOptionRows(
      baseQb, this.connection, workspaceId, exclusions, options, MAX_OPTIONS, processingDurationThresholdMs
    );

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
