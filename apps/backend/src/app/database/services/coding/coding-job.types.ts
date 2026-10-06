import { EntityManager } from 'typeorm';
import { ResponseMatchingFlag } from '../../../../../../../api-dto/coding/response-matching-flag';
import { CreateCodingJobDto } from '../../../admin/coding-job/dto/create-coding-job.dto';
import { JobDefinitionRefreshPreviewDto } from '../../../../../../../api-dto/coding/job-refresh.dto';
import { ManualCodingVariableReference } from '../../utils/manual-coding-candidate.util';
import { ReplayCodingBundleContextDto, ReplayCodingBundleVariableStatus, ReplayCodingSessionUnitDto } from '../../../../../../../api-dto/coding/replay-coding-session.dto';

export function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

export { ResponseMatchingFlag } from '../../../../../../../api-dto/coding/response-matching-flag';

export interface CodingSchemeCode {
  id: number | string;
  code?: string;
  label?: string;
  score?: number;
  manualInstruction?: string | null;
}

export interface SelectableReviewCode {
  code: number;
  label: string;
  score: number | null;
}

export interface CodingSchemeVariableCoding {
  id: string;
  alias?: string;
  codes?: CodingSchemeCode[];
}

export interface CodingScheme {
  variableCodings?: CodingSchemeVariableCoding[];
}

export interface JobCreationWarning {
  unitName: string;
  variableId: string;
  message: string;
  casesInJobs: number;
  availableCases: number;
}

export interface TransferCodingCasesResult {
  sourceCoderId: number;
  targetCoderId: number;
  affectedJobs: number;
  updatedAssignments: number;
  removedDuplicateAssignments: number;
  transferredCases: number;
}

export type VariableReference = ManualCodingVariableReference;

export type BundleItem = {
  id: number;
  name: string;
  caseOrderingMode?: 'continuous' | 'alternating';
  variables: VariableReference[];
};

export type DistributionItem = {
  type: 'bundle' | 'variable';
  item: BundleItem | VariableReference;
};

export type DistributionCoderInput = {
  id: number;
  name: string;
  username: string;
  weight?: number;
  capacityPercent?: number;
};

export type NormalizedDistributionCoder = {
  id: number;
  name: string;
  username: string;
  weight: number;
  displayKey: string;
  tieBreaker: number;
};

export type DistributionDoubleCodingInfo = {
  totalCases: number;
  distinctCases: number;
  codingTasksTotal: number;
  doubleCodedCases: number;
  singleCodedCasesAssigned: number;
  doubleCodedCasesPerCoder: Record<string, number>;
  doubleCodedCasesPerCoderId: Record<string, number>;
};

export type DistributionPlanRequest = {
  selectedVariables: VariableReference[];
  selectedVariableBundles?: BundleItem[];
  selectedCoders: DistributionCoderInput[];
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  maxCodingCases?: number | null;
  jobDefinitionId?: number;
  distributionSeed?: string | number;
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  missingsProfileId?: number;
};

export type DistributionVariableUsageRequest = {
  selectedVariables: VariableReference[];
  selectedVariableBundles?: BundleItem[];
  caseOrderingMode?: 'continuous' | 'alternating';
  maxCodingCases?: number | null;
  jobDefinitionId?: number;
  excludeJobDefinitionId?: number;
  distributionSeed?: string | number;
};

export type DistributionVariableUsageBatchRequest =
  DistributionVariableUsageRequest & {
    key: string | number;
  };

export type DistributionVariableUsageByStatus = {
  regular: number;
  deriveError: number;
  total: number;
};

export type DistributionVariableUsageCaseStatus = 'regular' | 'deriveError';

export type DeriveErrorManualCodingRequest = {
  selectedVariables?: ManualCodingVariableReference[];
  selectedVariableBundles?: Array<{
    variables?: ManualCodingVariableReference[];
  }>;
};

export type DistributionVariableUsageContext = {
  matchingFlags: ResponseMatchingFlag[];
  aggregationThreshold: number | null;
  derivedVariableSets: Map<string, Set<string>>;
  allResponses: SlimResponse[];
  assignedResponseIds: Set<number>;
  assignedResponseIdsByExcludedJobDefinitionId: Map<number, Set<number>>;
};

export type DistributionPlanItem = {
  type: 'bundle' | 'variable';
  item: BundleItem | VariableReference;
  itemKey: string;
  itemLabel: string;
  itemVariables: VariableReference[];
  itemCaseOrderingMode: 'continuous' | 'alternating';
  uniqueCases: number;
  totalResponses: number;
  availableCases: DistributionPlanCaseGroup[];
  caseStatusesByResponseId: Map<number, DistributionVariableUsageCaseStatus>;
  selectedCases: DistributionPlanCaseGroup[];
};

export type DistributionPlanCaseGroup = {
  caseKey: string;
  responses: SlimResponse[];
  representativeResponse: SlimResponse;
};

export type DistributionPlanCase = {
  item: DistributionPlanItem;
  response: SlimResponse;
  allocationCaseKey: string;
  isDoubleCoded: boolean;
  assignedCoderIds: number[];
};

