import {
  Injectable
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import {
  Repository
} from 'typeorm';
import { TrainingComparisonFreshnessDto } from '../../../../../../../api-dto/coding/training-comparison-freshness.dto';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import {
  WorkspaceExclusionService,
  applyResolvedExclusionsToQuery
} from '../workspace/workspace-exclusion.service';
import { TrainingComparisonFreshnessAggregateRow, TrainingComparisonResponseFreshnessRow, TrainingDiscussionFreshnessAggregateRow } from './coder-training.types';
import { toFreshnessNumber } from './coder-training.util';

@Injectable()
export class CoderTrainingFreshnessService {
  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTraining)
    private coderTrainingRepository: Repository<CoderTraining>,
    @InjectRepository(CoderTrainingDiscussionResult)
    private coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
    private workspaceExclusionService: WorkspaceExclusionService
  ) {}

  private toFreshnessIsoString(value: Date | string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  private createTrainingComparisonVersion(payload: Record<string, unknown>): string {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')
      .slice(0, 16);
  }

  private createTrainingComparisonResponseSignature(rows: TrainingComparisonResponseFreshnessRow[]): string {
    const normalizedRows = rows
      .map(row => ({
        responseId: toFreshnessNumber(row.responseId),
        responseHash: row.responseHash ?? ''
      }))
      .sort((a, b) => a.responseId - b.responseId);

    return createHash('sha256')
      .update(JSON.stringify(normalizedRows))
      .digest('hex');
  }

  private createExclusionFreshnessSignature(exclusions: {
    globalIgnoredUnits: string[];
    ignoredBooklets: string[];
    testletIgnoredUnits: { bookletId: string; unitId: string }[];
  }): Record<string, unknown> {
    return {
      globalIgnoredUnits: [...exclusions.globalIgnoredUnits].sort(),
      ignoredBooklets: [...exclusions.ignoredBooklets].sort(),
      testletIgnoredUnits: [...exclusions.testletIgnoredUnits]
        .map(item => `${item.bookletId}:${item.unitId}`)
        .sort()
    };
  }

  async getWithinTrainingComparisonFreshness(
    workspaceId: number,
    trainingId: number
  ): Promise<TrainingComparisonFreshnessDto> {
    const training = await this.coderTrainingRepository.findOne({
      where: {
        workspace_id: workspaceId,
        id: trainingId
      }
    });

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const jobs = training ?
      await this.codingJobRepository.find({
        where: {
          workspace_id: workspaceId,
          training_id: trainingId
        },
        order: { id: 'ASC' }
      }) :
      [];

    let unitAggregate: TrainingComparisonFreshnessAggregateRow = {
      unitCount: 0,
      responseCount: 0,
      latestUnitChange: null
    };
    let responseSignature = '';

    if (jobs.length > 0) {
      const unitQuery = this.codingJobUnitRepository
        .createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .select('COUNT(DISTINCT cju.id)', 'unitCount')
        .addSelect('COUNT(DISTINCT cju.response_id)', 'responseCount')
        .addSelect('MAX(cju.updated_at)', 'latestUnitChange')
        .where('cj.workspace_id = :workspaceId', { workspaceId })
        .andWhere('cj.training_id = :trainingId', { trainingId });

      applyResolvedExclusionsToQuery(unitQuery, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name',
        parameterPrefix: 'withinTrainingFreshness'
      });

      unitAggregate = await unitQuery.getRawOne<TrainingComparisonFreshnessAggregateRow>() ?? unitAggregate;

      const responseSignatureQuery = this.codingJobUnitRepository
        .createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .leftJoin('cju.response', 'resp')
        .select('cju.response_id', 'responseId')
        .addSelect(`
          MD5(
            CONCAT_WS(
              CHR(31),
              CAST(cju.response_id AS text),
              COALESCE(resp.value, ''),
              COALESCE(CAST(resp.code_v1 AS text), ''),
              COALESCE(CAST(resp.score_v1 AS text), ''),
              COALESCE(CAST(resp.code_v2 AS text), ''),
              COALESCE(CAST(resp.score_v2 AS text), ''),
              COALESCE(CAST(resp.code_v3 AS text), ''),
              COALESCE(CAST(resp.score_v3 AS text), '')
            )
          )
        `, 'responseHash')
        .where('cj.workspace_id = :workspaceId', { workspaceId })
        .andWhere('cj.training_id = :trainingId', { trainingId })
        .groupBy('cju.response_id')
        .addGroupBy('resp.value')
        .addGroupBy('resp.code_v1')
        .addGroupBy('resp.score_v1')
        .addGroupBy('resp.code_v2')
        .addGroupBy('resp.score_v2')
        .addGroupBy('resp.code_v3')
        .addGroupBy('resp.score_v3')
        .orderBy('cju.response_id', 'ASC');

      applyResolvedExclusionsToQuery(responseSignatureQuery, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name',
        parameterPrefix: 'withinTrainingResponseFreshness'
      });

      responseSignature = this.createTrainingComparisonResponseSignature(
        await responseSignatureQuery.getRawMany<TrainingComparisonResponseFreshnessRow>()
      );
    }

    const discussionAggregate = (await this.coderTrainingDiscussionResultRepository
      .createQueryBuilder('ctdr')
      .select('COUNT(DISTINCT ctdr.id)', 'discussionResultCount')
      .addSelect('MAX(ctdr.updated_at)', 'latestDiscussionChange')
      .where('ctdr.workspace_id = :workspaceId', { workspaceId })
      .andWhere('ctdr.training_id = :trainingId', { trainingId })
      .getRawOne<TrainingDiscussionFreshnessAggregateRow>()) ?? {
      discussionResultCount: 0,
      latestDiscussionChange: null
    };

    const latestTrainingChange = this.toFreshnessIsoString(training?.updated_at);
    const latestJobChange = this.toFreshnessIsoString(
      jobs
        .map(job => job.updated_at)
        .filter((value): value is Date => !!value)
        .sort((a, b) => b.getTime() - a.getTime())[0]
    );
    const latestUnitChange = this.toFreshnessIsoString(unitAggregate.latestUnitChange);
    const latestDiscussionChange = this.toFreshnessIsoString(discussionAggregate.latestDiscussionChange);
    const jobCount = jobs.length;
    const unitCount = toFreshnessNumber(unitAggregate.unitCount);
    const responseCount = toFreshnessNumber(unitAggregate.responseCount);
    const discussionResultCount = toFreshnessNumber(discussionAggregate.discussionResultCount);
    const missingProfileSignature = jobs
      .map(job => (job.missings_profile_id ?? 'default').toString())
      .sort()
      .join(',');

    const versionPayload = {
      workspaceId,
      trainingId,
      trainingExists: !!training,
      jobIds: jobs.map(job => job.id),
      jobCount,
      unitCount,
      responseCount,
      discussionResultCount,
      latestTrainingChange,
      latestJobChange,
      latestUnitChange,
      latestDiscussionChange,
      responseSignature,
      missingProfileSignature,
      exclusions: this.createExclusionFreshnessSignature(exclusions)
    };

    return {
      workspaceId,
      trainingId,
      version: this.createTrainingComparisonVersion(versionPayload),
      jobCount,
      unitCount,
      responseCount,
      discussionResultCount,
      latestTrainingChange,
      latestJobChange,
      latestUnitChange,
      latestDiscussionChange
    };
  }
}
