import {
  BadRequestException,
  Injectable
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository
} from 'typeorm';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { assertCodingResourceMutation } from '../shared/coding-ownership.policy';
import { lockWorkspaceTestResultsMutationInTransaction, withWorkspaceTestResultsMutationTransaction } from '../shared/workspace-test-results-lock.util';
import {
  WorkspaceExclusionService,
  isExcludedByResolvedExclusions
} from '../workspace/workspace-exclusion.service';
import { CoderTrainingDisplayService } from './coder-training-display.service';
import {
  DEFAULT_MISSING_CODE_CONTEXT, DiscussionScoreFallback, MissingCodeDisplayContext, SaveDiscussionResultResponse, WithinTrainingCoderResult, WithinTrainingCodingRow
} from './coder-training.types';
import { CodingJobService } from './coding-job.service';
import {
  IqbStandardMissingId,
  MissingsProfilesService
} from './missings-profiles.service';

@Injectable()
export class CoderTrainingDiscussionService {
  constructor(
    @InjectRepository(CoderTraining)
    private coderTrainingRepository: Repository<CoderTraining>,
    private codingJobService: CodingJobService,
    private missingsProfilesService: MissingsProfilesService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly display: CoderTrainingDisplayService
  ) {}

  private deriveAutomaticDiscussionResult(
    coders: WithinTrainingCoderResult[]
  ): { code: number; score: number | null } | null {
    if (coders.length === 0 || coders.some(coder => coder.code === null)) {
      return null;
    }

    const firstCode = coders[0].code;
    const firstScore = coders[0].score ?? null;
    if (firstCode === null || !/^-?\d+$/.test(firstCode)) {
      return null;
    }

    const allCodersAgree = coders.every(coder => (
      coder.code === firstCode &&
      (coder.score ?? null) === firstScore
    ));

    if (!allCodersAgree) {
      return null;
    }

    return {
      code: parseInt(firstCode, 10),
      score: firstScore
    };
  }

