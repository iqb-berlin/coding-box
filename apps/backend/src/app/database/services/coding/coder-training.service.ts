import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, In, IsNull, Not, Brackets
} from 'typeorm';
import { createHash } from 'crypto';
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
import {
  DERIVE_ERROR_STATUS,
  MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
} from '../../utils/manual-coding-candidate.util';
import {
  buildAggregationGroups,
  deduplicateManualCodingResponses
} from './aggregation-metrics.util';
import { TrainingComparisonFreshnessDto } from '../../../../../../../api-dto/coding/training-comparison-freshness.dto';
import {
  TrainingCodingComparisonPageDto,
  TrainingCodingComparisonRowDto,
  TrainingComparisonCoderDto,
  TrainingComparisonFiltersDto,
  TrainingComparisonNotesFilter,
  TrainingComparisonSortBy,
  TrainingComparisonSortDirection,
  TrainingComparisonSummaryDto,
  WithinTrainingCodingComparisonPageDto,
  WithinTrainingCodingComparisonRowDto,
  WithinTrainingComparisonCoderDto
} from '../../../../../../../api-dto/coding/training-comparison.dto';
import {
  KappaCalculationLevel,
  TrainingKappaStatisticsDto
} from '../../../../../../../api-dto/coding/training-kappa-statistics.dto';
import {
  CodingStatisticsService,
  KappaCalculationResult
} from './coding-statistics.service';
import { calculateMetricMean } from './interrater-reliability.calculator';

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
  show_score?: boolean;
  allow_comments?: boolean;
  suppress_general_instructions?: boolean;
}

export type TrainingResponseIdsMap = Record<string, number[]>;

type TrainingVariableConfig = {
  variableId: string;
  unitId: string;
  sampleCount: number;
  includeDeriveError?: boolean;
};

type TrainingBundleConfig = {
  id: number;
  name: string;
  sampleCount: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  variables: TrainingVariableConfig[];
};

type DiscussionSource = 'manual' | 'auto_agreement' | null;

