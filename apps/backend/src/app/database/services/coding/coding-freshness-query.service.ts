import {
  Inject, Injectable, Logger, Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets, DataSource, EntityManager, Repository, SelectQueryBuilder, ObjectLiteral
} from 'typeorm';
import { CodingUnitFreshness } from '../../entities/coding-unit-freshness.entity';
import { ResponseEntity } from '../../entities/response.entity';
import FileUpload from '../../entities/file_upload.entity';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import {
  CodingFreshnessImpactDto, CodingFreshnessGroupDto, CodingFreshnessScopeDto, CodingFreshnessState, CodingFreshnessSummaryDto, CodingFreshnessVersion
} from '../../../../../../../api-dto/coding/coding-freshness.dto';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { getCodingVariableIdCandidateSql } from './coding-response-candidate.util';
import { excludeUnitsWithoutCodingScheme } from './coding-freshness-schema-scope.util';
import {
  UnitCodingPresence, FreshnessSummaryRow, FreshnessScopeRow, ImportedResponseScopeRow, DeleteImpactRow
} from './coding-freshness.types';
import {
  uniquePositiveIds, uniqueStrings, uniqueVersions, collectChunked
} from './coding-freshness.util';

@Injectable()
export class CodingFreshnessQueryService {
  private readonly logger = new Logger(CodingFreshnessQueryService.name);
  private readonly ID_QUERY_BATCH_SIZE = 1000;

  constructor(
    @InjectRepository(CodingUnitFreshness)
    private readonly freshnessRepository: Repository<CodingUnitFreshness>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    @InjectRepository(FileUpload)
    private readonly fileRepository: Repository<FileUpload>,
    @Optional()
    @Inject(WorkspaceExclusionService)
    private readonly workspaceExclusionService?: WorkspaceExclusionService
  ) {}