export type DistributionPlanJob = {
  coder: NormalizedDistributionCoder;
  item: DistributionPlanItem;
  unitSubset: SlimResponse[];
};

export type DistributionPlan = {
  distribution: Record<string, Record<string, number>>;
  distributionByCoderId: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, DistributionDoubleCodingInfo>;
  aggregationInfo: Record<
  string,
  { uniqueCases: number; totalResponses: number }
  >;
  matchingFlags: ResponseMatchingFlag[];
  warnings: JobCreationWarning[];
  jobsToCreate: DistributionPlanJob[];
  plannedCases: DistributionPlanCase[];
  pairDistribution: Record<string, number>;
  tasksPerCoder: Record<string, number>;
  coderWeights: Record<string, number>;
};

export type JobDefinitionExistingTaskRow = {
  responseId: number;
  itemKey: string;
  coderId: number;
  taskCount: number;
};

export type DistributionCreatedJob = {
  itemKey: string;
  coderId: number;
  coderName: string;
  variable: { unitName: string; variableId: string };
  jobId: number;
  jobName: string;
  caseCount: number;
};

export type CodingJobBundleVariableStatus = ReplayCodingBundleVariableStatus;

export type CodingJobBundleContext = ReplayCodingBundleContextDto;

export type CodingJobBundleTarget = {
  login: string;
  code: string;
  person_group: string;
  booklet_name: string;
  unit_name: string;
  variable_id: string;
};

export type CodingJobNavigationUnit = ReplayCodingSessionUnitDto & {
  notes: string | null;
  isDoubleCoded: boolean;
  otherCoders: string[];
};

export type DistributedCodingJobsResult = {
  success: boolean;
  jobsCreated: number;
  message: string;
  distribution: Record<string, Record<string, number>>;
  distributionByCoderId: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, DistributionDoubleCodingInfo>;
  aggregationInfo: Record<
  string,
  { uniqueCases: number; totalResponses: number }
  >;
  matchingFlags: ResponseMatchingFlag[];
  warnings: JobCreationWarning[];
  pairDistribution: Record<string, number>;
  tasksPerCoder: Record<string, number>;
  coderWeights: Record<string, number>;
  jobs: DistributionCreatedJob[];
};

export type DistributedCodingJobsTransactionHook = (
  manager: EntityManager,
  result: DistributedCodingJobsResult
) => Promise<void>;

export type CodingJobListScope = 'all' | 'training' | 'productive';

export type CodingJobListSortBy =
  | 'name'
  | 'description'
  | 'status'
  | 'createdAt'
  | 'updatedAt';

export type CodingJobListSortDirection = 'asc' | 'desc';

export interface CodingJobIssueSummary {
  total: number;
  open: number;
  codeAssignmentUncertain: number;
  newCodeNeeded: number;
}

export interface CodingJobListFilters {
  scope?: CodingJobListScope;
  status?: string;
  excludeStatus?: string;
  coderId?: number;
  jobName?: string;
  trainingId?: number | 'none';
  includeIssueSummary?: boolean;
  sortBy?: CodingJobListSortBy;
  sortDirection?: CodingJobListSortDirection;
}

export type RefreshDistributedCodingJobsTransactionHook = (
  manager: EntityManager,
  result: JobDefinitionRefreshCodingJobsResult
) => Promise<void>;

export type JobDefinitionRefreshCodingJobsResult = DistributedCodingJobsResult & {
  preview: JobDefinitionRefreshPreviewDto;
};

export const DEFAULT_DISTRIBUTION_CODER_WEIGHT = 1;

export const MIN_DISTRIBUTION_CODER_CAPACITY_PERCENT = 10;

export const MAX_DISTRIBUTION_CODER_CAPACITY_PERCENT = 300;

export interface SlimResponse {
  id: number;
  variableid: string;
  value: string | null;
  statusV1?: number | null;
  statusV2?: number | null;
  unitName: string;
  unitAlias: string | null;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  variableBundleId?: number;
}

export interface DistributableResponses {
  filteredResponses: SlimResponse[];
  uniqueCases: number;
  totalResponses: number;
  caseStatusesByResponseId: Map<number, DistributionVariableUsageCaseStatus>;
}

export interface CodingJobCountRow {
  jobDefinitionId: number | string;
  jobsCount: number | string;
}

export const JOB_DEFINITION_DELETE_READY_STATUSES = ['results_applied', 'review'];

export type InternalCreateCodingJobDto = CreateCodingJobDto & {
  jobDefinitionId?: number;
};

export const UPDATABLE_CODING_JOB_STATUSES = new Set([
  'pending',
  'active',
  'paused',
  'open',
  'completed',
  'review'
]);

export interface CodingJobAggregationSettings {
  aggregationEnabled: boolean;
  aggregationThreshold: number | null;
  responseMatchingFlags: ResponseMatchingFlag[];
  aggregationSettingsVersion: number | null;
  fromJobSnapshot: boolean;
}
