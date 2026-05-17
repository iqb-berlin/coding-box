import {
  Injectable, Logger, forwardRef, Inject, Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingFreshnessService } from './coding-freshness.service';
import { CodingFreshnessVersion } from '../../../../../../../api-dto/coding/coding-freshness.dto';

type ResetCodingVersion = 'v1' | 'v2' | 'v3';
type ResetUnitIdsByVersion = Record<ResetCodingVersion, Set<number>>;
type ResetResponseIdsByVersion = Record<ResetCodingVersion, Set<number>>;

@Injectable()
export class CodingVersionService {
  private readonly logger = new Logger(CodingVersionService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @Inject(forwardRef(() => CodingStatisticsService))
    private codingStatisticsService: CodingStatisticsService,
    @Optional()
    private codingFreshnessService?: CodingFreshnessService
  ) { }

  async resetCodingVersion(
    workspaceId: number,
    version: ResetCodingVersion,
    unitFilters?: string[],
    variableFilters?: string[],
    progressCallback?: (progress: number) => Promise<void>
  ): Promise<{
      affectedResponseCount: number;
      deletedGeneratedResponseCount: number;
      cascadeResetVersions: ('v2' | 'v3')[];
      message: string;
    }> {
    try {
      this.logger.log(
        `Starting reset for version ${version} in workspace ${workspaceId}, filters: units=${unitFilters?.join(
          ','
        )}, variables=${variableFilters?.join(',')}`
      );

      if (progressCallback) await progressCallback(0);

      // Determine which versions to reset and build the appropriate WHERE clause
      const versionsToReset: ResetCodingVersion[] = [version];
      const resetUnitIdsByVersion = this.createResetUnitIdsByVersion();
      const resetResponseIdsByVersion = this.createResetResponseIdsByVersion();

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
            variableFilters
          );
        await this.reconcileAppliedCodingJobsAfterReset(
          workspaceId,
          version,
          unitFilters,
          variableFilters
        );
        await this.invalidateStatisticsCaches(workspaceId, version);
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

      for (; ;) {
        const batchQueryBuilder = baseQueryBuilder
          .clone()
          .select([
            'response.id',
            'response.unitid',
            ...this.getVersionCodingColumns(versionsToReset)
          ])
          .orderBy('response.id', 'ASC')
          .skip(offset)
          .take(batchSize);

        const batchResponses = await batchQueryBuilder.getMany();
        if (batchResponses.length === 0) {
          break;
        }

        this.collectResetUnitIds(batchResponses, versionsToReset, resetUnitIdsByVersion);
        this.collectResetResponseIds(batchResponses, versionsToReset, resetResponseIdsByVersion);

        const batchIds = batchResponses.map(r => r.id);
        await this.responseRepository.update(
          {
            id: In(batchIds)
          },
          updateObj
        );

        if (progressCallback) {
          processedCount += batchResponses.length;
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
          variableFilters
        );

      if (deletedGeneratedResponseCount > 0) {
        this.logger.log(
          `Deleted ${deletedGeneratedResponseCount} empty autocoder-generated responses after reset`
        );
      }

      // Invalidate statistics cache for all affected versions
      await this.codingFreshnessService?.markVersionsPendingAfterReset(
        workspaceId,
        this.toResetUnitIdsByVersion(resetUnitIdsByVersion)
      );
      await this.markAppliedCodingJobsResultsClearedAfterReset(
        workspaceId,
        version,
        resetResponseIdsByVersion,
        unitFilters,
        variableFilters
      );
      await this.invalidateStatisticsCaches(workspaceId, version);

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
      this.logger.error(
        `Error resetting coding version ${version} in workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to reset coding version: ${error.message}`);
    }
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
    variableFilters?: string[]
  ): Promise<number> {
    let deletedCount = 0;
    const batchSize = 5000;

    for (; ;) {
      const queryBuilder = this.responseRepository
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
        queryBuilder.andWhere('unit.name IN (:...unitNames)', {
          unitNames: unitFilters
        });
      }

      if (variableFilters && variableFilters.length > 0) {
        queryBuilder.andWhere('response.variableid IN (:...variableIds)', {
          variableIds: variableFilters
        });
      }

      const responses = await queryBuilder.getMany();
      if (responses.length === 0) {
        break;
      }

      const responseIds = responses.map(response => response.id);
      await this.markAppliedCodingJobsResultsClearedBeforeGeneratedResponseDelete(
        workspaceId,
        responseIds
      );

      const deleteResult = await this.responseRepository.delete({
        id: In(responseIds)
      });
      deletedCount += deleteResult.affected || 0;
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

  private async markAppliedCodingJobsResultsClearedAfterReset(
    workspaceId: number,
    version: ResetCodingVersion,
    resetResponseIdsByVersion: ResetResponseIdsByVersion,
    unitFilters?: string[],
    variableFilters?: string[]
  ): Promise<void> {
    if (version === 'v3' || !this.codingFreshnessService) {
      return;
    }

    const status = version === 'v1' ? 'stale_source' : 'current';
    const manualResultResponseIds = Array.from(resetResponseIdsByVersion.v2);
    if (manualResultResponseIds.length > 0) {
      await this.codingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds(
        workspaceId,
        manualResultResponseIds,
        'RESET',
        status
      );
    }

    await this.reconcileAppliedCodingJobsAfterReset(
      workspaceId,
      version,
      unitFilters,
      variableFilters
    );
  }

  private async reconcileAppliedCodingJobsAfterReset(
    workspaceId: number,
    version: ResetCodingVersion,
    unitFilters?: string[],
    variableFilters?: string[]
  ): Promise<void> {
    if (version === 'v3' || !this.codingFreshnessService) {
      return;
    }

    await this.codingFreshnessService.reconcileAppliedManualCodingJobs(
      workspaceId,
      'RESET',
      version === 'v1' ? 'stale_source' : 'current',
      {
        unitNames: unitFilters,
        variableIds: variableFilters
      }
    );
  }

  private async markAppliedCodingJobsResultsClearedBeforeGeneratedResponseDelete(
    workspaceId: number,
    responseIds: number[]
  ): Promise<void> {
    if (!this.codingFreshnessService || responseIds.length === 0) {
      return;
    }

    await this.codingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds(
      workspaceId,
      responseIds,
      'RESET',
      'stale_source'
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
}
