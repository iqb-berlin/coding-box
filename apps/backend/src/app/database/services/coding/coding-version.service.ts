import {
  Injectable, Logger, forwardRef, Inject, Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingFreshnessService } from './coding-freshness.service';
import { CodingFreshnessVersion } from '../../../../../../../api-dto/coding/coding-freshness.dto';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingValidationService } from './coding-validation.service';
import { JournalService, RecordAuditJournalEventInput } from '../shared/journal.service';
import { lockWorkspaceTestResultsMutationInTransaction } from '../shared/workspace-test-results-lock.util';

type ResetCodingVersion = 'v1' | 'v2' | 'v3';
type ResetUnitIdsByVersion = Record<ResetCodingVersion, Set<number>>;
type ResetResponseIdsByVersion = Record<ResetCodingVersion, Set<number>>;
type ResetAuditContext = Pick<RecordAuditJournalEventInput, 'actorUserId' | 'jobId'>;
type ResetCodingJobScope = { unitIds: number[]; responseIds: number[] };

@Injectable()
export class CodingVersionService {
  private readonly logger = new Logger(CodingVersionService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @Inject(forwardRef(() => CodingStatisticsService))
    private codingStatisticsService: CodingStatisticsService,
    private codingAnalysisService: CodingAnalysisService,
    private codingValidationService: CodingValidationService,
    @Optional()
    private codingFreshnessService?: CodingFreshnessService
  ) { }

