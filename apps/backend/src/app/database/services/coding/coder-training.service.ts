import {
  Injectable
} from '@nestjs/common';
import { TrainingComparisonFreshnessDto } from '../../../../../../../api-dto/coding/training-comparison-freshness.dto';
import {
  TrainingCodingComparisonPageDto,
  WithinTrainingCodingComparisonPageDto
} from '../../../../../../../api-dto/coding/training-comparison.dto';
import type { CaseSelectionMode, ReferenceMode } from '../../entities/coder-training.entity';
import { JobDefinitionVariable, JobDefinitionVariableBundle } from '../../entities/job-definition.entity';
import { CoderTrainingComparisonService } from './coder-training-comparison.service';
import { CoderTrainingDiscussionService } from './coder-training-discussion.service';
import { CoderTrainingFreshnessService } from './coder-training-freshness.service';
import { CoderTrainingKappaService } from './coder-training-kappa.service';
import { CoderTrainingMutationService } from './coder-training-mutation.service';
import { CoderTrainingQueryService } from './coder-training-query.service';
import { CoderTrainingSelectionService } from './coder-training-selection.service';
import {
  CoderTrainingWithJobs, DiscussionSource, SaveDiscussionResultResponse, TrainingCohensKappaStatistics, TrainingComparisonPageOptions, TrainingJob, TrainingKappaOptions, TrainingPackage, TrainingResponseIdsMap, TrainingVariableConfig, WithinTrainingCoderResult
} from './coder-training.types';

export type { TrainingCohensKappaStatistics, TrainingResponseIdsMap } from './coder-training.types';

/** Compatibility facade; feature providers own reads, writes and exports. */
@Injectable()
export class CoderTrainingService {
  constructor(
    private readonly selection: CoderTrainingSelectionService,
    private readonly mutation: CoderTrainingMutationService,
    private readonly comparison: CoderTrainingComparisonService,
    private readonly kappa: CoderTrainingKappaService,
    private readonly discussion: CoderTrainingDiscussionService,
    private readonly query: CoderTrainingQueryService,
    private readonly freshness: CoderTrainingFreshnessService
  ) {}

  async getTrainingResponseIds(
    workspaceId: number,
    trainingIds: number[]
  ): Promise<TrainingResponseIdsMap> {
    return this.selection.getTrainingResponseIds(workspaceId, trainingIds);
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
    return this.discussion.saveDiscussionResult(workspaceId, trainingId, responseId, managerUserId, managerName, code, notes);
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
    return this.selection.generateCoderTrainingPackages(workspaceId, selectedCoders, variableConfigs, options);
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
    suppressGeneralInstructions?: boolean,
    actorUserId?: number
  ): Promise<{ success: boolean; jobsCreated: number; message: string; jobs: TrainingJob[]; trainingId?: number }> {
    return this.mutation.createCoderTrainingJobs(workspaceId, selectedCoders, variableConfigs, trainingLabel, missingsProfileId, assignedVariables, assignedVariableBundles, caseOrderingMode, caseSelectionMode, referenceTrainingIds, referenceMode, showScore, allowComments, suppressGeneralInstructions, actorUserId);
  }

  async getCoderTrainings(workspaceId: number): Promise<CoderTrainingWithJobs[]> {
    return this.query.getCoderTrainings(workspaceId);
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
    return this.comparison.getTrainingCodingComparison(workspaceId, trainingIds);
  }

  async getTrainingCodingComparisonPage(
    workspaceId: number,
    trainingIds: number[],
    options: TrainingComparisonPageOptions = {}
  ): Promise<TrainingCodingComparisonPageDto> {
    return this.comparison.getTrainingCodingComparisonPage(workspaceId, trainingIds, options);
  }

  async getWithinTrainingComparisonFreshness(
    workspaceId: number,
    trainingId: number
  ): Promise<TrainingComparisonFreshnessDto> {
    return this.freshness.getWithinTrainingComparisonFreshness(workspaceId, trainingId);
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
    return this.comparison.getWithinTrainingCodingComparison(workspaceId, trainingId);
  }

  async getWithinTrainingCodingComparisonPage(
    workspaceId: number,
    trainingId: number,
    options: TrainingComparisonPageOptions = {}
  ): Promise<WithinTrainingCodingComparisonPageDto> {
    return this.comparison.getWithinTrainingCodingComparisonPage(workspaceId, trainingId, options);
  }

  async getWithinTrainingCohensKappa(
    workspaceId: number,
    trainingId: number,
    options: TrainingKappaOptions = {}
  ): Promise<TrainingCohensKappaStatistics> {
    return this.kappa.getWithinTrainingCohensKappa(workspaceId, trainingId, options);
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
    suppressGeneralInstructions?: boolean,
    actorUserId?: number
  ): Promise<{ success: boolean; message: string; jobsCreated?: number; jobs?: TrainingJob[] }> {
    return this.mutation.updateCoderTraining(workspaceId, trainingId, trainingLabel, selectedCoders, variableConfigs, missingsProfileId, assignedVariables, assignedVariableBundles, caseOrderingMode, caseSelectionMode, referenceTrainingIds, referenceMode, showScore, allowComments, suppressGeneralInstructions, actorUserId);
  }

  async updateCoderTrainingLabel(workspaceId: number, trainingId: number, newLabel: string,
                                 actorUserId?: number): Promise<{ success: boolean; message: string }> {
    return this.mutation.updateCoderTrainingLabel(workspaceId, trainingId, newLabel, actorUserId);
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
    return this.query.getCodingJobsForTraining(workspaceId, trainingId);
  }

  async deleteCoderTraining(workspaceId: number, trainingId: number,
                            actorUserId?: number): Promise<{ success: boolean; message: string }> {
    return this.mutation.deleteCoderTraining(workspaceId, trainingId, actorUserId);
  }

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
    return this.kappa.transformToCoderPairs(comparisonData);
  }
}
