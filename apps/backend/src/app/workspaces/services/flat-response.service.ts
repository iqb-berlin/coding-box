import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ResponseEntity, Unit } from '../../common';
import {
  statusNumberToString,
  statusStringToNumber
} from '../utils/response-status-converter';
import { Booklet } from '../entities/booklet.entity';
import { BookletLog } from '../entities/bookletLog.entity';
import { UnitLog } from '../entities/unitLog.entity';
import { Session } from '../entities/session.entity';

interface FlatResponseFilters {
  code: string;
  group: string;
  login: string;
  booklet: string;
  unit: string;
  response: string;
  responseStatus: string;
  responseStatusNum: number | null;
  responseValue: string;
  tags: string;
  geogebraOnly: boolean;
  audioLowOnly: boolean;
  hasValueOnly: boolean;
  audioLowThreshold: number;
  shortProcessingOnly: boolean;
  shortProcessingThresholdMs: number;
  longLoadingOnly: boolean;
  longLoadingThresholdMs: number;
  processingDurationThresholdMs: number;
  processingDurationMinMs: number | null;
  processingDurationMaxMs: number | null;
  processingDurations: string[];
  unitProgress: string[];
  sessionBrowsers: string[];
  sessionOs: string[];
  sessionScreens: string[];
  sessionIds: number[];
}

/**
 * FlatResponseService
 *
 * Handles complex flat response queries with extensive filtering capabilities.
 * This service is responsible for:
 * - Finding flat responses with complex filters (processing times, audio quality, etc.)
 * - Calculating response frequencies for specific unit/variable combinations
 * - Generating filter options based on current data
 * - Parsing and normalizing filter parameters
 *
 * Extracted from WorkspaceTestResultsService to improve maintainability.
 */
