import { CodingJobFormValue } from './coding-job-definition-form';
import {
  CodingJob, DistributionVariableUsageByStatus, JobDefinitionCoderConfig, Variable, VariableBundle
} from '../../models/coding-job.model';

export interface CodingJobDefinitionDialogData {
  codingJob?: CodingJob;
  isEdit: boolean;
  mode: 'definition' | 'job';
  jobDefinitionId?: number;
  preloadedVariables?: Variable[];
  readOnly?: boolean;
  createdJobsCount?: number;
}

export interface JobDefinition {
  creatorUserId?: number | null;
  id?: number;
  name?: string;
  description?: string | null;
  status?: 'draft' | 'pending_review' | 'approved';
  assignedVariables?: Variable[];
  assignedVariableBundles?: VariableBundle[];
  assignedCoders?: number[];
  assignedCoderConfigs?: JobDefinitionCoderConfig[];
  missingsProfileId?: number | null;
  distributionSeed?: string;
  plannedVariableUsage?: Record<string, number>;
  plannedVariableUsageByStatus?: Record<string, DistributionVariableUsageByStatus>;
  durationSeconds?: number;
  maxCodingCases?: number | null;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  createdJobsCount?: number;
  created_at?: Date;
  updated_at?: Date;
}

export const CODING_JOB_DEFINITION_RECOVERY_KEY = 'coding-job-definition-active-state';

export interface CodingJobDefinitionRecoveryVariable {
  unitName: string;
  variableId: string;
  includeDeriveError?: boolean;
}

export interface CodingJobDefinitionRecoveryBundle {
  id: number;
  name: string;
  caseOrderingMode?: 'continuous' | 'alternating';
  variables: CodingJobDefinitionRecoveryVariable[];
}

export interface CodingJobDefinitionRecoveryDraft {
  workspaceId?: number;
  mode: 'definition';
  isEdit: boolean;
  jobDefinitionId?: number;
  codingJob?: CodingJob;
  readOnly?: boolean;
  createdJobsCount?: number;
  formValue: Partial<CodingJobFormValue>;
  doubleCodingMode: 'absolute' | 'percentage';
  selectedVariables: CodingJobDefinitionRecoveryVariable[];
  selectedVariableBundles: CodingJobDefinitionRecoveryBundle[];
  selectedCoderConfigs: JobDefinitionCoderConfig[];
  unitNameFilter: string;
  variableIdFilter: string;
  bundleNameFilter: string;
  availabilityFilter: 'all' | 'full' | 'partial' | 'none';
  trainingRequiredFilter: 'all' | 'true' | 'false';
  distributionSeed?: string;
}

export interface CreationResults {
  doubleCodingInfo: Record<string, {
    totalCases: number;
    distinctCases?: number;
    codingTasksTotal?: number;
    doubleCodedCases: number;
    singleCodedCasesAssigned: number;
    doubleCodedCasesPerCoder: Record<string, number>;
  }>;
  distributionByCoderId?: Record<string, Record<string, number>>;
  jobs: {
    itemKey?: string;
    coderId: number;
    coderName: string;
    variable: { unitName: string; variableId: string };
    jobId: number;
    jobName: string;
    caseCount: number;
  }[];
}