  async resetCodingVersion(
    workspaceId: number,
    version: ResetCodingVersion,
    unitFilters?: string[],
    variableFilters?: string[],
    progressCallback?: (progress: number) => Promise<void>,
    audit: ResetAuditContext = {}
  ): Promise<{
      affectedResponseCount: number;
      deletedGeneratedResponseCount: number;
      cascadeResetVersions: ('v2' | 'v3')[];
      message: string;
    }> {
    let committedMutation = false;
    const onCommitted = () => { committedMutation = true; };
    try {
      this.logger.log(
        `Starting reset for version ${version} in workspace ${workspaceId}, filters: units=${unitFilters?.join(
          ','
        )}, variables=${variableFilters?.join(',')}`
      );

      if (progressCallback) await progressCallback(0);

      // Determine which versions to reset and build the appropriate WHERE clause
      const versionsToReset: ResetCodingVersion[] = [version];

      const baseQueryBuilder = this.responseRepository
        .createQueryBuilder('response')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        // Only reset responses that are counted in "total responses" statistic:
        // 1. Status must be one of: NOT_REACHED (1), DISPLAYED (2), VALUE_CHANGED (3)
        .andWhere('response.status IN (:...codedStatuses)', { codedStatuses: [1, 2, 3] });

      if (version === 'v1') {
        versionsToReset.push('v2', 'v3'); // Cascade: resetting v1 also resets v2 and v3
        baseQueryBuilder.andWhere(this.buildResetTargetCondition(['v1', 'v2', 'v3']));
      } else if (version === 'v2') {
        versionsToReset.push('v3'); // Cascade: resetting v2 also resets v3
        baseQueryBuilder.andWhere(this.buildResetTargetCondition(['v2', 'v3']));
        baseQueryBuilder.andWhere('(response.code_v2 IS NULL OR response.code_v2 != -111)');
      } else {
        baseQueryBuilder.andWhere(this.buildResetTargetCondition(['v3']));
      }

      if (unitFilters && unitFilters.length > 0) {
        baseQueryBuilder.andWhere('unit.name IN (:...unitNames)', {
          unitNames: unitFilters
        });
      }

      if (variableFilters && variableFilters.length > 0) {
        baseQueryBuilder.andWhere('response.variableid IN (:...variableIds)', {
          variableIds: variableFilters
        });
      }

      if (progressCallback) await progressCallback(5);

      const countQueryBuilder = baseQueryBuilder.clone();
      const affectedResponseCount = await countQueryBuilder.getCount();

      if (progressCallback) await progressCallback(10);

      const cascadeResetVersions: ('v2' | 'v3')[] = [];
      let messageSuffix = '';

      if (version === 'v1') {
        cascadeResetVersions.push('v2', 'v3');
        messageSuffix = ' and v2, v3 (cascade)';
      } else if (version === 'v2') {
        cascadeResetVersions.push('v3');
        messageSuffix = ' and v3 (cascade)';
      }

      if (affectedResponseCount === 0) {
        this.logger.log(`No responses found to reset for version ${version}`);
        const deletedGeneratedResponseCount =
          await this.deleteEmptyAutocoderGeneratedResponses(
            workspaceId,
            unitFilters,
            variableFilters,
            version,
            audit,
            onCommitted
          );
        await this.finalizeResetFreshness(
          workspaceId,
          version,
          unitFilters,
          variableFilters
        );
        await this.invalidateCodingMutationCaches(workspaceId, version);
        if (progressCallback) await progressCallback(100);
        return {
          affectedResponseCount: 0,
          deletedGeneratedResponseCount,
          cascadeResetVersions,
          message: deletedGeneratedResponseCount > 0 ?
            `No responses found matching the filters for version ${version}; removed ${deletedGeneratedResponseCount} generated response rows` :
            `No responses found matching the filters for version ${version}`
        };
      }

      const updateObj: Record<string, null> = {};
      versionsToReset.forEach(v => {
        updateObj[`status_${v}`] = null;
        updateObj[`code_${v}`] = null;
        updateObj[`score_${v}`] = null;
      });

      const batchSize = 5000;
      const offset = 0;
      let processedCount = 0;
      let committedJobScope: ResetCodingJobScope = { unitIds: [], responseIds: [] };

      for (; ;) {
        const previousJobScope = committedJobScope;
        const batch = await this.responseRepository.manager.transaction(async manager => {
          await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
          const batchResponses = await baseQueryBuilder
            .clone()
            .setQueryRunner(manager.queryRunner)
            .select([
              'response.id',
              'response.unitid',
              ...this.getVersionCodingColumns(versionsToReset)
            ])
            .orderBy('response.id', 'ASC')
            .skip(offset)
            .take(batchSize)
            .getMany();
          if (batchResponses.length === 0) return null;

          const batchIds = batchResponses.map(r => r.id);
          const result = await manager.getRepository(ResponseEntity).update({ id: In(batchIds) }, updateObj);
          const jobScope = await this.updateResetBatchFreshness(
            workspaceId, version, versionsToReset, batchResponses, manager, previousJobScope
          );
          await this.recordResetBatch(manager, workspaceId, version, audit, {
            phase: 'reset', affectedResponseCount: result.affected ?? batchIds.length, cascadeResetVersions
          });
          return { responseCount: batchResponses.length, jobScope };
        });
        if (!batch) break;
        committedJobScope = batch.jobScope;
        onCommitted();

        if (progressCallback) {
          processedCount += batch.responseCount;
          // Progress: 10% (counting) to 90% (batches done), leaving 10% for cache invalidation
          const batchProgress = Math.min(
            Math.floor(10 + (processedCount / affectedResponseCount) * 80),
            90
          );
          await progressCallback(batchProgress);
        }
      }

      this.logger.log(
        `Reset successful: ${affectedResponseCount} responses cleared for version(s) ${versionsToReset.join(
          ', '
        )}`
      );

      const deletedGeneratedResponseCount =
        await this.deleteEmptyAutocoderGeneratedResponses(
          workspaceId,
          unitFilters,
          variableFilters,
          version,
          audit,
          onCommitted
        );

      if (deletedGeneratedResponseCount > 0) {
        this.logger.log(
          `Deleted ${deletedGeneratedResponseCount} empty autocoder-generated responses after reset`
        );
      }

      // Invalidate caches for all affected coding views
      await this.finalizeResetFreshness(
        workspaceId,
        version,
        unitFilters,
        variableFilters
      );
      await this.invalidateCodingMutationCaches(workspaceId, version);

      if (progressCallback) await progressCallback(100);

      return {
        affectedResponseCount,
        deletedGeneratedResponseCount,
        cascadeResetVersions,
        message: deletedGeneratedResponseCount > 0 ?
          `Successfully reset ${affectedResponseCount} responses for version ${version}${messageSuffix} and removed ${deletedGeneratedResponseCount} generated response rows` :
          `Successfully reset ${affectedResponseCount} responses for version ${version}${messageSuffix}`
      };
    } catch (error) {
      if (committedMutation) {
        try {
          await this.invalidateCodingMutationCaches(workspaceId, version);
        } catch (cacheError) {
          this.logger.error(`Could not invalidate caches after partial coding reset: ${cacheError.message}`);
        }
      }
      this.logger.error(
        `Error resetting coding version ${version} in workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to reset coding version: ${error.message}`);
    }
  }

