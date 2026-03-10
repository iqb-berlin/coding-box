import {
  Injectable, Logger, forwardRef, Inject
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingStatisticsService } from './coding-statistics.service';

@Injectable()
export class CodingVersionService {
  private readonly logger = new Logger(CodingVersionService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @Inject(forwardRef(() => CodingStatisticsService))
    private codingStatisticsService: CodingStatisticsService
  ) { }

  async resetCodingVersion(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    unitFilters?: string[],
    variableFilters?: string[],
    progressCallback?: (progress: number) => Promise<void>
  ): Promise<{
      affectedResponseCount: number;
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
      const versionsToReset: ('v1' | 'v2' | 'v3')[] = [version];

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
        baseQueryBuilder.andWhere('(response.status_v3 IS NOT NULL OR response.status_v2 IS NOT NULL OR response.status_v1 IS NOT NULL)');
      } else if (version === 'v2') {
        versionsToReset.push('v3'); // Cascade: resetting v2 also resets v3
        baseQueryBuilder.andWhere('(response.status_v3 IS NOT NULL OR response.status_v2 IS NOT NULL)');
        baseQueryBuilder.andWhere('(response.code_v2 IS NULL OR response.code_v2 != -111)');
      } else {
        baseQueryBuilder.andWhere('response.status_v3 IS NOT NULL');
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
        if (progressCallback) await progressCallback(100);
        return {
          affectedResponseCount: 0,
          cascadeResetVersions,
          message: `No responses found matching the filters for version ${version}`
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
          .select(['response.id'])
          .orderBy('response.id', 'ASC')
          .skip(offset)
          .take(batchSize);

        const batchResponses = await batchQueryBuilder.getMany();
        if (batchResponses.length === 0) {
          break;
        }

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

      // Invalidate statistics cache for all affected versions
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

      if (progressCallback) await progressCallback(100);

      return {
        affectedResponseCount,
        cascadeResetVersions,
        message: `Successfully reset ${affectedResponseCount} responses for version ${version}${messageSuffix}`
      };
    } catch (error) {
      this.logger.error(
        `Error resetting coding version ${version} in workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to reset coding version: ${error.message}`);
    }
  }
}
