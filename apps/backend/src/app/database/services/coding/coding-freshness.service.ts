import {
  BadRequestException,
  Injectable,
  Logger,
  Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder
} from 'typeorm';
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
  CodingFreshnessSummaryItemDto,
  CodingFreshnessReason,
  CodingFreshnessScopeDto,
  CodingFreshnessState,
  CodingFreshnessSummaryDto,
  CodingFreshnessVersion
} from '../../../../../../../api-dto/coding/coding-freshness.dto';
import { CodingJobFreshnessStatus } from '../../../../../../../api-dto/coding/job-refresh.dto';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { IQB_STANDARD_MISSING_CODES, MissingsProfilesService } from './missings-profiles.service';
import { getNonCodingIssueReviewJobSqlCondition } from './coding-job-type.util';
import { getCodingVariableIdCandidateSql } from './coding-response-candidate.util';

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

type ImportedResponseScopeRow = {
  responseId: string;
  unitId: string;
};

type DeleteImpactRow = {
  affectedUnits: string;
  autoCodingV1: string;
  manualCodingV2: string;
  autoCodingV3: string;
};

type ManualJobFreshnessRow = {
  jobCount?: string | number;
  affectedUnits?: string | number;
  affectedResponses?: string | number;
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

type ResetFreshnessUnitMap = Partial<Record<CodingFreshnessVersion, number[]>>;

type MarkManualCodingCurrentOptions = {
  codingJobId?: number;
  clearCoveredReviewJobs?: boolean;
  manager?: EntityManager;
};

type ReconcileAppliedManualCodingJobsOptions = {
  unitNames?: string[];
  variableIds?: string[];
  manager?: EntityManager;
};

@Injectable()
export class CodingFreshnessService {
  private readonly logger = new Logger(CodingFreshnessService.name);
  private readonly ID_QUERY_BATCH_SIZE = 1000;
  private readonly FRESHNESS_UPSERT_BATCH_SIZE = 250;

  constructor(
    @InjectRepository(CodingUnitFreshness)
    private readonly freshnessRepository: Repository<CodingUnitFreshness>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    @Optional()
    private readonly workspaceExclusionService?: WorkspaceExclusionService,
    @Optional()
    private readonly missingsProfilesService?: MissingsProfilesService
  ) { }

  private async getDefaultMirCode(workspaceId: number): Promise<number> {
    if (!this.missingsProfilesService) {
      return IQB_STANDARD_MISSING_CODES.mir;
    }

    const missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
      workspaceId,
      null,
      'mir'
    );
    return missing.code;
  }

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

  async assertAutoCodingRunCanStart(
    workspaceId: number,
    autoCoderRun: number
  ): Promise<void> {
    if (autoCoderRun !== 2) {
      return;
    }

    const workspacePresence = await this.getWorkspaceCodingPresence(workspaceId);
    if (!workspacePresence.v1) {
      throw new BadRequestException(
        'Der 2. Autocoder-Lauf kann nicht gestartet werden, weil Auto-Coding 1 noch nicht ausgeführt wurde.'
      );
    }

    const blockers = await this.getAutoCodingRunBlockers(workspaceId, autoCoderRun);
    if (blockers.length === 0) {
      return;
    }

    throw new BadRequestException(this.buildAutoCodingRunBlockedMessage(blockers));
  }

  async getAutoCodingRunBlockers(
    workspaceId: number,
    autoCoderRun: number
  ): Promise<CodingFreshnessSummaryItemDto[]> {
    if (autoCoderRun !== 2) {
      return [];
    }

    const summary = await this.getSummary(workspaceId);
    const blockers = summary.items.filter(item => (
      item.state !== 'CURRENT' &&
      item.unitCount > 0 &&
      (
        (item.version === 'v1' && (item.state === 'PENDING' || item.state === 'STALE')) ||
        (item.version === 'v2' && item.state === 'MANUAL_REVIEW_REQUIRED')
      )
    ));
    const openManualCodingBlocker = await this.getOpenManualCodingFreshnessBlocker(workspaceId);
    if (openManualCodingBlocker) {
      this.mergeFreshnessBlocker(blockers, openManualCodingBlocker);
    }

    const manualJobBlocker = await this.getManualCodingJobFreshnessBlocker(workspaceId);

    if (manualJobBlocker) {
      this.mergeFreshnessBlocker(blockers, manualJobBlocker);
    }

    return blockers;
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

    this.getAutoCodingVersionsToRefresh(workspacePresence).forEach(version => {
      ids.forEach(unitId => rows.push(this.buildRow(
        workspaceId,
        unitId,
        version,
        'PENDING',
        'RESULT_ADDED',
        responseCounts.get(unitId) ?? affectedResponseCount,
        revision,
        null
      )));
    });

    await this.upsertRows(rows);
    await this.markCodingJobsStaleForUnitIds(
      workspaceId,
      ids,
      'RESULT_ADDED',
      'stale_source'
    );
    await this.markCodingJobsStaleForAddedUnitIds(
      workspaceId,
      ids,
      'RESULT_ADDED',
      'stale_source'
    );
  }

  async markResponsesPendingAfterImport(
    workspaceId: number,
    responseIds: number[]
  ): Promise<void> {
    const responseIdsByUnit = await this.getImportedResponseIdsByUnit(
      workspaceId,
      responseIds
    );
    const unitIds = Array.from(responseIdsByUnit.keys());
    if (unitIds.length === 0) {
      return;
    }

    const revision = await this.incrementRevision(workspaceId);
    const workspacePresence = await this.getWorkspaceCodingPresence(workspaceId);
    const rows: FreshnessUpsert[] = [];

    this.getAutoCodingVersionsToRefresh(workspacePresence).forEach(version => {
      unitIds.forEach(unitId => rows.push(this.buildRow(
        workspaceId,
        unitId,
        version,
        'PENDING',
        'RESULT_ADDED',
        responseIdsByUnit.get(unitId)?.length || 0,
        revision,
        null
      )));
    });

    await this.upsertRows(rows);
    await this.markCodingJobsStaleForAddedResponseIds(
      workspaceId,
      Array.from(responseIdsByUnit.values()).flat(),
      'RESULT_ADDED',
      'stale_source'
    );
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
    const workspacePresence = await this.getWorkspaceCodingPresence(workspaceId);
    const unitPresence = await this.getUnitCodingPresence(workspaceId, ids);
    const manualReviewUnitIds = ids.filter(unitId => unitPresence.get(unitId)?.v2);
    const manualResponseCounts = manualReviewUnitIds.length > 0 ?
      await this.getResponseCountsByUnit(workspaceId, manualReviewUnitIds) :
      new Map<number, number>();
    const autoCodingVersionsToRefresh = this.getAutoCodingVersionsToRefresh(workspacePresence);
    const autoCodingResponseCountsByVersion = new Map<CodingFreshnessVersion, Map<number, number>>();
    const rows: FreshnessUpsert[] = [];

    for (const version of autoCodingVersionsToRefresh) {
      autoCodingResponseCountsByVersion.set(
        version,
        await this.getAutoCodingCandidateResponseCountsByUnit(workspaceId, ids, version)
      );
    }

    autoCodingVersionsToRefresh.forEach(version => {
      ids.forEach(unitId => {
        const autoCodingResponseCount =
          autoCodingResponseCountsByVersion.get(version)?.get(unitId) || 0;
        let state: CodingFreshnessState = 'CURRENT';
        if (autoCodingResponseCount > 0) {
          state = unitPresence.get(unitId)?.[version] ? 'STALE' : 'PENDING';
        }
        rows.push(this.buildRow(
          workspaceId,
          unitId,
          version,
          state,
          reason,
          autoCodingResponseCount,
          revision,
          state === 'CURRENT' ? revision : null
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
          manualResponseCounts.get(unitId) || 0,
          revision,
          null
        ));
      }
    });

    await this.upsertRows(rows);
    await this.markCodingJobsStaleForUnitIds(
      workspaceId,
      ids,
      reason,
      'stale_source'
    );
  }

  async markUnitsStaleAfterCodingSchemeChange(
    workspaceId: number,
    scope: {
      autoCodingSchemeRefs?: string[];
      manualCodingSchemeRefs?: string[];
    }
  ): Promise<void> {
    const autoCodingUnitIds = await this.getUnitIdsByCodingSchemeRefs(
      workspaceId,
      scope.autoCodingSchemeRefs || []
    );
    const manualCodingUnitIds = await this.getUnitIdsByCodingSchemeRefs(
      workspaceId,
      [
        ...(scope.manualCodingSchemeRefs || []),
        ...(scope.autoCodingSchemeRefs || [])
      ]
    );
    const allUnitIds = await this.filterIncludedUnitIds(
      workspaceId,
      this.uniquePositiveIds([
        ...autoCodingUnitIds,
        ...manualCodingUnitIds
      ])
    );
    if (allUnitIds.length === 0) {
      return;
    }

    const includedUnitIdSet = new Set(allUnitIds);
    const includedAutoCodingUnitIds = autoCodingUnitIds
      .filter(unitId => includedUnitIdSet.has(unitId));
    const includedManualCodingUnitIds = manualCodingUnitIds
      .filter(unitId => includedUnitIdSet.has(unitId));

    const revision = await this.incrementRevision(workspaceId);
    const responseCounts = await this.getResponseCountsByUnit(
      workspaceId,
      allUnitIds
    );
    const workspacePresence = await this.getWorkspaceCodingPresence(workspaceId);
    const unitPresence = await this.getUnitCodingPresence(workspaceId, allUnitIds);
    const rows: FreshnessUpsert[] = [];

    if (includedAutoCodingUnitIds.length > 0) {
      this.getAutoCodingVersionsToRefresh(workspacePresence).forEach(version => {
        includedAutoCodingUnitIds.forEach(unitId => {
          const state: CodingFreshnessState =
            unitPresence.get(unitId)?.[version] ? 'STALE' : 'PENDING';
          rows.push(this.buildRow(
            workspaceId,
            unitId,
            version,
            state,
            'CODING_SCHEME_CHANGED',
            responseCounts.get(unitId) || 0,
            revision,
            null
          ));
        });
      });
    }

    includedManualCodingUnitIds.forEach(unitId => {
      const presence = unitPresence.get(unitId);
      if (!presence?.v1 && !presence?.v2 && !presence?.v3) {
        return;
      }
      rows.push(this.buildRow(
        workspaceId,
        unitId,
        'v2',
        'MANUAL_REVIEW_REQUIRED',
        'CODING_SCHEME_CHANGED',
        responseCounts.get(unitId) || 0,
        revision,
        null
      ));
    });

    await this.upsertRows(rows);

    if (includedAutoCodingUnitIds.length > 0) {
      await this.markCodingJobsStaleForUnitIds(
        workspaceId,
        includedAutoCodingUnitIds,
        'CODING_SCHEME_CHANGED',
        'stale_source'
      );
    }

    const includedAutoCodingUnitIdSet = new Set(includedAutoCodingUnitIds);
    const includedManualOnlyUnitIds = includedManualCodingUnitIds
      .filter(unitId => !includedAutoCodingUnitIdSet.has(unitId));
    if (includedManualOnlyUnitIds.length > 0) {
      await this.markCodingJobsStaleForUnitIds(
        workspaceId,
        includedManualOnlyUnitIds,
        'CODING_SCHEME_CHANGED',
        'review_required'
      );
    }
  }

  async markVersionCurrent(
    workspaceId: number,
    unitIds: number[],
    version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>,
    manager?: EntityManager,
    expectedSourceRevision?: number
  ): Promise<void> {
    const ids = this.uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return;
    }

    const revision = await this.getCurrentRevision(workspaceId, manager);
    if (expectedSourceRevision !== undefined && revision !== Number(expectedSourceRevision)) {
      this.logger.warn(
        `Skipped marking ${version} current for workspace ${workspaceId}: ` +
        `expected revision ${expectedSourceRevision}, current revision ${revision}.`
      );
      return;
    }

    const responseCounts = await this.getResponseCountsByUnit(workspaceId, ids, manager);
    await this.upsertRows(ids.map(unitId => this.buildRow(
      workspaceId,
      unitId,
      version,
      'CURRENT',
      'AUTOCODE_RUN',
      responseCounts.get(unitId) || 0,
      revision,
      revision
    )), manager);
  }

  async markManualCodingCurrent(
    workspaceId: number,
    responseIds: number[],
    options: MarkManualCodingCurrentOptions = {}
  ): Promise<void> {
    const ids = this.uniquePositiveIds(responseIds);
    const codingJobIdsToClear = this.uniquePositiveIds([
      options.codingJobId || 0,
      ...(
        options.clearCoveredReviewJobs ?
          await this.getReviewRequiredCodingJobIdsCoveredByResponseIds(
            workspaceId,
            ids,
            options.manager
          ) :
          []
      )
    ]);

    if (ids.length === 0) {
      if (codingJobIdsToClear.length > 0) {
        await this.markCodingJobsCurrent(workspaceId, codingJobIdsToClear, options.manager);
      }
      return;
    }

    const unitIds = await this.getUnitIdsForResponseIds(workspaceId, ids, options.manager);
    if (unitIds.length === 0) {
      if (codingJobIdsToClear.length > 0) {
        await this.markCodingJobsCurrent(workspaceId, codingJobIdsToClear, options.manager);
      }
      return;
    }

    const blockedUnitIds = await this.getReviewRequiredUnitIds(
      workspaceId,
      unitIds,
      codingJobIdsToClear,
      options.manager
    );
    const blockedUnitIdSet = new Set(blockedUnitIds);
    const clearableUnitIds = unitIds.filter(unitId => !blockedUnitIdSet.has(unitId));

    if (clearableUnitIds.length > 0) {
      const revision = await this.getCurrentRevision(workspaceId, options.manager);
      const responseCounts = await this.getResponseCountsByUnit(
        workspaceId,
        clearableUnitIds,
        options.manager
      );
      await this.upsertRows(clearableUnitIds.map(unitId => this.buildRow(
        workspaceId,
        unitId,
        'v2',
        'CURRENT',
        'MANUAL_CODING_APPLIED',
        responseCounts.get(unitId) || 0,
        revision,
        revision
      )), options.manager);
    }

    if (codingJobIdsToClear.length > 0) {
      await this.markCodingJobsCurrent(workspaceId, codingJobIdsToClear, options.manager);
    }
  }

  async markVersionsPendingAfterReset(
    workspaceId: number,
    resetUnitIdsByVersion: ResetFreshnessUnitMap
  ): Promise<void> {
    const entries = this.uniqueVersions(
      Object.keys(resetUnitIdsByVersion) as CodingFreshnessVersion[]
    )
      .map(version => ({
        version,
        unitIds: this.uniquePositiveIds(resetUnitIdsByVersion[version] || [])
      }))
      .filter(entry => entry.unitIds.length > 0);

    if (entries.length === 0) {
      return;
    }

    const includedUnitIds = await this.filterIncludedUnitIds(
      workspaceId,
      this.uniquePositiveIds(entries.flatMap(entry => entry.unitIds))
    );
    if (includedUnitIds.length === 0) {
      return;
    }

    const includedUnitIdSet = new Set(includedUnitIds);
    const revision = await this.getCurrentRevision(workspaceId);
    const responseCounts = await this.getResponseCountsByUnit(workspaceId, includedUnitIds);
    const rows: FreshnessUpsert[] = [];

    entries.forEach(entry => {
      const state: CodingFreshnessState =
        entry.version === 'v2' ? 'MANUAL_REVIEW_REQUIRED' : 'PENDING';
      entry.unitIds
        .filter(unitId => includedUnitIdSet.has(unitId))
        .forEach(unitId => rows.push(this.buildRow(
          workspaceId,
          unitId,
          entry.version,
          state,
          'RESET',
          responseCounts.get(unitId) || 0,
          revision,
          null
        )));
    });

    await this.upsertRows(rows);

    const manualReviewUnitIds = this.uniquePositiveIds(entries
      .filter(entry => entry.version === 'v1')
      .flatMap(entry => entry.unitIds)
      .filter(unitId => includedUnitIdSet.has(unitId)));

    if (manualReviewUnitIds.length > 0) {
      await this.markCodingJobsStaleForUnitIds(
        workspaceId,
        manualReviewUnitIds,
        'RESET',
        'stale_source'
      );
    }
  }

  async markExistingAutoCodingVersionsPendingAfterResetScope(
    workspaceId: number,
    versions: CodingFreshnessVersion[],
    unitNames?: string[],
    variableIds?: string[]
  ): Promise<void> {
    const autoCodingVersions = this.uniqueVersions(versions)
      .filter((version): version is Extract<CodingFreshnessVersion, 'v1' | 'v3'> => (
        version === 'v1' || version === 'v3'
      ));
    if (autoCodingVersions.length === 0) {
      return;
    }
    const autoCodingVersionSet = new Set<CodingFreshnessVersion>(autoCodingVersions);

    const query = this.responseRepository
      .createQueryBuilder('response')
      .select('response.unitid', 'unitId')
      .addSelect('freshness.version', 'version')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .innerJoin(
        CodingUnitFreshness,
        'freshness',
        `freshness.workspace_id = :workspaceId
          AND freshness.unit_id = response.unitid
          AND freshness.version IN (:...versions)`,
        { workspaceId, versions: autoCodingVersions }
      )
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status IN (:...codedStatuses)', { codedStatuses: [1, 2, 3] })
      .andWhere('response.is_autocoder_generated IS NOT TRUE')
      .groupBy('response.unitid')
      .addGroupBy('freshness.version');

    const scopedUnitNames = this.uniqueStrings(unitNames || []);
    if (scopedUnitNames.length > 0) {
      query.andWhere('unit.name IN (:...unitNames)', { unitNames: scopedUnitNames });
    }

    const scopedVariableIds = this.uniqueStrings(variableIds || []);
    if (scopedVariableIds.length > 0) {
      query.andWhere('response.variableid IN (:...variableIds)', {
        variableIds: scopedVariableIds
      });
    }

    await this.applyWorkspaceExclusions(workspaceId, query);

    const rows = await query.getRawMany<{
      unitId: number | string;
      version: CodingFreshnessVersion;
    }>();
    const resetUnitIdsByVersion: ResetFreshnessUnitMap = {};

    rows.forEach(row => {
      const unitId = Number(row.unitId);
      if (!Number.isInteger(unitId) || unitId <= 0 || !autoCodingVersionSet.has(row.version)) {
        return;
      }

      resetUnitIdsByVersion[row.version] = [
        ...(resetUnitIdsByVersion[row.version] || []),
        unitId
      ];
    });

    await this.markVersionsPendingAfterReset(workspaceId, resetUnitIdsByVersion);
  }

  async clearVersionsAfterReset(
    workspaceId: number,
    versions: CodingFreshnessVersion[],
    unitNames?: string[],
    variableIds?: string[]
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

    const scopedUnitNames = this.uniqueStrings(unitNames || []);
    const scopedVariableIds = this.uniqueStrings(variableIds || []);
    if (scopedUnitNames.length > 0 || scopedVariableIds.length > 0) {
      const unitQuery = this.connection
        .createQueryBuilder()
        .select('DISTINCT unit.id', 'id')
        .from('unit', 'unit')
        .innerJoin('booklet', 'booklet', 'booklet.id = unit.bookletid')
        .innerJoin('persons', 'person', 'person.id = booklet.personid')
        .where('person.workspace_id = :workspaceId', { workspaceId });

      if (scopedUnitNames.length > 0) {
        unitQuery.andWhere('unit.name IN (:...unitNames)', { unitNames: scopedUnitNames });
      }

      if (scopedVariableIds.length > 0) {
        unitQuery
          .innerJoin('response', 'response', 'response.unitid = unit.id')
          .andWhere('response.variableid IN (:...variableIds)', {
            variableIds: scopedVariableIds
          });
      }

      const unitIds = await unitQuery.getRawMany<{ id: number | string }>();
      const ids = this.uniquePositiveIds(unitIds.map(row => Number(row.id)));
      if (ids.length === 0) {
        return;
      }
      query.andWhere('unit_id IN (:...unitIds)', { unitIds: ids });
    }

    await query.execute();
  }

  async markCodingJobsStaleForUnitIds(
    workspaceId: number,
    unitIds: number[],
    reason: CodingFreshnessReason,
    status: Exclude<CodingJobFreshnessStatus, 'current'> = 'stale_source',
    manager?: EntityManager
  ): Promise<void> {
    const ids = this.uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return;
    }

    const queryRunner = manager ?? this.connection;
    await queryRunner.query(
      `
        WITH affected_jobs AS (
          SELECT
            cju.coding_job_id,
            COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name)) AS affected_units,
            COUNT(DISTINCT cju.response_id) AS affected_responses
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          INNER JOIN response resp ON resp.id = cju.response_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND resp.unitid = ANY($2::int[])
          GROUP BY cju.coding_job_id
        )
        UPDATE coding_job cj
        SET freshness_status = CASE
              WHEN $3 = 'stale_source' OR cj.freshness_status = 'stale_source'
                THEN 'stale_source'
              WHEN cj.freshness_status = 'review_required' OR $3 = 'review_required'
                THEN 'review_required'
              ELSE $3
            END,
            freshness_reason = $4,
            freshness_updated_at = now(),
            freshness_affected_units = GREATEST(
              COALESCE(cj.freshness_affected_units, 0),
              affected_jobs.affected_units::int
            ),
            freshness_affected_responses = GREATEST(
              COALESCE(cj.freshness_affected_responses, 0),
              affected_jobs.affected_responses::int
            ),
            updated_at = now()
        FROM affected_jobs
        WHERE cj.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids, status, reason]
    );
  }

  async markCodingJobsStaleForResponseIds(
    workspaceId: number,
    responseIds: number[],
    reason: CodingFreshnessReason,
    status: Exclude<CodingJobFreshnessStatus, 'current'> = 'stale_source',
    manager?: EntityManager
  ): Promise<void> {
    const ids = this.uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return;
    }

    const queryRunner = manager ?? this.connection;
    await queryRunner.query(
      `
        WITH affected_jobs AS (
          SELECT
            cju.coding_job_id,
            COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name)) AS affected_units,
            COUNT(DISTINCT cju.response_id) AS affected_responses
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND cju.response_id = ANY($2::int[])
          GROUP BY cju.coding_job_id
        )
        UPDATE coding_job cj
        SET freshness_status = CASE
              WHEN $3 = 'stale_source' OR cj.freshness_status = 'stale_source'
                THEN 'stale_source'
              WHEN cj.freshness_status = 'review_required' OR $3 = 'review_required'
                THEN 'review_required'
              ELSE $3
            END,
            freshness_reason = $4,
            freshness_updated_at = now(),
            freshness_affected_units = GREATEST(
              COALESCE(cj.freshness_affected_units, 0),
              affected_jobs.affected_units::int
            ),
            freshness_affected_responses = GREATEST(
              COALESCE(cj.freshness_affected_responses, 0),
              affected_jobs.affected_responses::int
            ),
            updated_at = now()
        FROM affected_jobs
        WHERE cj.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids, status, reason]
    );
  }

  async markAppliedCodingJobsResultsClearedForUnitIds(
    workspaceId: number,
    unitIds: number[],
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    manager?: EntityManager
  ): Promise<void> {
    const ids = this.uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return;
    }

    await this.markAppliedCodingJobsResultsCleared(
      workspaceId,
      'unit',
      ids,
      reason,
      status,
      manager
    );
  }

  async markAppliedCodingJobsResultsClearedForResponseIds(
    workspaceId: number,
    responseIds: number[],
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    manager?: EntityManager
  ): Promise<void> {
    const ids = this.uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return;
    }

    await this.markAppliedCodingJobsResultsCleared(
      workspaceId,
      'response',
      ids,
      reason,
      status,
      manager
    );
  }

  async reconcileAppliedManualCodingJobs(
    workspaceId: number,
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    options: ReconcileAppliedManualCodingJobsOptions = {}
  ): Promise<number> {
    const queryRunner = options.manager ?? this.connection;
    const params: unknown[] = [workspaceId, status, reason];
    const scopeConditions: string[] = [];

    const unitNames = this.uniqueStrings(options.unitNames || []);
    if (unitNames.length > 0) {
      params.push(unitNames);
      scopeConditions.push(`AND cju.unit_name = ANY($${params.length}::text[])`);
    }

    const variableIds = this.uniqueStrings(options.variableIds || []);
    if (variableIds.length > 0) {
      params.push(variableIds);
      scopeConditions.push(`AND cju.variable_id = ANY($${params.length}::text[])`);
    }

    const missingManualResultCondition = `
      resp.id IS NULL OR (
        resp.status_v2 IS NULL
        AND resp.code_v2 IS NULL
        AND resp.score_v2 IS NULL
      )
    `;

    const rows = await queryRunner.query(
      `
        WITH affected_jobs AS (
          SELECT
            cju.coding_job_id,
            COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name))
              FILTER (WHERE ${missingManualResultCondition}) AS affected_units,
            COUNT(DISTINCT cju.response_id)
              FILTER (WHERE ${missingManualResultCondition}) AS affected_responses
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          LEFT JOIN response resp ON resp.id = cju.response_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND cj.status = 'results_applied'
            ${scopeConditions.join('\n            ')}
          GROUP BY cju.coding_job_id
          HAVING COUNT(*) FILTER (WHERE ${missingManualResultCondition}) > 0
        )
        UPDATE coding_job cj
        SET status = 'completed',
            freshness_status = CASE
              WHEN $2 = 'current' AND COALESCE(cj.freshness_status, 'current') = 'stale_source'
                THEN 'stale_source'
              ELSE $2
            END,
            freshness_reason = CASE
              WHEN $2 = 'current' AND COALESCE(cj.freshness_status, 'current') = 'stale_source'
                THEN cj.freshness_reason
              WHEN $2 = 'current'
                THEN NULL
              ELSE $3
            END,
            freshness_updated_at = now(),
            freshness_affected_units = CASE
              WHEN $2 = 'current' AND COALESCE(cj.freshness_status, 'current') <> 'stale_source'
                THEN 0
              ELSE GREATEST(
                COALESCE(cj.freshness_affected_units, 0),
                affected_jobs.affected_units::int
              )
            END,
            freshness_affected_responses = CASE
              WHEN $2 = 'current' AND COALESCE(cj.freshness_status, 'current') <> 'stale_source'
                THEN 0
              ELSE GREATEST(
                COALESCE(cj.freshness_affected_responses, 0),
                affected_jobs.affected_responses::int
              )
            END,
            updated_at = now()
        FROM affected_jobs
        WHERE cj.id = affected_jobs.coding_job_id
        RETURNING cj.id
      `,
      params
    );

    const reconciledCount = Array.isArray(rows) ? rows.length : 0;
    if (reconciledCount > 0) {
      this.logger.log(
        `Reconciled ${reconciledCount} applied manual coding jobs in workspace ${workspaceId}`
      );
    }

    return reconciledCount;
  }

  private async markCodingJobsCurrent(
    workspaceId: number,
    codingJobIds: number[],
    manager?: EntityManager
  ): Promise<void> {
    const ids = this.uniquePositiveIds(codingJobIds);
    if (ids.length === 0) {
      return;
    }

    const queryRunner = manager ?? this.connection;
    await queryRunner.query(
      `
        UPDATE coding_job
        SET freshness_status = 'current',
            freshness_reason = NULL,
            freshness_updated_at = now(),
            freshness_affected_units = 0,
            freshness_affected_responses = 0,
            updated_at = now()
        WHERE workspace_id = $1
          AND id = ANY($2::int[])
          AND training_id IS NULL
          AND COALESCE(freshness_status, 'current') <> 'stale_source'
      `,
      [workspaceId, ids]
    );
  }

  private async markAppliedCodingJobsResultsCleared(
    workspaceId: number,
    scope: 'unit' | 'response',
    ids: number[],
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    manager?: EntityManager
  ): Promise<void> {
    const queryRunner = manager ?? this.connection;
    const scopeCondition = scope === 'unit' ?
      'resp.unitid = ANY($2::int[])' :
      'cju.response_id = ANY($2::int[])';

    await queryRunner.query(
      `
        WITH affected_jobs AS (
          SELECT
            cju.coding_job_id,
            COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name)) AS affected_units,
            COUNT(DISTINCT cju.response_id) AS affected_responses
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          LEFT JOIN response resp ON resp.id = cju.response_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND cj.status = 'results_applied'
            AND ${scopeCondition}
          GROUP BY cju.coding_job_id
        )
        UPDATE coding_job cj
        SET status = 'completed',
            freshness_status = CASE
              WHEN $3 = 'current' AND COALESCE(cj.freshness_status, 'current') = 'stale_source'
                THEN 'stale_source'
              ELSE $3
            END,
            freshness_reason = CASE
              WHEN $3 = 'current' AND COALESCE(cj.freshness_status, 'current') = 'stale_source'
                THEN cj.freshness_reason
              WHEN $3 = 'current'
                THEN NULL
              ELSE $4
            END,
            freshness_updated_at = now(),
            freshness_affected_units = CASE
              WHEN $3 = 'current' AND COALESCE(cj.freshness_status, 'current') <> 'stale_source'
                THEN 0
              ELSE GREATEST(
                COALESCE(cj.freshness_affected_units, 0),
                affected_jobs.affected_units::int
              )
            END,
            freshness_affected_responses = CASE
              WHEN $3 = 'current' AND COALESCE(cj.freshness_status, 'current') <> 'stale_source'
                THEN 0
              ELSE GREATEST(
                COALESCE(cj.freshness_affected_responses, 0),
                affected_jobs.affected_responses::int
              )
            END,
            updated_at = now()
        FROM affected_jobs
        WHERE cj.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids, status, reason]
    );
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values
      .map(value => value?.trim())
      .filter((value): value is string => Boolean(value))));
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
    this.uniqueStrings(values).forEach(value => {
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

  private async getUnitIdsByCodingSchemeRefs(
    workspaceId: number,
    codingSchemeRefs: string[]
  ): Promise<number[]> {
    const schemeRefCandidates =
      this.getCodingSchemeRefCandidates(codingSchemeRefs);
    if (schemeRefCandidates.length === 0) {
      return [];
    }

    const rows = await this.connection.query(
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

    const indexedUnitIds = this.uniquePositiveIds(rows.map(row => Number(row.id)));
    if (!await this.hasLegacyUnitCodingSchemeRefs(workspaceId)) {
      return indexedUnitIds;
    }

    const legacyRows = await this.connection.query(
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

    return this.uniquePositiveIds([
      ...indexedUnitIds,
      ...legacyRows.map(row => Number(row.id))
    ]);
  }

  private async hasLegacyUnitCodingSchemeRefs(workspaceId: number): Promise<boolean> {
    const rows = await this.connection.query(
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

  private async markCodingJobsStaleForAddedUnitIds(
    workspaceId: number,
    unitIds: number[],
    reason: Extract<CodingFreshnessReason, 'RESULT_ADDED'>,
    status: Exclude<CodingJobFreshnessStatus, 'current'> = 'stale_source'
  ): Promise<void> {
    const ids = this.uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return;
    }

    await this.connection.query(
      `
        WITH added_responses AS (
          SELECT
            response.id AS response_id,
            unit.name AS unit_name,
            response.variableid AS variable_id,
            CONCAT_WS('|', person.login, COALESCE(bookletinfo.name, ''), unit.name) AS unit_key
          FROM response
          INNER JOIN unit ON unit.id = response.unitid
          INNER JOIN booklet ON booklet.id = unit.bookletid
          LEFT JOIN bookletinfo ON bookletinfo.id = booklet.infoid
          INNER JOIN persons person ON person.id = booklet.personid
          WHERE person.workspace_id = $1
            AND person.consider = true
            AND response.unitid = ANY($2::int[])
            AND response.is_autocoder_generated IS NOT TRUE
        ),
        matched_job_responses AS (
          SELECT
            coding_job.id AS coding_job_id,
            added_responses.unit_key,
            added_responses.response_id
          FROM added_responses
          INNER JOIN coding_job_variable
            ON coding_job_variable.unit_name = added_responses.unit_name
            AND coding_job_variable.variable_id = added_responses.variable_id
          INNER JOIN coding_job
            ON coding_job.id = coding_job_variable.coding_job_id
          WHERE coding_job.workspace_id = $1
            AND coding_job.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('coding_job')}
          UNION
          SELECT
            coding_job.id AS coding_job_id,
            added_responses.unit_key,
            added_responses.response_id
          FROM added_responses
          INNER JOIN variable_bundle
            ON variable_bundle.workspace_id = $1
            AND variable_bundle.variables @> jsonb_build_array(
              jsonb_build_object(
                'unitName', added_responses.unit_name,
                'variableId', added_responses.variable_id
              )
            )
          INNER JOIN coding_job_variable_bundle
            ON coding_job_variable_bundle.variable_bundle_id = variable_bundle.id
          INNER JOIN coding_job
            ON coding_job.id = coding_job_variable_bundle.coding_job_id
          WHERE coding_job.workspace_id = $1
            AND coding_job.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('coding_job')}
        ),
        affected_jobs AS (
          SELECT
            coding_job_id,
            COUNT(DISTINCT unit_key) AS affected_units,
            COUNT(DISTINCT response_id) AS affected_responses
          FROM matched_job_responses
          GROUP BY coding_job_id
        )
        UPDATE coding_job
        SET freshness_status = CASE
              WHEN $3 = 'stale_source' OR coding_job.freshness_status = 'stale_source'
                THEN 'stale_source'
              WHEN coding_job.freshness_status = 'review_required' OR $3 = 'review_required'
                THEN 'review_required'
              ELSE $3
            END,
            freshness_reason = $4,
            freshness_updated_at = now(),
            freshness_affected_units = GREATEST(
              COALESCE(coding_job.freshness_affected_units, 0),
              affected_jobs.affected_units::int
            ),
            freshness_affected_responses = GREATEST(
              COALESCE(coding_job.freshness_affected_responses, 0),
              affected_jobs.affected_responses::int
            ),
            updated_at = now()
        FROM affected_jobs
        WHERE coding_job.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids, status, reason]
    );
  }

  private async markCodingJobsStaleForAddedResponseIds(
    workspaceId: number,
    responseIds: number[],
    reason: Extract<CodingFreshnessReason, 'RESULT_ADDED'>,
    status: Exclude<CodingJobFreshnessStatus, 'current'> = 'stale_source'
  ): Promise<void> {
    const ids = this.uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return;
    }

    await this.connection.query(
      `
        WITH added_responses AS (
          SELECT
            response.id AS response_id,
            unit.name AS unit_name,
            response.variableid AS variable_id,
            CONCAT_WS('|', person.login, COALESCE(bookletinfo.name, ''), unit.name) AS unit_key
          FROM response
          INNER JOIN unit ON unit.id = response.unitid
          INNER JOIN booklet ON booklet.id = unit.bookletid
          LEFT JOIN bookletinfo ON bookletinfo.id = booklet.infoid
          INNER JOIN persons person ON person.id = booklet.personid
          WHERE person.workspace_id = $1
            AND person.consider = true
            AND response.id = ANY($2::int[])
            AND response.is_autocoder_generated IS NOT TRUE
        ),
        matched_job_responses AS (
          SELECT
            coding_job.id AS coding_job_id,
            added_responses.unit_key,
            added_responses.response_id
          FROM added_responses
          INNER JOIN coding_job_variable
            ON coding_job_variable.unit_name = added_responses.unit_name
            AND coding_job_variable.variable_id = added_responses.variable_id
          INNER JOIN coding_job
            ON coding_job.id = coding_job_variable.coding_job_id
          WHERE coding_job.workspace_id = $1
            AND coding_job.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('coding_job')}
          UNION
          SELECT
            coding_job.id AS coding_job_id,
            added_responses.unit_key,
            added_responses.response_id
          FROM added_responses
          INNER JOIN variable_bundle
            ON variable_bundle.workspace_id = $1
            AND variable_bundle.variables @> jsonb_build_array(
              jsonb_build_object(
                'unitName', added_responses.unit_name,
                'variableId', added_responses.variable_id
              )
            )
          INNER JOIN coding_job_variable_bundle
            ON coding_job_variable_bundle.variable_bundle_id = variable_bundle.id
          INNER JOIN coding_job
            ON coding_job.id = coding_job_variable_bundle.coding_job_id
          WHERE coding_job.workspace_id = $1
            AND coding_job.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('coding_job')}
        ),
        affected_jobs AS (
          SELECT
            coding_job_id,
            COUNT(DISTINCT unit_key) AS affected_units,
            COUNT(DISTINCT response_id) AS affected_responses
          FROM matched_job_responses
          GROUP BY coding_job_id
        )
        UPDATE coding_job
        SET freshness_status = CASE
              WHEN $3 = 'stale_source' OR coding_job.freshness_status = 'stale_source'
                THEN 'stale_source'
              WHEN coding_job.freshness_status = 'review_required' OR $3 = 'review_required'
                THEN 'review_required'
              ELSE $3
            END,
            freshness_reason = $4,
            freshness_updated_at = now(),
            freshness_affected_units = GREATEST(
              COALESCE(coding_job.freshness_affected_units, 0),
              affected_jobs.affected_units::int
            ),
            freshness_affected_responses = GREATEST(
              COALESCE(coding_job.freshness_affected_responses, 0),
              affected_jobs.affected_responses::int
            ),
            updated_at = now()
        FROM affected_jobs
        WHERE coding_job.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids, status, reason]
    );
  }

  private async getUnitIdsForResponseIds(
    workspaceId: number,
    responseIds: number[],
    manager?: EntityManager
  ): Promise<number[]> {
    const ids = this.uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return [];
    }

    const responseRepository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const rows = await this.collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
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

      await this.applyWorkspaceExclusions(workspaceId, query);

      return query.getRawMany<{ unitId: number | string }>();
    });
    return this.uniquePositiveIds(rows.map(row => Number(row.unitId)));
  }

  private async getReviewRequiredUnitIds(
    workspaceId: number,
    unitIds: number[],
    excludedCodingJobIds: number[] = [],
    manager?: EntityManager
  ): Promise<number[]> {
    const ids = this.uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return [];
    }

    const excludedIds = this.uniquePositiveIds(excludedCodingJobIds);
    const queryRunner = manager ?? this.connection;
    const rows = await queryRunner.query(
      `
        SELECT DISTINCT resp.unitid AS "unitId"
        FROM coding_job_unit cju
        INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
        INNER JOIN response resp ON resp.id = cju.response_id
        WHERE cj.workspace_id = $1
          AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
          AND cj.training_id IS NULL
          AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
          AND cj.freshness_status IN ('review_required', 'stale_source')
          AND resp.unitid = ANY($2::int[])
          AND (
            cardinality($3::int[]) = 0
            OR cj.id <> ALL($3::int[])
          )
      `,
      [workspaceId, ids, excludedIds]
    ) as Array<{ unitId: number | string }>;

    return this.uniquePositiveIds(rows.map(row => Number(row.unitId)));
  }

  private async getReviewRequiredCodingJobIdsCoveredByResponseIds(
    workspaceId: number,
    responseIds: number[],
    manager?: EntityManager
  ): Promise<number[]> {
    const ids = this.uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return [];
    }

    const queryRunner = manager ?? this.connection;
    const rows = await queryRunner.query(
      `
        WITH candidate_jobs AS (
          SELECT DISTINCT cju.coding_job_id
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND cj.freshness_status = 'review_required'
            AND cju.response_id = ANY($2::int[])
        )
        SELECT cj.id AS "jobId"
        FROM coding_job cj
        INNER JOIN candidate_jobs candidate ON candidate.coding_job_id = cj.id
        INNER JOIN coding_job_unit cju ON cju.coding_job_id = cj.id
        WHERE cj.workspace_id = $1
          AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
          AND cj.training_id IS NULL
          AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
          AND cj.freshness_status = 'review_required'
        GROUP BY cj.id
        HAVING BOOL_AND(cju.response_id = ANY($2::int[]))
      `,
      [workspaceId, ids]
    ) as Array<{ jobId: number | string }>;

    return this.uniquePositiveIds(rows.map(row => Number(row.jobId)));
  }

  private countVersionExpression(version: CodingFreshnessVersion): string {
    return [
      `COUNT(DISTINCT CASE WHEN response.status_${version} IS NOT NULL`,
      `OR response.code_${version} IS NOT NULL`,
      `OR response.score_${version} IS NOT NULL`,
      'THEN response.id END)'
    ].join(' ');
  }

  private async getCurrentRevision(
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

      const rows = await this.collectChunked(ids, this.ID_QUERY_BATCH_SIZE, chunkIds => {
        const query = this.connection
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
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    await this.applyWorkspaceExclusions(workspaceId, raw);

    const result = await raw.getRawOne<{ v1: boolean; v2: boolean; v3: boolean }>();

    return {
      v1: this.toBoolean(result?.v1),
      v2: this.toBoolean(result?.v2),
      v3: this.toBoolean(result?.v3)
    };
  }

  private getAutoCodingVersionsToRefresh(
    workspacePresence: UnitCodingPresence
  ): CodingFreshnessVersion[] {
    const existingAutoCodingVersions = (['v1', 'v3'] as CodingFreshnessVersion[])
      .filter(version => workspacePresence[version]);

    return existingAutoCodingVersions.length > 0 ? existingAutoCodingVersions : ['v1'];
  }

  private async getUnitCodingPresence(
    workspaceId: number,
    unitIds: number[]
  ): Promise<Map<number, UnitCodingPresence>> {
    const ids = this.uniquePositiveIds(unitIds);
    const presenceByUnit = new Map<number, UnitCodingPresence>();
    ids.forEach(id => presenceByUnit.set(id, { v1: false, v2: false, v3: false }));
    if (ids.length === 0) {
      return presenceByUnit;
    }

    const presenceRows = await this.collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
      const query = this.responseRepository
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

      await this.applyWorkspaceExclusions(workspaceId, query);

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

  private async getImportedResponseIdsByUnit(
    workspaceId: number,
    responseIds: number[]
  ): Promise<Map<number, number[]>> {
    const ids = this.uniquePositiveIds(responseIds);
    const responseIdsByUnit = new Map<number, number[]>();
    if (ids.length === 0) {
      return responseIdsByUnit;
    }

    const rows = await this.collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
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
      responseIdsByUnit.set(unitId, this.uniquePositiveIds(unitResponseIds));
    });

    return responseIdsByUnit;
  }

  private async getResponseCountsByUnit(
    workspaceId: number,
    unitIds: number[],
    manager?: EntityManager
  ): Promise<Map<number, number>> {
    const ids = this.uniquePositiveIds(unitIds);
    const result = new Map<number, number>();
    ids.forEach(id => result.set(id, 0));
    if (ids.length === 0) {
      return result;
    }

    const responseRepository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const countRows = await this.collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
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

      await this.applyWorkspaceExclusions(workspaceId, query);

      return query.getRawMany<{ unitId: number | string; count: string }>();
    });

    countRows.forEach(row => result.set(Number(row.unitId), Number(row.count || 0)));
    return result;
  }

  private async getAutoCodingCandidateResponseCountsByUnit(
    workspaceId: number,
    unitIds: number[],
    version: CodingFreshnessVersion,
    manager?: EntityManager
  ): Promise<Map<number, number>> {
    const ids = this.uniquePositiveIds(unitIds);
    const result = new Map<number, number>();
    ids.forEach(id => result.set(id, 0));
    if (ids.length === 0) {
      return result;
    }

    const autoCoderRun = version === 'v3' ? 2 : 1;
    const responseRepository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const countRows = await this.collectChunked(ids, this.ID_QUERY_BATCH_SIZE, async chunkIds => {
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
      await this.applyWorkspaceExclusions(workspaceId, query);

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

  private async upsertRows(
    rows: FreshnessUpsert[],
    manager?: EntityManager
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const freshnessRepository = manager ?
      manager.getRepository(CodingUnitFreshness) :
      this.freshnessRepository;
    for (const chunkRows of this.chunk(rows, this.FRESHNESS_UPSERT_BATCH_SIZE)) {
      await freshnessRepository.upsert(chunkRows, [
        'workspace_id',
        'unit_id',
        'version'
      ]);
    }
    this.logger.log(`Updated coding freshness for ${rows.length} unit/version pairs.`);
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private async collectChunked<T, R>(
    items: T[],
    size: number,
    callback: (chunkItems: T[]) => Promise<R[]>
  ): Promise<R[]> {
    const results: R[] = [];
    for (const chunkItems of this.chunk(items, size)) {
      results.push(...await callback(chunkItems));
    }
    return results;
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

  private buildAutoCodingRunBlockedMessage(
    blockers: CodingFreshnessSummaryItemDto[]
  ): string {
    const descriptions = blockers
      .map(item => {
        const versionLabel = this.getFreshnessVersionLabel(item.version);
        const stateLabel = this.getFreshnessStateLabel(item.state);
        const unitLabel = item.unitCount === 1 ?
          '1 Aufgabenbearbeitung' :
          `${item.unitCount} Aufgabenbearbeitungen`;
        return `${versionLabel}: ${unitLabel} ${stateLabel}`;
      })
      .join('; ');

    return 'Der 2. Autocoder-Lauf kann nicht gestartet werden, weil der Kodierstand nicht aktuell ist. ' +
      `Offen: ${descriptions}. ` +
      'Aktualisieren Sie zuerst Auto-Coding 1 und prüfen Sie anschließend die manuelle Kodierung.';
  }

  private async getOpenManualCodingFreshnessBlocker(
    workspaceId: number
  ): Promise<CodingFreshnessSummaryItemDto | null> {
    const manualSourceStatuses = [
      statusStringToNumber('CODING_INCOMPLETE'),
      statusStringToNumber('INTENDED_INCOMPLETE')
    ].filter((status): status is number => status !== null);
    const appliedStatuses = [
      statusStringToNumber('CODING_COMPLETE'),
      statusStringToNumber('INVALID'),
      statusStringToNumber('CODING_ERROR')
    ].filter((status): status is number => status !== null);

    const query = this.responseRepository
      .createQueryBuilder('response')
      .select('COUNT(DISTINCT response.unitid)', 'affectedUnits')
      .addSelect('COUNT(DISTINCT response.id)', 'affectedResponses')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 IN (:...manualSourceStatuses)', { manualSourceStatuses })
      .andWhere(
        '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :defaultMirCode))',
        { aggregatedCode: -111, defaultMirCode: await this.getDefaultMirCode(workspaceId) }
      )
      .andWhere(new Brackets(qb => {
        qb.where('response.status_v2 IS NULL')
          .orWhere('response.status_v2 NOT IN (:...appliedStatuses)', { appliedStatuses })
          .orWhere('response.code_v2 < 0');
      }));

    await this.applyWorkspaceExclusions(workspaceId, query);

    const row = await query.getRawOne<{
      affectedUnits: number | string;
      affectedResponses: number | string;
    }>();
    const affectedResponses = Number(row?.affectedResponses || 0);
    if (affectedResponses === 0) {
      return null;
    }

    const affectedUnits = Number(row?.affectedUnits || 0);
    return {
      version: 'v2',
      state: 'MANUAL_REVIEW_REQUIRED',
      unitCount: affectedUnits,
      affectedResponseCount: affectedResponses
    };
  }

  private async getManualCodingJobFreshnessBlocker(
    workspaceId: number
  ): Promise<CodingFreshnessSummaryItemDto | null> {
    const raw = await this.connection.query(
      `
        SELECT
          COUNT(DISTINCT cj.id) AS "jobCount",
          COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name)) AS "affectedUnits",
          COUNT(DISTINCT cju.response_id) AS "affectedResponses"
        FROM coding_job cj
        LEFT JOIN coding_job_unit cju
          ON cju.coding_job_id = cj.id
          AND COALESCE(cju.workspace_id, cj.workspace_id) = cj.workspace_id
        WHERE cj.workspace_id = $1
          AND cj.training_id IS NULL
          AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
          AND cj.freshness_status IN ('review_required', 'stale_source')
      `,
      [workspaceId]
    ) as ManualJobFreshnessRow[] | undefined;

    const row = Array.isArray(raw) ? raw[0] : undefined;
    const jobCount = Number(row?.jobCount || 0);
    if (jobCount === 0) {
      return null;
    }

    const affectedUnits = Number(row?.affectedUnits || 0);
    const affectedResponses = Number(row?.affectedResponses || 0);

    return {
      version: 'v2',
      state: 'MANUAL_REVIEW_REQUIRED',
      unitCount: affectedUnits > 0 ? affectedUnits : jobCount,
      affectedResponseCount: affectedResponses
    };
  }

  private mergeFreshnessBlocker(
    blockers: CodingFreshnessSummaryItemDto[],
    blocker: CodingFreshnessSummaryItemDto
  ): void {
    const existing = blockers.find(item => (
      item.version === blocker.version &&
      item.state === blocker.state
    ));

    if (!existing) {
      blockers.push(blocker);
      return;
    }

    existing.unitCount = Math.max(existing.unitCount, blocker.unitCount);
    existing.affectedResponseCount = Math.max(
      existing.affectedResponseCount,
      blocker.affectedResponseCount
    );
  }

  private getFreshnessVersionLabel(version: CodingFreshnessVersion): string {
    if (version === 'v1') {
      return 'Auto-Coding 1';
    }

    if (version === 'v3') {
      return 'Auto-Coding 2';
    }

    return 'manuelle Kodierung';
  }

  private getFreshnessStateLabel(state: CodingFreshnessState): string {
    if (state === 'PENDING') {
      return 'zu kodieren';
    }

    if (state === 'STALE') {
      return 'zu aktualisieren';
    }

    return 'manuell zu prüfen';
  }
}