  private async deriveAutomaticDiscussionResultForResponse(
    workspaceId: number,
    training: CoderTraining,
    responseId: number,
    coders: WithinTrainingCoderResult[],
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<{ code: number; score: number | null } | null> {
    const result = this.deriveAutomaticDiscussionResult(coders);
    if (!result || result.code >= 0) {
      return result;
    }

    return {
      code: result.code,
      score: await this.display.getMissingScoreForResponse(
        workspaceId,
        training,
        responseId,
        result.code,
        exclusions
      )
    };
  }

  async deriveAutomaticDiscussionResultForRawResponse(
    workspaceId: number,
    trainingId: number,
    responseId: number,
    jobs: Array<Pick<CodingJob, 'id' | 'missings_profile_id'>>,
    unitsByJobId: Map<number, WithinTrainingCodingRow>,
    coders: WithinTrainingCoderResult[]
  ): Promise<{ code: number; score: number | null } | null> {
    const result = this.deriveAutomaticDiscussionResult(coders);
    if (!result || result.code >= 0) {
      return result;
    }

    const responseJobs = jobs.filter(job => unitsByJobId.has(job.id));
    const resolvedProfileIds = await Promise.all(responseJobs.map(job => (
      this.missingsProfilesService.resolveMissingsProfileId(workspaceId, job.missings_profile_id)
    )));
    const profileKeys = new Set(resolvedProfileIds);
    if (profileKeys.size > 1) {
      throw new BadRequestException(`Conflicting missing profiles for response ${responseId} in training ${trainingId}`);
    }

    return {
      code: result.code,
      score: await this.display.getMissingScoreForProfile(
        workspaceId,
        resolvedProfileIds[0] ?? null,
        result.code
      )
    };
  }

  private findTrainingUnitForResponse(
    training: CoderTraining,
    responseId: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): CodingJobUnit | null {
    return this.display.findTrainingJobUnitsForResponse(training, responseId, exclusions)[0]?.unit ?? null;
  }

  private buildCoderResultsForResponse(
    training: CoderTraining,
    responseId: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>,
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>
  ): WithinTrainingCoderResult[] {
    return (training.codingJobs || []).map(job => {
      let code: number | null = null;
      let score: number | null = null;
      let notes: string | null = null;
      let codingIssueOption: number | null = null;

      const coderName = job.codingJobCoders && job.codingJobCoders.length > 0 && job.codingJobCoders[0].user ?
        `${job.codingJobCoders[0].user.username || 'Unknown'}` :
        `Coder ${job.name}`;

      job.codingJobUnits?.forEach(unit => {
        if (
          unit.response_id === responseId &&
          !isExcludedByResolvedExclusions(exclusions, unit.booklet_name, unit.unit_name)
        ) {
          code = unit.code;
          if (unit.score !== null) {
            score = unit.score;
          }
          notes = unit.notes;
          codingIssueOption = unit.coding_issue_option;
        }
      });

      const mappedDisplay = this.display.mapDisplayCodeAndScore(
        code,
        score,
        codingIssueOption,
        missingCodesByJobId.get(job.id) ?? DEFAULT_MISSING_CODE_CONTEXT
      );

      return {
        jobId: job.id,
        coderName,
        code: mappedDisplay.code,
        score: mappedDisplay.score,
        notes,
        codingIssueOption
      };
    });
  }

  private findReplayScoreFallback(response: ResponseEntity | null | undefined, code: number): DiscussionScoreFallback {
    const versionedResults = [
      { code: response?.code_v3, score: response?.score_v3 },
      { code: response?.code_v2, score: response?.score_v2 },
      { code: response?.code_v1, score: response?.score_v1 }
    ];

    const replayResult = versionedResults.find(result => (
      result.code !== null &&
      result.code !== undefined &&
      Number(result.code) === code
    ));

    if (!replayResult) {
      return { found: false, score: null };
    }

    return {
      found: true,
      score: this.display.toNullableScore(replayResult.score)
    };
  }

  private findExistingDiscussionScoreFallback(
    training: CoderTraining,
    responseId: number,
    code: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): DiscussionScoreFallback {
    for (const job of training.codingJobs || []) {
      const unit = job.codingJobUnits?.find(candidate => (
        candidate.response_id === responseId &&
        !isExcludedByResolvedExclusions(exclusions, candidate.booklet_name, candidate.unit_name)
      ));

      if (!unit) {
        continue;
      }

      if (unit.code !== null && unit.code !== undefined && Number(unit.code) === code) {
        return {
          found: true,
          score: this.display.toNullableScore(unit.score)
        };
      }

      const replayFallback = this.findReplayScoreFallback(unit.response, code);
      if (replayFallback.found) {
        return replayFallback;
      }
    }

    return { found: false, score: null };
  }

  private async resolveManualDiscussionCode(
    workspaceId: number,
    training: CoderTraining,
    responseId: number,
    code: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<number> {
    const missingIdByIssueOption = new Map<number, IqbStandardMissingId>([
      [-3, 'mir'],
      [-4, 'mci']
    ]);
    const missingId = missingIdByIssueOption.get(code);
    if (!missingId) {
      return code;
    }

    const profileId = await this.display.resolveMissingProfileIdForResponse(
      workspaceId,
      training,
      responseId,
      exclusions
    );
    const missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
      workspaceId,
      profileId,
      missingId
    );

    return missing.code;
  }

  private async deriveDiscussionScore(
    workspaceId: number,
    training: CoderTraining,
    responseId: number,
    code: number,
    representativeUnit: CodingJobUnit,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<number | null> {
    if (code < 0) {
      return this.display.getMissingScoreForResponse(
        workspaceId,
        training,
        responseId,
        code,
        exclusions
      );
    }

    try {
      return await this.codingJobService.getCodingSchemeScoreForUnitCode(
        representativeUnit,
        workspaceId,
        code
      );
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }

      const fallback = this.findExistingDiscussionScoreFallback(training, responseId, code, exclusions);
      if (fallback.found) {
        return fallback.score;
      }

      throw error;
    }
  }

  async saveDiscussionResult(
    workspaceId: number,
    trainingId: number,
    responseId: number,
    managerUserId: number | null,
    managerName: string | null,
    code: number | null | undefined,
    notes?: string | null
  ): Promise<SaveDiscussionResultResponse> {
    return withWorkspaceTestResultsMutationTransaction(this.coderTrainingRepository.manager, async manager => {
      await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
      await assertCodingResourceMutation(manager, workspaceId, 'training', trainingId, managerUserId);
      const coderTrainingRepository = manager.getRepository(CoderTraining);
      const coderTrainingDiscussionResultRepository = manager.getRepository(CoderTrainingDiscussionResult);

      const training = await coderTrainingRepository.findOne({
        where: {
          id: trainingId,
          workspace_id: workspaceId
        },
        relations: ['codingJobs', 'codingJobs.codingJobUnits', 'codingJobs.codingJobUnits.response']
      });

      if (!training) {
        throw new BadRequestException(`Training ${trainingId} not found in workspace ${workspaceId}`);
      }

      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId, manager);
      const representativeUnit = this.findTrainingUnitForResponse(training, responseId, exclusions);

      if (!representativeUnit) {
        throw new BadRequestException(`Response ${responseId} is not part of training ${trainingId}`);
      }

      const existing = await coderTrainingDiscussionResultRepository.findOne({
        where: {
          workspace_id: workspaceId,
          training_id: trainingId,
          response_id: responseId
        }
      });

      if (code === null || code === undefined) {
        const missingCodesByJobId = await this.display.buildMissingCodesByJobId(workspaceId, training.codingJobs || []);
        const codersData = this.buildCoderResultsForResponse(
          training,
          responseId,
          exclusions,
          missingCodesByJobId
        );
        const automaticDiscussionResult = await this.deriveAutomaticDiscussionResultForResponse(
          workspaceId,
          training,
          responseId,
          codersData,
          exclusions
        );

        if (existing) {
          await coderTrainingDiscussionResultRepository.delete(existing.id);
        }
        return {
          success: true,
          code: automaticDiscussionResult?.code ?? null,
          score: automaticDiscussionResult?.score ?? null,
          notes: null,
          source: automaticDiscussionResult ? 'auto_agreement' : null,
          managerUserId: null,
          managerName: null
        };
      }

      if (!Number.isInteger(code)) {
        throw new BadRequestException('Discussion code must be an integer');
      }

      const resolvedCode = await this.resolveManualDiscussionCode(
        workspaceId,
        training,
        responseId,
        code,
        exclusions
      );

      const derivedScore = await this.deriveDiscussionScore(
        workspaceId,
        training,
        responseId,
        resolvedCode,
        representativeUnit,
        exclusions
      );

      const discussionResult = existing || coderTrainingDiscussionResultRepository.create({
        workspace_id: workspaceId,
        training_id: trainingId,
        response_id: responseId
      });

      discussionResult.code = resolvedCode;
      discussionResult.score = derivedScore;
      discussionResult.notes = notes?.trim() || null;
      discussionResult.manager_user_id = managerUserId;
      discussionResult.manager_name = managerName;

      const saved = await coderTrainingDiscussionResultRepository.save(discussionResult);
      return {
        success: true,
        code: saved.code,
        score: saved.score,
        notes: saved.notes ?? null,
        source: 'manual',
        managerUserId: saved.manager_user_id,
        managerName: saved.manager_name
      };
    });
  }
}