  async getSummary(workspaceId: number): Promise<CodingFreshnessSummaryDto> {
    const query = this.freshnessRepository
      .createQueryBuilder('freshness')
      .innerJoin('freshness.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .select('freshness.version', 'version')
      .addSelect('freshness.state', 'state')
      .addSelect('COUNT(DISTINCT freshness.unit_id)', 'unitCount')
      .addSelect('COALESCE(SUM(freshness.affected_response_count), 0)', 'affectedResponseCount')
      .where('freshness.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .groupBy('freshness.version')
      .addGroupBy('freshness.state')
      .orderBy('freshness.version', 'ASC')
      .addOrderBy('freshness.state', 'ASC');

    await this.applyWorkspaceExclusions(workspaceId, query);
    await excludeUnitsWithoutCodingScheme(workspaceId, query, this.fileRepository);

    const rows = await query.getRawMany<FreshnessSummaryRow>();

    return {
      workspaceId,
      currentRevision: await this.getCurrentRevision(workspaceId),
      items: rows.map(row => ({
        version: row.version,
        state: row.state,
        unitCount: Number(row.unitCount || 0),
        affectedResponseCount: Number(row.affectedResponseCount || 0)
      }))
    };
  }

  async getScope(
    workspaceId: number,
    versions: CodingFreshnessVersion[] = ['v1', 'v2', 'v3'],
    states: CodingFreshnessState[] = ['PENDING', 'STALE', 'MANUAL_REVIEW_REQUIRED']
  ): Promise<CodingFreshnessScopeDto> {
    const filteredVersions = uniqueVersions(versions);
    const filteredStates = this.uniqueStates(states).filter(state => state !== 'CURRENT');

    if (filteredVersions.length === 0 || filteredStates.length === 0) {
      return this.emptyScope(workspaceId, filteredVersions, filteredStates);
    }

    const query = this.freshnessRepository
      .createQueryBuilder('freshness')
      .innerJoin('freshness.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .select('freshness.unit_id', 'unitId')
      .addSelect('person.id', 'personId')
      .addSelect('person.group', 'groupName')
      .addSelect('freshness.version', 'version')
      .addSelect('freshness.state', 'state')
      .addSelect('freshness.affected_response_count', 'affectedResponseCount')
      .where('freshness.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('freshness.version IN (:...versions)', { versions: filteredVersions })
      .andWhere('freshness.state IN (:...states)', { states: filteredStates });

    await this.applyWorkspaceExclusions(workspaceId, query);
    await excludeUnitsWithoutCodingScheme(workspaceId, query, this.fileRepository);

    const rows = await query.getRawMany<FreshnessScopeRow>();
    const unitIds = uniquePositiveIds(rows.map(row => Number(row.unitId)));
    const personIds = uniquePositiveIds(rows.map(row => Number(row.personId)));
    const groupNames = Array.from(new Set(
      rows
        .map(row => row.groupName || '')
        .filter(groupName => groupName.trim() !== '')
    )).sort((a, b) => a.localeCompare(b));
    const affectedResponseCount = rows.reduce(
      (sum, row) => sum + Number(row.affectedResponseCount || 0),
      0
    );

    return {
      workspaceId,
      currentRevision: await this.getCurrentRevision(workspaceId),
      versions: filteredVersions,
      states: filteredStates,
      unitCount: unitIds.length,
      personCount: personIds.length,
      groupCount: groupNames.length,
      affectedResponseCount,
      unitIds,
      personIds,
      groupNames,
      groups: this.buildGroupScope(rows)
    };
  }

  async getDeleteImpactForUnitIds(
    workspaceId: number,
    unitIds: number[]
  ): Promise<CodingFreshnessImpactDto> {
    const ids = uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return this.emptyImpact();
    }

    const raw = await this.responseRepository
      .createQueryBuilder('response')
      .select('COUNT(DISTINCT response.unitid)', 'affectedUnits')
      .addSelect(this.countVersionExpression('v1'), 'autoCodingV1')
      .addSelect(this.countVersionExpression('v2'), 'manualCodingV2')
      .addSelect(this.countVersionExpression('v3'), 'autoCodingV3')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.unitid IN (:...unitIds)', { unitIds: ids })
      .getRawOne<DeleteImpactRow>();

    return {
      autoCodingV1: Number(raw?.autoCodingV1 || 0),
      manualCodingV2: Number(raw?.manualCodingV2 || 0),
      autoCodingV3: Number(raw?.autoCodingV3 || 0),
      affectedUnits: Number(raw?.affectedUnits || 0)
    };
  }

  async isRevisionCurrent(
    workspaceId: number,
    expectedRevision: number | null | undefined,
    manager?: EntityManager
  ): Promise<boolean> {
    if (expectedRevision === null || expectedRevision === undefined) {
      return true;
    }

    const expected = Number(expectedRevision);
    if (!Number.isFinite(expected)) {
      return true;
    }

    return (await this.getCurrentRevision(workspaceId, manager)) === expected;
  }

  private normalizeCodingSchemeRef(value: string): string {
    return value
      .trim()
      .toUpperCase()
      .replace(/\.VOCS$/i, '')
      .replace(/\.XML$/i, '');
  }

  private getCodingSchemeRefCandidates(values: string[]): string[] {
    const candidates = new Set<string>();
    uniqueStrings(values).forEach(value => {
      const normalized = this.normalizeCodingSchemeRef(value);
      if (!normalized) {
        return;
      }

      candidates.add(normalized);
      const basename = normalized.split(/[\\/]/).filter(Boolean).pop();
      if (basename) {
        candidates.add(basename);
      }
    });
    return Array.from(candidates);
  }

  async getUnitIdsByCodingSchemeRefs(
    workspaceId: number,
    codingSchemeRefs: string[],
    manager?: EntityManager
  ): Promise<number[]> {
    const schemeRefCandidates =
      this.getCodingSchemeRefCandidates(codingSchemeRefs);
    if (schemeRefCandidates.length === 0) {
      return [];
    }

    const queryRunner = manager ?? this.connection;
    const rows = await queryRunner.query(
      `
        WITH scheme_ref_candidates AS (
          SELECT unnest($2::text[]) AS scheme_ref
        ),
        matching_unit_files AS (
          SELECT DISTINCT unit_file.file_id_normalized AS unit_ref
          FROM file_upload unit_file
          INNER JOIN scheme_ref_candidates candidate
            ON unit_file.coding_scheme_ref_normalized = candidate.scheme_ref
          WHERE unit_file.workspace_id = $1
            AND unit_file.file_type = 'Unit'
            AND unit_file.file_id_normalized IS NOT NULL
        ),
        unit_refs AS (
          SELECT scheme_ref AS unit_ref
          FROM scheme_ref_candidates
          UNION
          SELECT unit_ref
          FROM matching_unit_files
        ),
        matched_unit_ids AS (
          SELECT matched_unit.id
          FROM unit_refs
          CROSS JOIN LATERAL (
            SELECT unit.id, unit.bookletid
            FROM "unit" unit
            WHERE REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') = unit_refs.unit_ref
            UNION
            SELECT unit.id, unit.bookletid
            FROM "unit" unit
            WHERE REGEXP_REPLACE(UPPER(COALESCE(unit.alias, '')), '\\.XML$', '', 'i') = unit_refs.unit_ref
          ) matched_unit
          INNER JOIN booklet booklet ON booklet.id = matched_unit.bookletid
          INNER JOIN persons person ON person.id = booklet.personid
          WHERE person.workspace_id = $1
        )
        SELECT DISTINCT id FROM matched_unit_ids
      `,
      [workspaceId, schemeRefCandidates]
    ) as Array<{ id: number | string }>;

    const indexedUnitIds = uniquePositiveIds(rows.map(row => Number(row.id)));
    if (!await this.hasLegacyUnitCodingSchemeRefs(workspaceId, manager)) {
      return indexedUnitIds;
    }

    const legacyRows = await queryRunner.query(
      `
        WITH legacy_matching_unit_files AS (
          SELECT DISTINCT REGEXP_REPLACE(UPPER(unit_file.file_id), '\\.XML$', '', 'i') AS unit_ref
          FROM file_upload unit_file
          WHERE unit_file.workspace_id = $1
            AND unit_file.file_type = 'Unit'
            AND unit_file.file_id_normalized IS NOT NULL
            AND unit_file.coding_scheme_ref_normalized IS NULL
            AND COALESCE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(
                  REGEXP_REPLACE(
                    UPPER(COALESCE(
                      NULLIF(unit_file.structured_data #>> '{extractedInfo,codingSchemeRef}', ''),
                      (REGEXP_MATCH(unit_file.data, '<\\s*codingschemeref[^>]*>\\s*([^<]+)', 'i'))[1],
                      ''
                    )),
                    '\\.VOCS$',
                    '',
                    'i'
                  ),
                  '\\.XML$',
                  '',
                  'i'
                ),
                '^.*[/\\\\]',
                '',
                'i'
              ),
              ''
            ) = ANY($2::text[])
        ),
        matched_unit_ids AS (
          SELECT matched_unit.id
          FROM legacy_matching_unit_files
          CROSS JOIN LATERAL (
            SELECT unit.id, unit.bookletid
            FROM "unit" unit
            WHERE REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') =
              legacy_matching_unit_files.unit_ref
            UNION
            SELECT unit.id, unit.bookletid
            FROM "unit" unit
            WHERE REGEXP_REPLACE(UPPER(COALESCE(unit.alias, '')), '\\.XML$', '', 'i') =
              legacy_matching_unit_files.unit_ref
          ) matched_unit
          INNER JOIN booklet booklet ON booklet.id = matched_unit.bookletid
          INNER JOIN persons person ON person.id = booklet.personid
          WHERE person.workspace_id = $1
        )
        SELECT DISTINCT id FROM matched_unit_ids
      `,
      [workspaceId, schemeRefCandidates]
    ) as Array<{ id: number | string }>;

    return uniquePositiveIds([
      ...indexedUnitIds,
      ...legacyRows.map(row => Number(row.id))
    ]);
  }

  private async hasLegacyUnitCodingSchemeRefs(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<boolean> {
    const queryRunner = manager ?? this.connection;
    const rows = await queryRunner.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM file_upload unit_file
          WHERE unit_file.workspace_id = $1
            AND unit_file.file_type = 'Unit'
            AND unit_file.coding_scheme_ref_normalized IS NULL
          LIMIT 1
        ) AS "hasLegacy"
      `,
      [workspaceId]
    ) as Array<{ hasLegacy: boolean | string }>;

    return rows[0]?.hasLegacy === true || rows[0]?.hasLegacy === 'true';
  }

  async getUnitIdsForResponseIds(
    workspaceId: number,
    responseIds: number[],
    manager?: EntityManager
  ): Promise<number[]> {
    const ids = uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return [];
    }

    const responseRepository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const rows = await collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
      const query = responseRepository
        .createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .select('DISTINCT response.unitid', 'unitId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.id IN (:...responseIds)', { responseIds: chunkIds });

      await this.applyWorkspaceExclusions(workspaceId, query, manager);

      return query.getRawMany<{ unitId: number | string }>();
    });
    return uniquePositiveIds(rows.map(row => Number(row.unitId)));
  }

  private countVersionExpression(version: CodingFreshnessVersion): string {
    return [
      `COUNT(DISTINCT CASE WHEN response.status_${version} IS NOT NULL`,
      `OR response.code_${version} IS NOT NULL`,
      `OR response.score_${version} IS NOT NULL`,
      'THEN response.id END)'
    ].join(' ');
  }

  async getCurrentRevision(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<number> {
    const queryRunner = manager ?? this.connection;
    const raw = await queryRunner.query(
      'SELECT revision FROM workspace_test_results_revision WHERE workspace_id = $1',
      [workspaceId]
    ) as Array<{ revision: number | string }>;
    return Number(raw[0]?.revision || 0);
  }

  async filterIncludedUnitIds(
    workspaceId: number,
    unitIds: number[],
    manager?: EntityManager
  ): Promise<number[]> {
    const ids = uniquePositiveIds(unitIds);
    if (ids.length === 0 || !this.workspaceExclusionService) {
      return ids;
    }

    try {
      const exclusions = manager ?
        await this.workspaceExclusionService.resolveExclusionsForQueries(
          workspaceId,
          manager
        ) :
        await this.workspaceExclusionService.resolveExclusionsForQueries(
          workspaceId
        );
      if (!this.hasWorkspaceExclusions(exclusions)) {
        return ids;
      }

      const rows = await collectChunked(ids, this.ID_QUERY_BATCH_SIZE, chunkIds => {
        const query = (manager ?? this.connection)
          .createQueryBuilder()
          .select('unit.id', 'id')
          .from('unit', 'unit')
          .innerJoin('booklet', 'booklet', 'booklet.id = unit.bookletid')
          .innerJoin('bookletinfo', 'bookletinfo', 'bookletinfo.id = booklet.infoid')
          .innerJoin('persons', 'person', 'person.id = booklet.personid')
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('unit.id IN (:...unitIds)', { unitIds: chunkIds });

        applyResolvedExclusionsToQuery(query, exclusions);

        return query.getRawMany<{ id: number | string }>();
      });
      const includedIds = new Set(rows.map(row => Number(row.id)));
      return ids.filter(id => includedIds.has(id));
    } catch (error) {
      if (manager) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not apply workspace exclusions to coding freshness units: ${message}`
      );
      return ids;
    }
  }

  private buildGroupScope(rows: FreshnessScopeRow[]): CodingFreshnessGroupDto[] {
    const groupMap = new Map<string, {
      personIds: Set<number>;
      unitIds: Set<number>;
      affectedResponseCount: number;
      itemMap: Map<string, {
        version: CodingFreshnessVersion;
        state: CodingFreshnessState;
        unitIds: Set<number>;
        affectedResponseCount: number;
      }>;
    }>();

    rows.forEach(row => {
      const groupName = row.groupName || '';
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, {
          personIds: new Set<number>(),
          unitIds: new Set<number>(),
          affectedResponseCount: 0,
          itemMap: new Map()
        });
      }

      const group = groupMap.get(groupName)!;
      const unitId = Number(row.unitId);
      const personId = Number(row.personId);
      const affectedResponseCount = Number(row.affectedResponseCount || 0);
      if (Number.isInteger(unitId) && unitId > 0) {
        group.unitIds.add(unitId);
      }
      if (Number.isInteger(personId) && personId > 0) {
        group.personIds.add(personId);
      }
      group.affectedResponseCount += affectedResponseCount;

      const itemKey = `${row.version}:${row.state}`;
      if (!group.itemMap.has(itemKey)) {
        group.itemMap.set(itemKey, {
          version: row.version,
          state: row.state,
          unitIds: new Set<number>(),
          affectedResponseCount: 0
        });
      }
      const item = group.itemMap.get(itemKey)!;
      if (Number.isInteger(unitId) && unitId > 0) {
        item.unitIds.add(unitId);
      }
      item.affectedResponseCount += affectedResponseCount;
    });

    return Array.from(groupMap.entries())
      .map(([groupName, group]) => ({
        groupName,
        personCount: group.personIds.size,
        unitCount: group.unitIds.size,
        affectedResponseCount: group.affectedResponseCount,
        items: Array.from(group.itemMap.values()).map(item => ({
          version: item.version,
          state: item.state,
          unitCount: item.unitIds.size,
          affectedResponseCount: item.affectedResponseCount
        }))
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName));
  }

  async applyWorkspaceExclusions<T extends ObjectLiteral>(
    workspaceId: number,
    query: SelectQueryBuilder<T>,
    manager?: EntityManager
  ): Promise<void> {
    if (!this.workspaceExclusionService) {
      return;
    }

    try {
      const exclusions = manager ?
        await this.workspaceExclusionService.resolveExclusionsForQueries(
          workspaceId,
          manager
        ) :
        await this.workspaceExclusionService.resolveExclusionsForQueries(
          workspaceId
        );
      if (this.hasWorkspaceExclusions(exclusions)) {
        applyResolvedExclusionsToQuery(query, exclusions);
      }
    } catch (error) {
      if (manager) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not apply workspace exclusions to coding freshness summary: ${message}`
      );
    }
  }

  private hasWorkspaceExclusions(exclusions: {
    globalIgnoredUnits?: unknown[];
    ignoredBooklets?: unknown[];
    testletIgnoredUnits?: unknown[];
  }): boolean {
    return Boolean(
      exclusions.globalIgnoredUnits?.length ||
      exclusions.ignoredBooklets?.length ||
      exclusions.testletIgnoredUnits?.length
    );
  }

  private uniqueStates(states: CodingFreshnessState[]): CodingFreshnessState[] {
    const allowed = new Set<CodingFreshnessState>([
      'CURRENT',
      'PENDING',
      'STALE',
      'MANUAL_REVIEW_REQUIRED'
    ]);
    return Array.from(new Set(states.filter(state => allowed.has(state))));
  }

  async getWorkspaceCodingPresence(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<UnitCodingPresence> {
    const responseRepository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const raw = await responseRepository
      .createQueryBuilder('response')
      .select(this.existsVersionExpression('v1'), 'v1')
      .addSelect(this.existsVersionExpression('v2'), 'v2')
      .addSelect(this.existsVersionExpression('v3'), 'v3')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    await this.applyWorkspaceExclusions(workspaceId, raw, manager);

    const result = await raw.getRawOne<{ v1: boolean; v2: boolean; v3: boolean }>();

    return {
      v1: this.toBoolean(result?.v1),
      v2: this.toBoolean(result?.v2),
      v3: this.toBoolean(result?.v3)
    };
  }

  async getUnitCodingPresence(
    workspaceId: number,
    unitIds: number[],
    manager?: EntityManager
  ): Promise<Map<number, UnitCodingPresence>> {
    const ids = uniquePositiveIds(unitIds);
    const presenceByUnit = new Map<number, UnitCodingPresence>();
    ids.forEach(id => presenceByUnit.set(id, { v1: false, v2: false, v3: false }));
    if (ids.length === 0) {
      return presenceByUnit;
    }

    const presenceRows = await collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
      const responseRepository = manager ?
        manager.getRepository(ResponseEntity) :
        this.responseRepository;
      const query = responseRepository
        .createQueryBuilder('response')
        .select('response.unitid', 'unitId')
        .addSelect(this.existsVersionExpression('v1'), 'v1')
        .addSelect(this.existsVersionExpression('v2'), 'v2')
        .addSelect(this.existsVersionExpression('v3'), 'v3')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.unitid IN (:...unitIds)', { unitIds: chunkIds })
        .groupBy('response.unitid');

      await this.applyWorkspaceExclusions(workspaceId, query, manager);

      return query.getRawMany<{
        unitId: number | string;
        v1: boolean;
        v2: boolean;
        v3: boolean
      }>();
    });

    presenceRows.forEach(row => presenceByUnit.set(Number(row.unitId), {
      v1: this.toBoolean(row.v1),
      v2: this.toBoolean(row.v2),
      v3: this.toBoolean(row.v3)
    }));

    return presenceByUnit;
  }

  async getImportedResponseIdsByUnit(
    workspaceId: number,
    responseIds: number[]
  ): Promise<Map<number, number[]>> {
    const ids = uniquePositiveIds(responseIds);
    const responseIdsByUnit = new Map<number, number[]>();
    if (ids.length === 0) {
      return responseIdsByUnit;
    }

    const rows = await collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
      const query = this.responseRepository
        .createQueryBuilder('response')
        .select('response.id', 'responseId')
        .addSelect('response.unitid', 'unitId')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.id IN (:...responseIds)', { responseIds: chunkIds })
        .andWhere('response.is_autocoder_generated IS NOT TRUE');

      await this.applyWorkspaceExclusions(workspaceId, query);

      return query.getRawMany<ImportedResponseScopeRow>();
    });
    rows.forEach(row => {
      const unitId = Number(row.unitId);
      const responseId = Number(row.responseId);
      if (!Number.isInteger(unitId) || unitId <= 0 || !Number.isInteger(responseId) || responseId <= 0) {
        return;
      }
      const existing = responseIdsByUnit.get(unitId) || [];
      existing.push(responseId);
      responseIdsByUnit.set(unitId, existing);
    });

    responseIdsByUnit.forEach((unitResponseIds, unitId) => {
      responseIdsByUnit.set(unitId, uniquePositiveIds(unitResponseIds));
    });

    return responseIdsByUnit;
  }

  async getResponseCountsByUnit(
    workspaceId: number,
    unitIds: number[],
    manager?: EntityManager
  ): Promise<Map<number, number>> {
    const ids = uniquePositiveIds(unitIds);
    const result = new Map<number, number>();
    ids.forEach(id => result.set(id, 0));
    if (ids.length === 0) {
      return result;
    }

    const responseRepository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const countRows = await collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
      const query = responseRepository
        .createQueryBuilder('response')
        .select('response.unitid', 'unitId')
        .addSelect('COUNT(response.id)', 'count')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.unitid IN (:...unitIds)', { unitIds: chunkIds })
        .andWhere('response.is_autocoder_generated IS NOT TRUE')
        .groupBy('response.unitid');

      await this.applyWorkspaceExclusions(workspaceId, query, manager);

      return query.getRawMany<{ unitId: number | string; count: string }>();
    });

    countRows.forEach(row => result.set(Number(row.unitId), Number(row.count || 0)));
    return result;
  }

  async getAutoCodingCandidateResponseCountsByUnit(
    workspaceId: number,
    unitIds: number[],
    version: CodingFreshnessVersion,
    manager?: EntityManager
  ): Promise<Map<number, number>> {
    const ids = uniquePositiveIds(unitIds);
    const result = new Map<number, number>();
    ids.forEach(id => result.set(id, 0));
    if (ids.length === 0) {
      return result;
    }

    const autoCoderRun = version === 'v3' ? 2 : 1;
    const responseRepository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const countRows = await collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
      const query = responseRepository
        .createQueryBuilder('response')
        .select('response.unitid', 'unitId')
        .addSelect('COUNT(response.id)', 'count')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.unitid IN (:...unitIds)', { unitIds: chunkIds })
        .andWhere(
          new Brackets(qb => {
            qb.where('response.status IN (:...statuses)', {
              statuses: [3, 2, 1]
            }).orWhere('response.status_v1 = :derivePending', {
              derivePending: statusStringToNumber('DERIVE_PENDING') as number
            });
          })
        )
        .andWhere(getCodingVariableIdCandidateSql('response'))
        .groupBy('response.unitid');

      this.applyAutoCodingSourceFilter(query, autoCoderRun);
      await this.applyWorkspaceExclusions(workspaceId, query, manager);

      return query.getRawMany<{ unitId: number | string; count: string }>();
    });

    countRows.forEach(row => result.set(Number(row.unitId), Number(row.count || 0)));
    return result;
  }

  private applyAutoCodingSourceFilter(
    query: SelectQueryBuilder<ResponseEntity>,
    autoCoderRun: 1 | 2
  ): void {
    if (autoCoderRun === 1) {
      query.andWhere('response.is_autocoder_generated IS NOT TRUE');
      return;
    }

    query.andWhere(
      new Brackets(qb => {
        qb.where('response.is_autocoder_generated IS NOT TRUE').orWhere(
          `response.is_autocoder_generated = :generatedWithSourceCoding
            AND (
              response.status_v1 IS NOT NULL
              OR response.status_v2 IS NOT NULL
            )`,
          { generatedWithSourceCoding: true }
        );
      })
    );
  }

  private existsVersionExpression(version: CodingFreshnessVersion): string {
    return `BOOL_OR(response.status_${version} IS NOT NULL OR response.code_${version} IS NOT NULL OR response.score_${version} IS NOT NULL)`;
  }

  private toBoolean(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  private emptyImpact(): CodingFreshnessImpactDto {
    return {
      autoCodingV1: 0,
      manualCodingV2: 0,
      autoCodingV3: 0,
      affectedUnits: 0
    };
  }

  private async emptyScope(
    workspaceId: number,
    versions: CodingFreshnessVersion[],
    states: CodingFreshnessState[]
  ): Promise<CodingFreshnessScopeDto> {
    return {
      workspaceId,
      currentRevision: await this.getCurrentRevision(workspaceId),
      versions,
      states,
      unitCount: 0,
      personCount: 0,
      groupCount: 0,
      affectedResponseCount: 0,
      unitIds: [],
      personIds: [],
      groupNames: [],
      groups: []
    };
  }
}