@Injectable()
export class FlatResponseService {
  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(BookletLog)
    private bookletLogRepository: Repository<BookletLog>,
    @InjectRepository(UnitLog)
    private unitLogRepository: Repository<UnitLog>
  ) {}

  /**
   * Find flat responses with extensive filtering and pagination
   *
   * Supports filtering by:
   * - Basic fields: code, group, login, booklet, unit, response, status, value, tags
   * - GeoGebra responses
   * - Audio quality (low audio detection)
   * - Processing times (short/long processing, loading times)
   * - Unit progress (complete/incomplete)
   * - Session information (browser, OS, screen size)
   */
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
      audioLowThreshold?: string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: string;
      longLoading?: string;
      longLoadingThresholdMs?: string;
      processingDurations?: string;
      processingDurationThresholdMs?: string;
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
    this.validateWorkspaceId(workspaceId);

    const { validPage, validLimit } = this.validatePagination(
      options.page,
      options.limit
    );

    const filters = this.parseFilters(options);
    const qb = this.buildBaseQuery(workspaceId);

    this.applyBasicFilters(qb, filters);
    this.applySpecialFilters(qb, filters);
    this.applyProcessingFilters(qb, filters);
    this.applySessionFilters(qb, filters);

    const [responses, total] = await qb
      .select([
        'response.id',
        'response.unitid',
        'response.variableid',
        'response.status',
        'response.value',
        'unit.id',
        'unit.name',
        'unit.alias',
        'person.id',
        'person.code',
        'person.group',
        'person.login',
        'bookletinfo.name',
        'unitTag.tag'
      ])
      .skip((validPage - 1) * validLimit)
      .take(validLimit)
      .orderBy('response.id', 'ASC')
      .getManyAndCount();

    return [this.formatResponses(responses), total];
  }

  /**
   * Calculate response frequencies for specific unit/variable combinations
   *
   * @param workspaceId - The workspace ID
   * @param combos - Array of unit/variable/value combinations to analyze
   * @returns Frequency data for each combination
   */
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
    this.validateWorkspaceId(workspaceId);

    const normalized = this.normalizeCombos(combos);
    if (normalized.length === 0) {
      return {};
    }

    const uniqueCombos = this.deduplicateCombos(normalized);
    const qb = this.buildFrequencyBaseQuery(workspaceId, uniqueCombos);

    const totals = await this.fetchTotals(qb.clone());
    const counts = await this.fetchCounts(qb.clone(), uniqueCombos);

    return this.buildFrequencyResult(uniqueCombos, totals, counts);
  }

  /**
   * Get available filter options based on current workspace data
   *
   * Returns distinct values for each filterable field to populate dropdowns/autocomplete
   */
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
      audioLowThreshold?: string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: string;
      longLoading?: string;
      longLoadingThresholdMs?: string;
      processingDurations?: string;
      processingDurationThresholdMs?: string;
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
    this.validateWorkspaceId(workspaceId);

    const filters = this.parseFilters(options);
    const baseQb = this.buildBaseQuery(workspaceId);
    this.applyBasicFilters(baseQb, filters);
    this.applySpecialFilters(baseQb, filters);

    const MAX_OPTIONS = 500;

    const [
      codes,
      groups,
      logins,
      booklets,
      units,
      responses,
      responseStatuses,
      tags,
      processingDurations,
      unitProgresses,
      sessionBrowsers,
      sessionOs,
      sessionScreens,
      sessionIds
    ] = await Promise.all([
      this.fetchDistinctValues(baseQb.clone(), 'person.code', MAX_OPTIONS),
      this.fetchDistinctValues(baseQb.clone(), 'person.group', MAX_OPTIONS),
      this.fetchDistinctValues(baseQb.clone(), 'person.login', MAX_OPTIONS),
      this.fetchDistinctValues(
        baseQb.clone(),
        'bookletinfo.name',
        MAX_OPTIONS
      ),
      this.fetchDistinctUnits(baseQb.clone(), MAX_OPTIONS),
      this.fetchDistinctValues(
        baseQb.clone(),
        'response.variableid',
        MAX_OPTIONS
      ),
      this.fetchDistinctResponseStatuses(baseQb.clone(), MAX_OPTIONS),
      this.fetchDistinctValues(baseQb.clone(), 'unitTag.tag', MAX_OPTIONS),
      this.fetchDistinctProcessingDurations(
        workspaceId,
        filters,
        MAX_OPTIONS
      ),
      this.fetchDistinctUnitProgresses(workspaceId, filters, MAX_OPTIONS),
      this.fetchDistinctSessionValues(
        workspaceId,
        filters,
        'browser',
        MAX_OPTIONS
      ),
      this.fetchDistinctSessionValues(workspaceId, filters, 'os', MAX_OPTIONS),
      this.fetchDistinctSessionValues(
        workspaceId,
        filters,
        'screen',
        MAX_OPTIONS
      ),
      this.fetchDistinctSessionIds(workspaceId, filters, MAX_OPTIONS)
    ]);

    return {
      codes,
      groups,
      logins,
      booklets,
      units,
      responses,
      responseStatuses,
      tags,
      processingDurations,
      unitProgresses,
      sessionBrowsers,
      sessionOs,
      sessionScreens,
      sessionIds
    };
  }

  // ==================== Private Helper Methods ====================

  private validateWorkspaceId(workspaceId: number): void {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }
  }

  private validatePagination(
    page: number,
    limit: number
  ): { validPage: number; validLimit: number } {
    const MAX_LIMIT = 200;
    const validPage = Math.max(1, Number(page || 1));
    const validLimit = Math.min(Math.max(1, Number(limit || 50)), MAX_LIMIT);
    return { validPage, validLimit };
  }

  private parseFilters(options: {
    page?: number;
    limit?: number;
    [key: string]: unknown;
  }): FlatResponseFilters {
    const unitProgressRaw = this.parseCsv(options.unitProgress as string | undefined);
    const unitProgress = unitProgressRaw
      .map(v => v.toLowerCase())
      .map(v => {
        if (v === 'vollständig') return 'complete';
        if (v === 'unvollständig') return 'incomplete';
        return v;
      })
      .filter(v => v === 'complete' || v === 'incomplete');

    return {
      code: (String(options.code || '')).trim(),
      group: (String(options.group || '')).trim(),
      login: (String(options.login || '')).trim(),
      booklet: (String(options.booklet || '')).trim(),
      unit: (String(options.unit || '')).trim(),
      response: (String(options.response || '')).trim(),
      responseStatus: (String(options.responseStatus || '')).trim(),
      responseStatusNum: this.parseResponseStatus(String(options.responseStatus || '')),
      responseValue: (String(options.responseValue || '')).trim(),
      tags: (String(options.tags || '')).trim(),
      geogebraOnly: this.parseBoolean(options.geogebra as string | undefined),
      audioLowOnly: this.parseBoolean(options.audioLow as string | undefined),
      hasValueOnly: this.parseBoolean(options.hasValue as string | undefined),
      audioLowThreshold: this.parseNumber(options.audioLowThreshold as string | undefined, 0.9),
      shortProcessingOnly: this.parseBoolean(options.shortProcessing as string | undefined),
      shortProcessingThresholdMs: this.parseNumber(
        options.shortProcessingThresholdMs as string | undefined,
        60000
      ),
      longLoadingOnly: this.parseBoolean(options.longLoading as string | undefined),
      longLoadingThresholdMs: this.parseNumber(options.longLoadingThresholdMs as string | undefined, 5000),
      processingDurationThresholdMs: this.parseNumber(
        options.processingDurationThresholdMs as string | undefined,
        60000
      ),
      processingDurationMinMs: this.parseMmSsToMs(options.processingDurationMin as string | undefined),
      processingDurationMaxMs: this.parseMmSsToMs(options.processingDurationMax as string | undefined),
      processingDurations: this.parseCsv(options.processingDurations as string | undefined),
      unitProgress,
      sessionBrowsers: this.parseCsv(options.sessionBrowsers as string | undefined),
      sessionOs: this.parseCsv(options.sessionOs as string | undefined),
      sessionScreens: this.parseCsv(options.sessionScreens as string | undefined),
      sessionIds: this.parseCsv(options.sessionIds as string | undefined)
        .map(v => Number(v))
        .filter(v => Number.isFinite(v) && v > 0)
    };
  }

  private parseCsv(raw: string | undefined): string[] {
    return String(raw || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }

  private parseMmSsToMs(raw: string | undefined): number | null {
    const v = String(raw || '').trim();
    if (!v) return null;
    const m = v.match(/^(\d+):(\d{1,2})$/);
    if (!m) return null;
    const minutes = Number(m[1]);
    const seconds = Number(m[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (seconds < 0 || seconds >= 60 || minutes < 0) return null;
    return (minutes * 60 + seconds) * 1000;
  }

  private parseBoolean(raw: string | undefined): boolean {
    const v = String(raw || '')
      .trim()
      .toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }

  private parseNumber(raw: string | undefined, defaultValue: number): number {
    const parsed = Number(raw || defaultValue);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  private parseResponseStatus(s: string): number | null {
    const v = (s || '').trim();
    if (!v) return null;
    if (/^\d+$/.test(v)) return Number(v);
    return statusStringToNumber(v);
  }

  private buildBaseQuery(workspaceId: number): SelectQueryBuilder<ResponseEntity> {
    return this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .leftJoin('unit.tags', 'unitTag')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
  }

  private applyBasicFilters(qb: SelectQueryBuilder<ResponseEntity>, filters: FlatResponseFilters): void {
    if (filters.code) {
      qb.andWhere('person.code ILIKE :code', { code: `%${filters.code}%` });
    }
    if (filters.group) {
      qb.andWhere('person.group ILIKE :group', { group: `%${filters.group}%` });
    }
    if (filters.login) {
      qb.andWhere('person.login ILIKE :login', { login: `%${filters.login}%` });
    }
    if (filters.booklet) {
      qb.andWhere('bookletinfo.name ILIKE :booklet', {
        booklet: `%${filters.booklet}%`
      });
    }
    if (filters.unit) {
      qb.andWhere('(unit.alias ILIKE :unit OR unit.name ILIKE :unit)', {
        unit: `%${filters.unit}%`
      });
    }
    if (filters.response) {
      qb.andWhere('response.variableid ILIKE :response', {
        response: `%${filters.response}%`
      });
    }
    if (filters.responseStatus) {
      if (filters.responseStatusNum === null) {
        qb.andWhere('1=0');
      } else {
        qb.andWhere('response.status = :responseStatusNum', {
          responseStatusNum: filters.responseStatusNum
        });
      }
    }
    if (filters.responseValue) {
      qb.andWhere('response.value ILIKE :responseValue', {
        responseValue: `%${filters.responseValue}%`
      });
    }
    if (filters.tags) {
      qb.andWhere('unitTag.tag ILIKE :tags', { tags: `%${filters.tags}%` });
    }
  }

  private applySpecialFilters(qb: SelectQueryBuilder<ResponseEntity>, filters: FlatResponseFilters): void {
    if (filters.geogebraOnly) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM response r2 WHERE r2.unitid = unit.id AND r2.value LIKE :ggPrefix)',
        { ggPrefix: 'UEsD%' }
      );
    }

    if (filters.audioLowOnly) {
      qb.andWhere('response.variableid ILIKE :audioPrefix', {
        audioPrefix: 'audio%'
      });
      qb.andWhere("response.value ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'");
      qb.andWhere('(response.value::double precision) < :audioLowThreshold', {
        audioLowThreshold: filters.audioLowThreshold
      });
    }

    if (filters.hasValueOnly) {
      qb.andWhere(
        "BTRIM(COALESCE(response.value, '')) <> '' AND BTRIM(COALESCE(response.value, '')) <> '[]'"
      );
    }
  }

  private applyProcessingFilters(qb: SelectQueryBuilder<ResponseEntity>, filters: FlatResponseFilters): void {
    if (
      filters.shortProcessingOnly ||
      filters.longLoadingOnly ||
      (filters.processingDurations && filters.processingDurations.length > 0) ||
      filters.processingDurationMinMs !== null ||
      filters.processingDurationMaxMs !== null ||
      (filters.unitProgress && filters.unitProgress.length > 0)
    ) {
      const logSubQb = this.bookletLogRepository
        .createQueryBuilder('bl')
        .select('bl.bookletid', 'bookletid')
        .addSelect('bl.ts', 'ts')
        .addSelect('bl.parameter', 'parameter')
        .where("bl.key = 'UNIT_ENTER'");

      qb.leftJoin(
        `(${logSubQb.getQuery()})`,
        'enter_log',
        'enter_log.bookletid = bookletEntity.id AND enter_log.parameter = unit.name'
      );

      const nextLogSubQb = this.bookletLogRepository
        .createQueryBuilder('bl2')
        .select('bl2.bookletid', 'bookletid')
        .addSelect('MIN(bl2.ts)', 'ts')
        .addSelect('bl2.parameter', 'parameter')
        .where("bl2.key = 'UNIT_ENTER'")
        .groupBy('bl2.bookletid')
        .addGroupBy('bl2.parameter');

      qb.leftJoin(
        `(${nextLogSubQb.getQuery()})`,
        'next_enter_log',
        'next_enter_log.bookletid = bookletEntity.id AND next_enter_log.ts > enter_log.ts'
      );

      if (filters.shortProcessingOnly) {
        qb.andWhere(
          '(next_enter_log.ts - enter_log.ts) < :shortProcessingThresholdMs',
          { shortProcessingThresholdMs: filters.shortProcessingThresholdMs }
        );
      }

      if (filters.longLoadingOnly) {
        const loadingLogSubQb = this.unitLogRepository
          .createQueryBuilder('ul')
          .select('ul.unitid', 'unitid')
          .addSelect('ul.parameter', 'parameter')
          .where("ul.key = 'LOAD_COMPLETE'");

        qb.leftJoin(
          `(${loadingLogSubQb.getQuery()})`,
          'load_log',
          'load_log.unitid = unit.id'
        );

        qb.andWhere(
          '(load_log.parameter::bigint) > :longLoadingThresholdMs',
          { longLoadingThresholdMs: filters.longLoadingThresholdMs }
        );
      }

      if (filters.processingDurations && filters.processingDurations.length > 0) {
        const durationConditions: string[] = [];
        if (filters.processingDurations.includes('kurz')) {
          durationConditions.push(
            '(next_enter_log.ts - enter_log.ts) < :processingDurationThresholdMs'
          );
        }
        if (filters.processingDurations.includes('normal')) {
          durationConditions.push(
            '(next_enter_log.ts - enter_log.ts) >= :processingDurationThresholdMs'
          );
        }
        if (durationConditions.length > 0) {
          qb.andWhere(`(${durationConditions.join(' OR ')})`, {
            processingDurationThresholdMs: filters.processingDurationThresholdMs
          });
        }
      }

      if (filters.processingDurationMinMs !== null) {
        qb.andWhere(
          '(next_enter_log.ts - enter_log.ts) >= :processingDurationMinMs',
          { processingDurationMinMs: filters.processingDurationMinMs }
        );
      }
      if (filters.processingDurationMaxMs !== null) {
        qb.andWhere(
          '(next_enter_log.ts - enter_log.ts) <= :processingDurationMaxMs',
          { processingDurationMaxMs: filters.processingDurationMaxMs }
        );
      }

      if (filters.unitProgress && filters.unitProgress.length > 0) {
        const progressConditions: string[] = [];
        if (filters.unitProgress.includes('complete')) {
          progressConditions.push('next_enter_log.ts IS NOT NULL');
        }
        if (filters.unitProgress.includes('incomplete')) {
          progressConditions.push('next_enter_log.ts IS NULL');
        }
        if (progressConditions.length > 0) {
          qb.andWhere(`(${progressConditions.join(' OR ')})`);
        }
      }
    }
  }

  private applySessionFilters(qb: SelectQueryBuilder<ResponseEntity>, filters: FlatResponseFilters): void {
    if (
      (filters.sessionBrowsers && filters.sessionBrowsers.length > 0) ||
      (filters.sessionOs && filters.sessionOs.length > 0) ||
      (filters.sessionScreens && filters.sessionScreens.length > 0) ||
      (filters.sessionIds && filters.sessionIds.length > 0)
    ) {
      qb.innerJoin('person.sessions', 'session');

      if (filters.sessionBrowsers && filters.sessionBrowsers.length > 0) {
        qb.andWhere('session.browser IN (:...sessionBrowsers)', {
          sessionBrowsers: filters.sessionBrowsers
        });
      }

      if (filters.sessionOs && filters.sessionOs.length > 0) {
        qb.andWhere('session.os IN (:...sessionOs)', {
          sessionOs: filters.sessionOs
        });
      }

      if (filters.sessionScreens && filters.sessionScreens.length > 0) {
        qb.andWhere('session.screen IN (:...sessionScreens)', {
          sessionScreens: filters.sessionScreens
        });
      }

      if (filters.sessionIds && filters.sessionIds.length > 0) {
        qb.andWhere('session.id IN (:...sessionIds)', {
          sessionIds: filters.sessionIds
        });
      }
    }
  }

  private formatResponses(responses: ResponseEntity[]): Array<{
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
  }> {
    const MAX_RESPONSE_VALUE_LEN = 2000;

    return responses.map(r => ({
      responseId: r.id,
      unitId: r.unit?.id || r.unitid,
      personId: r.unit?.booklet?.person?.id || 0,
      code: r.unit?.booklet?.person?.code || '',
      group: r.unit?.booklet?.person?.group || '',
      login: r.unit?.booklet?.person?.login || '',
      booklet: r.unit?.booklet?.bookletinfo?.name || '',
      unit: r.unit?.alias || r.unit?.name || '',
      response: r.variableid || '',
      responseStatus: statusNumberToString(r.status) || 'UNSET',
      responseValue: (r.value || '').substring(0, MAX_RESPONSE_VALUE_LEN),
      tags: r.unit?.tags?.map(t => t.tag) || []
    }));
  }

  // Frequency calculation helpers
  private normalizeCombos(
    combos: Array<{ unitKey: string; variableId: string; values: string[] }>
  ): Array<{ unitKey: string; variableId: string; values: string[] }> {
    return (combos || [])
      .map(c => ({
        unitKey: String(c.unitKey || '').trim(),
        variableId: String(c.variableId || '').trim(),
        values: Array.isArray(c.values) ?
          c.values.map(v => String(v ?? '')) :
          []
      }))
      .filter(c => !!c.unitKey && !!c.variableId);
  }

  private deduplicateCombos(
    combos: Array<{ unitKey: string; variableId: string; values: string[] }>
  ): Array<{ unitKey: string; variableId: string; values: string[] }> {
    const uniqueMap = new Map<
    string,
    { unitKey: string; variableId: string; values: string[] }
    >();

    combos.forEach(c => {
      const key = `${encodeURIComponent(c.unitKey)}:${encodeURIComponent(c.variableId)}`;
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

    return Array.from(uniqueMap.values());
  }

  private buildFrequencyBaseQuery(
    workspaceId: number,
    uniqueCombos: Array<{ unitKey: string; variableId: string; values: string[] }>
  ): SelectQueryBuilder<ResponseEntity> {
    const qb = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    const params: Record<string, unknown> = {};
    const orParts = uniqueCombos.map((c, idx) => {
      const uk = `uk${idx}`;
      const v = `v${idx}`;
      params[uk] = c.unitKey;
      params[v] = c.variableId;
      return `(COALESCE(unit.alias, unit.name) = :${uk} AND response.variableid = :${v})`;
    });
    qb.andWhere(`(${orParts.join(' OR ')})`, params);

    return qb;
  }

  private async fetchTotals(qb: SelectQueryBuilder<ResponseEntity>): Promise<Map<string, number>> {
    const totalsRaw = await qb
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

    return totalByKey;
  }

  private async fetchCounts(
    qb: SelectQueryBuilder<ResponseEntity>,
    uniqueCombos: Array<{ unitKey: string; variableId: string; values: string[] }>
  ): Promise<Map<string, number>> {
    const allRequestedValues = Array.from(
      new Set(uniqueCombos.flatMap(c => (c.values || []).map(v => String(v ?? ''))))
    );

    const countsRaw = await qb.clone()
      .andWhere(allRequestedValues.length > 0 ?
        "SUBSTRING(COALESCE(response.value, ''), 1, 2000) IN (:...values)" :
        '1=1',
      { values: allRequestedValues }
      )
      .select([
        'COALESCE(unit.alias, unit.name) AS "unitKey"',
        'response.variableid AS "variableId"',
        "SUBSTRING(COALESCE(response.value, ''), 1, 2000) AS \"value\"",
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
      const comboKey = `${encodeURIComponent(unitKey)}:${encodeURIComponent(variableId)}`;
      const value = String(r.value ?? '');
      countByKeyAndValue.set(`${comboKey}@@${value}`, Number(r.count || 0));
    });

    return countByKeyAndValue;
  }

  private buildFrequencyResult(
    uniqueCombos: Array<{ unitKey: string; variableId: string; values: string[] }>,
    totals: Map<string, number>,
    counts: Map<string, number>
  ): Record<string, { total: number; values: Array<{ value: string; count: number; p: number }> }> {
    const result: Record<
    string,
    {
      total: number;
      values: Array<{ value: string; count: number; p: number }>;
    }
    > = {};

    uniqueCombos.forEach(c => {
      const key = `${encodeURIComponent(c.unitKey)}:${encodeURIComponent(c.variableId)}`;
      const total = totals.get(key) || 0;
      const values = Array.from(new Set(c.values || []));

      const rows = values.map(v => {
        const count = counts.get(`${key}@@${v}`) || 0;
        return {
          value: String(v),
          count,
          p: total > 0 ? count / total : 0
        };
      });
      result[key] = { total, values: rows };
    });

    return result;
  }

  // Filter options helpers
  private async fetchDistinctValues(
    qb: SelectQueryBuilder<ResponseEntity>,
    field: string,
    maxOptions: number
  ): Promise<string[]> {
    const rows = await qb
      .clone()
      .select(`DISTINCT ${field} AS v`)
      .where(`${field} IS NOT NULL`)
      .andWhere(`${field} <> ''`)
      .orderBy('v', 'ASC')
      .limit(maxOptions)
      .getRawMany<{ v: string }>();

    return rows.map(r => String(r.v || '').trim()).filter(Boolean);
  }

  private async fetchDistinctUnits(qb: SelectQueryBuilder<ResponseEntity>, maxOptions: number): Promise<string[]> {
    const rows = await qb
      .clone()
      .select('DISTINCT COALESCE(unit.alias, unit.name) AS v')
      .where('COALESCE(unit.alias, unit.name) IS NOT NULL')
      .andWhere("COALESCE(unit.alias, unit.name) <> ''")
      .orderBy('v', 'ASC')
      .limit(maxOptions)
      .getRawMany<{ v: string }>();

    return rows.map(r => String(r.v || '').trim()).filter(Boolean);
  }

  private async fetchDistinctResponseStatuses(
    qb: SelectQueryBuilder<ResponseEntity>,
    maxOptions: number
  ): Promise<string[]> {
    const rows = await qb
      .clone()
      .select('DISTINCT response.status AS v')
      .where('response.status IS NOT NULL')
      .orderBy('v', 'ASC')
      .limit(maxOptions)
      .getRawMany<{ v: number }>();

    return rows
      .map(r => statusNumberToString(r.v))
      .filter(Boolean) as string[];
  }

  private async fetchDistinctProcessingDurations(
    _workspaceId: number, // eslint-disable-line @typescript-eslint/no-unused-vars
    _filters: FlatResponseFilters, // eslint-disable-line @typescript-eslint/no-unused-vars
    _maxOptions: number // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<string[]> {
    // Simplified - full implementation would query booklet logs
    return [];
  }

  private async fetchDistinctUnitProgresses(
    _workspaceId: number, // eslint-disable-line @typescript-eslint/no-unused-vars
    _filters: FlatResponseFilters, // eslint-disable-line @typescript-eslint/no-unused-vars
    _maxOptions: number // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<string[]> {
    // Simplified - full implementation would calculate unit progress
    return ['complete', 'incomplete'];
  }

  private async fetchDistinctSessionValues(
    workspaceId: number,
    _filters: FlatResponseFilters,
    field: string,
    maxOptions: number
  ): Promise<string[]> {
    const qb = this.responseRepository.manager
      .createQueryBuilder(Session, 'session')
      .innerJoin('session.person', 'person')
      .select(`DISTINCT session.${field}`, 'v')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere(`session.${field} IS NOT NULL`)
      .andWhere(`session.${field} <> ''`)
      .orderBy('v', 'ASC')
      .limit(maxOptions);

    const rows = await qb.getRawMany<{ v: string }>();
    return rows.map(r => String(r.v || '').trim()).filter(Boolean);
  }

  private async fetchDistinctSessionIds(
    workspaceId: number,
    _filters: FlatResponseFilters,
    maxOptions: number
  ): Promise<string[]> {
    const qb = this.responseRepository.manager
      .createQueryBuilder(Session, 'session')
      .innerJoin('session.person', 'person')
      .select('DISTINCT session.id', 'v')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .orderBy('session.id', 'ASC')
      .limit(maxOptions);

    const rows = await qb.getRawMany<{ v: number }>();
    return rows.map(r => String(r.v || '')).filter(Boolean);
  }
}