  private recordResetBatch(manager: EntityManager, workspaceId: number, version: ResetCodingVersion,
                           audit: ResetAuditContext, details: Record<string, unknown>) {
    const actorType = audit.actorUserId ? 'user' : 'system';
    return JournalService.recordEventInTransaction(manager, {
      workspaceId,
      ...audit,
      actorType: audit.jobId ? 'job' : actorType,
      eventType: 'CODING_VERSION_RESET',
      entityType: 'coding',
      entityId: workspaceId,
      result: 'success',
      summary: 'Coding version reset batch committed',
      details: { version, ...details }
    });
  }

  private buildResetTargetCondition(versions: ResetCodingVersion[]): string {
    const fields = ['status', 'code', 'score'];
    const conditions = versions.flatMap(version => fields.map(
      field => `response.${field}_${version} IS NOT NULL`
    ));

    return `(${conditions.join(' OR ')})`;
  }

  private async deleteEmptyAutocoderGeneratedResponses(
    workspaceId: number,
    unitFilters?: string[],
    variableFilters?: string[],
    version: ResetCodingVersion = 'v1',
    audit: ResetAuditContext = {},
    onCommitted?: () => void
  ): Promise<number> {
    let deletedCount = 0;
    const batchSize = 5000;

    for (; ;) {
      const batch = await this.responseRepository.manager.transaction(async manager => {
        await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
        const queryBuilder = manager.getRepository(ResponseEntity)
          .createQueryBuilder('response')
          .leftJoin('response.unit', 'unit')
          .leftJoin('unit.booklet', 'booklet')
          .leftJoin('booklet.person', 'person')
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true })
          .andWhere('response.status IN (:...codedStatuses)', { codedStatuses: [1, 2, 3] })
          .andWhere('response.is_autocoder_generated = :generated', { generated: true })
          .andWhere(this.buildEmptyCodingColumnsCondition())
          .select(['response.id'])
          .orderBy('response.id', 'ASC')
          .take(batchSize);

        if (unitFilters && unitFilters.length > 0) {
          queryBuilder.andWhere('unit.name IN (:...unitNames)', { unitNames: unitFilters });
        }
        if (variableFilters && variableFilters.length > 0) {
          queryBuilder.andWhere('response.variableid IN (:...variableIds)', { variableIds: variableFilters });
        }

        const responses = await queryBuilder.getMany();
        if (responses.length === 0) return null;

        const responseIds = responses.map(response => response.id);
        await this.markAppliedCodingJobsResultsClearedBeforeGeneratedResponseDelete(workspaceId, responseIds, manager);
        const result = await manager.getRepository(ResponseEntity).delete({ id: In(responseIds) });
        await this.recordResetBatch(manager, workspaceId, version, audit, {
          phase: 'generated-response-cleanup', deletedGeneratedResponseCount: result.affected || 0
        });
        return { deletedCount: result.affected || 0 };
      });
      if (!batch) break;
      onCommitted?.();
      deletedCount += batch.deletedCount;
    }

    return deletedCount;
  }

  private buildEmptyCodingColumnsCondition(): string {
    return [
      'response.status_v1 IS NULL',
      'response.code_v1 IS NULL',
      'response.score_v1 IS NULL',
      'response.status_v2 IS NULL',
      'response.code_v2 IS NULL',
      'response.score_v2 IS NULL',
      'response.status_v3 IS NULL',
      'response.code_v3 IS NULL',
      'response.score_v3 IS NULL'
    ].join(' AND ');
  }

  private async invalidateStatisticsCaches(
    workspaceId: number,
    version: ResetCodingVersion
  ): Promise<void> {
    this.logger.log(`Invalidating statistics cache for workspace ${workspaceId}, version ${version}`);
    await this.codingStatisticsService.invalidateCache(workspaceId, version);

    if (version === 'v1') {
      // Invalidate v2 and v3 cache when v1 is reset (cascade)
      this.logger.log(`Invalidating statistics cache for workspace ${workspaceId}, version v2 and v3 (cascade)`);
      await this.codingStatisticsService.invalidateCache(workspaceId, 'v2');
      await this.codingStatisticsService.invalidateCache(workspaceId, 'v3');
    } else if (version === 'v2') {
      // Also invalidate v3 cache when v2 is reset (cascade)
      this.logger.log(`Invalidating statistics cache for workspace ${workspaceId}, version v3 (cascade)`);
      await this.codingStatisticsService.invalidateCache(workspaceId, 'v3');
    }
  }

  private async invalidateCodingMutationCaches(
    workspaceId: number,
    version: ResetCodingVersion
  ): Promise<void> {
    await this.invalidateStatisticsCaches(workspaceId, version);
    await Promise.all([
      this.codingAnalysisService.invalidateCache(workspaceId),
      this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId)
    ]);
  }

  private createResetUnitIdsByVersion(): ResetUnitIdsByVersion {
    return {
      v1: new Set<number>(),
      v2: new Set<number>(),
      v3: new Set<number>()
    };
  }

  private createResetResponseIdsByVersion(): ResetResponseIdsByVersion {
    return {
      v1: new Set<number>(),
      v2: new Set<number>(),
      v3: new Set<number>()
    };
  }

  private getVersionCodingColumns(versions: ResetCodingVersion[]): string[] {
    const fields = ['status', 'code', 'score'];
    return versions.flatMap(version => fields.map(
      field => `response.${field}_${version}`
    ));
  }

  private collectResetUnitIds(
    responses: ResponseEntity[],
    versions: ResetCodingVersion[],
    resetUnitIdsByVersion: ResetUnitIdsByVersion
  ): void {
    responses.forEach(response => {
      const unitId = Number(response.unitid);
      if (!Number.isInteger(unitId) || unitId <= 0) {
        return;
      }

      versions.forEach(version => {
        if (this.hasVersionCoding(response, version)) {
          resetUnitIdsByVersion[version].add(unitId);
        }
      });
    });
  }

  private collectResetResponseIds(
    responses: ResponseEntity[],
    versions: ResetCodingVersion[],
    resetResponseIdsByVersion: ResetResponseIdsByVersion
  ): void {
    responses.forEach(response => {
      const responseId = Number(response.id);
      if (!Number.isInteger(responseId) || responseId <= 0) {
        return;
      }

      versions.forEach(version => {
        if (this.hasVersionCoding(response, version)) {
          resetResponseIdsByVersion[version].add(responseId);
        }
      });
    });
  }

  private hasVersionCoding(response: ResponseEntity, version: ResetCodingVersion): boolean {
    const fields = ['status', 'code', 'score'];
    return fields.some(field => {
      const key = `${field}_${version}` as keyof ResponseEntity;
      return response[key] !== null && response[key] !== undefined;
    });
  }

  private async updateResetBatchFreshness(
    workspaceId: number,
    version: ResetCodingVersion,
    versionsToReset: ResetCodingVersion[],
    responses: ResponseEntity[],
    manager: EntityManager,
    committedJobScope: ResetCodingJobScope
  ): Promise<ResetCodingJobScope> {
    if (!this.codingFreshnessService) {
      return committedJobScope;
    }

    const resetUnitIdsByVersion = this.createResetUnitIdsByVersion();
    const resetResponseIdsByVersion = this.createResetResponseIdsByVersion();
    this.collectResetUnitIds(responses, versionsToReset, resetUnitIdsByVersion);
    this.collectResetResponseIds(responses, versionsToReset, resetResponseIdsByVersion);
    const unitIds = Array.from(new Set(responses.map(response => Number(response.unitid))))
      .filter(unitId => Number.isInteger(unitId) && unitId > 0);

    if (version === 'v1') {
      await this.codingFreshnessService.clearVersionsAfterReset(
        workspaceId, ['v2'], undefined, undefined, { unitIds, manager }
      );
    }
    const sourceUnitIds = await this.codingFreshnessService.markVersionsPendingAfterReset(
      workspaceId,
      this.toFreshnessResetUnitIdsByVersion(resetUnitIdsByVersion, version),
      manager
    );
    const existingSourceUnitIds = await this.codingFreshnessService.markExistingAutoCodingVersionsPendingAfterResetScope(
      workspaceId,
      version === 'v1' ? ['v1', 'v3'] : ['v3'],
      undefined,
      undefined,
      { unitIds, manager }
    );

    const manualResultResponseIds = Array.from(resetResponseIdsByVersion.v2);
    if (version !== 'v3' && manualResultResponseIds.length > 0) {
      await this.codingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds(
        workspaceId,
        manualResultResponseIds,
        'RESET',
        version === 'v1' ? 'stale_source' : 'current',
        manager
      );
    }
    if (version === 'v3') return committedJobScope;

    const jobScope = {
      unitIds: version === 'v1' ?
        Array.from(new Set([...committedJobScope.unitIds, ...sourceUnitIds, ...existingSourceUnitIds])) :
        committedJobScope.unitIds,
      responseIds: Array.from(new Set([...committedJobScope.responseIds, ...manualResultResponseIds]))
    };
    // Count the union of committed batches, including jobs already moved back to completed.
    if (version === 'v1') {
      await this.codingFreshnessService.markCodingJobsStaleForResetScope(
        workspaceId, jobScope.unitIds, jobScope.responseIds, manager
      );
    } else {
      await this.codingFreshnessService.updateStaleCodingJobResetCountsForResponseIds(
        workspaceId, jobScope.responseIds, manager
      );
    }
    return jobScope;
  }

  private async finalizeResetFreshness(
    workspaceId: number,
    version: ResetCodingVersion,
    unitFilters?: string[],
    variableFilters?: string[]
  ): Promise<void> {
    const freshnessService = this.codingFreshnessService;
    if (!freshnessService) {
      return;
    }

    await this.responseRepository.manager.transaction(async manager => {
      await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
      if (version === 'v1') {
        await freshnessService.clearVersionsAfterReset(
          workspaceId, ['v2'], unitFilters, variableFilters, { manager }
        );
      }
      await freshnessService.markExistingAutoCodingVersionsPendingAfterResetScope(
        workspaceId, version === 'v1' ? ['v1', 'v3'] : ['v3'], unitFilters, variableFilters, { manager }
      );
      if (version !== 'v3') {
        await freshnessService.reconcileAppliedManualCodingJobs(
          workspaceId, 'RESET', version === 'v1' ? 'stale_source' : 'current', {
            unitNames: unitFilters,
            variableIds: variableFilters,
            manager
          }
        );
      }
    });
  }

  private async markAppliedCodingJobsResultsClearedBeforeGeneratedResponseDelete(
    workspaceId: number,
    responseIds: number[],
    manager?: EntityManager
  ): Promise<void> {
    if (!this.codingFreshnessService || responseIds.length === 0) {
      return;
    }

    await this.codingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds(
      workspaceId,
      responseIds,
      'RESET',
      'stale_source',
      manager
    );
  }

  private toResetUnitIdsByVersion(
    resetUnitIdsByVersion: ResetUnitIdsByVersion
  ): Partial<Record<CodingFreshnessVersion, number[]>> {
    return Object.fromEntries(
      Object.entries(resetUnitIdsByVersion)
        .map(([version, unitIds]) => [version, Array.from(unitIds)])
        .filter(([, unitIds]) => (unitIds as number[]).length > 0)
    ) as Partial<Record<CodingFreshnessVersion, number[]>>;
  }

  private toFreshnessResetUnitIdsByVersion(
    resetUnitIdsByVersion: ResetUnitIdsByVersion,
    version: ResetCodingVersion
  ): Partial<Record<CodingFreshnessVersion, number[]>> {
    const resetUnitIds = this.toResetUnitIdsByVersion(resetUnitIdsByVersion);
    if (version === 'v1') {
      delete resetUnitIds.v2;
    }

    return resetUnitIds;
  }
}
