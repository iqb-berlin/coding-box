import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { CodingUnitFreshness } from '../../entities/coding-unit-freshness.entity';
import { ResponseEntity } from '../../entities/response.entity';
// eslint-disable-next-line import/no-cycle
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import {
  CodingFreshnessImpactDto,
  CodingFreshnessGroupDto,
  CodingFreshnessReason,
  CodingFreshnessScopeDto,
  CodingFreshnessState,
  CodingFreshnessSummaryDto,
  CodingFreshnessVersion
} from '../../../../../../../api-dto/coding/coding-freshness.dto';

type UnitCodingPresence = Record<CodingFreshnessVersion, boolean>;

type FreshnessSummaryRow = {
  version: CodingFreshnessVersion;
  state: CodingFreshnessState;
  unitCount: string;
  affectedResponseCount: string;
};

type FreshnessScopeRow = {
  unitId: string;
  personId: string;
  groupName: string | null;
  version: CodingFreshnessVersion;
  state: CodingFreshnessState;
  affectedResponseCount: string;
};

type DeleteImpactRow = {
  affectedUnits: string;
  autoCodingV1: string;
  manualCodingV2: string;
  autoCodingV3: string;
};

type FreshnessUpsert = {
  workspace_id: number;
  unit_id: number;
  version: CodingFreshnessVersion;
  state: CodingFreshnessState;
  reason: CodingFreshnessReason;
  affected_response_count: number;
  source_revision: number;
  coded_revision: number | null;
};

@Injectable()
export class CodingFreshnessService {
  private readonly logger = new Logger(CodingFreshnessService.name);

  constructor(
    @InjectRepository(CodingUnitFreshness)
    private readonly freshnessRepository: Repository<CodingUnitFreshness>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    @Optional()
    private readonly workspaceExclusionService?: WorkspaceExclusionService
  ) { }

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
    const filteredVersions = this.uniqueVersions(versions);
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

    const rows = await query.getRawMany<FreshnessScopeRow>();
    const unitIds = this.uniquePositiveIds(rows.map(row => Number(row.unitId)));
    const personIds = this.uniquePositiveIds(rows.map(row => Number(row.personId)));
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
    const ids = this.uniquePositiveIds(unitIds);
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

  async markUnitsPendingAfterImport(
    workspaceId: number,
    unitIds: number[],
    affectedResponseCount = 0
  ): Promise<void> {
    const ids = await this.filterIncludedUnitIds(
      workspaceId,
      this.uniquePositiveIds(unitIds)
    );
    if (ids.length === 0) {
      return;
    }

    const revision = await this.incrementRevision(workspaceId);
    const responseCounts = await this.getResponseCountsByUnit(workspaceId, ids);
    const workspacePresence = await this.getWorkspaceCodingPresence(workspaceId);
    const rows: FreshnessUpsert[] = [];

    (['v1', 'v3'] as CodingFreshnessVersion[]).forEach(version => {
      if (!workspacePresence[version]) {
        return;
      }
      ids.forEach(unitId => rows.push(this.buildRow(
        workspaceId,
        unitId,
        version,
        'PENDING',
        'RESULT_ADDED',
        responseCounts.get(unitId) || affectedResponseCount,
        revision,
        null
      )));
    });

    await this.upsertRows(rows);
  }

  async markUnitsStaleAfterResultChange(
    workspaceId: number,
    unitIds: number[],
    reason: Extract<CodingFreshnessReason, 'RESULT_UPDATED' | 'RESULT_DELETED'> = 'RESULT_UPDATED'
  ): Promise<void> {
    const ids = await this.filterIncludedUnitIds(
      workspaceId,
      this.uniquePositiveIds(unitIds)
    );
    if (ids.length === 0) {
      return;
    }

    const revision = await this.incrementRevision(workspaceId);
    const responseCounts = await this.getResponseCountsByUnit(workspaceId, ids);
    const workspacePresence = await this.getWorkspaceCodingPresence(workspaceId);
    const unitPresence = await this.getUnitCodingPresence(workspaceId, ids);
    const rows: FreshnessUpsert[] = [];

    (['v1', 'v3'] as CodingFreshnessVersion[]).forEach(version => {
      if (!workspacePresence[version]) {
        return;
      }
      ids.forEach(unitId => {
        const state: CodingFreshnessState =
          unitPresence.get(unitId)?.[version] ? 'STALE' : 'PENDING';
        rows.push(this.buildRow(
          workspaceId,
          unitId,
          version,
          state,
          reason,
          responseCounts.get(unitId) || 0,
          revision,
          null
        ));
      });
    });

    ids.forEach(unitId => {
      if (unitPresence.get(unitId)?.v2) {
        rows.push(this.buildRow(
          workspaceId,
          unitId,
          'v2',
          'MANUAL_REVIEW_REQUIRED',
          reason,
          responseCounts.get(unitId) || 0,
          revision,
          null
        ));
      }
    });

    await this.upsertRows(rows);
  }

