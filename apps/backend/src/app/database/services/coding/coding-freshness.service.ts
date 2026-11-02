import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource, EntityManager, In, Repository
} from 'typeorm';
import { CodingUnitFreshness } from '../../entities/coding-unit-freshness.entity';
import { ResponseEntity } from '../../entities/response.entity';
import {
  CodingFreshnessImpactDto, CodingFreshnessSummaryItemDto, CodingFreshnessReason, CodingFreshnessScopeDto, CodingFreshnessState, CodingFreshnessSummaryDto, CodingFreshnessVersion
} from '../../../../../../../api-dto/coding/coding-freshness.dto';
import { CodingJobFreshnessStatus } from '../../../../../../../api-dto/coding/job-refresh.dto';
import {
  UnitCodingPresence, FreshnessUpsert, ResetFreshnessUnitMap, ResetFreshnessScopeOptions, MarkManualCodingCurrentOptions, ReconcileAppliedManualCodingJobsOptions
} from './coding-freshness.types';
import {
  uniquePositiveIds, uniqueStrings, uniqueVersions, chunk
} from './coding-freshness.util';
import { CodingFreshnessQueryService } from './coding-freshness-query.service';
import { CodingJobFreshnessService } from './coding-job-freshness.service';

@Injectable()
export class CodingFreshnessService {
  private readonly logger = new Logger(CodingFreshnessService.name);
  private readonly FRESHNESS_UPSERT_BATCH_SIZE = 250;

  constructor(
    @InjectRepository(CodingUnitFreshness)
    private readonly freshnessRepository: Repository<CodingUnitFreshness>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    private readonly queries: CodingFreshnessQueryService,
    private readonly jobs: CodingJobFreshnessService
  ) {}

  async getSummary(workspaceId: number): Promise<CodingFreshnessSummaryDto> {
    return this.queries.getSummary(workspaceId);
  }

  async getScope(
    workspaceId: number,
    versions: CodingFreshnessVersion[] = ['v1', 'v2', 'v3'],
    states: CodingFreshnessState[] = ['PENDING', 'STALE', 'MANUAL_REVIEW_REQUIRED']
  ): Promise<CodingFreshnessScopeDto> {
    return this.queries.getScope(workspaceId, versions, states);
  }

  async getDeleteImpactForUnitIds(
    workspaceId: number,
    unitIds: number[]
  ): Promise<CodingFreshnessImpactDto> {
    return this.queries.getDeleteImpactForUnitIds(workspaceId, unitIds);
  }

  async isRevisionCurrent(
    workspaceId: number,
    expectedRevision: number | null | undefined,
    manager?: EntityManager
  ): Promise<boolean> {
    return this.queries.isRevisionCurrent(workspaceId, expectedRevision, manager);
  }

