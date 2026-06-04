import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, In, IsNull, Not
} from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CoderTrainingVariable } from '../../entities/coder-training-variable.entity';
import { CoderTrainingBundle } from '../../entities/coder-training-bundle.entity';
import { CoderTrainingCoder } from '../../entities/coder-training-coder.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { ResponseEntity } from '../../entities/response.entity';
import User from '../../entities/user.entity';
import { JobDefinitionVariable, JobDefinitionVariableBundle } from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CodingJobService } from './coding-job.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  IQB_STANDARD_MISSING_CODES,
  IQB_STANDARD_MISSING_SCORES,
  IqbStandardMissingId,
  MissingsProfilesService
} from './missings-profiles.service';
import {
  applyResolvedExclusionsToQuery,
  isExcludedByResolvedExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import type { CaseSelectionMode, ReferenceMode } from '../../entities/coder-training.entity';

interface CoderTrainingResponse {
  responseId: number;
  unitAlias: string;
  variableId: string;
  unitName: string;
  value: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
  variable: string;
  chunkTs?: number;
  unitId?: number;
}

interface TrainingPackage {
  coderId: number;
  coderName: string;
  responses: CoderTrainingResponse[];
}

interface TrainingJob {
  coderId: number;
  coderName: string;
  jobId: number;
  jobName: string;
}

interface CoderTrainingWithJobs {
  id: number;
  workspace_id: number;
  label: string;
  created_at: Date;
  updated_at: Date;
  jobsCount: number;
  assigned_variables?: JobDefinitionVariable[];
  assigned_variable_bundles?: JobDefinitionVariableBundle[];
  assigned_coders?: number[];
  case_ordering_mode?: 'continuous' | 'alternating';
  case_selection_mode?: string;
  reference_training_ids?: number[];
  reference_mode?: string | null;
  suppress_general_instructions?: boolean;
}

export type TrainingResponseIdsMap = Record<string, number[]>;

type DiscussionSource = 'manual' | 'auto_agreement' | null;

type SaveDiscussionResultResponse = {
  success: boolean;
  code: number | null;
  score: number | null;
  source: DiscussionSource;
  managerUserId: number | null;
  managerName: string | null;
};

type WithinTrainingCoderResult = {
  jobId: number;
  coderName: string;
  code: string | null;
  score: number | null;
  notes: string | null;
  codingIssueOption: number | null;
};

type DiscussionScoreFallback = {
  found: boolean;
  score: number | null;
};

type TrainingResponseJobUnit = {
  job: Pick<CodingJob, 'id' | 'missings_profile_id'>;
  unit: CodingJobUnit;
};

type MissingCodePair = { mirCode: number; mciCode: number };
type MissingCodeDisplayContext = MissingCodePair & {
  negativeCodes: Set<number>;
  scoresByCode: Map<number, number>;
};

const DEFAULT_MISSING_CODE_CONTEXT: MissingCodeDisplayContext = {
  mirCode: IQB_STANDARD_MISSING_CODES.mir,
  mciCode: IQB_STANDARD_MISSING_CODES.mci,
  negativeCodes: new Set(Object.values(IQB_STANDARD_MISSING_CODES)),
  scoresByCode: new Map(
    (Object.entries(IQB_STANDARD_MISSING_SCORES) as Array<[IqbStandardMissingId, number]>)
      .map(([missingId, score]) => [IQB_STANDARD_MISSING_CODES[missingId], score])
  )
};

@Injectable()
export class CoderTrainingService {
  private readonly logger = new Logger(CoderTrainingService.name);

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTraining)
    private coderTrainingRepository: Repository<CoderTraining>,
    @InjectRepository(CoderTrainingVariable)
    private coderTrainingVariableRepository: Repository<CoderTrainingVariable>,
    @InjectRepository(CoderTrainingBundle)
    private coderTrainingBundleRepository: Repository<CoderTrainingBundle>,
    @InjectRepository(CoderTrainingCoder)
    private coderTrainingCoderRepository: Repository<CoderTrainingCoder>,
    @InjectRepository(CoderTrainingDiscussionResult)
    private coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
    @InjectRepository(CodingJobVariableBundle)
    private codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(ChunkEntity)
    private chunkRepository: Repository<ChunkEntity>,
    private codingJobService: CodingJobService,
    private workspaceFilesService: WorkspaceFilesService,
    private missingsProfilesService: MissingsProfilesService,
    private workspaceExclusionService: WorkspaceExclusionService
  ) { }

  private async buildMissingCodesByJobId(
    workspaceId: number,
    jobs: Array<Pick<CodingJob, 'id' | 'missings_profile_id'>>
  ): Promise<Map<number, MissingCodeDisplayContext>> {
    if (!Array.isArray(jobs)) {
      return new Map();
    }

    const defaultMissingCodes = await this.getDefaultMissingCodeDisplayContext(workspaceId);
    const profileIds = [...new Set(jobs
      .map(job => job.missings_profile_id)
      .filter((id): id is number => id !== null && id !== undefined))];

    const missingCodesByProfileId = new Map<number, MissingCodeDisplayContext>();

    for (const profileId of profileIds) {
      if (!this.missingsProfilesService?.getMissingsProfileDetails ||
          !this.missingsProfilesService?.getNegativeMissingCodesForProfileOrDefault) {
        missingCodesByProfileId.set(profileId, defaultMissingCodes);
        continue;
      }

      const [profile, negativeCodes] = await Promise.all([
        this.missingsProfilesService.getMissingsProfileDetails(workspaceId, profileId),
        this.missingsProfilesService.getNegativeMissingCodesForProfileOrDefault(workspaceId, profileId)
      ]);
      if (!profile) {
        throw new BadRequestException(`Missing profile ${profileId} not found`);
      }

      missingCodesByProfileId.set(
        profileId,
        {
          ...this.getMirMciCodesFromMissings(profile.parseMissings(), defaultMissingCodes),
          negativeCodes,
          scoresByCode: this.getMissingScoresByCodeFromMissings(
            profile.parseMissings(),
            defaultMissingCodes.scoresByCode
          )
        }
      );
    }

    const missingCodesByJobId = new Map<number, MissingCodeDisplayContext>();
    jobs.forEach(job => {
      const profileCodes = job.missings_profile_id ? missingCodesByProfileId.get(job.missings_profile_id) : undefined;
      missingCodesByJobId.set(job.id, profileCodes ?? defaultMissingCodes);
    });

    return missingCodesByJobId;
  }

  private async getDefaultMissingCodeDisplayContext(workspaceId: number): Promise<MissingCodeDisplayContext> {
    if (!this.missingsProfilesService?.getNegativeMissingCodesForProfileOrDefault ||
        !this.missingsProfilesService?.ensureDefaultMissingsProfile) {
      return {
        ...DEFAULT_MISSING_CODE_CONTEXT,
        negativeCodes: new Set(DEFAULT_MISSING_CODE_CONTEXT.negativeCodes),
        scoresByCode: new Map(DEFAULT_MISSING_CODE_CONTEXT.scoresByCode)
      };
    }

    const [defaultProfile, negativeCodes] = await Promise.all([
      this.missingsProfilesService.ensureDefaultMissingsProfile(workspaceId),
      this.missingsProfilesService.getNegativeMissingCodesForProfileOrDefault(workspaceId, null)
    ]);

    return {
      ...this.getMirMciCodesFromMissings(defaultProfile.parseMissings()),
      negativeCodes,
      scoresByCode: this.getMissingScoresByCodeFromMissings(
        defaultProfile.parseMissings()
      )
    };
  }

  private getMissingScoresByCodeFromMissings(
    missings: Array<{ id?: string; code: number; score?: unknown }>,
    fallbackScoresByCode?: Map<number, number>
  ): Map<number, number> {
    const scoresByCode = new Map<number, number>(fallbackScoresByCode);

    missings.forEach(missing => {
      const code = Number(missing.code);
      if (!Number.isInteger(code) || code >= 0) {
        return;
      }

      if (!this.hasExplicitFiniteScore(missing.score)) {
        throw new BadRequestException(`Missing profile must define a score for code ${code}`);
      }

      scoresByCode.set(code, Number(missing.score));
    });

    return scoresByCode;
  }

  private hasExplicitFiniteScore(score: unknown): boolean {
    if (typeof score === 'number') {
      return Number.isFinite(score);
    }

    if (typeof score === 'string') {
      const trimmedScore = score.trim();
      return trimmedScore !== '' && Number.isFinite(Number(trimmedScore));
    }

    return false;
  }

  private getMissingScoreFromContext(
    missingCodes: MissingCodeDisplayContext,
    code: number
  ): number {
    const score = missingCodes.scoresByCode.get(code);
    if (score === undefined) {
      throw new BadRequestException(`Missing profile must define a score for code ${code}`);
    }

    return score;
  }

  private getMirMciCodesFromMissings(
    missings: Array<{ id?: string; label?: string; code: number }>,
    fallback?: MissingCodePair
  ): MissingCodePair {
    const mirMissing = missings.find(m => m.id === 'mir' ||
      m.label?.toLowerCase().includes('invalid') ||
      m.label?.toLowerCase().includes('spa')
    );

    const mciMissing = missings.find(m => m.id === 'mci' ||
      m.label?.toLowerCase().includes('coding impossible') ||
      m.label?.toLowerCase().includes('techn')
    );

    const mirCode = mirMissing?.code ?? fallback?.mirCode;
    const mciCode = mciMissing?.code ?? fallback?.mciCode;

    if (!Number.isInteger(mirCode) || !Number.isInteger(mciCode)) {
      throw new BadRequestException('Missing profile must define MIR and MCI codes');
    }

    return { mirCode, mciCode };
  }

  /**
   * Get response IDs used in the given trainings, grouped by variable.
   * Both unit name and unit alias are exposed as keys so reference training filters
   * match whichever unit identifier the current training configuration uses.
   */
  async getTrainingResponseIds(
    workspaceId: number,
    trainingIds: number[]
  ): Promise<TrainingResponseIdsMap> {
    if (trainingIds.length === 0) {
      return {};
    }

    this.logger.log(`Getting response IDs for trainings ${trainingIds.join(', ')} in workspace ${workspaceId}`);

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.unit_alias', 'unitAlias')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.response_id', 'responseId')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id IN (:...trainingIds)', { trainingIds })
      .distinct(true);
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'trainingResponseIds'
    });
    const rows = await query.getRawMany<{
      unitName?: string | null;
      unitAlias?: string | null;
      unitKey?: string | null;
      variableId: string;
      responseId: number;
    }>();

    const result: TrainingResponseIdsMap = {};
    for (const row of rows) {
      const unitKeys = new Set([row.unitName, row.unitAlias, row.unitKey].filter((key): key is string => !!key));
      for (const unitKey of unitKeys) {
        const key = `${unitKey}:${row.variableId}`;
        if (!result[key]) {
          result[key] = [];
        }
        if (!result[key].includes(row.responseId)) {
          result[key].push(row.responseId);
        }
      }
    }

    this.logger.log(`Found response IDs for ${Object.keys(result).length} variable configs`);
    return result;
  }

  private applyReferenceFilter(
    responses: CoderTrainingResponse[],
    referenceMode: ReferenceMode | undefined,
    referenceResponseIdsByConfig: TrainingResponseIdsMap | null,
    configKey: string
  ): CoderTrainingResponse[] {
    if (!referenceMode || !referenceResponseIdsByConfig) {
      return responses;
    }

    const refIds = referenceResponseIdsByConfig[configKey] ?
      new Set(referenceResponseIdsByConfig[configKey]) :
      null;

    if (referenceMode === 'same') {
      return refIds ? responses.filter(r => refIds.has(r.responseId)) : [];
    }

    if (referenceMode === 'different' && refIds) {
      return responses.filter(r => !refIds.has(r.responseId));
    }

    return responses;
  }

  private async hasCodingProgressForJobs(jobIds: number[]): Promise<boolean> {
    const distinctJobIds = [...new Set(jobIds.filter(jobId => Number.isInteger(jobId) && jobId > 0))];
    if (distinctJobIds.length === 0) {
      return false;
    }

    const codedUnits = await this.codingJobUnitRepository.count({
      where: [
        { coding_job_id: In(distinctJobIds), code: Not(IsNull()) },
        { coding_job_id: In(distinctJobIds), score: Not(IsNull()) },
        { coding_job_id: In(distinctJobIds), notes: Not(IsNull()) },
        { coding_job_id: In(distinctJobIds), coding_issue_option: Not(IsNull()) },
        { coding_job_id: In(distinctJobIds), supervisor_comment: Not(IsNull()) }
      ]
    });

    return codedUnits > 0;
  }

  private async hasDiscussionResultsForTraining(workspaceId: number, trainingId: number): Promise<boolean> {
    const discussionResults = await this.coderTrainingDiscussionResultRepository.count({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId
      }
    });

    return discussionResults > 0;
  }

  private mapDisplayCodeAndScore(
    code: number | null,
    score: number | null,
    codingIssueOption: number | null,
    missingCodes: MissingCodeDisplayContext
  ): { code: string | null; score: number | null } {
    if (code === null && codingIssueOption === null) {
      return { code: null, score };
    }

    if (code === -3 || codingIssueOption === -3) {
      return {
        code: missingCodes.mirCode.toString(),
        score: this.getMissingScoreFromContext(missingCodes, missingCodes.mirCode)
      };
    }

    if (code === -4 || codingIssueOption === -4) {
      return {
        code: missingCodes.mciCode.toString(),
        score: this.getMissingScoreFromContext(missingCodes, missingCodes.mciCode)
      };
    }

    if (code !== null && code < 0 && missingCodes.negativeCodes.has(code)) {
      return {
        code: code.toString(),
        score: this.getMissingScoreFromContext(missingCodes, code)
      };
    }

    return {
      code: code !== null ? code.toString() : null,
      score
    };
  }

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
      score: await this.getMissingScoreForResponse(
        workspaceId,
        training,
        responseId,
        result.code,
        exclusions
      )
    };
  }

  private findTrainingUnitForResponse(
    training: CoderTraining,
    responseId: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): CodingJobUnit | null {
    return this.findTrainingJobUnitsForResponse(training, responseId, exclusions)[0]?.unit ?? null;
  }

  private findTrainingJobUnitsForResponse(
    training: CoderTraining,
    responseId: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): TrainingResponseJobUnit[] {
    return (training.codingJobs || []).flatMap(job => {
      const unit = job.codingJobUnits?.find(candidate => (
        candidate.response_id === responseId &&
        !isExcludedByResolvedExclusions(exclusions, candidate.booklet_name, candidate.unit_name)
      ));

      return unit ? [{ job, unit }] : [];
    });
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

      const mappedDisplay = this.mapDisplayCodeAndScore(
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

  private toNullableScore(score: number | string | null | undefined): number | null {
    if (score === null || score === undefined) {
      return null;
    }

    const numericScore = Number(score);
    return Number.isFinite(numericScore) ? numericScore : null;
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
      score: this.toNullableScore(replayResult.score)
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
          score: this.toNullableScore(unit.score)
        };
      }

      const replayFallback = this.findReplayScoreFallback(unit.response, code);
      if (replayFallback.found) {
        return replayFallback;
      }
    }

    return { found: false, score: null };
  }

  private async getMissingScoreForResponse(
    workspaceId: number,
    training: CoderTraining,
    responseId: number,
    code: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<number> {
    const jobUnits = this.findTrainingJobUnitsForResponse(training, responseId, exclusions);
    if (jobUnits.length === 0) {
      return (await this.missingsProfilesService.getMissingByCodeForProfileOrDefault(
        workspaceId,
        null,
        code
      )).score;
    }

    const resolvedProfileIds = await Promise.all(jobUnits.map(({ job }) => (
      this.missingsProfilesService.resolveMissingsProfileId(workspaceId, job.missings_profile_id)
    )));
    const profileKeys = new Set(resolvedProfileIds);
    if (profileKeys.size > 1) {
      throw new BadRequestException(`Conflicting missing profiles for response ${responseId} in training ${training.id}`);
    }

    try {
      return (await this.missingsProfilesService.getMissingByCodeForProfileOrDefault(
        workspaceId,
        resolvedProfileIds[0],
        code
      )).score;
    } catch (error) {
      if (error instanceof BadRequestException && error.message.includes('not found')) {
        throw new BadRequestException(`Unsupported missing code: ${code}`);
      }

      throw error;
    }
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
      return this.getMissingScoreForResponse(
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
    code: number | null | undefined
  ): Promise<SaveDiscussionResultResponse> {
    const training = await this.coderTrainingRepository.findOne({
      where: {
        id: trainingId,
        workspace_id: workspaceId
      },
      relations: ['codingJobs', 'codingJobs.codingJobUnits', 'codingJobs.codingJobUnits.response']
    });

    if (!training) {
      throw new BadRequestException(`Training ${trainingId} not found in workspace ${workspaceId}`);
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const representativeUnit = this.findTrainingUnitForResponse(training, responseId, exclusions);

    if (!representativeUnit) {
      throw new BadRequestException(`Response ${responseId} is not part of training ${trainingId}`);
    }

    const existing = await this.coderTrainingDiscussionResultRepository.findOne({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId,
        response_id: responseId
      }
    });

    if (code === null || code === undefined) {
      const missingCodesByJobId = await this.buildMissingCodesByJobId(workspaceId, training.codingJobs || []);
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
        await this.coderTrainingDiscussionResultRepository.delete(existing.id);
      }
      return {
        success: true,
        code: automaticDiscussionResult?.code ?? null,
        score: automaticDiscussionResult?.score ?? null,
        source: automaticDiscussionResult ? 'auto_agreement' : null,
        managerUserId: null,
        managerName: null
      };
    }

    if (!Number.isInteger(code)) {
      throw new BadRequestException('Discussion code must be an integer');
    }

    const derivedScore = await this.deriveDiscussionScore(
      workspaceId,
      training,
      responseId,
      code,
      representativeUnit,
      exclusions
    );

    const discussionResult = existing || this.coderTrainingDiscussionResultRepository.create({
      workspace_id: workspaceId,
      training_id: trainingId,
      response_id: responseId
    });

    discussionResult.code = code;
    discussionResult.score = derivedScore;
    discussionResult.manager_user_id = managerUserId;
    discussionResult.manager_name = managerName;

    const saved = await this.coderTrainingDiscussionResultRepository.save(discussionResult);
    return {
      success: true,
      code: saved.code,
      score: saved.score,
      source: 'manual',
      managerUserId: saved.manager_user_id,
      managerName: saved.manager_name
    };
  }

  /**
   * Fisher-Yates shuffle for random sampling
   */
  private shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  private sampleResponses(
    responses: CoderTrainingResponse[],
    sampleCount: number,
    caseSelectionMode: CaseSelectionMode = 'oldest_first'
  ): CoderTrainingResponse[] {
    if (responses.length <= sampleCount) {
      return responses;
    }

    const arr = [...responses];

    switch (caseSelectionMode) {
      case 'oldest_first': {
        arr.sort((a, b) => {
          const tsA = a.chunkTs ?? a.responseId;
          const tsB = b.chunkTs ?? b.responseId;
          if (tsA !== tsB) return tsA - tsB;
          return a.responseId - b.responseId;
        });
        return arr.slice(0, sampleCount);
      }
      case 'newest_first': {
        arr.sort((a, b) => {
          const tsA = a.chunkTs ?? a.responseId;
          const tsB = b.chunkTs ?? b.responseId;
          if (tsA !== tsB) return tsB - tsA;
          return b.responseId - a.responseId;
        });
        return arr.slice(0, sampleCount);
      }
      case 'random': {
        return this.shuffle(arr).slice(0, sampleCount);
      }
      case 'random_per_testgroup': {
        const byGroup = new Map<string, CoderTrainingResponse[]>();
        for (const r of arr) {
          const key = r.personGroup || '_ungrouped';
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key)!.push(r);
        }
        const groups = this.shuffle(Array.from(byGroup.values()).map(group => this.shuffle(group)));
        const result: CoderTrainingResponse[] = [];

        while (result.length < sampleCount && groups.some(group => group.length > 0)) {
          for (const group of groups) {
            if (result.length >= sampleCount) break;
            const response = group.shift();
            if (response) {
              result.push(response);
            }
          }
        }

        return result;
      }
      case 'random_testgroups': {
        const byGroup = new Map<string, CoderTrainingResponse[]>();
        for (const r of arr) {
          const key = r.personGroup || '_ungrouped';
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key)!.push(r);
        }
        const shuffledGroups = this.shuffle(Array.from(byGroup.entries()));
        const result: CoderTrainingResponse[] = [];
        for (const [, groupResponses] of shuffledGroups) {
          if (result.length >= sampleCount) break;
          const shuffled = this.shuffle(groupResponses);
          const remaining = sampleCount - result.length;
          result.push(...shuffled.slice(0, remaining));
        }
        return result;
      }
      default:
        arr.sort((a, b) => a.responseId - b.responseId);
        return arr.slice(0, sampleCount);
    }
  }

  private sortTrainingResponses(
    responses: CoderTrainingResponse[],
    caseOrderingMode: 'continuous' | 'alternating' = 'continuous'
  ): CoderTrainingResponse[] {
    const cmp = (v1: string, v2: string) => v1.localeCompare(v2);

    return [...responses].sort((a, b) => {
      if (caseOrderingMode === 'alternating') {
        // Alternating: person first, then booklet, then unit, then variable
        if (a.personLogin !== b.personLogin) return cmp(a.personLogin, b.personLogin);
        if (a.personCode !== b.personCode) return cmp(a.personCode, b.personCode);
        if (a.personGroup !== b.personGroup) return cmp(a.personGroup, b.personGroup);
        if (a.bookletName !== b.bookletName) return cmp(a.bookletName, b.bookletName);
        if (a.unitName !== b.unitName) return cmp(a.unitName, b.unitName);
        if (a.variableId !== b.variableId) return cmp(a.variableId, b.variableId);
        return a.responseId - b.responseId;
      }
      // Continuous: variable first, then unit, then person
      if (a.variableId !== b.variableId) return cmp(a.variableId, b.variableId);
      if (a.unitName !== b.unitName) return cmp(a.unitName, b.unitName);
      if (a.personLogin !== b.personLogin) return cmp(a.personLogin, b.personLogin);
      if (a.personCode !== b.personCode) return cmp(a.personCode, b.personCode);
      if (a.personGroup !== b.personGroup) return cmp(a.personGroup, b.personGroup);
      if (a.bookletName !== b.bookletName) return cmp(a.bookletName, b.bookletName);
      return a.responseId - b.responseId;
    });
  }

  async generateCoderTrainingPackages(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number }[],
    options?: {
      caseSelectionMode?: CaseSelectionMode;
      referenceTrainingIds?: number[];
      referenceMode?: ReferenceMode;
    }
  ): Promise<TrainingPackage[]> {
    const caseSelectionMode = options?.caseSelectionMode ?? 'oldest_first';
    const referenceTrainingIds = options?.referenceTrainingIds ?? [];
    const referenceMode = options?.referenceMode;

    this.logger.log(`Generating coder training packages for workspace ${workspaceId} with ${selectedCoders.length} coders and ${variableConfigs.length} variable configs (caseSelectionMode=${caseSelectionMode})`);

    const referenceResponseIdsByConfig =
      referenceMode && referenceTrainingIds.length > 0 ?
        await this.getTrainingResponseIds(workspaceId, referenceTrainingIds) :
        null;
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

    // Load aggregation settings once for this workspace
    const aggregationThreshold = await this.codingJobService.getAggregationThreshold(workspaceId);
    const matchingFlags = await this.codingJobService.getResponseMatchingMode(workspaceId);
    this.logger.log(`Aggregation threshold: ${aggregationThreshold}, matching flags: ${matchingFlags.join(', ')}`);

    // Build derived variable lookup to skip aggregation for derived vars
    const derivedVariableMap = await this.workspaceFilesService.getDerivedVariableMap(workspaceId);
    const derivedVariableSets = new Map<string, Set<string>>();
    derivedVariableMap.forEach((vars, unitNameKey) => {
      derivedVariableSets.set(unitNameKey.toUpperCase(), vars);
    });
    const isDerivedVariable = (unitName: string, variableId: string): boolean => derivedVariableSets.get(unitName.toUpperCase())?.has(variableId) ?? false;

    // Pre-sample responses for each variable configuration to ensure consistency across all coders
    const sampledResponsesByConfig: Map<string, CoderTrainingResponse[]> = new Map();

    for (const config of variableConfigs) {
      const variableId = config.variableId;
      const unitId = config.unitId;
      const sampleCount = config.sampleCount;
      const configKey = `${unitId}:${variableId}`;

      this.logger.log(`Querying incomplete responses for unit ${unitId}, variable ${variableId}`);

      // Fetch all eligible responses (no DB-level limit — we need the full set to apply aggregation grouping)
      const unitResponsesQuery = this.responseRepository
        .createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v1 IN (:...statuses)', {
          statuses: [
            statusStringToNumber('CODING_INCOMPLETE'),
            statusStringToNumber('INTENDED_INCOMPLETE')
          ]
        })
        .andWhere('response.variableid = :variableId', { variableId })
        .andWhere('response.status_v2 IS NULL')
        .andWhere('(unit.alias = :unitId OR unit.name = :unitId)', { unitId })
        .orderBy('response.id', 'ASC');
      applyResolvedExclusionsToQuery(unitResponsesQuery, exclusions, { parameterPrefix: `trainingPackage${configKey.replace(/[^a-zA-Z0-9]/g, '')}` });
      const unitResponses = await unitResponsesQuery.getMany();

      this.logger.log(`Found ${unitResponses.length} incomplete responses for unit ${unitId}, variable ${variableId}`);

      let transformedResponses: CoderTrainingResponse[] = unitResponses.map(r => ({
        responseId: r.id,
        unitAlias: r.unit?.alias || '',
        variableId: r.variableid,
        unitName: r.unit?.name || '',
        value: r.value,
        personLogin: r.unit?.booklet?.person?.login || '',
        personCode: r.unit?.booklet?.person?.code || '',
        personGroup: r.unit?.booklet?.person?.group || '',
        bookletName: r.unit?.booklet?.bookletinfo?.name || '',
        variable: r.variableid,
        unitId: r.unitid
      }));

      if (caseSelectionMode === 'oldest_first' || caseSelectionMode === 'newest_first') {
        const unitIds = [...new Set(transformedResponses.map(r => r.unitId!).filter(Boolean))];
        if (unitIds.length > 0) {
          const chunks = await this.chunkRepository
            .createQueryBuilder('chunk')
            .where('chunk.unitid IN (:...unitIds)', { unitIds })
            .getMany();

          const chunkTsStatsByUnitAndVar = new Map<string, { min: number; max: number; hasMultiple: boolean }>();
          for (const chunk of chunks) {
            if (!chunk.variables) continue;

            const chunkTs = Number(chunk.ts) || 0;
            for (const v of chunk.variables.split(',').map(s => s.trim())) {
              const key = `${chunk.unitid}:${v}`;
              const existing = chunkTsStatsByUnitAndVar.get(key);
              if (existing) {
                if (chunkTs < existing.min) {
                  existing.min = chunkTs;
                  existing.hasMultiple = true;
                }
                if (chunkTs > existing.max) {
                  existing.max = chunkTs;
                  existing.hasMultiple = true;
                }
              } else {
                chunkTsStatsByUnitAndVar.set(key, { min: chunkTs, max: chunkTs, hasMultiple: false });
              }
            }
          }

          const multipleKeys: string[] = [];
          for (const [key, stats] of chunkTsStatsByUnitAndVar.entries()) {
            if (stats.hasMultiple) multipleKeys.push(key);
          }
          if (multipleKeys.length > 0) {
            const sample = multipleKeys.slice(0, 10).join(', ');
            this.logger.debug(`Multiple chunk.ts values detected for ${multipleKeys.length} unit/variable keys. Sample: ${sample}`);
          }

          const pickOldest = caseSelectionMode === 'oldest_first';
          transformedResponses = transformedResponses.map(r => {
            const stats = chunkTsStatsByUnitAndVar.get(`${r.unitId}:${r.variableId}`);
            let chunkTs: number | undefined;
            if (stats) {
              chunkTs = pickOldest ? stats.min : stats.max;
            }
            return {
              ...r,
              chunkTs
            };
          });
        }
      }

      // De-duplicate identical responses per person/unit/variable/value (keep lowest responseId).
      const dedupedByPersonValue = new Map<string, CoderTrainingResponse>();
      for (const response of transformedResponses) {
        const valueHash = createHash('sha1').update(response.value || '').digest('hex');
        const key = `${response.personLogin}::${response.personCode}::${response.personGroup}::${response.unitName}::${response.variableId}::${valueHash}`;
        const existing = dedupedByPersonValue.get(key);
        if (!existing || response.responseId < existing.responseId) {
          dedupedByPersonValue.set(key, response);
        }
      }
      if (dedupedByPersonValue.size !== transformedResponses.length) {
        this.logger.debug(`Removed ${transformedResponses.length - dedupedByPersonValue.size} duplicate responses for unit ${unitId}, variable ${variableId}.`);
      }
      transformedResponses = Array.from(dedupedByPersonValue.values());

      // Apply aggregation grouping: if threshold is set, keep only 1 representative per value group.
      // Derived variables have null/empty values — skip aggregation to avoid collapsing all responses into 1 group.
      const isDerived = isDerivedVariable(unitId, variableId);
      let responsesForSampling: CoderTrainingResponse[];
      if (!isDerived && aggregationThreshold !== null) {
        // Build slim-compatible objects for aggregation
        const slimResponses = transformedResponses.map(r => ({
          id: r.responseId,
          variableid: r.variableId,
          value: r.value,
          unitName: r.unitName,
          unitAlias: r.unitAlias,
          bookletName: r.bookletName,
          personLogin: r.personLogin,
          personCode: r.personCode,
          personGroup: r.personGroup
        }));
        const aggregatedGroups = this.codingJobService.aggregateResponsesByValue(slimResponses, matchingFlags);
        responsesForSampling = [];
        for (const group of aggregatedGroups) {
          if (group.responses.length >= aggregationThreshold) {
            // Keep only 1 representative (lowest id first)
            const representative = group.responses.reduce((a, b) => (a.id < b.id ? a : b));
            const orig = transformedResponses.find(r => r.responseId === representative.id);
            if (orig) responsesForSampling.push(orig);
          } else {
            // Below threshold — all responses are kept individually
            for (const slimR of group.responses) {
              const orig = transformedResponses.find(r => r.responseId === slimR.id);
              if (orig) responsesForSampling.push(orig);
            }
          }
        }
        this.logger.log(
          `After aggregation grouping: ${responsesForSampling.length} cases (from ${transformedResponses.length} raw responses) for unit ${unitId}, variable ${variableId}`
        );
      } else {
        responsesForSampling = transformedResponses;
      }

      responsesForSampling = this.applyReferenceFilter(
        responsesForSampling,
        referenceMode,
        referenceResponseIdsByConfig,
        configKey
      );

      const sampledResponses = this.sampleResponses(responsesForSampling, sampleCount, caseSelectionMode);
      sampledResponsesByConfig.set(configKey, sampledResponses);

      this.logger.log(`Sampled ${sampledResponses.length} consistent responses for unit ${unitId}, variable ${variableId}`);
    }

    // Create training packages for each coder using the pre-sampled responses
    const result: TrainingPackage[] = [];

    for (const coder of selectedCoders) {
      const coderId = coder.id;
      const coderName = coder.name;
      const coderResponses: CoderTrainingResponse[] = [];

      this.logger.log(`Assigning consistent training samples to coder ${coderName} (ID: ${coderId})`);

      for (const config of variableConfigs) {
        const configKey = `${config.unitId}:${config.variableId}`;
        const sampledResponses = sampledResponsesByConfig.get(configKey)!;
        coderResponses.push(...sampledResponses);
      }

      result.push({
        coderId,
        coderName,
        responses: coderResponses
      });

      this.logger.log(`Generated consistent training package for coder ${coderName} with ${coderResponses.length} responses`);
    }

    this.logger.log(`Completed generating consistent coder training packages. Total packages: ${result.length}`);
    return result;
  }

  async createCoderTrainingJobs(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number }[],
    trainingLabel: string,
    missingsProfileId?: number,
    assignedVariables?: JobDefinitionVariable[],
    assignedVariableBundles?: JobDefinitionVariableBundle[],
    caseOrderingMode?: 'continuous' | 'alternating',
    caseSelectionMode?: CaseSelectionMode,
    referenceTrainingIds?: number[],
    referenceMode?: ReferenceMode,
    suppressGeneralInstructions?: boolean
  ): Promise<{ success: boolean; jobsCreated: number; message: string; jobs: TrainingJob[]; trainingId?: number }> {
    try {
      this.logger.log(`Creating coder training jobs for workspace ${workspaceId} with ${selectedCoders.length} coders and label '${trainingLabel}'`);
      await this.codingJobService.assertCodersCanCodeInWorkspace(
        selectedCoders.map(coder => coder.id),
        workspaceId
      );
      const resolvedMissingsProfileId = await this.missingsProfilesService.resolveMissingsProfileId(
        workspaceId,
        missingsProfileId
      );

      const coderTraining = new CoderTraining();
      coderTraining.workspace_id = workspaceId;
      coderTraining.label = trainingLabel;
      coderTraining.case_ordering_mode = caseOrderingMode || 'continuous';
      coderTraining.case_selection_mode = caseSelectionMode ?? 'oldest_first';
      coderTraining.reference_training_ids = referenceTrainingIds?.length ? referenceTrainingIds : null;
      coderTraining.reference_mode = referenceMode ?? null;
      coderTraining.suppress_general_instructions = suppressGeneralInstructions ?? false;
      coderTraining.created_at = new Date();
      coderTraining.updated_at = new Date();

      const savedTraining = await this.coderTrainingRepository.save(coderTraining);
      const trainingId = savedTraining.id;

      // Save assigned variables
      if (assignedVariables) {
        for (const variable of assignedVariables) {
          const trainingVariable = new CoderTrainingVariable();
          trainingVariable.coder_training_id = trainingId;
          trainingVariable.variable_id = variable.variableId;
          trainingVariable.unit_name = variable.unitName;
          trainingVariable.sample_count = variable.sampleCount || 10;
          await this.coderTrainingVariableRepository.save(trainingVariable);
        }
      }

      // Save assigned bundles
      if (assignedVariableBundles) {
        for (const bundle of assignedVariableBundles) {
          const trainingBundle = new CoderTrainingBundle();
          trainingBundle.coder_training_id = trainingId;
          trainingBundle.variable_bundle_id = bundle.id;
          trainingBundle.sample_count = bundle.sampleCount || 10;
          trainingBundle.case_ordering_mode = bundle.caseOrderingMode || null;
          await this.coderTrainingBundleRepository.save(trainingBundle);
        }
      }

      // Save assigned coders
      for (const coder of selectedCoders) {
        const trainingCoder = new CoderTrainingCoder();
        trainingCoder.coder_training_id = trainingId;
        trainingCoder.user_id = coder.id;
        await this.coderTrainingCoderRepository.save(trainingCoder);
      }

      this.logger.log(`Created coder training ${trainingId} with label '${trainingLabel}' and configuration`);

      const trainingPackages = await this.generateCoderTrainingPackages(workspaceId, selectedCoders, variableConfigs, {
        caseSelectionMode: caseSelectionMode ?? 'oldest_first',
        referenceTrainingIds,
        referenceMode
      });

      // Build mapping from variable to bundle id and bundle sorting mode
      const variableToBundleMap = new Map<string, number>();
      const bundleSortingModeMap = new Map<number, 'continuous' | 'alternating'>();
      this.logger.log(`Building bundle maps for ${assignedVariableBundles?.length || 0} bundles`);
      if (assignedVariableBundles && assignedVariableBundles.length > 0) {
        const bundleIds = assignedVariableBundles.map(b => b.id);
        if (bundleIds.length > 0) {
          const fetchedBundles = await this.variableBundleRepository.find({
            where: { id: In(bundleIds) }
          });
          for (const bundle of fetchedBundles) {
            // Store the bundle's sorting mode (if set, otherwise null)
            const bundleConfig = assignedVariableBundles.find(b => b.id === bundle.id);
            const mode = bundleConfig?.caseOrderingMode || null;
            bundleSortingModeMap.set(bundle.id, mode);
            this.logger.log(`Bundle ${bundle.id} (${bundle.name}): mode=${mode}`);
            if (bundle.variables) {
              for (const v of bundle.variables) {
                const key = `${v.unitName}::${v.variableId}`;
                variableToBundleMap.set(key, bundle.id);
                this.logger.debug(`  Variable mapping: ${key} -> bundle ${bundle.id}`);
              }
            }
          }
        }
      }

      const jobs: TrainingJob[] = [];
      let jobsCreated = 0;

      for (const trainingPackage of trainingPackages) {
        const coderId = trainingPackage.coderId;
        const coderName = trainingPackage.coderName;

        this.logger.log(`Creating training job for coder ${coderName} (ID: ${coderId})`);

        const codingJob = new CodingJob();
        codingJob.name = `${trainingLabel}-${coderName}`;
        codingJob.workspace_id = workspaceId;
        codingJob.description = '';
        codingJob.training_id = trainingId;
        codingJob.missings_profile_id = resolvedMissingsProfileId;
        codingJob.case_ordering_mode = caseOrderingMode || 'continuous';
        codingJob.suppressGeneralInstructions = suppressGeneralInstructions ?? false;
        codingJob.created_at = new Date();
        codingJob.updated_at = new Date();

        const savedJob = await this.codingJobRepository.save(codingJob);
        const jobId = savedJob.id;

        jobsCreated += 1;
        jobs.push({
          coderId,
          coderName,
          jobId,
          jobName: codingJob.name
        });

        const codingJobCoder = new CodingJobCoder();
        codingJobCoder.coding_job_id = jobId;
        codingJobCoder.user_id = coderId;
        await this.codingJobCoderRepository.save(codingJobCoder);

        // Save bundle configurations to CodingJobVariableBundle for display sorting
        const seenBundleIdsForJob = new Set<number>();
        for (const response of trainingPackage.responses) {
          const bundleId = variableToBundleMap.get(`${response.unitName}::${response.variableId}`);
          if (bundleId && !seenBundleIdsForJob.has(bundleId)) {
            seenBundleIdsForJob.add(bundleId);
            const bundleMode = bundleSortingModeMap.get(bundleId);
            const jobVariableBundle = new CodingJobVariableBundle();
            jobVariableBundle.coding_job_id = jobId;
            jobVariableBundle.variable_bundle_id = bundleId;
            jobVariableBundle.case_ordering_mode = bundleMode || null;
            await this.codingJobVariableBundleRepository.save(jobVariableBundle);
            this.logger.log(`Saved CodingJobVariableBundle: job=${jobId}, bundle=${bundleId}, mode=${bundleMode || 'null'}`);
          }
        }

        const processedVariables = new Set<string>();
        for (const response of trainingPackage.responses) {
          const variableKey = `${response.variableId}:${response.unitName}`;
          if (!processedVariables.has(variableKey)) {
            const codingJobVariable = new CodingJobVariable();
            codingJobVariable.coding_job_id = jobId;
            codingJobVariable.variable_id = response.variableId;
            codingJobVariable.unit_name = response.unitName;
            await this.codingJobVariableRepository.save(codingJobVariable);
            processedVariables.add(variableKey);
            this.logger.log(`Added variable ${response.variableId} for unit ${response.unitName} to training job ${jobId} for coder ${coderName}`);
          }
        }

        // Sort responses with bundle-specific sorting modes
        // Group responses by their effective sorting mode
        const defaultMode = caseOrderingMode || 'continuous';
        const alternatingResponses: CoderTrainingResponse[] = [];
        const continuousResponses: CoderTrainingResponse[] = [];

        for (const response of trainingPackage.responses) {
          const bundleId = variableToBundleMap.get(`${response.unitName}::${response.variableId}`);
          const bundleMode = bundleId !== undefined ? bundleSortingModeMap.get(bundleId) : undefined;
          const effectiveMode = bundleMode || defaultMode;

          this.logger.debug(`Response ${response.responseId} (${response.unitName}::${response.variableId}): bundleId=${bundleId}, bundleMode=${bundleMode}, effectiveMode=${effectiveMode}`);

          if (effectiveMode === 'alternating') {
            alternatingResponses.push(response);
          } else {
            continuousResponses.push(response);
          }
        }

        this.logger.log(`Sorting: ${alternatingResponses.length} alternating, ${continuousResponses.length} continuous (default: ${defaultMode})`);

        // Sort each group with its respective mode
        const sortedAlternating = this.sortTrainingResponses(alternatingResponses, 'alternating');
        const sortedContinuous = this.sortTrainingResponses(continuousResponses, 'continuous');

        // Combine: alternating first, then continuous
        const sortedResponses = [...sortedAlternating, ...sortedContinuous];

        const codingJobUnits: CodingJobUnit[] = sortedResponses.map(response => {
          const codingJobUnit = new CodingJobUnit();
          codingJobUnit.coding_job_id = jobId;
          codingJobUnit.workspace_id = workspaceId;
          codingJobUnit.response_id = response.responseId;
          codingJobUnit.unit_name = response.unitName;
          codingJobUnit.unit_alias = response.unitAlias || null;
          codingJobUnit.variable_id = response.variableId;
          codingJobUnit.variable_anchor = response.variableId; // Same as variable_id
          codingJobUnit.booklet_name = response.bookletName;
          codingJobUnit.person_login = response.personLogin;
          codingJobUnit.person_code = response.personCode;
          codingJobUnit.person_group = response.personGroup;
          codingJobUnit.is_open = true;
          codingJobUnit.variable_bundle_id = variableToBundleMap.get(`${response.unitName}::${response.variableId}`) || null;
          return codingJobUnit;
        });
        await this.codingJobUnitRepository.save(codingJobUnits);
        this.logger.log(`Bulk-inserted ${codingJobUnits.length} coding job units to training job ${jobId} for coder ${coderName}`);

        this.logger.log(`Successfully created training job ${jobId} with ${trainingPackage.responses.length} coding units for coder ${coderName}`);
      }

      const message = `Successfully created ${jobsCreated} coder training jobs`;

      this.logger.log(message);
      return {
        success: true,
        jobsCreated,
        message,
        jobs,
        trainingId
      };
    } catch (error) {
      const errorMessage = `Error creating coder training jobs: ${error.message}`;
      this.logger.error(errorMessage, error.stack);
      return {
        success: false,
        jobsCreated: 0,
        message: errorMessage,
        jobs: []
      };
    }
  }

  async getCoderTrainings(workspaceId: number): Promise<CoderTrainingWithJobs[]> {
    this.logger.log(`Getting all coder trainings for workspace ${workspaceId}`);

    const trainings = await this.coderTrainingRepository.find({
      where: { workspace_id: workspaceId },
      relations: ['codingJobs', 'variables', 'bundles', 'bundles.bundle', 'coders'],
      order: { created_at: 'DESC' }
    });

    return trainings.map(training => ({
      id: training.id,
      workspace_id: training.workspace_id,
      label: training.label,
      created_at: training.created_at,
      updated_at: training.updated_at,
      jobsCount: training.codingJobs?.length || 0,
      case_ordering_mode: training.case_ordering_mode,
      case_selection_mode: training.case_selection_mode,
      reference_training_ids: training.reference_training_ids ?? undefined,
      reference_mode: training.reference_mode ?? undefined,
      suppress_general_instructions: training.suppress_general_instructions,
      assigned_variables: training.variables?.map(v => ({
        variableId: v.variable_id,
        unitName: v.unit_name,
        sampleCount: v.sample_count
      })),
      assigned_variable_bundles: training.bundles?.map(b => ({
        id: b.variable_bundle_id,
        name: b.bundle?.name || 'Unknown Bundle',
        sampleCount: b.sample_count,
        caseOrderingMode: b.case_ordering_mode
      })),
      assigned_coders: training.coders?.map(c => c.user_id)
    }));
  }

  async getTrainingCodingComparison(
    workspaceId: number,
    trainingIds: number[]
  ): Promise<Array<{
      responseId: number;
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      testPerson: string;
      coders: Array<{
        trainingId: number;
        trainingLabel: string;
        coderId: number;
        coderName: string;
        code: string | null;
        score: number | null;
        notes: string | null;
        codingIssueOption: number | null;
      }>;
    }>> {
    this.logger.log(`Getting coding comparison for trainings ${trainingIds.join(', ')} in workspace ${workspaceId}`);

    const trainings = await this.coderTrainingRepository.find({
      where: {
        workspace_id: workspaceId,
        id: In(trainingIds)
      },
      relations: [
        'codingJobs',
        'codingJobs.codingJobUnits',
        'codingJobs.codingJobCoders',
        'codingJobs.codingJobCoders.user'
      ],
      order: { label: 'ASC' }
    });

    if (trainings.length === 0) {
      return [];
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const allTrainingJobs = trainings.flatMap(training => training.codingJobs || []);
    const missingCodesByJobId = await this.buildMissingCodesByJobId(workspaceId, allTrainingJobs);
    const defaultMissingCodeContext = await this.getDefaultMissingCodeDisplayContext(workspaceId);

    const responseMap = new Map<number, {
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      testPerson: string;
    }>();

    // Identify all unique responses involved across all selected trainings
    trainings.forEach(training => {
      training.codingJobs?.forEach(job => {
        job.codingJobUnits?.forEach(unit => {
          if (isExcludedByResolvedExclusions(exclusions, unit.booklet_name, unit.unit_name)) {
            return;
          }
          if (unit.response_id && !responseMap.has(unit.response_id)) {
            const personGroup = unit.person_group || '';
            const testPerson = `${unit.person_login} (${personGroup}) - ${unit.booklet_name}`;

            responseMap.set(unit.response_id, {
              unitName: unit.unit_name,
              variableId: unit.variable_id,
              personCode: unit.person_code,
              personLogin: unit.person_login,
              personGroup: personGroup,
              testPerson
            });
          }
        });
      });
    });

    const comparisonData: Array<{
      responseId: number;
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      testPerson: string;
      coders: Array<{
        trainingId: number;
        trainingLabel: string;
        coderId: number;
        coderName: string;
        code: string | null;
        score: number | null;
        notes: string | null;
        codingIssueOption: number | null;
      }>;
    }> = [];

    // For each unique response, find how it was coded in each training by ALL coders
    for (const [responseId, info] of responseMap.entries()) {
      const codersData: Array<{
        trainingId: number;
        trainingLabel: string;
        coderId: number;
        coderName: string;
        code: string | null;
        score: number | null;
        notes: string | null;
        codingIssueOption: number | null;
      }> = [];

      for (const training of trainings) {
        if (training.codingJobs) {
          for (const job of training.codingJobs) {
            // Find if this job (coder) has a unit for this response
            const unit = job.codingJobUnits?.find(u => (
              u.response_id === responseId &&
              !isExcludedByResolvedExclusions(exclusions, u.booklet_name, u.unit_name)
            ));

            // Determine coder info
            // Assuming one coder per job for now, which is standard in this system
            const coderUser = job.codingJobCoders?.[0]?.user;

            // If no user assigned (rare), use job name? CoderTrainingService logic usually ensures assignment.
            // But let's be safe.
            const coderName = coderUser ? coderUser.username : `Job ${job.id}`;

            if (unit) {
              // This coder HAS this response assigned
              const mappedDisplay = this.mapDisplayCodeAndScore(
                unit.code,
                unit.score,
                unit.coding_issue_option,
                missingCodesByJobId.get(job.id) ?? defaultMissingCodeContext
              );

              codersData.push({
                trainingId: training.id,
                trainingLabel: training.label,
                coderId: job.id,
                coderName: coderName,
                code: mappedDisplay.code,
                score: mappedDisplay.score,
                notes: unit.notes,
                codingIssueOption: unit.coding_issue_option
              });
            }
          }
        }
      }

      comparisonData.push({
        responseId,
        unitName: info.unitName,
        variableId: info.variableId,
        personCode: info.personCode,
        personLogin: info.personLogin,
        personGroup: info.personGroup,
        testPerson: info.testPerson,
        coders: codersData
      });
    }

    // Sort by Unit, Variable, then Person
    comparisonData.sort((a, b) => {
      if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
      if (a.variableId !== b.variableId) return a.variableId.localeCompare(b.variableId);
      return a.personLogin.localeCompare(b.personLogin);
    });

    this.logger.log(`Generated comparison data for ${comparisonData.length} unique responses across ${trainings.length} trainings`);

    return comparisonData;
  }

  async getWithinTrainingCodingComparison(
    workspaceId: number,
    trainingId: number
  ): Promise<Array<{

      responseId: number;

      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      testPerson: string;
      givenAnswer: string;
      replayCode: number | null;
      replayScore: number | null;
      discussionCode: number | null;
      discussionScore: number | null;
      discussionManagerUserId: number | null;
      discussionManagerName: string | null;
      discussionSource: DiscussionSource;
      coders: WithinTrainingCoderResult[];
    }>> {
    this.logger.log(`Getting within-training coding comparison for training ${trainingId} in workspace ${workspaceId}`);

    const training = await this.coderTrainingRepository.findOne({
      where: {
        workspace_id: workspaceId,
        id: trainingId
      },
      relations: ['codingJobs.codingJobCoders.user', 'codingJobs.codingJobUnits.response.unit.booklet.person']
    });

    if (!training || !training.codingJobs) {
      return [];
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const missingCodesByJobId = await this.buildMissingCodesByJobId(workspaceId, training.codingJobs);
    const defaultMissingCodeContext = await this.getDefaultMissingCodeDisplayContext(workspaceId);

    const unitVariableMap = new Map<string, {
      responseId: number;
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      testPerson: string;
      givenAnswer: string;
      replayCode: number | null;
      replayScore: number | null;
    }>();

    training.codingJobs.forEach(job => {
      job.codingJobUnits?.forEach(unit => {
        if (isExcludedByResolvedExclusions(exclusions, unit.booklet_name, unit.unit_name)) {
          return;
        }
        const unitVariableKey = unit.response_id.toString();
        if (!unitVariableMap.has(unitVariableKey)) {
          const givenAnswer = unit.response?.value || '';
          const personGroup = unit.response?.unit?.booklet?.person?.group || '';
          const testPerson = `${unit.person_login} (${personGroup}) - ${unit.booklet_name}`;

          unitVariableMap.set(unitVariableKey, {
            responseId: unit.response_id,
            unitName: unit.unit_name,
            variableId: unit.variable_id,
            personCode: unit.person_code,
            personLogin: unit.person_login,
            personGroup: personGroup,
            testPerson,
            givenAnswer,
            replayCode: unit.response?.code_v3 ?? unit.response?.code_v2 ?? unit.response?.code_v1 ?? null,
            replayScore: unit.response?.score_v3 ?? unit.response?.score_v2 ?? unit.response?.score_v1 ?? null
          });
        }
      });
    });

    const comparisonData = [];
    const responseIds = Array.from(unitVariableMap.values()).map(item => item.responseId);
    const persistedDiscussionResults = responseIds.length > 0 ?
      await this.coderTrainingDiscussionResultRepository.find({
        where: {
          workspace_id: workspaceId,
          training_id: trainingId,
          response_id: In(responseIds)
        }
      }) :
      [];
    const discussionByResponseId = new Map<number, CoderTrainingDiscussionResult>();
    persistedDiscussionResults.forEach(result => {
      discussionByResponseId.set(result.response_id, result);
    });

    const managerUserIds = [...new Set(persistedDiscussionResults
      .map(result => result.manager_user_id)
      .filter((id): id is number => id !== null && id !== undefined))];
    const managerNameById = new Map<number, string>();
    if (managerUserIds.length > 0) {
      const users = await this.userRepository.find({
        where: { id: In(managerUserIds) }
      });
      users.forEach(user => {
        managerNameById.set(user.id, user.username);
      });
    }

    for (const [, unitVar] of unitVariableMap.entries()) {
      const codersData: WithinTrainingCoderResult[] = [];

      for (const job of training.codingJobs) {
        let code: number | null = null;
        let score: number | null = null;
        let notes: string | null = null;
        let codingIssueOption: number | null = null;

        const coderName = job.codingJobCoders && job.codingJobCoders.length > 0 && job.codingJobCoders[0].user ?
          `${job.codingJobCoders[0].user.username || 'Unknown'}` :
          `Coder ${job.name}`;

        job.codingJobUnits?.forEach(unit => {
          if (
            unit.response_id === unitVar.responseId &&
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

        const mappedDisplay = this.mapDisplayCodeAndScore(
          code,
          score,
          codingIssueOption,
          missingCodesByJobId.get(job.id) ?? defaultMissingCodeContext
        );

        codersData.push({
          jobId: job.id,
          coderName,
          code: mappedDisplay.code,
          score: mappedDisplay.score,
          notes,
          codingIssueOption
        });
      }

      const discussionResult = discussionByResponseId.get(unitVar.responseId);
      const hasManualDiscussionResult = discussionResult?.code !== null && discussionResult?.code !== undefined;
      const automaticDiscussionResult = hasManualDiscussionResult ?
        null :
        await this.deriveAutomaticDiscussionResultForResponse(
          workspaceId,
          training,
          unitVar.responseId,
          codersData,
          exclusions
        );
      let discussionCode = automaticDiscussionResult?.code ?? null;
      let discussionScore = automaticDiscussionResult?.score ?? null;
      let discussionManagerUserId: number | null = null;
      let discussionManagerName: string | null = null;
      let discussionSource: DiscussionSource = automaticDiscussionResult ? 'auto_agreement' : null;

      if (hasManualDiscussionResult) {
        discussionCode = discussionResult!.code;
        discussionScore = discussionResult!.score;
        discussionManagerUserId = discussionResult!.manager_user_id ?? null;
        discussionManagerName = discussionResult!.manager_user_id ?
          (managerNameById.get(discussionResult!.manager_user_id) ?? discussionResult!.manager_name ?? null) :
          (discussionResult!.manager_name ?? null);
        discussionSource = 'manual';
      }

      comparisonData.push({
        responseId: unitVar.responseId,
        unitName: unitVar.unitName,
        variableId: unitVar.variableId,
        personCode: unitVar.personCode,
        personLogin: unitVar.personLogin,
        personGroup: unitVar.personGroup,
        testPerson: unitVar.testPerson,
        givenAnswer: unitVar.givenAnswer,
        replayCode: unitVar.replayCode,
        replayScore: unitVar.replayScore,
        discussionCode,
        discussionScore,
        discussionManagerUserId,
        discussionManagerName,
        discussionSource,
        coders: codersData
      });
    }

    this.logger.log(`Generated within-training comparison data for ${comparisonData.length} unit/variable combinations across ${training.codingJobs.length} coders`);

    return comparisonData;
  }

  async updateCoderTraining(
    workspaceId: number,
    trainingId: number,
    trainingLabel: string,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number }[],
    missingsProfileId?: number,
    assignedVariables?: JobDefinitionVariable[],
    assignedVariableBundles?: JobDefinitionVariableBundle[],
    caseOrderingMode?: 'continuous' | 'alternating',
    caseSelectionMode?: CaseSelectionMode,
    referenceTrainingIds?: number[],
    referenceMode?: ReferenceMode,
    suppressGeneralInstructions?: boolean
  ): Promise<{ success: boolean; message: string; jobsCreated?: number; jobs?: TrainingJob[] }> {
    try {
      this.logger.log(`Updating coder training ${trainingId} in workspace ${workspaceId}`);
      await this.codingJobService.assertCodersCanCodeInWorkspace(
        selectedCoders.map(coder => coder.id),
        workspaceId
      );

      const training = await this.coderTrainingRepository.findOne({
        where: { id: trainingId, workspace_id: workspaceId },
        relations: ['codingJobs', 'variables', 'bundles', 'coders']
      });

      if (!training) {
        return { success: false, message: 'Training nicht gefunden' };
      }

      const resolvedCurrentProfileIds = await Promise.all((training.codingJobs || [])
        .map(job => this.missingsProfilesService.resolveMissingsProfileId(
          workspaceId,
          job.missings_profile_id
        )));
      const currentProfileKeys = new Set(resolvedCurrentProfileIds);
      const hasConflictingCurrentMissingsProfiles = currentProfileKeys.size > 1;
      if (hasConflictingCurrentMissingsProfiles && missingsProfileId === undefined) {
        throw new BadRequestException(`Conflicting missing profiles for training ${trainingId}`);
      }
      const currentMissingsProfileId = currentProfileKeys.size === 1 ?
        Array.from(currentProfileKeys)[0] :
        null;
      const resolvedCurrentMissingsProfileId = await this.missingsProfilesService.resolveMissingsProfileId(
        workspaceId,
        currentMissingsProfileId
      );
      const resolvedMissingsProfileId = missingsProfileId !== undefined ?
        await this.missingsProfilesService.resolveMissingsProfileId(workspaceId, missingsProfileId) :
        resolvedCurrentMissingsProfileId;

      // Check if critical configuration changed (coders or variables)
      const currentCoderIds = training.coders?.map(c => c.user_id).sort() || [];
      const newCoderIds = selectedCoders.map(c => c.id).sort();
      const codersChanged = JSON.stringify(currentCoderIds) !== JSON.stringify(newCoderIds);

      const currentAssignedVariables: JobDefinitionVariable[] = training.variables?.map(v => ({
        variableId: v.variable_id,
        unitName: v.unit_name,
        sampleCount: v.sample_count || 10
      })) || [];

      const currentCaseOrderingMode = training.case_ordering_mode || 'continuous';
      const newCaseOrderingMode = caseOrderingMode ?? currentCaseOrderingMode;

      const currentAssignedVariableBundles: JobDefinitionVariableBundle[] = training.bundles?.map(b => ({
        id: b.variable_bundle_id,
        name: b.bundle?.name || '',
        sampleCount: b.sample_count || 10,
        caseOrderingMode: b.case_ordering_mode ?? undefined
      })) || [];

      const effectiveAssignedVariables = assignedVariables ?? currentAssignedVariables;
      const effectiveAssignedVariableBundles = assignedVariableBundles ?? currentAssignedVariableBundles;

      const currentVariables = currentAssignedVariables.map(v => ({
        variableId: v.variableId,
        unitName: v.unitName,
        sampleCount: v.sampleCount || 10
      })).sort((a, b) => (a.variableId + a.unitName).localeCompare(b.variableId + b.unitName));

      const newVariables = effectiveAssignedVariables.map(v => ({
        variableId: v.variableId,
        unitName: v.unitName,
        sampleCount: v.sampleCount || 10
      })).sort((a, b) => (a.variableId + a.unitName).localeCompare(b.variableId + b.unitName));

      const variablesChanged = JSON.stringify(currentVariables) !== JSON.stringify(newVariables);

      const currentBundles = currentAssignedVariableBundles.map(b => ({
        id: b.id,
        sampleCount: b.sampleCount || 10,
        caseOrderingMode: b.caseOrderingMode ?? currentCaseOrderingMode
      })).sort((a, b) => a.id - b.id);

      const newBundles = effectiveAssignedVariableBundles.map(b => ({
        id: b.id,
        sampleCount: b.sampleCount || 10,
        caseOrderingMode: b.caseOrderingMode ?? newCaseOrderingMode
      })).sort((a, b) => a.id - b.id);

      const bundlesChanged = JSON.stringify(currentBundles) !== JSON.stringify(newBundles);
      const caseOrderingChanged = currentCaseOrderingMode !== newCaseOrderingMode;
      const currentCaseSelectionMode = training.case_selection_mode || 'oldest_first';
      const newCaseSelectionMode = caseSelectionMode ?? currentCaseSelectionMode;
      const currentReferenceTrainingIds = [...(training.reference_training_ids ?? [])].sort((a, b) => a - b);
      const effectiveReferenceTrainingIds = referenceTrainingIds ?? training.reference_training_ids ?? [];
      const newReferenceTrainingIds = [...effectiveReferenceTrainingIds].sort((a, b) => a - b);
      const currentReferenceMode = training.reference_mode ?? null;
      const newReferenceMode = effectiveReferenceTrainingIds.length > 0 ?
        referenceMode ?? currentReferenceMode :
        null;
      const caseSelectionChanged = currentCaseSelectionMode !== newCaseSelectionMode;
      const referenceSelectionChanged = JSON.stringify(currentReferenceTrainingIds) !== JSON.stringify(newReferenceTrainingIds) ||
        currentReferenceMode !== newReferenceMode;
      const missingsProfileChanged = hasConflictingCurrentMissingsProfiles ||
        resolvedCurrentMissingsProfileId !== resolvedMissingsProfileId;
      const shouldRecreateJobs =
        codersChanged ||
        variablesChanged ||
        bundlesChanged ||
        caseOrderingChanged ||
        caseSelectionChanged ||
        referenceSelectionChanged ||
        missingsProfileChanged;

      if (shouldRecreateJobs) {
        const jobIds = (training.codingJobs || []).map(job => job.id);
        const [hasCodingProgress, hasDiscussionResults] = await Promise.all([
          this.hasCodingProgressForJobs(jobIds),
          this.hasDiscussionResultsForTraining(workspaceId, trainingId)
        ]);
        if (hasCodingProgress || hasDiscussionResults) {
          return {
            success: false,
            message: 'Die Schulung wurde bereits bearbeitet. Änderungen an Fallauswahl, Fallreihenfolge, Referenzen, Missing-Profil, Kodierern oder Variablen würden bestehende Kodierungen löschen.'
          };
        }
      }

      const resolvedSuppressGeneralInstructions = suppressGeneralInstructions ??
        training.suppress_general_instructions ??
        false;

      training.label = trainingLabel;
      training.case_ordering_mode = newCaseOrderingMode;
      training.case_selection_mode = newCaseSelectionMode;
      training.reference_training_ids = effectiveReferenceTrainingIds.length ? effectiveReferenceTrainingIds : null;
      training.reference_mode = newReferenceMode;
      training.suppress_general_instructions = resolvedSuppressGeneralInstructions;
      training.updated_at = new Date();

      await this.coderTrainingRepository.save(training);

      if (shouldRecreateJobs) {
        this.logger.log(`Configuration changed for training ${trainingId}. Recreating jobs.`);

        // Delete existing configuration relations
        await this.coderTrainingVariableRepository.delete({ coder_training_id: trainingId });
        await this.coderTrainingBundleRepository.delete({ coder_training_id: trainingId });
        await this.coderTrainingCoderRepository.delete({ coder_training_id: trainingId });

        // Save new configuration relations
        for (const variable of effectiveAssignedVariables) {
          const trainingVariable = new CoderTrainingVariable();
          trainingVariable.coder_training_id = trainingId;
          trainingVariable.variable_id = variable.variableId;
          trainingVariable.unit_name = variable.unitName;
          trainingVariable.sample_count = variable.sampleCount || 10;
          await this.coderTrainingVariableRepository.save(trainingVariable);
        }

        for (const bundle of effectiveAssignedVariableBundles) {
          const trainingBundle = new CoderTrainingBundle();
          trainingBundle.coder_training_id = trainingId;
          trainingBundle.variable_bundle_id = bundle.id;
          trainingBundle.sample_count = bundle.sampleCount || 10;
          trainingBundle.case_ordering_mode = bundle.caseOrderingMode ?? null;
          await this.coderTrainingBundleRepository.save(trainingBundle);
        }

        for (const coder of selectedCoders) {
          const trainingCoder = new CoderTrainingCoder();
          trainingCoder.coder_training_id = trainingId;
          trainingCoder.user_id = coder.id;
          await this.coderTrainingCoderRepository.save(trainingCoder);
        }
        this.logger.log(`Configuration changed for training ${trainingId}. Recreating jobs.`);

        // Delete existing jobs and their associations
        for (const job of training.codingJobs || []) {
          await this.codingJobUnitRepository.delete({ coding_job_id: job.id });
          await this.codingJobVariableRepository.delete({ coding_job_id: job.id });
          await this.codingJobCoderRepository.delete({ coding_job_id: job.id });
          await this.codingJobRepository.delete(job.id);
        }

        // Generate and create new jobs
        const trainingPackages = await this.generateCoderTrainingPackages(workspaceId, selectedCoders, variableConfigs, {
          caseSelectionMode: newCaseSelectionMode,
          referenceTrainingIds: effectiveReferenceTrainingIds,
          referenceMode: newReferenceMode ?? undefined
        });

        // Build mapping from variable to bundle id and bundle sorting mode
        const variableToBundleMap = new Map<string, number>();
        const bundleSortingModeMap = new Map<number, 'continuous' | 'alternating' | null>();
        this.logger.log(`[Update] Building bundle maps for ${effectiveAssignedVariableBundles.length} bundles`);
        if (effectiveAssignedVariableBundles.length > 0) {
          const bundleIds = effectiveAssignedVariableBundles.map(b => b.id);
          if (bundleIds.length > 0) {
            const fetchedBundles = await this.variableBundleRepository.find({
              where: { id: In(bundleIds) }
            });
            for (const bundle of fetchedBundles) {
              // Store the bundle's sorting mode (if set, otherwise null)
              const bundleConfig = effectiveAssignedVariableBundles.find(b => b.id === bundle.id);
              const mode = bundleConfig?.caseOrderingMode ?? null;
              bundleSortingModeMap.set(bundle.id, mode);
              this.logger.log(`[Update] Bundle ${bundle.id} (${bundle.name}): mode=${mode}`);
              if (bundle.variables) {
                for (const v of bundle.variables) {
                  const key = `${v.unitName}::${v.variableId}`;
                  variableToBundleMap.set(key, bundle.id);
                  this.logger.debug(`[Update]   Variable mapping: ${key} -> bundle ${bundle.id}`);
                }
              }
            }
          }
        }

        const jobs: TrainingJob[] = [];
        let jobsCreatedCount = 0;

        for (const trainingPackage of trainingPackages) {
          const coderId = trainingPackage.coderId;
          const coderName = trainingPackage.coderName;

          const codingJob = new CodingJob();
          codingJob.name = `${trainingLabel}-${coderName}`;
          codingJob.workspace_id = workspaceId;
          codingJob.training_id = trainingId;
          codingJob.missings_profile_id = resolvedMissingsProfileId;
          codingJob.case_ordering_mode = newCaseOrderingMode;
          codingJob.suppressGeneralInstructions = resolvedSuppressGeneralInstructions;
          codingJob.created_at = new Date();
          codingJob.updated_at = new Date();

          const savedJob = await this.codingJobRepository.save(codingJob);
          const jobId = savedJob.id;

          jobsCreatedCount += 1;
          jobs.push({
            coderId,
            coderName,
            jobId,
            jobName: codingJob.name
          });

          const codingJobCoder = new CodingJobCoder();
          codingJobCoder.coding_job_id = jobId;
          codingJobCoder.user_id = coderId;
          await this.codingJobCoderRepository.save(codingJobCoder);

          // Save bundle configurations to CodingJobVariableBundle for display sorting
          const seenBundleIdsForJob = new Set<number>();
          for (const response of trainingPackage.responses) {
            const bundleId = variableToBundleMap.get(`${response.unitName}::${response.variableId}`);
            if (bundleId && !seenBundleIdsForJob.has(bundleId)) {
              seenBundleIdsForJob.add(bundleId);
              const bundleMode = bundleSortingModeMap.get(bundleId);
              const jobVariableBundle = new CodingJobVariableBundle();
              jobVariableBundle.coding_job_id = jobId;
              jobVariableBundle.variable_bundle_id = bundleId;
              jobVariableBundle.case_ordering_mode = bundleMode ?? null;
              await this.codingJobVariableBundleRepository.save(jobVariableBundle);
              this.logger.log(`[Update] Saved CodingJobVariableBundle: job=${jobId}, bundle=${bundleId}, mode=${bundleMode || 'null'}`);
            }
          }

          const processedVariables = new Set<string>();
          for (const response of trainingPackage.responses) {
            const variableKey = `${response.variableId}:${response.unitName}`;
            if (!processedVariables.has(variableKey)) {
              const codingJobVariable = new CodingJobVariable();
              codingJobVariable.coding_job_id = jobId;
              codingJobVariable.variable_id = response.variableId;
              codingJobVariable.unit_name = response.unitName;
              await this.codingJobVariableRepository.save(codingJobVariable);
              processedVariables.add(variableKey);
            }
          }

          // Sort responses with bundle-specific sorting modes
          // Group responses by their effective sorting mode
          const defaultMode = newCaseOrderingMode;
          const alternatingResponses: CoderTrainingResponse[] = [];
          const continuousResponses: CoderTrainingResponse[] = [];

          for (const response of trainingPackage.responses) {
            const bundleId = variableToBundleMap.get(`${response.unitName}::${response.variableId}`);
            const bundleMode = bundleId !== undefined ? bundleSortingModeMap.get(bundleId) : undefined;
            const effectiveMode = bundleMode || defaultMode;

            this.logger.debug(`Response ${response.responseId} (${response.unitName}::${response.variableId}): bundleId=${bundleId}, bundleMode=${bundleMode}, effectiveMode=${effectiveMode}`);

            if (effectiveMode === 'alternating') {
              alternatingResponses.push(response);
            } else {
              continuousResponses.push(response);
            }
          }

          this.logger.log(`Sorting: ${alternatingResponses.length} alternating, ${continuousResponses.length} continuous (default: ${defaultMode})`);

          // Sort each group with its respective mode
          const sortedAlternating = this.sortTrainingResponses(alternatingResponses, 'alternating');
          const sortedContinuous = this.sortTrainingResponses(continuousResponses, 'continuous');

          // Combine: alternating first, then continuous
          const sortedResponses = [...sortedAlternating, ...sortedContinuous];

          const codingJobUnits: CodingJobUnit[] = sortedResponses.map(response => {
            const codingJobUnit = new CodingJobUnit();
            codingJobUnit.coding_job_id = jobId;
            codingJobUnit.workspace_id = workspaceId;
            codingJobUnit.response_id = response.responseId;
            codingJobUnit.unit_name = response.unitName;
            codingJobUnit.unit_alias = response.unitAlias || null;
            codingJobUnit.variable_id = response.variableId;
            codingJobUnit.variable_anchor = response.variableId; // Same as variable_id
            codingJobUnit.booklet_name = response.bookletName;
            codingJobUnit.person_login = response.personLogin;
            codingJobUnit.person_code = response.personCode;
            codingJobUnit.person_group = response.personGroup;
            codingJobUnit.is_open = true;
            codingJobUnit.variable_bundle_id = variableToBundleMap.get(`${response.unitName}::${response.variableId}`) || null;
            return codingJobUnit;
          });
          await this.codingJobUnitRepository.save(codingJobUnits);
          this.logger.log(`Bulk-inserted ${codingJobUnits.length} coding job units to training job ${jobId} for coder ${coderName}`);
        }

        return {
          success: true,
          message: 'Training erfolgreich aktualisiert und neue Kodierungsaufträge erstellt',
          jobsCreated: jobsCreatedCount,
          jobs
        };
      }

      for (const job of training.codingJobs || []) {
        job.suppressGeneralInstructions = resolvedSuppressGeneralInstructions;
        await this.codingJobRepository.save(job);
      }

      return { success: true, message: 'Training erfolgreich aktualisiert' };
    } catch (error) {
      this.logger.error(`Error updating coder training: ${error.message}`, error.stack);
      return { success: false, message: `Fehler beim Aktualisieren des Trainings: ${error.message}` };
    }
  }

  async updateCoderTrainingLabel(workspaceId: number, trainingId: number, newLabel: string): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Updating coder training ${trainingId} label to "${newLabel}" in workspace ${workspaceId}`);

      const training = await this.coderTrainingRepository.findOne({
        where: {
          id: trainingId,
          workspace_id: workspaceId
        }
      });

      if (!training) {
        return {
          success: false,
          message: `Coder training with ID ${trainingId} not found in workspace ${workspaceId}`
        };
      }

      training.label = newLabel;
      training.updated_at = new Date();

      await this.coderTrainingRepository.save(training);
      this.logger.log(`Updated coder training ${trainingId} label to "${newLabel}"`);

      return {
        success: true,
        message: `Successfully updated coder training label to "${newLabel}"`
      };
    } catch (error) {
      const errorMessage = `Error updating coder training label: ${error.message}`;
      this.logger.error(errorMessage, error.stack);
      return {
        success: false,
        message: errorMessage
      };
    }
  }

  async getCodingJobsForTraining(workspaceId: number, trainingId: number): Promise<Array<{
    id: number;
    name: string;
    description?: string;
    status: string;
    created_at: Date;
    coder: {
      userId: number;
      username: string;
    };
    unitsCount: number;
  }>> {
    this.logger.log(`Getting coding jobs for training ${trainingId} in workspace ${workspaceId}`);

    const training = await this.coderTrainingRepository.findOne({
      where: {
        id: trainingId,
        workspace_id: workspaceId
      },
      relations: ['codingJobs', 'codingJobs.codingJobCoders', 'codingJobs.codingJobCoders.user', 'codingJobs.codingJobUnits']
    });

    if (!training || !training.codingJobs) {
      return [];
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    return training.codingJobs.map(job => ({
      id: job.id,
      name: job.name,
      description: job.description,
      status: job.status,
      created_at: job.created_at,
      coder: job.codingJobCoders && job.codingJobCoders.length > 0 && job.codingJobCoders[0].user ? {
        userId: job.codingJobCoders[0].user.id,
        username: job.codingJobCoders[0].user.username
      } : {
        userId: 0,
        username: 'Unknown'
      },
      unitsCount: job.codingJobUnits?.filter(unit => !isExcludedByResolvedExclusions(
        exclusions,
        unit.booklet_name,
        unit.unit_name
      )).length || 0
    }));
  }

  async deleteCoderTraining(workspaceId: number, trainingId: number): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Deleting coder training ${trainingId} in workspace ${workspaceId}`);

      const training = await this.coderTrainingRepository.findOne({
        where: {
          id: trainingId,
          workspace_id: workspaceId
        },
        relations: ['codingJobs', 'codingJobs.codingJobUnits']
      });

      if (!training) {
        return {
          success: false,
          message: `Coder training with ID ${trainingId} not found in workspace ${workspaceId}`
        };
      }

      for (const job of training.codingJobs || []) {
        await this.codingJobUnitRepository.delete({ coding_job_id: job.id });
        this.logger.log(`Deleted ${job.codingJobUnits?.length || 0} coding job units for job ${job.id}`);
      }

      for (const job of training.codingJobs || []) {
        await this.codingJobVariableRepository.delete({ coding_job_id: job.id });
        this.logger.log(`Deleted coding job variables for job ${job.id}`);
      }

      for (const job of training.codingJobs || []) {
        await this.codingJobCoderRepository.delete({ coding_job_id: job.id });
        this.logger.log(`Deleted coding job coders for job ${job.id}`);
      }

      const jobsDeleted = training.codingJobs?.length || 0;
      if (jobsDeleted > 0) {
        await this.codingJobRepository.delete({ training_id: trainingId });
        this.logger.log(`Deleted ${jobsDeleted} coding jobs for training ${trainingId}`);
      }

      await this.coderTrainingRepository.delete(trainingId);
      this.logger.log(`Deleted coder training ${trainingId}`);

      return {
        success: true,
        message: `Successfully deleted coder training "${training.label}" with ${jobsDeleted} associated jobs`
      };
    } catch (error) {
      const errorMessage = `Error deleting coder training: ${error.message}`;
      this.logger.error(errorMessage, error.stack);
      return {
        success: false,
        message: errorMessage
      };
    }
  }

  /**
   * Transform within-training comparison data to format expected by Cohen's Kappa calculation
   * This allows reuse of existing Cohen's Kappa calculation logic
   */
  transformToCoderPairs(
    comparisonData: Array<{
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      testPerson: string;
      givenAnswer: string;
      coders: Array<{
        jobId: number;
        coderName: string;
        code: string | null;
        score: number | null;
      }>;
    }>
  ): Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      unitName: string;
      variableId: string;
      codes: Array<{ code1: number | null; code2: number | null }>;
      scores: Array<{ score1: number | null; score2: number | null }>;
    }> {
    this.logger.log(`Transforming ${comparisonData.length} comparison items to coder pairs format`);

    // Group by unit/variable to get all responses for each variable
    const variableMap = new Map<string, typeof comparisonData>();

    for (const item of comparisonData) {
      const key = `${item.unitName}:${item.variableId}`;
      if (!variableMap.has(key)) {
        variableMap.set(key, []);
      }
      variableMap.get(key)!.push(item);
    }

    const allCoderPairs: Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      unitName: string;
      variableId: string;
      codes: Array<{ code1: number | null; code2: number | null }>;
      scores: Array<{ score1: number | null; score2: number | null }>;
    }> = [];

    // For each variable, create coder pairs
    for (const [variableKey, items] of variableMap.entries()) {
      if (items.length === 0) continue;

      // Get all unique coders from the first item (all items should have same coders)
      const coders = items[0].coders;

      if (coders.length < 2) {
        this.logger.warn(`Variable ${variableKey} has less than 2 coders, skipping`);
        continue;
      }

      // Create all possible pairs of coders
      for (let i = 0; i < coders.length; i++) {
        for (let j = i + 1; j < coders.length; j++) {
          const coder1 = coders[i];
          const coder2 = coders[j];

          // Collect code and score pairs for this coder pair across all responses
          const codePairs: Array<{ code1: number | null; code2: number | null }> = [];
          const scorePairs: Array<{ score1: number | null; score2: number | null }> = [];

          for (const item of items) {
            const coder1Data = item.coders.find(c => c.jobId === coder1.jobId);
            const coder2Data = item.coders.find(c => c.jobId === coder2.jobId);

            if (coder1Data && coder2Data) {
              // Convert string codes to numbers (codes are stored as strings in the comparison data)
              const code1 = coder1Data.code !== null ? parseInt(coder1Data.code, 10) : null;
              const code2 = coder2Data.code !== null ? parseInt(coder2Data.code, 10) : null;

              codePairs.push({
                code1: Number.isNaN(code1) ? null : code1,
                code2: Number.isNaN(code2) ? null : code2
              });

              // Collect score pairs
              scorePairs.push({
                score1: coder1Data.score,
                score2: coder2Data.score
              });
            }
          }

          if (codePairs.length > 0) {
            allCoderPairs.push({
              coder1Id: coder1.jobId,
              coder1Name: coder1.coderName,
              coder2Id: coder2.jobId,
              coder2Name: coder2.coderName,
              unitName: items[0].unitName,
              variableId: items[0].variableId,
              codes: codePairs,
              scores: scorePairs
            });
          }
        }
      }
    }

    this.logger.log(`Created ${allCoderPairs.length} coder pairs from ${variableMap.size} variables`);
    return allCoderPairs;
  }
}