  async markVersionCurrent(
    workspaceId: number,
    unitIds: number[],
    version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
  ): Promise<void> {
    const ids = this.uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return;
    }

    const revision = await this.getCurrentRevision(workspaceId);
    const responseCounts = await this.getResponseCountsByUnit(workspaceId, ids);
    await this.upsertRows(ids.map(unitId => this.buildRow(
      workspaceId,
      unitId,
      version,
      'CURRENT',
      'AUTOCODE_RUN',
      responseCounts.get(unitId) || 0,
      revision,
      revision
    )));
  }

  async clearVersionsAfterReset(
    workspaceId: number,
    versions: CodingFreshnessVersion[],
    unitNames?: string[]
  ): Promise<void> {
    if (versions.length === 0) {
      return;
    }

    const query = this.freshnessRepository
      .createQueryBuilder()
      .delete()
      .from(CodingUnitFreshness)
      .where('workspace_id = :workspaceId', { workspaceId })
      .andWhere('version IN (:...versions)', { versions });

    if (unitNames && unitNames.length > 0) {
      const unitIds = await this.connection
        .createQueryBuilder()
        .select('unit.id', 'id')
        .from('unit', 'unit')
        .innerJoin('booklet', 'booklet', 'booklet.id = unit.bookletid')
        .innerJoin('persons', 'person', 'person.id = booklet.personid')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('unit.name IN (:...unitNames)', { unitNames })
        .getRawMany<{ id: number | string }>();
      const ids = this.uniquePositiveIds(unitIds.map(row => Number(row.id)));
      if (ids.length === 0) {
        return;
      }
      query.andWhere('unit_id IN (:...unitIds)', { unitIds: ids });
    }

    await query.execute();
  }

  private countVersionExpression(version: CodingFreshnessVersion): string {
    return [
      `COUNT(DISTINCT CASE WHEN response.status_${version} IS NOT NULL`,
      `OR response.code_${version} IS NOT NULL`,
      `OR response.score_${version} IS NOT NULL`,
      'THEN response.id END)'
    ].join(' ');
  }

  private async getCurrentRevision(workspaceId: number): Promise<number> {
    const raw = await this.connection.query(
      'SELECT revision FROM workspace_test_results_revision WHERE workspace_id = $1',
      [workspaceId]
    ) as Array<{ revision: number | string }>;
    return Number(raw[0]?.revision || 0);
  }

  private async filterIncludedUnitIds(
    workspaceId: number,
    unitIds: number[]
  ): Promise<number[]> {
    const ids = this.uniquePositiveIds(unitIds);
    if (ids.length === 0 || !this.workspaceExclusionService) {
      return ids;
    }

    try {
      const exclusions =
        await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      if (!this.hasWorkspaceExclusions(exclusions)) {
        return ids;
      }

      const query = this.connection
        .createQueryBuilder()
        .select('unit.id', 'id')
        .from('unit', 'unit')
        .innerJoin('booklet', 'booklet', 'booklet.id = unit.bookletid')
        .innerJoin('bookletinfo', 'bookletinfo', 'bookletinfo.id = booklet.infoid')
        .innerJoin('persons', 'person', 'person.id = booklet.personid')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('unit.id IN (:...unitIds)', { unitIds: ids });

      applyResolvedExclusionsToQuery(query, exclusions);

      const rows = await query.getRawMany<{ id: number | string }>();
      const includedIds = new Set(rows.map(row => Number(row.id)));
      return ids.filter(id => includedIds.has(id));
    } catch (error) {
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

  private async applyWorkspaceExclusions<T>(
    workspaceId: number,
    query: SelectQueryBuilder<T>
  ): Promise<void> {
    if (!this.workspaceExclusionService) {
      return;
    }

    try {
      const exclusions =
        await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      if (this.hasWorkspaceExclusions(exclusions)) {
        applyResolvedExclusionsToQuery(query, exclusions);
      }
    } catch (error) {
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

  private uniqueVersions(versions: CodingFreshnessVersion[]): CodingFreshnessVersion[] {
    const allowed = new Set<CodingFreshnessVersion>(['v1', 'v2', 'v3']);
    return Array.from(new Set(versions.filter(version => allowed.has(version))));
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

  private async incrementRevision(workspaceId: number): Promise<number> {
    const raw = await this.connection.query(
      `
        INSERT INTO workspace_test_results_revision (workspace_id, revision, updated_at)
        VALUES ($1, 1, now())
        ON CONFLICT (workspace_id)
        DO UPDATE SET revision = workspace_test_results_revision.revision + 1,
                      updated_at = now()
        RETURNING revision
      `,
      [workspaceId]
    ) as Array<{ revision: number | string }>;
    return Number(raw[0]?.revision || 1);
  }

  private async getWorkspaceCodingPresence(
    workspaceId: number
  ): Promise<UnitCodingPresence> {
    const raw = await this.responseRepository
      .createQueryBuilder('response')
      .select(this.existsVersionExpression('v1'), 'v1')
      .addSelect(this.existsVersionExpression('v2'), 'v2')
      .addSelect(this.existsVersionExpression('v3'), 'v3')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .getRawOne<{ v1: boolean; v2: boolean; v3: boolean }>();

    return {
      v1: this.toBoolean(raw?.v1),
      v2: this.toBoolean(raw?.v2),
      v3: this.toBoolean(raw?.v3)
    };
  }

  private async getUnitCodingPresence(
    workspaceId: number,
    unitIds: number[]
  ): Promise<Map<number, UnitCodingPresence>> {
    const ids = this.uniquePositiveIds(unitIds);
    const result = new Map<number, UnitCodingPresence>();
    ids.forEach(id => result.set(id, { v1: false, v2: false, v3: false }));
    if (ids.length === 0) {
      return result;
    }

    const rows = await this.responseRepository
      .createQueryBuilder('response')
      .select('response.unitid', 'unitId')
      .addSelect(this.existsVersionExpression('v1'), 'v1')
      .addSelect(this.existsVersionExpression('v2'), 'v2')
      .addSelect(this.existsVersionExpression('v3'), 'v3')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.unitid IN (:...unitIds)', { unitIds: ids })
      .groupBy('response.unitid')
      .getRawMany<{ unitId: number | string; v1: boolean; v2: boolean; v3: boolean }>();

    rows.forEach(row => result.set(Number(row.unitId), {
      v1: this.toBoolean(row.v1),
      v2: this.toBoolean(row.v2),
      v3: this.toBoolean(row.v3)
    }));

    return result;
  }

  private async getResponseCountsByUnit(
    workspaceId: number,
    unitIds: number[]
  ): Promise<Map<number, number>> {
    const ids = this.uniquePositiveIds(unitIds);
    const result = new Map<number, number>();
    ids.forEach(id => result.set(id, 0));
    if (ids.length === 0) {
      return result;
    }

    const rows = await this.responseRepository
      .createQueryBuilder('response')
      .select('response.unitid', 'unitId')
      .addSelect('COUNT(response.id)', 'count')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.unitid IN (:...unitIds)', { unitIds: ids })
      .andWhere('response.is_autocoder_generated IS NOT TRUE')
      .groupBy('response.unitid')
      .getRawMany<{ unitId: number | string; count: string }>();

    rows.forEach(row => result.set(Number(row.unitId), Number(row.count || 0)));
    return result;
  }

  private existsVersionExpression(version: CodingFreshnessVersion): string {
    return `BOOL_OR(response.status_${version} IS NOT NULL OR response.code_${version} IS NOT NULL OR response.score_${version} IS NOT NULL)`;
  }

  private buildRow(
    workspaceId: number,
    unitId: number,
    version: CodingFreshnessVersion,
    state: CodingFreshnessState,
    reason: CodingFreshnessReason,
    affectedResponseCount: number,
    sourceRevision: number,
    codedRevision: number | null
  ): FreshnessUpsert {
    return {
      workspace_id: workspaceId,
      unit_id: unitId,
      version,
      state,
      reason,
      affected_response_count: affectedResponseCount,
      source_revision: sourceRevision,
      coded_revision: codedRevision
    };
  }

  private async upsertRows(rows: FreshnessUpsert[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.freshnessRepository.upsert(rows, [
      'workspace_id',
      'unit_id',
      'version'
    ]);
    this.logger.log(`Updated coding freshness for ${rows.length} unit/version pairs.`);
  }

  private uniquePositiveIds(ids: number[]): number[] {
    return Array.from(
      new Set(
        ids
          .map(id => Number(id))
          .filter(id => Number.isInteger(id) && id > 0)
      )
    );
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