  async assertAutoCodingRunCanStart(
    workspaceId: number,
    autoCoderRun: number,
    additionalBlockers: CodingFreshnessSummaryItemDto[] = []
  ): Promise<void> {
    if (autoCoderRun !== 2) {
      return;
    }

    const workspacePresence = await this.queries.getWorkspaceCodingPresence(workspaceId);
    if (!workspacePresence.v1) {
      throw new BadRequestException(
        'Der 2. Autocoder-Lauf kann nicht gestartet werden, weil Auto-Coding 1 noch nicht ausgeführt wurde.'
      );
    }

    const blockers = await this.getAutoCodingRunBlockers(workspaceId, autoCoderRun);
    additionalBlockers.forEach(blocker => this.mergeFreshnessBlocker(blockers, blocker));
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

    const summary = await this.queries.getSummary(workspaceId);
    const blockers = summary.items.filter(item => (
      item.state !== 'CURRENT' &&
      item.unitCount > 0 &&
      (
        item.version === 'v1' && (item.state === 'PENDING' || item.state === 'STALE')
      )
    ));
    const manualJobBlocker = await this.jobs.getManualCodingJobFreshnessBlocker(workspaceId);

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
    const ids = await this.queries.filterIncludedUnitIds(
      workspaceId,
      uniquePositiveIds(unitIds)
    );
    if (ids.length === 0) {
      return;
    }

    const revision = await this.incrementRevision(workspaceId);
    const responseCounts = await this.queries.getResponseCountsByUnit(workspaceId, ids);
    const workspacePresence = await this.queries.getWorkspaceCodingPresence(workspaceId);
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
    await this.jobs.markCodingJobsStaleForUnitIds(
      workspaceId,
      ids,
      'RESULT_ADDED',
      'stale_source'
    );
    await this.jobs.markCodingJobsStaleForAddedUnitIds(
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
    const responseIdsByUnit = await this.queries.getImportedResponseIdsByUnit(
      workspaceId,
      responseIds
    );
    const unitIds = Array.from(responseIdsByUnit.keys());
    if (unitIds.length === 0) {
      return;
    }

    const revision = await this.incrementRevision(workspaceId);
    const workspacePresence = await this.queries.getWorkspaceCodingPresence(workspaceId);
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
    await this.jobs.markCodingJobsStaleForAddedResponseIds(
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
    const ids = await this.queries.filterIncludedUnitIds(
      workspaceId,
      uniquePositiveIds(unitIds)
    );
    if (ids.length === 0) {
      return;
    }

    const revision = await this.incrementRevision(workspaceId);
    const workspacePresence = await this.queries.getWorkspaceCodingPresence(workspaceId);
    const unitPresence = await this.queries.getUnitCodingPresence(workspaceId, ids);
    const manualReviewUnitIds = ids.filter(unitId => unitPresence.get(unitId)?.v2);
    const manualResponseCounts = manualReviewUnitIds.length > 0 ?
      await this.queries.getResponseCountsByUnit(workspaceId, manualReviewUnitIds) :
      new Map<number, number>();
    const autoCodingVersionsToRefresh = this.getAutoCodingVersionsToRefresh(workspacePresence);
    const autoCodingResponseCountsByVersion = new Map<CodingFreshnessVersion, Map<number, number>>();
    const rows: FreshnessUpsert[] = [];

    for (const version of autoCodingVersionsToRefresh) {
      autoCodingResponseCountsByVersion.set(
        version,
        await this.queries.getAutoCodingCandidateResponseCountsByUnit(workspaceId, ids, version)
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
    await this.jobs.markCodingJobsStaleForUnitIds(
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
    },
    manager?: EntityManager
  ): Promise<void> {
    const autoCodingUnitIds = await this.queries.getUnitIdsByCodingSchemeRefs(
      workspaceId,
      scope.autoCodingSchemeRefs || [],
      manager
    );
    const manualCodingUnitIds = await this.queries.getUnitIdsByCodingSchemeRefs(
      workspaceId,
      [
        ...(scope.manualCodingSchemeRefs || []),
        ...(scope.autoCodingSchemeRefs || [])
      ],
      manager
    );
    const allUnitIds = await this.queries.filterIncludedUnitIds(
      workspaceId,
      uniquePositiveIds([
        ...autoCodingUnitIds,
        ...manualCodingUnitIds
      ]),
      manager
    );
    if (allUnitIds.length === 0) {
      return;
    }

    const includedUnitIdSet = new Set(allUnitIds);
    const includedAutoCodingUnitIds = autoCodingUnitIds
      .filter(unitId => includedUnitIdSet.has(unitId));
    const includedManualCodingUnitIds = manualCodingUnitIds
      .filter(unitId => includedUnitIdSet.has(unitId));

    const revision = await this.incrementRevision(workspaceId, manager);
    const responseCounts = await this.queries.getResponseCountsByUnit(
      workspaceId,
      allUnitIds,
      manager
    );
    const workspacePresence = await this.queries.getWorkspaceCodingPresence(
      workspaceId,
      manager
    );
    const unitPresence = await this.queries.getUnitCodingPresence(
      workspaceId,
      allUnitIds,
      manager
    );
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

    await this.upsertRows(rows, manager);

    if (includedAutoCodingUnitIds.length > 0) {
      await this.jobs.markCodingJobsStaleForUnitIds(
        workspaceId,
        includedAutoCodingUnitIds,
        'CODING_SCHEME_CHANGED',
        'stale_source',
        manager
      );
    }

    const includedAutoCodingUnitIdSet = new Set(includedAutoCodingUnitIds);
    const includedManualOnlyUnitIds = includedManualCodingUnitIds
      .filter(unitId => !includedAutoCodingUnitIdSet.has(unitId));
    if (includedManualOnlyUnitIds.length > 0) {
      await this.jobs.markCodingJobsStaleForUnitIds(
        workspaceId,
        includedManualOnlyUnitIds,
        'CODING_SCHEME_CHANGED',
        'review_required',
        manager
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
    const ids = uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return;
    }

    const revision = await this.queries.getCurrentRevision(workspaceId, manager);
    if (expectedSourceRevision !== undefined && revision !== Number(expectedSourceRevision)) {
      this.logger.warn(
        `Skipped marking ${version} current for workspace ${workspaceId}: ` +
        `expected revision ${expectedSourceRevision}, current revision ${revision}.`
      );
      return;
    }

    const responseCounts = await this.queries.getResponseCountsByUnit(workspaceId, ids, manager);
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
    const ids = uniquePositiveIds(responseIds);
    const codingJobIdsToClear = uniquePositiveIds([
      options.codingJobId || 0,
      ...(
        options.clearCoveredReviewJobs ?
          await this.jobs.getReviewRequiredCodingJobIdsCoveredByResponseIds(
            workspaceId,
            ids,
            options.manager
          ) :
          []
      )
    ]);

    if (ids.length === 0) {
      if (codingJobIdsToClear.length > 0) {
        await this.jobs.markCodingJobsCurrent(workspaceId, codingJobIdsToClear, options.manager);
      }
      return;
    }

    const unitIds = await this.queries.getUnitIdsForResponseIds(workspaceId, ids, options.manager);
    if (unitIds.length === 0) {
      if (codingJobIdsToClear.length > 0) {
        await this.jobs.markCodingJobsCurrent(workspaceId, codingJobIdsToClear, options.manager);
      }
      return;
    }

    const blockedUnitIds = await this.jobs.getReviewRequiredUnitIds(
      workspaceId,
      unitIds,
      codingJobIdsToClear,
      options.manager
    );
    const blockedUnitIdSet = new Set(blockedUnitIds);
    const clearableUnitIds = unitIds.filter(unitId => !blockedUnitIdSet.has(unitId));
    const freshnessRepository = options.manager ?
      options.manager.getRepository(CodingUnitFreshness) :
      this.freshnessRepository;
    const currentV3Rows = await freshnessRepository.find({
      where: {
        workspace_id: workspaceId,
        unit_id: In(unitIds),
        version: 'v3',
        state: 'CURRENT'
      },
      select: ['unit_id']
    });
    const currentV3UnitIds = uniquePositiveIds(
      currentV3Rows.map(row => Number(row.unit_id))
    );

    if (clearableUnitIds.length > 0 || currentV3UnitIds.length > 0) {
      const revision = await this.queries.getCurrentRevision(workspaceId, options.manager);
      const affectedUnitIds = uniquePositiveIds([
        ...clearableUnitIds,
        ...currentV3UnitIds
      ]);
      const responseCounts = await this.queries.getResponseCountsByUnit(
        workspaceId,
        affectedUnitIds,
        options.manager
      );
      const rows = clearableUnitIds.map(unitId => this.buildRow(
        workspaceId,
        unitId,
        'v2',
        'CURRENT',
        'MANUAL_CODING_APPLIED',
        responseCounts.get(unitId) || 0,
        revision,
        revision
      ));
      currentV3UnitIds.forEach(unitId => rows.push(this.buildRow(
        workspaceId,
        unitId,
        'v3',
        'STALE',
        'MANUAL_CODING_APPLIED',
        responseCounts.get(unitId) || 0,
        revision,
        null
      )));
      await this.upsertRows(rows, options.manager);
    }

    if (codingJobIdsToClear.length > 0) {
      await this.jobs.markCodingJobsCurrent(workspaceId, codingJobIdsToClear, options.manager);
    }
  }

  async reconcileCompletedManualCodingFreshness(
    workspaceId: number,
    expectedRevision: number
  ): Promise<number> {
    const rows = await this.connection.query(
      `
        UPDATE coding_unit_freshness
        SET state = 'CURRENT',
            reason = 'MANUAL_CODING_APPLIED',
            affected_response_count = 0,
            source_revision = $2,
            coded_revision = $2,
            updated_at = now()
        WHERE workspace_id = $1
          AND version = 'v2'
          AND state = 'MANUAL_REVIEW_REQUIRED'
          AND $2 = COALESCE((
            SELECT revision
            FROM workspace_test_results_revision
            WHERE workspace_id = $1
          ), 0)
        RETURNING id
      `,
      [workspaceId, expectedRevision]
    ) as Array<{ id: number | string }> | undefined;
    const reconciledCount = Array.isArray(rows) ? rows.length : 0;

    if (reconciledCount > 0) {
      this.logger.log(
        `Reconciled ${reconciledCount} completed manual coding freshness entries ` +
        `in workspace ${workspaceId}`
      );
    }

    return reconciledCount;
  }

  async markVersionsPendingAfterReset(
    workspaceId: number,
    resetUnitIdsByVersion: ResetFreshnessUnitMap,
    manager?: EntityManager
  ): Promise<number[]> {
    const entries = uniqueVersions(
      Object.keys(resetUnitIdsByVersion) as CodingFreshnessVersion[]
    )
      .map(version => ({
        version,
        unitIds: uniquePositiveIds(resetUnitIdsByVersion[version] || [])
      }))
      .filter(entry => entry.unitIds.length > 0);

    if (entries.length === 0) {
      return [];
    }

    const includedUnitIds = await this.queries.filterIncludedUnitIds(
      workspaceId,
      uniquePositiveIds(entries.flatMap(entry => entry.unitIds)),
      manager
    );
    if (includedUnitIds.length === 0) {
      return [];
    }

    const includedUnitIdSet = new Set(includedUnitIds);
    const revision = await this.queries.getCurrentRevision(workspaceId, manager);
    const responseCounts = await this.queries.getResponseCountsByUnit(workspaceId, includedUnitIds, manager);
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

    await this.upsertRows(rows, manager);

    const manualReviewUnitIds = uniquePositiveIds(entries
      .filter(entry => entry.version === 'v1')
      .flatMap(entry => entry.unitIds)
      .filter(unitId => includedUnitIdSet.has(unitId)));

    if (manualReviewUnitIds.length > 0) {
      await this.jobs.markCodingJobsStaleForUnitIds(
        workspaceId,
        manualReviewUnitIds,
        'RESET',
        'stale_source',
        manager
      );
    }
    return manualReviewUnitIds;
  }

  async markExistingAutoCodingVersionsPendingAfterResetScope(
    workspaceId: number,
    versions: CodingFreshnessVersion[],
    unitNames?: string[],
    variableIds?: string[],
    options: ResetFreshnessScopeOptions = {}
  ): Promise<number[]> {
    const autoCodingVersions = uniqueVersions(versions)
      .filter((version): version is Extract<CodingFreshnessVersion, 'v1' | 'v3'> => (
        version === 'v1' || version === 'v3'
      ));
    if (autoCodingVersions.length === 0) {
      return [];
    }
    const autoCodingVersionSet = new Set<CodingFreshnessVersion>(autoCodingVersions);

    const unitIds = options.unitIds === undefined ? undefined : uniquePositiveIds(options.unitIds);
    if (unitIds?.length === 0) return [];
    const responseRepository = options.manager ? options.manager.getRepository(ResponseEntity) : this.responseRepository;
    const query = responseRepository
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

    if (unitIds) {
      query.andWhere('response.unitid IN (:...unitIds)', { unitIds });
    }

    const scopedUnitNames = uniqueStrings(unitNames || []);
    if (scopedUnitNames.length > 0) {
      query.andWhere('unit.name IN (:...unitNames)', { unitNames: scopedUnitNames });
    }

    const scopedVariableIds = uniqueStrings(variableIds || []);
    if (scopedVariableIds.length > 0) {
      query.andWhere('response.variableid IN (:...variableIds)', {
        variableIds: scopedVariableIds
      });
    }

    await this.queries.applyWorkspaceExclusions(workspaceId, query, options.manager);

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

    return this.markVersionsPendingAfterReset(workspaceId, resetUnitIdsByVersion, options.manager);
  }

  async clearVersionsAfterReset(
    workspaceId: number,
    versions: CodingFreshnessVersion[],
    unitNames?: string[],
    variableIds?: string[],
    options: ResetFreshnessScopeOptions = {}
  ): Promise<void> {
    if (versions.length === 0) {
      return;
    }

    const unitIds = options.unitIds === undefined ? undefined : uniquePositiveIds(options.unitIds);
    if (unitIds?.length === 0) return;
    const freshnessRepository = options.manager ? options.manager.getRepository(CodingUnitFreshness) : this.freshnessRepository;
    const query = freshnessRepository
      .createQueryBuilder()
      .delete()
      .from(CodingUnitFreshness)
      .where('workspace_id = :workspaceId', { workspaceId })
      .andWhere('version IN (:...versions)', { versions });

    if (unitIds) {
      query.andWhere('unit_id IN (:...resetUnitIds)', { resetUnitIds: unitIds });
    }

    const scopedUnitNames = uniqueStrings(unitNames || []);
    const scopedVariableIds = uniqueStrings(variableIds || []);
    if (scopedUnitNames.length > 0 || scopedVariableIds.length > 0) {
      const unitQuery = (options.manager ?? this.connection)
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

      const unitRows = await unitQuery.getRawMany<{ id: number | string }>();
      const ids = uniquePositiveIds(unitRows.map(row => Number(row.id)));
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
    return this.jobs.markCodingJobsStaleForUnitIds(workspaceId, unitIds, reason, status, manager);
  }

  async markCodingJobsStaleForResetScope(
    workspaceId: number,
    unitIds: number[],
    responseIds: number[],
    manager: EntityManager
  ): Promise<void> {
    return this.jobs.markCodingJobsStaleForResetScope(workspaceId, unitIds, responseIds, manager);
  }

  async updateStaleCodingJobResetCountsForResponseIds(
    workspaceId: number,
    responseIds: number[],
    manager: EntityManager
  ): Promise<void> {
    return this.jobs.updateStaleCodingJobResetCountsForResponseIds(workspaceId, responseIds, manager);
  }

  async markCodingJobsStaleForResponseIds(
    workspaceId: number,
    responseIds: number[],
    reason: CodingFreshnessReason,
    status: Exclude<CodingJobFreshnessStatus, 'current'> = 'stale_source',
    manager?: EntityManager
  ): Promise<void> {
    return this.jobs.markCodingJobsStaleForResponseIds(workspaceId, responseIds, reason, status, manager);
  }

  async markAppliedCodingJobsResultsClearedForUnitIds(
    workspaceId: number,
    unitIds: number[],
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    manager?: EntityManager
  ): Promise<void> {
    return this.jobs.markAppliedCodingJobsResultsClearedForUnitIds(workspaceId, unitIds, reason, status, manager);
  }

  async markAppliedCodingJobsResultsClearedForResponseIds(
    workspaceId: number,
    responseIds: number[],
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    manager?: EntityManager
  ): Promise<void> {
    return this.jobs.markAppliedCodingJobsResultsClearedForResponseIds(workspaceId, responseIds, reason, status, manager);
  }

  async reconcileAppliedManualCodingJobs(
    workspaceId: number,
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    options: ReconcileAppliedManualCodingJobsOptions = {}
  ): Promise<number> {
    return this.jobs.reconcileAppliedManualCodingJobs(workspaceId, reason, status, options);
  }

  private async incrementRevision(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<number> {
    const queryRunner = manager ?? this.connection;
    const raw = await queryRunner.query(
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

  private getAutoCodingVersionsToRefresh(
    workspacePresence: UnitCodingPresence
  ): CodingFreshnessVersion[] {
    const existingAutoCodingVersions = (['v1', 'v3'] as CodingFreshnessVersion[])
      .filter(version => workspacePresence[version]);

    return existingAutoCodingVersions.length > 0 ? existingAutoCodingVersions : ['v1'];
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
    for (const chunkRows of chunk(rows, this.FRESHNESS_UPSERT_BATCH_SIZE)) {
      await freshnessRepository.upsert(chunkRows, [
        'workspace_id',
        'unit_id',
        'version'
      ]);
    }
    this.logger.log(`Updated coding freshness for ${rows.length} unit/version pairs.`);
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