type SaveDiscussionResultResponse = {
  success: boolean;
  code: number | null;
  score: number | null;
  notes: string | null;
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

type WithinTrainingCodingRow = {
  jobId: number | string;
  unitRowId: number | string;
  responseId: number | string;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string | null;
  bookletName: string;
  givenAnswer: string | null;
  replayCodeV1: number | string | null;
  replayCodeV2: number | string | null;
  replayCodeV3: number | string | null;
  replayScoreV1: number | string | null;
  replayScoreV2: number | string | null;
  replayScoreV3: number | string | null;
  code: number | string | null;
  score: number | string | null;
  notes: string | null;
  codingIssueOption: number | string | null;
};

type TrainingComparisonFreshnessAggregateRow = {
  unitCount: number | string | null;
  responseCount: number | string | null;
  latestUnitChange: Date | string | null;
};

type TrainingDiscussionFreshnessAggregateRow = {
  discussionResultCount: number | string | null;
  latestDiscussionChange: Date | string | null;
};

type TrainingComparisonResponseFreshnessRow = {
  responseId: number | string | null;
  responseHash: string | null;
};

type TrainingComparisonStatus = 'match' | 'differ' | 'incomplete' | 'not_comparable';

type TrainingComparisonCodeSlot = {
  code: string | null;
  hasEntry: boolean;
  trainingId?: number;
};

type TrainingComparisonPageOptions = {
  page?: number;
  limit?: number;
  sortBy?: TrainingComparisonSortBy;
  sortDirection?: TrainingComparisonSortDirection;
  filters?: TrainingComparisonFiltersDto;
  selectedCoderKeys?: string[];
  selectedJobIds?: number[];
};

type TrainingKappaCalculationLevel = KappaCalculationLevel;

export type TrainingCohensKappaStatistics = TrainingKappaStatisticsDto;

type TrainingKappaOptions = {
  weightedMean?: boolean;
  level?: TrainingKappaCalculationLevel;
  selectedJobIds?: number[];
};

type TrainingComparisonAggregateRow = {
  responseId: number | string;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string | null;
  bookletName: string;
  completeCodeCount: number | string | null;
  distinctCodeCount: number | string | null;
  hasNotes: boolean | string | number | null;
};

type TrainingComparisonCandidate = {
  responseId: number;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string;
  bookletName: string;
  testPerson: string;
  status: TrainingComparisonStatus;
  hasNotes: boolean;
};

type TrainingComparisonRawUnitRow = {
  trainingId: number | string;
  trainingLabel: string;
  jobId: number | string;
  coderName: string | null;
  missingsProfileId: number | string | null;
  responseId: number | string;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string | null;
  bookletName: string;
  code: number | string | null;
  score: number | string | null;
  notes: string | null;
  codingIssueOption: number | string | null;
};

type WithinTrainingKappaCaseRow = {
  responseId: number | string;
  unitName: string;
  variableId: string;
  validValueCount: number | string | null;
};

type WithinTrainingKappaValueRow = {
  responseId: number | string;
  jobId: number | string;
  unitName: string;
  variableId: string;
  code: string | null;
  score: number | string | null;
};

type WithinTrainingKappaCase = {
  responseId: number;
  unitName: string;
  variableId: string;
  validValueCount: number;
};

type KappaCoderValue = {
  code: number | null;
  score: number | null;
};

type TrainingFleissKappaByVariable = Map<string, {
  fleissKappa: number | null;
  completeCaseCount: number;
}>;

type TrainingKappaCoderPairInput = {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  unitName: string;
  variableId: string;
  codes: Array<{ code1: number | null; code2: number | null }>;
  scores: Array<{ score1: number | null; score2: number | null }>;
};

type MissingCodePair = { mirCode: number; mciCode: number };
type MissingCodeDisplayContext = MissingCodePair & {
  negativeCodes: Set<number>;
  scoresByCode: Map<number, number | null>;
};

const DEFAULT_MISSING_CODE_CONTEXT: MissingCodeDisplayContext = {
  mirCode: IQB_STANDARD_MISSING_CODES.mir,
  mciCode: IQB_STANDARD_MISSING_CODES.mci,
  negativeCodes: new Set(Object.values(IQB_STANDARD_MISSING_CODES)),
  scoresByCode: new Map(
    (Object.entries(IQB_STANDARD_MISSING_SCORES) as Array<[IqbStandardMissingId, number | null]>)
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
    private workspaceExclusionService: WorkspaceExclusionService,
    private codingStatisticsService: CodingStatisticsService
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
    fallbackScoresByCode?: Map<number, number | null>
  ): Map<number, number | null> {
    const scoresByCode = new Map<number, number | null>(fallbackScoresByCode);

    missings.forEach(missing => {
      const code = Number(missing.code);
      if (!Number.isInteger(code) || code >= 0) {
        return;
      }

      if (!this.hasExplicitScoreProperty(missing) || !this.hasExplicitValidScore(missing.score)) {
        throw new BadRequestException(`Missing profile must define a score for code ${code}`);
      }

      scoresByCode.set(code, this.normalizeScore(missing.score));
    });

    return scoresByCode;
  }

  private hasExplicitScoreProperty(missing: { score?: unknown }): boolean {
    return Object.prototype.hasOwnProperty.call(missing, 'score');
  }

  private hasExplicitValidScore(score: unknown): boolean {
    if (score === null) {
      return true;
    }

    if (typeof score === 'number') {
      return Number.isFinite(score);
    }

    if (typeof score === 'string') {
      const trimmedScore = score.trim();
      return trimmedScore !== '' && Number.isFinite(Number(trimmedScore));
    }

    return false;
  }

  private normalizeScore(score: unknown): number | null {
    if (score === null) {
      return null;
    }

    return Number(score);
  }

  private getMissingScoreFromContext(
    missingCodes: MissingCodeDisplayContext,
    code: number
  ): number | null {
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

  private makeTrainingVariableKey(unitName: string, variableId: string): string {
    return `${unitName}::${variableId}`;
  }

  private getValidatedBundleIds(
    assignedVariableBundles: JobDefinitionVariableBundle[] = []
  ): number[] {
    const invalidBundleIds = assignedVariableBundles
      .map(bundle => bundle?.id)
      .filter(id => !Number.isInteger(id));

    if (invalidBundleIds.length > 0) {
      throw new BadRequestException(
        `Invalid variable bundle IDs: ${invalidBundleIds.map(id => String(id)).join(', ')}`
      );
    }

    return assignedVariableBundles.map(bundle => bundle.id);
  }

  private async getWorkspaceVariableBundlesById(
    workspaceId: number,
    bundleIds: number[]
  ): Promise<Map<number, VariableBundle>> {
    const uniqueBundleIds = Array.from(new Set(bundleIds));
    if (uniqueBundleIds.length === 0) {
      return new Map();
    }

    const variableBundles = await this.variableBundleRepository.find({
      where: {
        id: In(uniqueBundleIds),
        workspace_id: workspaceId
      }
    });
    const variableBundlesById = new Map(variableBundles.map(bundle => [bundle.id, bundle]));
    const missingBundleIds = uniqueBundleIds.filter(id => !variableBundlesById.has(id));

    if (missingBundleIds.length > 0) {
      throw new BadRequestException(
        `Unknown variable bundle IDs for workspace ${workspaceId}: ${missingBundleIds.join(', ')}`
      );
    }

    return variableBundlesById;
  }

  private async resolveBundleVariableSelections(
    workspaceId: number,
    assignedVariableBundles: JobDefinitionVariableBundle[] = []
  ): Promise<JobDefinitionVariable[]> {
    const bundleIds = this.getValidatedBundleIds(assignedVariableBundles);
    const fetchedBundleById = await this.getWorkspaceVariableBundlesById(workspaceId, bundleIds);
    const variablesByKey = new Map<string, JobDefinitionVariable>();

    const addBundleVariable = (
      variable: JobDefinitionVariable,
      bundleSampleCount?: number
    ) => {
      if (!variable.unitName || !variable.variableId) {
        return;
      }

      const key = this.makeTrainingVariableKey(variable.unitName, variable.variableId);
      const existing = variablesByKey.get(key);
      variablesByKey.set(key, {
        unitName: variable.unitName,
        variableId: variable.variableId,
        sampleCount: existing?.sampleCount || variable.sampleCount || bundleSampleCount || 10,
        includeDeriveError: existing?.includeDeriveError === true || variable.includeDeriveError === true ?
          true :
          undefined
      });
    };

    assignedVariableBundles.forEach(bundle => {
      const configuredBundleVariablesByKey = new Map(
        (bundle.variables || []).map(variable => [
          this.makeTrainingVariableKey(variable.unitName, variable.variableId),
          variable
        ])
      );
      const bundleVariables = fetchedBundleById.get(bundle.id)?.variables || [];
      bundleVariables.forEach(variable => {
        const configuredVariable = configuredBundleVariablesByKey.get(
          this.makeTrainingVariableKey(variable.unitName, variable.variableId)
        );
        addBundleVariable({
          unitName: variable.unitName,
          variableId: variable.variableId,
          sampleCount: configuredVariable?.sampleCount,
          includeDeriveError: configuredVariable?.includeDeriveError
        }, bundle.sampleCount);
      });
    });

    return Array.from(variablesByKey.values());
  }

  private async buildTrainingVariableSelections(
    workspaceId: number,
    variableConfigs: TrainingVariableConfig[] = [],
    assignedVariables: JobDefinitionVariable[] = [],
    assignedVariableBundles: JobDefinitionVariableBundle[] = []
  ): Promise<JobDefinitionVariable[]> {
    const bundleVariables = await this.resolveBundleVariableSelections(workspaceId, assignedVariableBundles);
    const fallbackVariables = [...assignedVariables, ...bundleVariables];
    const assignedVariablesByKey = new Map<string, JobDefinitionVariable>();
    fallbackVariables.forEach(variable => {
      assignedVariablesByKey.set(
        this.makeTrainingVariableKey(variable.unitName, variable.variableId),
        variable
      );
    });

    const selectionsByKey = new Map<string, JobDefinitionVariable>();
    variableConfigs.forEach(config => {
      const key = this.makeTrainingVariableKey(config.unitId, config.variableId);
      const assignedVariable = assignedVariablesByKey.get(key);
      selectionsByKey.set(key, {
        unitName: config.unitId,
        variableId: config.variableId,
        sampleCount: config.sampleCount || assignedVariable?.sampleCount || 10,
        includeDeriveError: config.includeDeriveError === true || assignedVariable?.includeDeriveError === true ?
          true :
          undefined
      });
    });

    fallbackVariables.forEach(variable => {
      const key = this.makeTrainingVariableKey(variable.unitName, variable.variableId);
      if (!selectionsByKey.has(key)) {
        selectionsByKey.set(key, {
          unitName: variable.unitName,
          variableId: variable.variableId,
          sampleCount: variable.sampleCount || 10,
          includeDeriveError: variable.includeDeriveError === true ? true : undefined
        });
      }
    });

    return Array.from(selectionsByKey.values());
  }

  private mapTrainingVariableSelectionsToConfigs(
    variables: JobDefinitionVariable[] = []
  ): TrainingVariableConfig[] {
    return variables.map(variable => ({
      variableId: variable.variableId,
      unitId: variable.unitName,
      sampleCount: variable.sampleCount || 10,
      includeDeriveError: variable.includeDeriveError === true ? true : undefined
    }));
  }

  private makeTrainingConfigKey(unitName: string, variableId: string): string {
    return `${unitName}:${variableId}`;
  }

  private async buildTrainingBundleConfigs(
    workspaceId: number,
    assignedVariableBundles: JobDefinitionVariableBundle[] = [],
    variableConfigs: TrainingVariableConfig[] = []
  ): Promise<TrainingBundleConfig[]> {
    const bundleIds = this.getValidatedBundleIds(assignedVariableBundles);
    const fetchedBundleById = await this.getWorkspaceVariableBundlesById(workspaceId, bundleIds);
    const variableConfigByKey = new Map(
      variableConfigs.map(config => [
        this.makeTrainingVariableKey(config.unitId, config.variableId),
        config
      ])
    );

    return assignedVariableBundles.map(bundle => {
      const fetchedBundle = fetchedBundleById.get(bundle.id);
      const configuredVariablesByKey = new Map(
        (bundle.variables || []).map(variable => [
          this.makeTrainingVariableKey(variable.unitName, variable.variableId),
          variable
        ])
      );
      const variables = (fetchedBundle?.variables || []).map(variable => {
        const variableKey = this.makeTrainingVariableKey(
          variable.unitName,
          variable.variableId
        );
        const configuredVariable = configuredVariablesByKey.get(variableKey);
        const selectedConfig = variableConfigByKey.get(variableKey);

        return {
          unitId: variable.unitName,
          variableId: variable.variableId,
          sampleCount:
            selectedConfig?.sampleCount ||
            configuredVariable?.sampleCount ||
            bundle.sampleCount ||
            10,
          includeDeriveError:
            selectedConfig?.includeDeriveError === true ||
            configuredVariable?.includeDeriveError === true ?
              true :
              undefined
        };
      });

      return {
        id: bundle.id,
        name: fetchedBundle?.name || bundle.name || '',
        sampleCount: bundle.sampleCount || 10,
        caseOrderingMode: bundle.caseOrderingMode,
        variables
      };
    });
  }

  private mapTrainingBundles(
    bundles: CoderTrainingBundle[] = [],
    variables: JobDefinitionVariable[] = []
  ): JobDefinitionVariableBundle[] {
    const variablesByKey = new Map(
      variables.map(variable => [
        this.makeTrainingVariableKey(variable.unitName, variable.variableId),
        variable
      ])
    );

    return bundles.map(bundle => ({
      id: bundle.variable_bundle_id,
      name: bundle.bundle?.name || '',
      sampleCount: bundle.sample_count || 10,
      caseOrderingMode: bundle.case_ordering_mode ?? undefined,
      variables: bundle.bundle?.variables?.map(variable => {
        const savedVariable = variablesByKey.get(
          this.makeTrainingVariableKey(variable.unitName, variable.variableId)
        );
        return {
          unitName: variable.unitName,
          variableId: variable.variableId,
          sampleCount: savedVariable?.sampleCount ?? bundle.sample_count ?? 10,
          includeDeriveError: savedVariable?.includeDeriveError === true ? true : undefined
        };
      })
    }));
  }

  private mapTrainingVariables(
    variables: CoderTrainingVariable[] = []
  ): JobDefinitionVariable[] {
    return variables.map(variable => ({
      variableId: variable.variable_id,
      unitName: variable.unit_name,
      sampleCount: variable.sample_count || 10,
      includeDeriveError: variable.include_derive_error === true ? true : undefined
    }));
  }

  private getBundleVariableKeys(bundles: CoderTrainingBundle[] = []): Set<string> {
    return new Set(
      bundles.flatMap(bundle => bundle.bundle?.variables || [])
        .map(variable => this.makeTrainingVariableKey(variable.unitName, variable.variableId))
    );
  }

  private getTrainingVariablesByKey(
    variables: CoderTrainingVariable[] = []
  ): Map<string, CoderTrainingVariable> {
    return new Map(variables.map(variable => [
      this.makeTrainingVariableKey(variable.unit_name, variable.variable_id),
      variable
    ]));
  }

  private normalizeComparisonPage(page?: number): number {
    const normalizedPage = Math.floor(Number(page ?? 1));
    return Number.isFinite(normalizedPage) && normalizedPage > 0 ? normalizedPage : 1;
  }

  private normalizeComparisonLimit(limit?: number): number {
    const normalizedLimit = Math.floor(Number(limit ?? 50));
    if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
      return 50;
    }
    return Math.min(normalizedLimit, 500);
  }

  private normalizeComparisonSortBy(sortBy?: TrainingComparisonSortBy): TrainingComparisonSortBy {
    return sortBy ?? 'unitName';
  }

  private normalizeComparisonSortDirection(
    sortDirection?: TrainingComparisonSortDirection
  ): TrainingComparisonSortDirection {
    return sortDirection === 'desc' ? 'desc' : 'asc';
  }

  private matchesComparisonTextFilter(
    value: string | number | null | undefined,
    filter: string | null | undefined
  ): boolean {
    const normalizedFilter = (filter || '').trim();
    if (!normalizedFilter) {
      return true;
    }

    const text = String(value ?? '');
    return text.toLowerCase().includes(normalizedFilter.toLowerCase());
  }

  private matchesComparisonTextFilters(
    row: Pick<
    TrainingCodingComparisonRowDto,
    'unitName' | 'variableId' | 'personLogin' | 'personGroup' | 'bookletName'
    >,
    filters: TrainingComparisonFiltersDto
  ): boolean {
    return (
      this.matchesComparisonTextFilter(row.unitName, filters.unitName) &&
      this.matchesComparisonTextFilter(row.variableId, filters.variableId) &&
      this.matchesComparisonTextFilter(row.personLogin, filters.personLogin) &&
      this.matchesComparisonTextFilter(row.personGroup, filters.personGroup) &&
      this.matchesComparisonTextFilter(row.bookletName, filters.bookletName)
    );
  }

  private getComparisonStatusFromSlots(slots: TrainingComparisonCodeSlot[]): TrainingComparisonStatus {
    if (slots.length < 2) {
      return 'not_comparable';
    }

    if (slots.some(slot => !slot.hasEntry || slot.code === null)) {
      return 'incomplete';
    }

    const firstCode = slots[0].code;
    return slots.every(slot => slot.code === firstCode) ? 'match' : 'differ';
  }

  private parseTrainingCoderKey(key: string): { trainingId: number; coderId: number } | null {
    const [trainingIdRaw, coderIdRaw] = key.split('_');
    const trainingId = Number(trainingIdRaw);
    const coderId = Number(coderIdRaw);
    if (!Number.isInteger(trainingId) || !Number.isInteger(coderId)) {
      return null;
    }
    return { trainingId, coderId };
  }

  private getTrainingComparisonStatus(
    row: TrainingCodingComparisonRowDto,
    selectedTrainingIds: number[],
    selectedCoderKeys: string[]
  ): TrainingComparisonStatus {
    const slots: TrainingComparisonCodeSlot[] = selectedCoderKeys.map(key => {
      const parsedKey = this.parseTrainingCoderKey(key);
      if (!parsedKey) {
        return {
          code: null,
          hasEntry: false
        };
      }

      const coder = row.coders.find(item => (
        item.trainingId === parsedKey.trainingId &&
        item.coderId === parsedKey.coderId
      ));
      return {
        code: coder?.code ?? null,
        hasEntry: !!coder,
        trainingId: parsedKey.trainingId
      };
    });

    const trainingsWithSelectedCoder = new Set(slots
      .map(slot => slot.trainingId)
      .filter((trainingId): trainingId is number => trainingId !== undefined));
    selectedTrainingIds.forEach(trainingId => {
      if (!trainingsWithSelectedCoder.has(trainingId)) {
        slots.push({
          code: null,
          hasEntry: false,
          trainingId
        });
      }
    });

    return this.getComparisonStatusFromSlots(slots);
  }

  private getWithinTrainingComparisonStatus(
    row: WithinTrainingCodingComparisonRowDto,
    selectedJobIds: number[]
  ): TrainingComparisonStatus {
    const slots = selectedJobIds.map(jobId => {
      const coder = row.coders.find(item => item.jobId === jobId);
      return {
        code: coder?.code ?? null,
        hasEntry: !!coder
      };
    });
    return this.getComparisonStatusFromSlots(slots);
  }

  private rowHasTrainingComparisonNotes(
    row: TrainingCodingComparisonRowDto,
    selectedCoderKeys: string[]
  ): boolean {
    return selectedCoderKeys.some(key => {
      const parsedKey = this.parseTrainingCoderKey(key);
      if (!parsedKey) {
        return false;
      }
      const coder = row.coders.find(item => (
        item.trainingId === parsedKey.trainingId &&
        item.coderId === parsedKey.coderId
      ));
      return !!coder?.notes?.trim();
    });
  }

  private rowHasWithinTrainingComparisonNotes(
    row: WithinTrainingCodingComparisonRowDto,
    selectedJobIds: number[]
  ): boolean {
    return selectedJobIds.some(jobId => {
      const coder = row.coders.find(item => item.jobId === jobId);
      return !!coder?.notes?.trim();
    });
  }

  private matchesComparisonStateFilters(
    status: TrainingComparisonStatus,
    hasNotes: boolean,
    filters: TrainingComparisonFiltersDto
  ): boolean {
    if (filters.match === 'match' && status !== 'match') {
      return false;
    }
    if (filters.match === 'differ' && status !== 'differ') {
      return false;
    }

    const notesMode: TrainingComparisonNotesFilter = filters.notesMode ?? 'all';
    if (notesMode === 'none') {
      return !hasNotes;
    }
    if (notesMode === 'with-notes') {
      return hasNotes;
    }

    return true;
  }

  private calculateComparisonSummary<T>(
    rows: T[],
    getStatus: (row: T) => TrainingComparisonStatus
  ): TrainingComparisonSummaryDto {
    const statuses = rows.map(row => getStatus(row));
    const comparableRows = statuses.filter(status => status === 'match' || status === 'differ').length;
    const matchingRows = statuses.filter(status => status === 'match').length;
    const incompleteRows = statuses.filter(status => status === 'incomplete').length;
    const notComparableRows = statuses.filter(status => status === 'not_comparable').length;
    const visibleRows = rows.length;

    return {
      visibleRows,
      comparableRows,
      matchingRows,
      matchingPercentage: comparableRows > 0 ? Math.round((matchingRows / comparableRows) * 100) : 0,
      incompleteRows,
      notComparableRows,
      deviationRows: Math.max(comparableRows - matchingRows, 0),
      completionRate: visibleRows > 0 ? Math.round((comparableRows / visibleRows) * 100) : 0
    };
  }

  private getComparisonSortValue(
    row: Pick<
    TrainingCodingComparisonRowDto,
    'responseId' | 'unitName' | 'variableId' | 'personLogin' | 'personGroup' | 'bookletName'
    >,
    sortBy: TrainingComparisonSortBy
  ): string | number {
    return row[sortBy] ?? '';
  }

  private compareComparisonValues(a: string | number, b: string | number): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    return String(a).localeCompare(String(b), 'de');
  }

  private sortComparisonRows<T extends Pick<
  TrainingCodingComparisonRowDto,
  'responseId' | 'unitName' | 'variableId' | 'personLogin' | 'personGroup' | 'bookletName'
  >>(
    rows: T[],
    sortBy?: TrainingComparisonSortBy,
    sortDirection?: TrainingComparisonSortDirection
  ): T[] {
    const normalizedSortBy = this.normalizeComparisonSortBy(sortBy);
    const directionMultiplier = this.normalizeComparisonSortDirection(sortDirection) === 'desc' ? -1 : 1;

    return [...rows].sort((a, b) => {
      const primary = this.compareComparisonValues(
        this.getComparisonSortValue(a, normalizedSortBy),
        this.getComparisonSortValue(b, normalizedSortBy)
      );
      if (primary !== 0) {
        return primary * directionMultiplier;
      }

      return (
        this.compareComparisonValues(a.unitName, b.unitName) ||
        this.compareComparisonValues(a.variableId, b.variableId) ||
        this.compareComparisonValues(a.personLogin, b.personLogin) ||
        this.compareComparisonValues(a.responseId, b.responseId)
      );
    });
  }

  private getTrainingComparisonAvailableCoders(
    rows: TrainingCodingComparisonRowDto[]
  ): TrainingComparisonCoderDto[] {
    const codersByKey = new Map<string, TrainingComparisonCoderDto>();
    rows.forEach(row => {
      row.coders.forEach(coder => {
        const key = `${coder.trainingId}_${coder.coderId}`;
        if (!codersByKey.has(key)) {
          codersByKey.set(key, {
            trainingId: coder.trainingId,
            trainingLabel: coder.trainingLabel,
            coderId: coder.coderId,
            coderName: coder.coderName
          });
        }
      });
    });

    return Array.from(codersByKey.values()).sort((a, b) => (
      a.trainingId - b.trainingId || a.coderName.localeCompare(b.coderName, 'de')
    ));
  }

  private getWithinTrainingComparisonAvailableCoders(
    rows: WithinTrainingCodingComparisonRowDto[]
  ): WithinTrainingComparisonCoderDto[] {
    const codersByJobId = new Map<number, WithinTrainingComparisonCoderDto>();
    rows.forEach(row => {
      row.coders.forEach(coder => {
        if (!codersByJobId.has(coder.jobId)) {
          codersByJobId.set(coder.jobId, {
            jobId: coder.jobId,
            coderName: coder.coderName
          });
        }
      });
    });

    return Array.from(codersByJobId.values()).sort((a, b) => a.jobId - b.jobId);
  }

  private paginateComparisonRows<T>(rows: T[], page: number, limit: number): T[] {
    return rows.slice((page - 1) * limit, page * limit);
  }

  private toBooleanValue(value: boolean | string | number | null | undefined): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  private getComparisonStatusFromAggregate(
    row: Pick<TrainingComparisonAggregateRow, 'completeCodeCount' | 'distinctCodeCount'>,
    slotCount: number
  ): TrainingComparisonStatus {
    if (slotCount < 2) {
      return 'not_comparable';
    }

    const completeCodeCount = this.toFreshnessNumber(row.completeCodeCount);
    if (completeCodeCount < slotCount) {
      return 'incomplete';
    }

    return this.toFreshnessNumber(row.distinctCodeCount) <= 1 ? 'match' : 'differ';
  }

  private toComparisonCandidate(
    row: TrainingComparisonAggregateRow,
    slotCount: number
  ): TrainingComparisonCandidate {
    const personGroup = row.personGroup || '';
    return {
      responseId: this.toFreshnessNumber(row.responseId),
      unitName: row.unitName,
      variableId: row.variableId,
      personCode: row.personCode,
      personLogin: row.personLogin,
      personGroup,
      bookletName: row.bookletName,
      testPerson: `${row.personLogin} (${personGroup}) - ${row.bookletName}`,
      status: this.getComparisonStatusFromAggregate(row, slotCount),
      hasNotes: this.toBooleanValue(row.hasNotes)
    };
  }

  private matchesComparisonCandidateFilters(
    row: TrainingComparisonCandidate,
    filters: TrainingComparisonFiltersDto
  ): boolean {
    return this.matchesComparisonTextFilters(row, filters) &&
      this.matchesComparisonStateFilters(row.status, row.hasNotes, filters);
  }

  private calculateComparisonSummaryFromCandidates(
    rows: TrainingComparisonCandidate[]
  ): TrainingComparisonSummaryDto {
    return this.calculateComparisonSummary(rows, row => row.status);
  }

  private getTrainingComparisonSelection(
    selectedTrainingIds: number[],
    selectedCoderKeys: string[],
    availableCoders: TrainingComparisonCoderDto[]
  ): { selectedJobIds: number[]; slotCount: number } {
    const trainingIds = [...new Set(selectedTrainingIds)];
    const selectedTrainingIdSet = new Set(trainingIds);
    const availableCoderKeys = new Set(availableCoders.map(coder => `${coder.trainingId}_${coder.coderId}`));
    const normalizedKeyMap = new Map<string, { trainingId: number; coderId: number }>();
    const parsedKeys = selectedCoderKeys
      .map(key => this.parseTrainingCoderKey(key))
      .filter((key): key is { trainingId: number; coderId: number } => (
        key !== null &&
        selectedTrainingIdSet.has(key.trainingId) &&
        availableCoderKeys.has(`${key.trainingId}_${key.coderId}`)
      ));
    parsedKeys.forEach(key => {
      normalizedKeyMap.set(`${key.trainingId}_${key.coderId}`, key);
    });
    const normalizedKeys = [...normalizedKeyMap.values()];
    const selectedTrainingKeys = new Set(normalizedKeys.map(key => key.trainingId));
    const missingTrainingSlots = trainingIds
      .filter(trainingId => !selectedTrainingKeys.has(trainingId))
      .length;

    return {
      selectedJobIds: [...new Set(normalizedKeys.map(key => key.coderId))],
      slotCount: normalizedKeys.length + missingTrainingSlots
    };
  }

  private getWithinTrainingComparisonSelectedJobIds(
    selectedJobIds: number[] | undefined,
    jobs: Array<Pick<CodingJob, 'id'>>
  ): number[] {
    const availableJobIds = new Set(jobs.map(job => job.id));
    const requestedJobIds = selectedJobIds ?? jobs.map(job => job.id);
    return [...new Set(requestedJobIds.filter(jobId => availableJobIds.has(jobId)))];
  }

  private getTrainingJobCoderName(job: Pick<CodingJob, 'id' | 'name'> & {
    codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
  }): string {
    return job.codingJobCoders?.[0]?.user?.username || `Job ${job.id}`;
  }

  private getWithinTrainingJobCoderName(job: Pick<CodingJob, 'id' | 'name'> & {
    codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
  }): string {
    return job.codingJobCoders?.[0]?.user?.username || `Coder ${job.name}`;
  }

  private buildComparisonDisplayCodeSqlExpression(
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext
  ): string {
    const buildJobCase = (selector: (context: MissingCodeDisplayContext) => number): string => {
      const cases = Array.from(missingCodesByJobId.entries())
        .map(([jobId, context]) => `WHEN ${jobId} THEN '${selector(context)}'`)
        .join(' ');
      return `(CASE cj.id ${cases} ELSE '${selector(defaultMissingCodeContext)}' END)`;
    };

    return `CASE
      WHEN cju.code IS NULL AND cju.coding_issue_option IS NULL THEN NULL
      WHEN cju.code = -3 OR cju.coding_issue_option = -3 THEN ${buildJobCase(context => context.mirCode)}
      WHEN cju.code = -4 OR cju.coding_issue_option = -4 THEN ${buildJobCase(context => context.mciCode)}
      ELSE cju.code::text
    END`;
  }

  private toSqlScoreLiteral(score: number | null): string {
    return score === null ? 'NULL::integer' : score.toString();
  }

  private buildComparisonMissingScoreByJobSqlExpression(
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    selector: (context: MissingCodeDisplayContext) => number | null
  ): string {
    const cases = Array.from(missingCodesByJobId.entries())
      .map(([jobId, context]) => `WHEN ${jobId} THEN ${this.toSqlScoreLiteral(selector(context))}`)
      .join(' ');
    return `(CASE cj.id ${cases} ELSE ${this.toSqlScoreLiteral(selector(defaultMissingCodeContext))} END)`;
  }

  private buildComparisonNegativeMissingScoreSqlExpression(
    context: MissingCodeDisplayContext
  ): string {
    const cases = Array.from(context.negativeCodes)
      .sort((a, b) => a - b)
      .map(code => `WHEN ${code} THEN ${this.toSqlScoreLiteral(this.getMissingScoreFromContext(context, code))}`)
      .join(' ');

    return cases.length > 0 ? `(CASE cju.code ${cases} ELSE cju.score END)` : 'cju.score';
  }

  private buildComparisonNegativeMissingScoreByJobSqlExpression(
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext
  ): string {
    const cases = Array.from(missingCodesByJobId.entries())
      .map(([jobId, context]) => `WHEN ${jobId} THEN ${this.buildComparisonNegativeMissingScoreSqlExpression(context)}`)
      .join(' ');
    return `(CASE cj.id ${cases} ELSE ${this.buildComparisonNegativeMissingScoreSqlExpression(defaultMissingCodeContext)} END)`;
  }

  private buildComparisonDisplayScoreSqlExpression(
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext
  ): string {
    const mirScoreExpression = this.buildComparisonMissingScoreByJobSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext,
      context => this.getMissingScoreFromContext(context, context.mirCode)
    );
    const mciScoreExpression = this.buildComparisonMissingScoreByJobSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext,
      context => this.getMissingScoreFromContext(context, context.mciCode)
    );
    const negativeMissingScoreExpression = this.buildComparisonNegativeMissingScoreByJobSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );

    return `CASE
      WHEN cju.code IS NULL AND cju.coding_issue_option IS NULL THEN cju.score
      WHEN cju.code = -3 OR cju.coding_issue_option = -3 THEN ${mirScoreExpression}
      WHEN cju.code = -4 OR cju.coding_issue_option = -4 THEN ${mciScoreExpression}
      WHEN cju.code < 0 THEN ${negativeMissingScoreExpression}
      ELSE cju.score
    END`;
  }

  private addComparisonAggregateSelects(
    query: ReturnType<Repository<CodingJobUnit>['createQueryBuilder']>,
    selectedJobIds: number[],
    displayCodeExpression: string,
    selectedJobParameterName: string
  ): void {
    if (selectedJobIds.length === 0) {
      query
        .addSelect('0', 'completeCodeCount')
        .addSelect('0', 'distinctCodeCount')
        .addSelect('false', 'hasNotes');
      return;
    }

    const selectedJobCondition = `cj.id IN (:...${selectedJobParameterName})`;
    query
      .addSelect(
        `COUNT(DISTINCT cj.id) FILTER (WHERE ${selectedJobCondition} AND (${displayCodeExpression}) IS NOT NULL)`,
        'completeCodeCount'
      )
      .addSelect(
        `COUNT(DISTINCT (${displayCodeExpression})) FILTER (WHERE ${selectedJobCondition} AND (${displayCodeExpression}) IS NOT NULL)`,
        'distinctCodeCount'
      )
      .addSelect(
        `COALESCE(BOOL_OR(${selectedJobCondition} AND cju.notes IS NOT NULL AND BTRIM(cju.notes) <> ''), false)`,
        'hasNotes'
      )
      .setParameter(selectedJobParameterName, selectedJobIds);
  }

  private async getTrainingComparisonAvailableCodersForJobs(
    workspaceId: number,
    trainingIds: number[],
    jobs: Array<Pick<CodingJob, 'id' | 'name' | 'training_id'> & {
      training?: Pick<CoderTraining, 'id' | 'label'> | null;
      codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
    }>,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<TrainingComparisonCoderDto[]> {
    if (jobs.length === 0) {
      return [];
    }

    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('DISTINCT cj.id', 'jobId')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id IN (:...trainingIds)', { trainingIds });

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'trainingComparisonAvailableCoders'
    });

    const rows = await query.getRawMany<{ jobId: number | string }>();
    const jobIdsWithUnits = new Set(rows.map(row => this.toFreshnessNumber(row.jobId)));

    return jobs
      .filter(job => jobIdsWithUnits.has(job.id))
      .map(job => ({
        trainingId: job.training?.id ?? job.training_id!,
        trainingLabel: job.training?.label ?? '',
        coderId: job.id,
        coderName: this.getTrainingJobCoderName(job)
      }))
      .sort((a, b) => (
        a.trainingId - b.trainingId || a.coderName.localeCompare(b.coderName, 'de')
      ));
  }

  private async getTrainingComparisonAggregateRows(
    workspaceId: number,
    trainingIds: number[],
    selectedJobIds: number[],
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<TrainingComparisonAggregateRow[]> {
    const displayCodeExpression = this.buildComparisonDisplayCodeSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.response_id', 'responseId')
      .addSelect('MIN(cju.unit_name)', 'unitName')
      .addSelect('MIN(cju.variable_id)', 'variableId')
      .addSelect('MIN(cju.person_code)', 'personCode')
      .addSelect('MIN(cju.person_login)', 'personLogin')
      .addSelect('MIN(cju.person_group)', 'personGroup')
      .addSelect('MIN(cju.booklet_name)', 'bookletName')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id IN (:...trainingIds)', { trainingIds })
      .groupBy('cju.response_id');

    this.addComparisonAggregateSelects(
      query,
      selectedJobIds,
      displayCodeExpression,
      'trainingComparisonSelectedJobIds'
    );
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'trainingComparisonAggregate'
    });

    return query.getRawMany<TrainingComparisonAggregateRow>();
  }

  private async getTrainingComparisonRowsForResponseIds(
    workspaceId: number,
    trainingIds: number[],
    responseIds: number[],
    pageCandidates: TrainingComparisonCandidate[],
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<TrainingCodingComparisonRowDto[]> {
    if (responseIds.length === 0) {
      return [];
    }

    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .innerJoin('cj.training', 'ct')
      .leftJoin('cj.codingJobCoders', 'cjc')
      .leftJoin('cjc.user', 'coderUser')
      .select('ct.id', 'trainingId')
      .addSelect('ct.label', 'trainingLabel')
      .addSelect('cj.id', 'jobId')
      .addSelect('coderUser.username', 'coderName')
      .addSelect('cj.missings_profile_id', 'missingsProfileId')
      .addSelect('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.person_code', 'personCode')
      .addSelect('cju.person_login', 'personLogin')
      .addSelect('cju.person_group', 'personGroup')
      .addSelect('cju.booklet_name', 'bookletName')
      .addSelect('cju.code', 'code')
      .addSelect('cju.score', 'score')
      .addSelect('cju.notes', 'notes')
      .addSelect('cju.coding_issue_option', 'codingIssueOption')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id IN (:...trainingIds)', { trainingIds })
      .andWhere('cju.response_id IN (:...responseIds)', { responseIds })
      .orderBy('ct.label', 'ASC')
      .addOrderBy('cj.id', 'ASC')
      .addOrderBy('cju.id', 'ASC');

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'trainingComparisonRows'
    });

    const rawRows = await query.getRawMany<TrainingComparisonRawUnitRow>();
    const codersByResponseId = new Map<number, TrainingCodingComparisonRowDto['coders']>();
    const seenSlots = new Set<string>();
    rawRows.forEach(row => {
      const responseId = this.toFreshnessNumber(row.responseId);
      const jobId = this.toFreshnessNumber(row.jobId);
      const slotKey = `${responseId}:${jobId}`;
      if (seenSlots.has(slotKey)) {
        return;
      }
      seenSlots.add(slotKey);

      const code = this.toNullableScore(row.code);
      const score = this.toNullableScore(row.score);
      const codingIssueOption = this.toNullableScore(row.codingIssueOption);
      const mappedDisplay = this.mapDisplayCodeAndScore(
        code,
        score,
        codingIssueOption,
        missingCodesByJobId.get(jobId) ?? defaultMissingCodeContext
      );
      const coders = codersByResponseId.get(responseId) ?? [];
      coders.push({
        trainingId: this.toFreshnessNumber(row.trainingId),
        trainingLabel: row.trainingLabel,
        coderId: jobId,
        coderName: row.coderName || `Job ${jobId}`,
        code: mappedDisplay.code,
        score: mappedDisplay.score,
        notes: row.notes,
        codingIssueOption
      });
      codersByResponseId.set(responseId, coders);
    });

    return pageCandidates.map(candidate => ({
      responseId: candidate.responseId,
      unitName: candidate.unitName,
      variableId: candidate.variableId,
      personCode: candidate.personCode,
      personLogin: candidate.personLogin,
      personGroup: candidate.personGroup,
      bookletName: candidate.bookletName,
      testPerson: candidate.testPerson,
      coders: codersByResponseId.get(candidate.responseId) ?? []
    }));
  }

  private async getWithinTrainingComparisonAggregateRows(
    workspaceId: number,
    trainingId: number,
    selectedJobIds: number[],
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<TrainingComparisonAggregateRow[]> {
    const displayCodeExpression = this.buildComparisonDisplayCodeSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.response_id', 'responseId')
      .addSelect('MIN(cju.unit_name)', 'unitName')
      .addSelect('MIN(cju.variable_id)', 'variableId')
      .addSelect('MIN(cju.person_code)', 'personCode')
      .addSelect('MIN(cju.person_login)', 'personLogin')
      .addSelect('MIN(cju.person_group)', 'personGroup')
      .addSelect('MIN(cju.booklet_name)', 'bookletName')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id = :trainingId', { trainingId })
      .groupBy('cju.response_id');

    this.addComparisonAggregateSelects(
      query,
      selectedJobIds,
      displayCodeExpression,
      'withinTrainingComparisonSelectedJobIds'
    );
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingComparisonAggregate'
    });

    return query.getRawMany<TrainingComparisonAggregateRow>();
  }

  private async getWithinTrainingComparisonRowsForResponseIds(
    workspaceId: number,
    trainingId: number,
    responseIds: number[],
    pageCandidates: TrainingComparisonCandidate[],
    jobs: Array<Pick<CodingJob, 'id' | 'name' | 'missings_profile_id'> & {
      codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
    }>,
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<WithinTrainingCodingComparisonRowDto[]> {
    if (responseIds.length === 0) {
      return [];
    }

    const coderNameByJobId = new Map<number, string>();
    jobs.forEach(job => {
      coderNameByJobId.set(job.id, this.getWithinTrainingJobCoderName(job));
    });

    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .leftJoin('cju.response', 'resp')
      .select('cj.id', 'jobId')
      .addSelect('cju.id', 'unitRowId')
      .addSelect('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.person_code', 'personCode')
      .addSelect('cju.person_login', 'personLogin')
      .addSelect('cju.person_group', 'personGroup')
      .addSelect('cju.booklet_name', 'bookletName')
      .addSelect('resp.value', 'givenAnswer')
      .addSelect('resp.code_v1', 'replayCodeV1')
      .addSelect('resp.code_v2', 'replayCodeV2')
      .addSelect('resp.code_v3', 'replayCodeV3')
      .addSelect('resp.score_v1', 'replayScoreV1')
      .addSelect('resp.score_v2', 'replayScoreV2')
      .addSelect('resp.score_v3', 'replayScoreV3')
      .addSelect('cju.code', 'code')
      .addSelect('cju.score', 'score')
      .addSelect('cju.notes', 'notes')
      .addSelect('cju.coding_issue_option', 'codingIssueOption')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id = :trainingId', { trainingId })
      .andWhere('cju.response_id IN (:...responseIds)', { responseIds })
      .orderBy('cju.id', 'ASC')
      .addOrderBy('cj.id', 'ASC');

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingComparisonRows'
    });

    const rawRows = await query.getRawMany<WithinTrainingCodingRow>();
    const unitsByResponseId = new Map<number, Map<number, WithinTrainingCodingRow>>();
    const firstRowByResponseId = new Map<number, WithinTrainingCodingRow>();

    rawRows.forEach(row => {
      const responseId = this.toNullableScore(row.responseId);
      const jobId = this.toNullableScore(row.jobId);
      if (responseId === null || jobId === null) {
        return;
      }

      if (!firstRowByResponseId.has(responseId)) {
        firstRowByResponseId.set(responseId, row);
      }
      if (!unitsByResponseId.has(responseId)) {
        unitsByResponseId.set(responseId, new Map<number, WithinTrainingCodingRow>());
      }
      unitsByResponseId.get(responseId)!.set(jobId, row);
    });

    const persistedDiscussionResults = await this.coderTrainingDiscussionResultRepository.find({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId,
        response_id: In(responseIds)
      }
    });
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

    const resultRows: WithinTrainingCodingComparisonRowDto[] = [];
    for (const candidate of pageCandidates) {
      const unitsByJobId = unitsByResponseId.get(candidate.responseId) ?? new Map<number, WithinTrainingCodingRow>();
      const firstRow = firstRowByResponseId.get(candidate.responseId);
      const codersData: WithinTrainingCoderResult[] = jobs.map(job => {
        const unit = unitsByJobId.get(job.id);
        const code = this.toNullableScore(unit?.code);
        const score = this.toNullableScore(unit?.score);
        const codingIssueOption = this.toNullableScore(unit?.codingIssueOption);
        const mappedDisplay = this.mapDisplayCodeAndScore(
          code,
          score,
          codingIssueOption,
          missingCodesByJobId.get(job.id) ?? defaultMissingCodeContext
        );

        return {
          jobId: job.id,
          coderName: coderNameByJobId.get(job.id) ?? `Coder ${job.name}`,
          code: mappedDisplay.code,
          score: mappedDisplay.score,
          notes: unit?.notes ?? null,
          codingIssueOption
        };
      });

      const discussionResult = discussionByResponseId.get(candidate.responseId);
      const hasManualDiscussionResult = discussionResult?.code !== null && discussionResult?.code !== undefined;
      const automaticDiscussionResult = hasManualDiscussionResult ?
        null :
        await this.deriveAutomaticDiscussionResultForRawResponse(
          workspaceId,
          trainingId,
          candidate.responseId,
          jobs,
          unitsByJobId,
          codersData
        );
      let discussionCode = automaticDiscussionResult?.code ?? null;
      let discussionScore = automaticDiscussionResult?.score ?? null;
      let discussionNotes: string | null = null;
      let discussionManagerUserId: number | null = null;
      let discussionManagerName: string | null = null;
      let discussionSource: DiscussionSource = automaticDiscussionResult ? 'auto_agreement' : null;

      if (hasManualDiscussionResult) {
        discussionCode = discussionResult!.code;
        discussionScore = discussionResult!.score;
        discussionNotes = discussionResult!.notes ?? null;
        discussionManagerUserId = discussionResult!.manager_user_id ?? null;
        discussionManagerName = discussionResult!.manager_user_id ?
          (managerNameById.get(discussionResult!.manager_user_id) ?? discussionResult!.manager_name ?? null) :
          (discussionResult!.manager_name ?? null);
        discussionSource = 'manual';
      }

      resultRows.push({
        responseId: candidate.responseId,
        unitName: candidate.unitName,
        variableId: candidate.variableId,
        personCode: candidate.personCode,
        personLogin: candidate.personLogin,
        personGroup: candidate.personGroup,
        bookletName: candidate.bookletName,
        testPerson: candidate.testPerson,
        givenAnswer: firstRow?.givenAnswer || '',
        replayCode: this.toNullableScore(firstRow?.replayCodeV3) ??
          this.toNullableScore(firstRow?.replayCodeV2) ??
          this.toNullableScore(firstRow?.replayCodeV1),
        replayScore: this.toNullableScore(firstRow?.replayScoreV3) ??
          this.toNullableScore(firstRow?.replayScoreV2) ??
          this.toNullableScore(firstRow?.replayScoreV1),
        discussionCode,
        discussionScore,
        discussionNotes,
        discussionManagerUserId,
        discussionManagerName,
        discussionSource,
        coders: codersData
      });
    }

    return resultRows;
  }

  private async getWithinTrainingKappaCaseRows(
    workspaceId: number,
    trainingId: number,
    selectedJobIds: number[],
    calculationLevel: TrainingKappaCalculationLevel,
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<WithinTrainingKappaCaseRow[]> {
    const selectedJobParameterName = 'withinTrainingKappaCaseSelectedJobIds';
    const valueExpression = calculationLevel === 'score' ?
      this.buildComparisonDisplayScoreSqlExpression(missingCodesByJobId, defaultMissingCodeContext) :
      this.buildComparisonDisplayCodeSqlExpression(missingCodesByJobId, defaultMissingCodeContext);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect(
        `COUNT(DISTINCT cj.id) FILTER (
          WHERE cj.id IN (:...${selectedJobParameterName})
          AND (${valueExpression}) IS NOT NULL
        )`,
        'validValueCount'
      )
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id = :trainingId', { trainingId })
      .groupBy('cju.response_id')
      .addGroupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .orderBy('cju.unit_name', 'ASC')
      .addOrderBy('cju.variable_id', 'ASC')
      .addOrderBy('cju.response_id', 'ASC')
      .setParameter(selectedJobParameterName, selectedJobIds);

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingKappaCases'
    });

    return query.getRawMany<WithinTrainingKappaCaseRow>();
  }

  private async getWithinTrainingKappaValueRows(
    workspaceId: number,
    trainingId: number,
    selectedJobIds: number[],
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<WithinTrainingKappaValueRow[]> {
    if (selectedJobIds.length === 0) {
      return [];
    }

    const displayCodeExpression = this.buildComparisonDisplayCodeSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );
    const displayScoreExpression = this.buildComparisonDisplayScoreSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cj.id', 'jobId')
      .addSelect('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect(displayCodeExpression, 'code')
      .addSelect(displayScoreExpression, 'score')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id = :trainingId', { trainingId })
      .andWhere('cj.id IN (:...withinTrainingKappaValueJobIds)', {
        withinTrainingKappaValueJobIds: selectedJobIds
      })
      .orderBy('cju.id', 'ASC')
      .addOrderBy('cj.id', 'ASC');

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingKappaValues'
    });

    return query.getRawMany<WithinTrainingKappaValueRow>();
  }

  private normalizeWithinTrainingKappaCases(
    rows: WithinTrainingKappaCaseRow[]
  ): WithinTrainingKappaCase[] {
    return rows
      .map(row => {
        const responseId = this.toNullableScore(row.responseId);
        if (responseId === null) {
          return null;
        }
        return {
          responseId,
          unitName: row.unitName,
          variableId: row.variableId,
          validValueCount: this.toFreshnessNumber(row.validValueCount)
        };
      })
      .filter((row): row is WithinTrainingKappaCase => row !== null);
  }

  private toKappaCode(value: string | null): number | null {
    if (value === null) {
      return null;
    }

    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private buildTrainingKappaValuesByResponseAndJob(
    valueRows: WithinTrainingKappaValueRow[],
    selectedJobIds: number[]
  ): Map<string, KappaCoderValue> {
    const selectedJobIdSet = new Set(selectedJobIds);
    const values = new Map<string, KappaCoderValue>();
    valueRows.forEach(row => {
      const responseId = this.toNullableScore(row.responseId);
      const jobId = this.toNullableScore(row.jobId);
      if (responseId === null || jobId === null || !selectedJobIdSet.has(jobId)) return;
      values.set(
        this.getTrainingKappaValueKey(responseId, row.unitName, row.variableId, jobId),
        { code: this.toKappaCode(row.code), score: this.toNullableScore(row.score) }
      );
    });
    return values;
  }

  private buildWithinTrainingKappaCoderPairs(
    cases: WithinTrainingKappaCase[],
    valueRows: WithinTrainingKappaValueRow[],
    selectedJobs: Array<Pick<CodingJob, 'id' | 'name'> & {
      codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
    }>
  ): TrainingKappaCoderPairInput[] {
    const valuesByResponseAndJob = this.buildTrainingKappaValuesByResponseAndJob(
      valueRows,
      selectedJobs.map(job => job.id)
    );

    const casesByVariable = new Map<string, WithinTrainingKappaCase[]>();
    cases.forEach(item => {
      const key = this.getTrainingKappaVariableKey(item.unitName, item.variableId);
      if (!casesByVariable.has(key)) {
        casesByVariable.set(key, []);
      }
      casesByVariable.get(key)!.push(item);
    });

    const coderPairs: TrainingKappaCoderPairInput[] = [];
    Array.from(casesByVariable.values()).forEach(variableCases => {
      variableCases.sort((a, b) => a.responseId - b.responseId);
      const firstCase = variableCases[0];
      if (!firstCase) {
        return;
      }

      for (let i = 0; i < selectedJobs.length; i++) {
        for (let j = i + 1; j < selectedJobs.length; j++) {
          const coder1 = selectedJobs[i];
          const coder2 = selectedJobs[j];
          const codes: Array<{ code1: number | null; code2: number | null }> = [];
          const scores: Array<{ score1: number | null; score2: number | null }> = [];

          variableCases.forEach(item => {
            const coder1Value = valuesByResponseAndJob.get(
              this.getTrainingKappaValueKey(
                item.responseId,
                item.unitName,
                item.variableId,
                coder1.id
              )
            );
            const coder2Value = valuesByResponseAndJob.get(
              this.getTrainingKappaValueKey(
                item.responseId,
                item.unitName,
                item.variableId,
                coder2.id
              )
            );
            codes.push({
              code1: coder1Value?.code ?? null,
              code2: coder2Value?.code ?? null
            });
            scores.push({
              score1: coder1Value?.score ?? null,
              score2: coder2Value?.score ?? null
            });
          });

          if (codes.length > 0) {
            coderPairs.push({
              coder1Id: coder1.id,
              coder1Name: this.getWithinTrainingJobCoderName(coder1),
              coder2Id: coder2.id,
              coder2Name: this.getWithinTrainingJobCoderName(coder2),
              unitName: firstCase.unitName,
              variableId: firstCase.variableId,
              codes,
              scores
            });
          }
        }
      }
    });

    return coderPairs;
  }

  private calculateWithinTrainingFleissKappa(
    cases: WithinTrainingKappaCase[],
    valueRows: WithinTrainingKappaValueRow[],
    selectedJobIds: number[],
    calculationLevel: TrainingKappaCalculationLevel
  ): TrainingFleissKappaByVariable {
    const valuesByResponseAndJob = this.buildTrainingKappaValuesByResponseAndJob(
      valueRows,
      selectedJobIds
    );

    const ratingsByVariable = new Map<string, Array<Array<number | null>>>();
    cases.forEach(item => {
      const key = this.getTrainingKappaVariableKey(item.unitName, item.variableId);
      if (!ratingsByVariable.has(key)) ratingsByVariable.set(key, []);
      ratingsByVariable.get(key)!.push(selectedJobIds.map(jobId => {
        const value = valuesByResponseAndJob.get(
          this.getTrainingKappaValueKey(item.responseId, item.unitName, item.variableId, jobId)
        );
        return calculationLevel === 'score' ? value?.score ?? null : value?.code ?? null;
      }));
    });

    return new Map(Array.from(ratingsByVariable.entries()).map(([key, ratings]) => {
      const result = this.codingStatisticsService.calculateFleissKappa(ratings);
      return [key, {
        fleissKappa: result.fleissKappa,
        completeCaseCount: result.completeCaseCount
      }];
    }));
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

  private async deriveAutomaticDiscussionResultForRawResponse(
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
      score: await this.getMissingScoreForProfile(
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
    const profileId = await this.resolveMissingProfileIdForResponse(
      workspaceId,
      training,
      responseId,
      exclusions
    );

    return this.getMissingScoreForProfile(workspaceId, profileId, code);
  }

  private async getMissingScoreForProfile(
    workspaceId: number,
    profileId: number | null,
    code: number
  ): Promise<number> {
    try {
      return (await this.missingsProfilesService.getMissingByCodeForProfileOrDefault(
        workspaceId,
        profileId,
        code
      )).score;
    } catch (error) {
      if (error instanceof BadRequestException && error.message.includes('not found')) {
        throw new BadRequestException(`Unsupported missing code: ${code}`);
      }

      throw error;
    }
  }

  private async resolveMissingProfileIdForResponse(
    workspaceId: number,
    training: CoderTraining,
    responseId: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<number | null> {
    const jobUnits = this.findTrainingJobUnitsForResponse(training, responseId, exclusions);
    if (jobUnits.length === 0) {
      return null;
    }

    const resolvedProfileIds = await Promise.all(jobUnits.map(({ job }) => (
      this.missingsProfilesService.resolveMissingsProfileId(workspaceId, job.missings_profile_id)
    )));
    const profileKeys = new Set(resolvedProfileIds);
    if (profileKeys.size > 1) {
      throw new BadRequestException(`Conflicting missing profiles for response ${responseId} in training ${training.id}`);
    }

    return resolvedProfileIds[0];
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

    const profileId = await this.resolveMissingProfileIdForResponse(
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
    code: number | null | undefined,
    notes?: string | null
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

    const discussionResult = existing || this.coderTrainingDiscussionResultRepository.create({
      workspace_id: workspaceId,
      training_id: trainingId,
      response_id: responseId
    });

    discussionResult.code = resolvedCode;
    discussionResult.score = derivedScore;
    discussionResult.notes = notes?.trim() || null;
    discussionResult.manager_user_id = managerUserId;
    discussionResult.manager_name = managerName;

    const saved = await this.coderTrainingDiscussionResultRepository.save(discussionResult);
    return {
      success: true,
      code: saved.code,
      score: saved.score,
      notes: saved.notes ?? null,
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

  private getTrainingBundleCaseKey(response: CoderTrainingResponse): string {
    return [
      response.personLogin,
      response.personCode,
      response.personGroup,
      response.bookletName
    ].join('\u0000');
  }

  private sampleBundleResponses(
    bundle: TrainingBundleConfig,
    responsesByConfig: Map<string, CoderTrainingResponse[]>,
    caseSelectionMode: CaseSelectionMode
  ): Map<string, CoderTrainingResponse[]> {
    const responsesByCase = new Map<string, CoderTrainingResponse[]>();

    bundle.variables.forEach(variable => {
      const configKey = this.makeTrainingConfigKey(
        variable.unitId,
        variable.variableId
      );
      const responses = responsesByConfig.get(configKey) || [];
      responses.forEach(response => {
        const caseKey = this.getTrainingBundleCaseKey(response);
        const caseResponses = responsesByCase.get(caseKey) || [];
        caseResponses.push(response);
        responsesByCase.set(caseKey, caseResponses);
      });
    });

    const representatives = Array.from(responsesByCase.entries()).map(
      ([caseKey, responses]) => {
        const sortedResponses = [...responses].sort((a, b) => a.responseId - b.responseId);
        const chunkTsValues = sortedResponses
          .map(response => response.chunkTs)
          .filter((chunkTs): chunkTs is number => chunkTs !== undefined);
        return {
          caseKey,
          response: {
            ...sortedResponses[0],
            responseId: Math.min(
              ...sortedResponses.map(response => response.responseId)
            ),
            chunkTs:
              chunkTsValues.length > 0 ?
                Math.min(...chunkTsValues) :
                sortedResponses[0].chunkTs
          }
        };
      }
    );
    const caseKeyByRepresentativeResponseId = new Map(
      representatives.map(entry => [entry.response.responseId, entry.caseKey])
    );
    const sampledRepresentatives = this.sampleResponses(
      representatives.map(entry => entry.response),
      bundle.sampleCount,
      caseSelectionMode
    );
    const sampledCaseKeys = new Set(
      sampledRepresentatives
        .map(response => caseKeyByRepresentativeResponseId.get(response.responseId))
        .filter((caseKey): caseKey is string => !!caseKey)
    );
    const sampledResponsesByConfig = new Map<string, CoderTrainingResponse[]>();

    bundle.variables.forEach(variable => {
      sampledResponsesByConfig.set(
        this.makeTrainingConfigKey(variable.unitId, variable.variableId),
        []
      );
    });

    sampledCaseKeys.forEach(caseKey => {
      const caseResponses = responsesByCase.get(caseKey) || [];
      caseResponses.forEach(response => {
        const configKey = this.makeTrainingConfigKey(
          response.unitName,
          response.variableId
        );
        const responses = sampledResponsesByConfig.get(configKey);
        if (responses) {
          responses.push(response);
        }
      });
    });

    return sampledResponsesByConfig;
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
    variableConfigs: TrainingVariableConfig[],
    options?: {
      caseSelectionMode?: CaseSelectionMode;
      referenceTrainingIds?: number[];
      referenceMode?: ReferenceMode;
      assignedVariableBundles?: JobDefinitionVariableBundle[];
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

    // Build derived variable lookup for the shared aggregation logic.
    const derivedVariableMap = await this.workspaceFilesService.getDerivedVariableMap(workspaceId);
    const derivedVariableSets = new Map<string, Set<string>>();
    derivedVariableMap.forEach((vars, unitNameKey) => {
      derivedVariableSets.set(unitNameKey.toUpperCase(), vars);
    });

    const bundleConfigs = await this.buildTrainingBundleConfigs(
      workspaceId,
      options?.assignedVariableBundles || [],
      variableConfigs
    );
    const bundleVariableKeys = new Set(
      bundleConfigs.flatMap(bundle => bundle.variables.map(variable => this.makeTrainingConfigKey(
        variable.unitId,
        variable.variableId
      )))
    );

    // Pre-sample responses for each variable configuration to ensure consistency across all coders
    const sampledResponsesByConfig: Map<string, CoderTrainingResponse[]> = new Map();
    const responsesForSamplingByConfig: Map<string, CoderTrainingResponse[]> = new Map();

    for (const config of variableConfigs) {
      const variableId = config.variableId;
      const unitId = config.unitId;
      const sampleCount = config.sampleCount;
      const configKey = this.makeTrainingConfigKey(unitId, variableId);
      const includeDeriveError = config.includeDeriveError === true;

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
        .andWhere(includeDeriveError ?
          new Brackets(qb => {
            qb.where('response.status_v1 IN (:...statuses)', {
              statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
            }).orWhere('response.status_v1 = :deriveErrorStatus', {
              deriveErrorStatus: DERIVE_ERROR_STATUS
            });
          }) :
          'response.status_v1 IN (:...statuses)',
        { statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES })
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

      const dedupedResponses = deduplicateManualCodingResponses(transformedResponses);
      if (dedupedResponses.length !== transformedResponses.length) {
        this.logger.debug(`Removed ${transformedResponses.length - dedupedResponses.length} duplicate responses for unit ${unitId}, variable ${variableId}.`);
      }
      transformedResponses = dedupedResponses;

      // Apply the same aggregation grouping used by availability analysis.
      let responsesForSampling: CoderTrainingResponse[];
      if (aggregationThreshold !== null) {
        const aggregatedGroups = buildAggregationGroups(
          transformedResponses,
          matchingFlags,
          aggregationThreshold,
          derivedVariableSets
        );
        responsesForSampling = [];
        for (const group of aggregatedGroups) {
          if (group.responses.length >= aggregationThreshold) {
            const representative = group.responses.reduce((a, b) => (
              a.responseId < b.responseId ? a : b
            ));
            responsesForSampling.push(representative);
          } else {
            responsesForSampling.push(...group.responses);
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
      responsesForSamplingByConfig.set(configKey, responsesForSampling);

      if (!bundleVariableKeys.has(configKey)) {
        const sampledResponses = this.sampleResponses(responsesForSampling, sampleCount, caseSelectionMode);
        sampledResponsesByConfig.set(configKey, sampledResponses);

        this.logger.log(`Sampled ${sampledResponses.length} consistent responses for unit ${unitId}, variable ${variableId}`);
      }
    }

    for (const bundle of bundleConfigs) {
      const sampledResponsesByBundleVariable = this.sampleBundleResponses(
        bundle,
        responsesForSamplingByConfig,
        caseSelectionMode
      );
      sampledResponsesByBundleVariable.forEach((responses, configKey) => {
        sampledResponsesByConfig.set(configKey, responses);
      });

      this.logger.log(
        `Sampled ${bundle.sampleCount} bundled cases for training bundle ${bundle.name || bundle.id}`
      );
    }

    // Create training packages for each coder using the pre-sampled responses
    const result: TrainingPackage[] = [];

    for (const coder of selectedCoders) {
      const coderId = coder.id;
      const coderName = coder.name;
      const coderResponses: CoderTrainingResponse[] = [];

      this.logger.log(`Assigning consistent training samples to coder ${coderName} (ID: ${coderId})`);

      for (const config of variableConfigs) {
        const configKey = this.makeTrainingConfigKey(
          config.unitId,
          config.variableId
        );
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
    variableConfigs: TrainingVariableConfig[],
    trainingLabel: string,
    missingsProfileId?: number,
    assignedVariables?: JobDefinitionVariable[],
    assignedVariableBundles?: JobDefinitionVariableBundle[],
    caseOrderingMode?: 'continuous' | 'alternating',
    caseSelectionMode?: CaseSelectionMode,
    referenceTrainingIds?: number[],
    referenceMode?: ReferenceMode,
    showScore?: boolean,
    allowComments?: boolean,
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
      const trainingVariableSelections = await this.buildTrainingVariableSelections(
        workspaceId,
        variableConfigs,
        assignedVariables || [],
        assignedVariableBundles || []
      );
      const trainingVariableConfigs = this.mapTrainingVariableSelectionsToConfigs(trainingVariableSelections);

      const coderTraining = new CoderTraining();
      coderTraining.workspace_id = workspaceId;
      coderTraining.label = trainingLabel;
      coderTraining.case_ordering_mode = caseOrderingMode || 'continuous';
      coderTraining.case_selection_mode = caseSelectionMode ?? 'oldest_first';
      coderTraining.reference_training_ids = referenceTrainingIds?.length ? referenceTrainingIds : null;
      coderTraining.reference_mode = referenceMode ?? null;
      coderTraining.show_score = showScore ?? false;
      coderTraining.allow_comments = allowComments ?? true;
      coderTraining.suppress_general_instructions = suppressGeneralInstructions ?? false;
      coderTraining.created_at = new Date();
      coderTraining.updated_at = new Date();

      const savedTraining = await this.coderTrainingRepository.save(coderTraining);
      const trainingId = savedTraining.id;

      // Save selected variables, including variables that came from bundles.
      for (const variable of trainingVariableSelections) {
        const trainingVariable = new CoderTrainingVariable();
        trainingVariable.coder_training_id = trainingId;
        trainingVariable.variable_id = variable.variableId;
        trainingVariable.unit_name = variable.unitName;
        trainingVariable.sample_count = variable.sampleCount || 10;
        trainingVariable.include_derive_error = variable.includeDeriveError === true;
        await this.coderTrainingVariableRepository.save(trainingVariable);
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

      const trainingPackageOptions: {
        caseSelectionMode: CaseSelectionMode;
        referenceTrainingIds?: number[];
        referenceMode?: ReferenceMode;
        assignedVariableBundles?: JobDefinitionVariableBundle[];
      } = {
        caseSelectionMode: caseSelectionMode ?? 'oldest_first',
        referenceTrainingIds,
        referenceMode
      };
      if (assignedVariableBundles?.length) {
        trainingPackageOptions.assignedVariableBundles = assignedVariableBundles;
      }

      const trainingPackages = await this.generateCoderTrainingPackages(
        workspaceId,
        selectedCoders,
        trainingVariableConfigs,
        trainingPackageOptions
      );

      // Build mapping from variable to bundle id and bundle sorting mode
      const variableToBundleMap = new Map<string, number>();
      const bundleSortingModeMap = new Map<number, 'continuous' | 'alternating'>();
      this.logger.log(`Building bundle maps for ${assignedVariableBundles?.length || 0} bundles`);
      if (assignedVariableBundles && assignedVariableBundles.length > 0) {
        const bundleIds = this.getValidatedBundleIds(assignedVariableBundles);
        if (bundleIds.length > 0) {
          const fetchedBundlesById = await this.getWorkspaceVariableBundlesById(workspaceId, bundleIds);
          for (const bundle of fetchedBundlesById.values()) {
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
        codingJob.showScore = showScore ?? false;
        codingJob.allowComments = allowComments ?? true;
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

    return trainings.map(training => {
      const bundleVariableKeys = this.getBundleVariableKeys(training.bundles || []);
      const trainingVariablesByKey = this.getTrainingVariablesByKey(training.variables || []);

      return {
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
        show_score: training.show_score,
        allow_comments: training.allow_comments,
        suppress_general_instructions: training.suppress_general_instructions,
        assigned_variables: training.variables
          ?.filter(v => !bundleVariableKeys.has(this.makeTrainingVariableKey(v.unit_name, v.variable_id)))
          .map(v => ({
            variableId: v.variable_id,
            unitName: v.unit_name,
            sampleCount: v.sample_count,
            ...(v.include_derive_error === true ? { includeDeriveError: true } : {})
          })),
        assigned_variable_bundles: training.bundles?.map(b => ({
          id: b.variable_bundle_id,
          name: b.bundle?.name || 'Unknown Bundle',
          sampleCount: b.sample_count,
          caseOrderingMode: b.case_ordering_mode,
          variables: b.bundle?.variables?.map(variable => {
            const savedVariable = trainingVariablesByKey.get(
              this.makeTrainingVariableKey(variable.unitName, variable.variableId)
            );
            return {
              ...variable,
              sampleCount: savedVariable?.sample_count ?? b.sample_count,
              ...(savedVariable?.include_derive_error === true ? { includeDeriveError: true } : {})
            };
          })
        })),
        assigned_coders: training.coders?.map(c => c.user_id)
      };
    });
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
      bookletName: string;
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
      bookletName: string;
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
              bookletName: unit.booklet_name,
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
      bookletName: string;
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
        bookletName: info.bookletName,
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

  async getTrainingCodingComparisonPage(
    workspaceId: number,
    trainingIds: number[],
    options: TrainingComparisonPageOptions = {}
  ): Promise<TrainingCodingComparisonPageDto> {
    const page = this.normalizeComparisonPage(options.page);
    const limit = this.normalizeComparisonLimit(options.limit);
    const filters = options.filters ?? {};
    if (trainingIds.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        summary: this.calculateComparisonSummaryFromCandidates([]),
        availableCoders: []
      };
    }

    const trainings = await this.coderTrainingRepository.find({
      where: {
        workspace_id: workspaceId,
        id: In(trainingIds)
      },
      relations: [
        'codingJobs',
        'codingJobs.codingJobCoders',
        'codingJobs.codingJobCoders.user'
      ],
      order: { label: 'ASC' }
    });

    if (trainings.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        summary: this.calculateComparisonSummaryFromCandidates([]),
        availableCoders: []
      };
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const allTrainingJobs = trainings.flatMap(training => (
      (training.codingJobs || []).map(job => ({
        ...job,
        training
      }))
    ));
    const [missingCodesByJobId, defaultMissingCodeContext, availableCoders] = await Promise.all([
      this.buildMissingCodesByJobId(workspaceId, allTrainingJobs),
      this.getDefaultMissingCodeDisplayContext(workspaceId),
      this.getTrainingComparisonAvailableCodersForJobs(workspaceId, trainingIds, allTrainingJobs, exclusions)
    ]);
    const selectedCoderKeys = options.selectedCoderKeys ?? availableCoders
      .map(coder => `${coder.trainingId}_${coder.coderId}`);
    const selection = this.getTrainingComparisonSelection(trainingIds, selectedCoderKeys, availableCoders);
    const aggregateRows = await this.getTrainingComparisonAggregateRows(
      workspaceId,
      trainingIds,
      selection.selectedJobIds,
      missingCodesByJobId,
      defaultMissingCodeContext,
      exclusions
    );

    const filteredCandidates = aggregateRows
      .map(row => this.toComparisonCandidate(row, selection.slotCount))
      .filter(row => this.matchesComparisonCandidateFilters(row, filters));
    const sortedCandidates = this.sortComparisonRows(filteredCandidates, options.sortBy, options.sortDirection);
    const pageCandidates = this.paginateComparisonRows(sortedCandidates, page, limit);
    const pageRows = await this.getTrainingComparisonRowsForResponseIds(
      workspaceId,
      trainingIds,
      pageCandidates.map(row => row.responseId),
      pageCandidates,
      missingCodesByJobId,
      defaultMissingCodeContext,
      exclusions
    );

    return {
      data: pageRows,
      total: filteredCandidates.length,
      page,
      limit,
      totalPages: Math.ceil(filteredCandidates.length / limit),
      summary: this.calculateComparisonSummaryFromCandidates(filteredCandidates),
      availableCoders
    };
  }

  private toFreshnessNumber(value: number | string | null | undefined): number {
    const numericValue = Number(value ?? 0);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

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
        responseId: this.toFreshnessNumber(row.responseId),
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
    const unitCount = this.toFreshnessNumber(unitAggregate.unitCount);
    const responseCount = this.toFreshnessNumber(unitAggregate.responseCount);
    const discussionResultCount = this.toFreshnessNumber(discussionAggregate.discussionResultCount);
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
      bookletName: string;
      testPerson: string;
      givenAnswer: string;
      replayCode: number | null;
      replayScore: number | null;
      discussionCode: number | null;
      discussionScore: number | null;
      discussionNotes: string | null;
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
      }
    });

    if (!training) {
      return [];
    }

    const jobs = await this.codingJobRepository.find({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId
      },
      relations: ['codingJobCoders.user'],
      order: { id: 'ASC' }
    });

    if (jobs.length === 0) {
      return [];
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const missingCodesByJobId = await this.buildMissingCodesByJobId(workspaceId, jobs);
    const defaultMissingCodeContext = await this.getDefaultMissingCodeDisplayContext(workspaceId);
    const coderNameByJobId = new Map<number, string>();
    jobs.forEach(job => {
      const coderName = job.codingJobCoders?.[0]?.user?.username ?
        `${job.codingJobCoders[0].user.username}` :
        `Coder ${job.name}`;
      coderNameByJobId.set(job.id, coderName);
    });

    const unitVariableMap = new Map<string, {
      responseId: number;
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      bookletName: string;
      testPerson: string;
      givenAnswer: string;
      replayCode: number | null;
      replayScore: number | null;
    }>();

    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .leftJoin('cju.response', 'resp')
      .select('cj.id', 'jobId')
      .addSelect('cju.id', 'unitRowId')
      .addSelect('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.person_code', 'personCode')
      .addSelect('cju.person_login', 'personLogin')
      .addSelect('cju.person_group', 'personGroup')
      .addSelect('cju.booklet_name', 'bookletName')
      .addSelect('resp.value', 'givenAnswer')
      .addSelect('resp.code_v1', 'replayCodeV1')
      .addSelect('resp.code_v2', 'replayCodeV2')
      .addSelect('resp.code_v3', 'replayCodeV3')
      .addSelect('resp.score_v1', 'replayScoreV1')
      .addSelect('resp.score_v2', 'replayScoreV2')
      .addSelect('resp.score_v3', 'replayScoreV3')
      .addSelect('cju.code', 'code')
      .addSelect('cju.score', 'score')
      .addSelect('cju.notes', 'notes')
      .addSelect('cju.coding_issue_option', 'codingIssueOption')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id = :trainingId', { trainingId })
      .orderBy('cju.id', 'ASC')
      .addOrderBy('cj.id', 'ASC');

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingComparison'
    });

    const rows = await query.getRawMany<WithinTrainingCodingRow>();
    const unitsByResponseId = new Map<number, Map<number, WithinTrainingCodingRow>>();

    rows.forEach(row => {
      const responseId = this.toNullableScore(row.responseId);
      const jobId = this.toNullableScore(row.jobId);
      if (responseId === null || jobId === null) {
        return;
      }

      const unitVariableKey = responseId.toString();
      if (!unitVariableMap.has(unitVariableKey)) {
        const personGroup = row.personGroup || '';
        const testPerson = `${row.personLogin} (${personGroup}) - ${row.bookletName}`;

        unitVariableMap.set(unitVariableKey, {
          responseId,
          unitName: row.unitName,
          variableId: row.variableId,
          personCode: row.personCode,
          personLogin: row.personLogin,
          personGroup,
          bookletName: row.bookletName,
          testPerson,
          givenAnswer: row.givenAnswer || '',
          replayCode: this.toNullableScore(row.replayCodeV3) ??
            this.toNullableScore(row.replayCodeV2) ??
            this.toNullableScore(row.replayCodeV1),
          replayScore: this.toNullableScore(row.replayScoreV3) ??
            this.toNullableScore(row.replayScoreV2) ??
            this.toNullableScore(row.replayScoreV1)
        });
      }

      if (!unitsByResponseId.has(responseId)) {
        unitsByResponseId.set(responseId, new Map<number, WithinTrainingCodingRow>());
      }
      unitsByResponseId.get(responseId)!.set(jobId, row);
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
      const unitsByJobId = unitsByResponseId.get(unitVar.responseId) ?? new Map<number, WithinTrainingCodingRow>();
      const codersData: WithinTrainingCoderResult[] = jobs.map(job => {
        const unit = unitsByJobId.get(job.id);
        const code = this.toNullableScore(unit?.code);
        const score = this.toNullableScore(unit?.score);
        const codingIssueOption = this.toNullableScore(unit?.codingIssueOption);

        const mappedDisplay = this.mapDisplayCodeAndScore(
          code,
          score,
          codingIssueOption,
          missingCodesByJobId.get(job.id) ?? defaultMissingCodeContext
        );

        return {
          jobId: job.id,
          coderName: coderNameByJobId.get(job.id) ?? `Coder ${job.name}`,
          code: mappedDisplay.code,
          score: mappedDisplay.score,
          notes: unit?.notes ?? null,
          codingIssueOption
        };
      });

      const discussionResult = discussionByResponseId.get(unitVar.responseId);
      const hasManualDiscussionResult = discussionResult?.code !== null && discussionResult?.code !== undefined;
      const automaticDiscussionResult = hasManualDiscussionResult ?
        null :
        await this.deriveAutomaticDiscussionResultForRawResponse(
          workspaceId,
          trainingId,
          unitVar.responseId,
          jobs,
          unitsByJobId,
          codersData
        );
      let discussionCode = automaticDiscussionResult?.code ?? null;
      let discussionScore = automaticDiscussionResult?.score ?? null;
      let discussionNotes: string | null = null;
      let discussionManagerUserId: number | null = null;
      let discussionManagerName: string | null = null;
      let discussionSource: DiscussionSource = automaticDiscussionResult ? 'auto_agreement' : null;

      if (hasManualDiscussionResult) {
        discussionCode = discussionResult!.code;
        discussionScore = discussionResult!.score;
        discussionNotes = discussionResult!.notes ?? null;
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
        bookletName: unitVar.bookletName,
        testPerson: unitVar.testPerson,
        givenAnswer: unitVar.givenAnswer,
        replayCode: unitVar.replayCode,
        replayScore: unitVar.replayScore,
        discussionCode,
        discussionScore,
        discussionNotes,
        discussionManagerUserId,
        discussionManagerName,
        discussionSource,
        coders: codersData
      });
    }

    this.logger.log(`Generated within-training comparison data for ${comparisonData.length} unit/variable combinations across ${jobs.length} coders`);

    return comparisonData;
  }

  async getWithinTrainingCodingComparisonPage(
    workspaceId: number,
    trainingId: number,
    options: TrainingComparisonPageOptions = {}
  ): Promise<WithinTrainingCodingComparisonPageDto> {
    const page = this.normalizeComparisonPage(options.page);
    const limit = this.normalizeComparisonLimit(options.limit);
    const filters = options.filters ?? {};
    const training = await this.coderTrainingRepository.findOne({
      where: {
        workspace_id: workspaceId,
        id: trainingId
      }
    });

    if (!training) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        summary: this.calculateComparisonSummaryFromCandidates([]),
        availableCoders: []
      };
    }

    const jobs = await this.codingJobRepository.find({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId
      },
      relations: ['codingJobCoders.user'],
      order: { id: 'ASC' }
    });

    if (jobs.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        summary: this.calculateComparisonSummaryFromCandidates([]),
        availableCoders: []
      };
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const [missingCodesByJobId, defaultMissingCodeContext] = await Promise.all([
      this.buildMissingCodesByJobId(workspaceId, jobs),
      this.getDefaultMissingCodeDisplayContext(workspaceId)
    ]);
    const selectedJobIds = this.getWithinTrainingComparisonSelectedJobIds(options.selectedJobIds, jobs);
    const aggregateRows = await this.getWithinTrainingComparisonAggregateRows(
      workspaceId,
      trainingId,
      selectedJobIds,
      missingCodesByJobId,
      defaultMissingCodeContext,
      exclusions
    );
    const availableCoders = aggregateRows.length > 0 ?
      jobs.map(job => ({
        jobId: job.id,
        coderName: this.getWithinTrainingJobCoderName(job)
      })) :
      [];
    const slotCount = selectedJobIds.length;

    const filteredCandidates = aggregateRows
      .map(row => this.toComparisonCandidate(row, slotCount))
      .filter(row => this.matchesComparisonCandidateFilters(row, filters));
    const sortedCandidates = this.sortComparisonRows(filteredCandidates, options.sortBy, options.sortDirection);
    const pageCandidates = this.paginateComparisonRows(sortedCandidates, page, limit);
    const pageRows = await this.getWithinTrainingComparisonRowsForResponseIds(
      workspaceId,
      trainingId,
      pageCandidates.map(row => row.responseId),
      pageCandidates,
      jobs,
      missingCodesByJobId,
      defaultMissingCodeContext,
      exclusions
    );

    return {
      data: pageRows,
      total: filteredCandidates.length,
      page,
      limit,
      totalPages: Math.ceil(filteredCandidates.length / limit),
      summary: this.calculateComparisonSummaryFromCandidates(filteredCandidates),
      availableCoders
    };
  }

  async getWithinTrainingCohensKappa(
    workspaceId: number,
    trainingId: number,
    options: TrainingKappaOptions = {}
  ): Promise<TrainingCohensKappaStatistics> {
    const useWeightedMean = options.weightedMean ?? true;
    const calculationLevel = options.level ?? 'code';
    const emptyStatistics = this.createEmptyTrainingKappaStatistics(useWeightedMean, calculationLevel);
    const training = await this.coderTrainingRepository.findOne({
      where: {
        workspace_id: workspaceId,
        id: trainingId
      }
    });

    if (!training) {
      return emptyStatistics;
    }

    const jobs = await this.codingJobRepository.find({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId
      },
      relations: ['codingJobCoders.user'],
      order: { id: 'ASC' }
    });
    const selectedJobIds = this.getWithinTrainingComparisonSelectedJobIds(options.selectedJobIds, jobs);
    const jobById = new Map(jobs.map(job => [job.id, job]));
    const selectedJobs = selectedJobIds
      .map(jobId => jobById.get(jobId))
      .filter((job): job is CodingJob => job !== undefined);

    if (selectedJobs.length < 2) {
      return emptyStatistics;
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const [missingCodesByJobId, defaultMissingCodeContext] = await Promise.all([
      this.buildMissingCodesByJobId(workspaceId, selectedJobs),
      this.getDefaultMissingCodeDisplayContext(workspaceId)
    ]);
    const [caseRows, valueRows] = await Promise.all([
      this.getWithinTrainingKappaCaseRows(
        workspaceId,
        trainingId,
        selectedJobIds,
        calculationLevel,
        missingCodesByJobId,
        defaultMissingCodeContext,
        exclusions
      ),
      this.getWithinTrainingKappaValueRows(
        workspaceId,
        trainingId,
        selectedJobIds,
        missingCodesByJobId,
        defaultMissingCodeContext,
        exclusions
      )
    ]);
    const cases = this.normalizeWithinTrainingKappaCases(caseRows);
    const coderPairs = this.buildWithinTrainingKappaCoderPairs(cases, valueRows, selectedJobs);

    if (coderPairs.length === 0) {
      return emptyStatistics;
    }

    const kappaResults = this.codingStatisticsService.calculateCohensKappa(coderPairs, calculationLevel);
    const caseCountsByVariable = this.calculateTrainingKappaCaseCountsByVariable(cases);
    const fleissKappaByVariable = this.calculateWithinTrainingFleissKappa(
      cases,
      valueRows,
      selectedJobIds,
      calculationLevel
    );

    return this.createTrainingKappaStatistics(
      kappaResults,
      caseCountsByVariable,
      fleissKappaByVariable,
      useWeightedMean,
      calculationLevel
    );
  }

  private getTrainingKappaVariableKey(unitName: string, variableId: string): string {
    return `${unitName}:${variableId}`;
  }

  private getTrainingKappaValueKey(
    responseId: number,
    unitName: string,
    variableId: string,
    jobId: number
  ): string {
    return `${responseId}:${unitName}:${variableId}:${jobId}`;
  }

  private createEmptyTrainingKappaStatistics(
    useWeightedMean: boolean,
    calculationLevel: TrainingKappaCalculationLevel
  ): TrainingCohensKappaStatistics {
    return {
      variables: [],
      workspaceSummary: {
        totalDoubleCodedResponses: 0,
        totalCoderPairs: 0,
        averageKappa: null,
        averageBrennanPredigerKappa: null,
        variablesIncluded: 0,
        codersIncluded: 0,
        weightingMethod: useWeightedMean ? 'weighted' : 'unweighted',
        calculationLevel
      }
    };
  }

  private calculateTrainingKappaCaseCountsByVariable(
    cases: WithinTrainingKappaCase[]
  ): Map<string, number> {
    const caseCountsByVariable = new Map<string, number>();

    cases.forEach(item => {
      if (item.validValueCount < 2) return;

      const key = this.getTrainingKappaVariableKey(item.unitName, item.variableId);
      caseCountsByVariable.set(key, (caseCountsByVariable.get(key) ?? 0) + 1);
    });

    return caseCountsByVariable;
  }

  private createTrainingKappaStatistics(
    kappaResults: KappaCalculationResult[],
    caseCountsByVariable: Map<string, number>,
    fleissKappaByVariable: TrainingFleissKappaByVariable,
    useWeightedMean: boolean,
    calculationLevel: TrainingKappaCalculationLevel
  ): TrainingCohensKappaStatistics {
    const variableMap = new Map<string, {
      unitName: string;
      variableId: string;
      coderPairs: KappaCalculationResult[];
    }>();

    kappaResults.forEach(result => {
      const unitName = result.unitName as string;
      const variableId = result.variableId as string;
      const key = this.getTrainingKappaVariableKey(unitName, variableId);
      if (!variableMap.has(key)) {
        variableMap.set(key, {
          unitName,
          variableId,
          coderPairs: []
        });
      }
      variableMap.get(key)!.coderPairs.push(result);
    });

    const variables = Array.from(variableMap.entries())
      .map(([key, variable]) => ({
        ...variable,
        coderPairs: variable.coderPairs.map(result => (
          this.codingStatisticsService.roundKappaCalculationResult(result)
        )),
        caseCount: caseCountsByVariable.get(key) ?? 0,
        fleissKappa: fleissKappaByVariable.get(key)?.fleissKappa ?? null,
        fleissCaseCount: fleissKappaByVariable.get(key)?.completeCaseCount ?? 0,
        ...this.codingStatisticsService.calculateKappaVariableSummary(
          variable.coderPairs,
          useWeightedMean
        )
      }));

    const uniqueCoders = new Set<number>();

    kappaResults.forEach(result => {
      uniqueCoders.add(result.coder1Id);
      uniqueCoders.add(result.coder2Id);
    });

    const averageKappa = calculateMetricMean(
      kappaResults,
      result => result.kappa,
      result => result.validPairs,
      useWeightedMean
    );
    const averageBrennanPredigerKappa = calculateMetricMean(
      kappaResults,
      result => result.brennanPredigerKappa,
      result => result.validPairs,
      useWeightedMean
    );
    const totalDoubleCodedResponses = Array.from(caseCountsByVariable.values())
      .reduce((sum, caseCount) => sum + caseCount, 0);

    return {
      variables,
      workspaceSummary: {
        totalDoubleCodedResponses,
        totalCoderPairs: kappaResults.length,
        averageKappa,
        averageBrennanPredigerKappa,
        variablesIncluded: variableMap.size,
        codersIncluded: uniqueCoders.size,
        weightingMethod: useWeightedMean ? 'weighted' : 'unweighted',
        calculationLevel
      }
    };
  }

  async updateCoderTraining(
    workspaceId: number,
    trainingId: number,
    trainingLabel: string,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: TrainingVariableConfig[],
    missingsProfileId?: number,
    assignedVariables?: JobDefinitionVariable[],
    assignedVariableBundles?: JobDefinitionVariableBundle[],
    caseOrderingMode?: 'continuous' | 'alternating',
    caseSelectionMode?: CaseSelectionMode,
    referenceTrainingIds?: number[],
    referenceMode?: ReferenceMode,
    showScore?: boolean,
    allowComments?: boolean,
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
        relations: ['codingJobs', 'variables', 'bundles', 'bundles.bundle', 'coders']
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

      const currentAssignedVariables = this.mapTrainingVariables(training.variables || []);

      const currentCaseOrderingMode = training.case_ordering_mode || 'continuous';
      const newCaseOrderingMode = caseOrderingMode ?? currentCaseOrderingMode;

      const currentAssignedVariableBundles = this.mapTrainingBundles(
        training.bundles || [],
        currentAssignedVariables
      );
      const currentTrainingVariables = await this.buildTrainingVariableSelections(
        workspaceId,
        [],
        currentAssignedVariables,
        currentAssignedVariableBundles
      );

      const effectiveAssignedVariables = assignedVariables ?? currentAssignedVariables;
      const effectiveAssignedVariableBundles = assignedVariableBundles ?? currentAssignedVariableBundles;
      const effectiveTrainingVariables = await this.buildTrainingVariableSelections(
        workspaceId,
        variableConfigs,
        effectiveAssignedVariables,
        effectiveAssignedVariableBundles
      );
      const effectiveTrainingVariableConfigs = this.mapTrainingVariableSelectionsToConfigs(effectiveTrainingVariables);

      const currentVariables = currentTrainingVariables.map(v => ({
        variableId: v.variableId,
        unitName: v.unitName,
        sampleCount: v.sampleCount || 10,
        includeDeriveError: v.includeDeriveError === true
      })).sort((a, b) => (a.variableId + a.unitName).localeCompare(b.variableId + b.unitName));

      const newVariables = effectiveTrainingVariables.map(v => ({
        variableId: v.variableId,
        unitName: v.unitName,
        sampleCount: v.sampleCount || 10,
        includeDeriveError: v.includeDeriveError === true
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
      const resolvedShowScore = showScore ??
        training.show_score ??
        false;
      const resolvedAllowComments = allowComments ??
        training.allow_comments ??
        true;

      training.label = trainingLabel;
      training.case_ordering_mode = newCaseOrderingMode;
      training.case_selection_mode = newCaseSelectionMode;
      training.reference_training_ids = effectiveReferenceTrainingIds.length ? effectiveReferenceTrainingIds : null;
      training.reference_mode = newReferenceMode;
      training.show_score = resolvedShowScore;
      training.allow_comments = resolvedAllowComments;
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
        for (const variable of effectiveTrainingVariables) {
          const trainingVariable = new CoderTrainingVariable();
          trainingVariable.coder_training_id = trainingId;
          trainingVariable.variable_id = variable.variableId;
          trainingVariable.unit_name = variable.unitName;
          trainingVariable.sample_count = variable.sampleCount || 10;
          trainingVariable.include_derive_error = variable.includeDeriveError === true;
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
        const trainingPackageOptions: {
          caseSelectionMode: CaseSelectionMode;
          referenceTrainingIds?: number[];
          referenceMode?: ReferenceMode;
          assignedVariableBundles?: JobDefinitionVariableBundle[];
        } = {
          caseSelectionMode: newCaseSelectionMode,
          referenceTrainingIds: effectiveReferenceTrainingIds,
          referenceMode: newReferenceMode ?? undefined
        };
        if (effectiveAssignedVariableBundles.length > 0) {
          trainingPackageOptions.assignedVariableBundles = effectiveAssignedVariableBundles;
        }

        const trainingPackages = await this.generateCoderTrainingPackages(
          workspaceId,
          selectedCoders,
          effectiveTrainingVariableConfigs,
          trainingPackageOptions
        );

        // Build mapping from variable to bundle id and bundle sorting mode
        const variableToBundleMap = new Map<string, number>();
        const bundleSortingModeMap = new Map<number, 'continuous' | 'alternating' | null>();
        this.logger.log(`[Update] Building bundle maps for ${effectiveAssignedVariableBundles.length} bundles`);
        if (effectiveAssignedVariableBundles.length > 0) {
          const bundleIds = this.getValidatedBundleIds(effectiveAssignedVariableBundles);
          if (bundleIds.length > 0) {
            const fetchedBundlesById = await this.getWorkspaceVariableBundlesById(workspaceId, bundleIds);
            for (const bundle of fetchedBundlesById.values()) {
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
          codingJob.showScore = resolvedShowScore;
          codingJob.allowComments = resolvedAllowComments;
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
        job.showScore = resolvedShowScore;
        job.allowComments = resolvedAllowComments;
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
