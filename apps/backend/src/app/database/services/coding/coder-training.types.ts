import {
  TrainingComparisonFiltersDto,
  TrainingComparisonSortBy,
  TrainingComparisonSortDirection
} from '../../../../../../../api-dto/coding/training-comparison.dto';
import {
  KappaCalculationLevel,
  TrainingKappaStatisticsDto
} from '../../../../../../../api-dto/coding/training-kappa-statistics.dto';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { JobDefinitionVariable, JobDefinitionVariableBundle } from '../../entities/job-definition.entity';
import {
  IQB_STANDARD_MISSING_CODES,
  IQB_STANDARD_MISSING_SCORES,
  IqbStandardMissingId
} from './missings-profiles.service';

export interface CoderTrainingResponse {
  responseId: number;
  unitAlias: string;
  variableId: string;
  unitName: string;
  value: string | null;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
  variable: string;
  chunkTs?: number;
  unitId?: number;
}

export interface TrainingPackage {
  coderId: number;
  coderName: string;
  responses: CoderTrainingResponse[];
}

export interface TrainingJob {
  coderId: number;
  coderName: string;
  jobId: number;
  jobName: string;
}

export interface CoderTrainingWithJobs {
  id: number;
  workspace_id: number;
  label: string;
  created_at: Date;
  updated_at: Date;
  jobsCount: number;
  assigned_variables?: JobDefinitionVariable[];
  assigned_variable_bundles?: Array<Omit<JobDefinitionVariableBundle, 'caseOrderingMode'> & {
    caseOrderingMode?: 'continuous' | 'alternating' | null;
  }>;
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

export type TrainingVariableConfig = {
  variableId: string;
  unitId: string;
  sampleCount: number;
  includeDeriveError?: boolean;
};

export type TrainingBundleConfig = {
  id: number;
  name: string;
  sampleCount: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  variables: TrainingVariableConfig[];
};

export type DiscussionSource = 'manual' | 'auto_agreement' | null;

export type SaveDiscussionResultResponse = {
  success: boolean;
  code: number | null;
  score: number | null;
  notes: string | null;
  source: DiscussionSource;
  managerUserId: number | null;
  managerName: string | null;
};

export type WithinTrainingCoderResult = {
  jobId: number;
  coderName: string;
  code: string | null;
  score: number | null;
  notes: string | null;
  codingIssueOption: number | null;
};

export type DiscussionScoreFallback = {
  found: boolean;
  score: number | null;
};

export type TrainingResponseJobUnit = {
  job: Pick<CodingJob, 'id' | 'missings_profile_id'>;
  unit: CodingJobUnit;
};

export type WithinTrainingCodingRow = {
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

export type TrainingComparisonFreshnessAggregateRow = {
  unitCount: number | string | null;
  responseCount: number | string | null;
  latestUnitChange: Date | string | null;
};

export type TrainingDiscussionFreshnessAggregateRow = {
  discussionResultCount: number | string | null;
  latestDiscussionChange: Date | string | null;
};

export type TrainingComparisonResponseFreshnessRow = {
  responseId: number | string | null;
  responseHash: string | null;
};

export type TrainingComparisonStatus = 'match' | 'differ' | 'incomplete' | 'not_comparable';

export type TrainingComparisonCodeSlot = {
  code: string | null;
  hasEntry: boolean;
  trainingId?: number;
};

export type TrainingComparisonPageOptions = {
  page?: number;
  limit?: number;
  sortBy?: TrainingComparisonSortBy;
  sortDirection?: TrainingComparisonSortDirection;
  filters?: TrainingComparisonFiltersDto;
  selectedCoderKeys?: string[];
  selectedJobIds?: number[];
};

export type TrainingKappaCalculationLevel = KappaCalculationLevel;

export type TrainingCohensKappaStatistics = TrainingKappaStatisticsDto;

export type TrainingKappaOptions = {
  weightedMean?: boolean;
  level?: TrainingKappaCalculationLevel;
  selectedJobIds?: number[];
};

export type TrainingComparisonAggregateRow = {
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

export type TrainingComparisonCandidate = {
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

export type TrainingComparisonRawUnitRow = {
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

export type WithinTrainingKappaCaseRow = {
  responseId: number | string;
  unitName: string;
  variableId: string;
  validValueCount: number | string | null;
};

export type WithinTrainingKappaValueRow = {
  responseId: number | string;
  jobId: number | string;
  unitName: string;
  variableId: string;
  code: string | null;
  score: number | string | null;
};

export type WithinTrainingKappaCase = {
  responseId: number;
  unitName: string;
  variableId: string;
  validValueCount: number;
};

export type KappaCoderValue = {
  code: number | null;
  score: number | null;
};

export type TrainingFleissKappaByVariable = Map<string, {
  fleissKappa: number | null;
  completeCaseCount: number;
  possibleCaseCount: number;
}>;

export type TrainingKappaCoderPairInput = {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  unitName: string;
  variableId: string;
  codes: Array<{ code1: number | null; code2: number | null }>;
  scores: Array<{ score1: number | null; score2: number | null }>;
};

export type MissingCodePair = { mirCode: number; mciCode: number };

export type MissingCodeDisplayContext = MissingCodePair & {
  negativeCodes: Set<number>;
  scoresByCode: Map<number, number | null>;
};

export const DEFAULT_MISSING_CODE_CONTEXT: MissingCodeDisplayContext = {
  mirCode: IQB_STANDARD_MISSING_CODES.mir,
  mciCode: IQB_STANDARD_MISSING_CODES.mci,
  negativeCodes: new Set(Object.values(IQB_STANDARD_MISSING_CODES)),
  scoresByCode: new Map(
    (Object.entries(IQB_STANDARD_MISSING_SCORES) as Array<[IqbStandardMissingId, number | null]>)
      .map(([missingId, score]) => [IQB_STANDARD_MISSING_CODES[missingId], score])
  )
};
