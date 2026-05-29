import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';
import { CodingJobFreshnessStatus } from '../../../../../../api-dto/coding/job-refresh.dto';
import { CoderTraining } from './coder-training.model';

export interface CodingJob {
  id: number;
  workspace_id: number;
  name: string;
  description?: string;
  comment?: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  assignedCoders: number[];
  assignedCoderConfigs?: JobDefinitionCoderConfig[];
  distributionSeed?: string;
  plannedVariableUsage?: Record<string, number>;
  assignedVariables?: Variable[];
  assignedVariableBundles?: VariableBundle[];
  variables?: Variable[];
  variableBundles?: VariableBundle[];
  variableBundleIds?: number[];
  progress?: number;
  codedUnits?: number;
  totalUnits?: number;
  openUnits?: number;
  missings_profile_id?: number;
  missings_profile?: MissingsProfilesDto;
  training_id?: number;
  training?: CoderTraining;
  durationSeconds?: number;
  maxCodingCases?: number;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  jobDefinitionId?: number;
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  hasIssues?: boolean;
  aggregationEnabled?: boolean;
  aggregationThreshold?: number | null;
  responseMatchingFlags?: string[] | null;
  aggregationSettingsVersion?: number | null;
  freshnessStatus?: CodingJobFreshnessStatus;
  freshnessReason?: string | null;
  freshnessUpdatedAt?: Date | string | null;
  freshnessAffectedUnits?: number;
  freshnessAffectedResponses?: number;
}

export interface JobDefinitionCoderConfig {
  coderId: number;
  capacityPercent: number;
}

export interface Variable {
  unitName: string;
  variableId: string;
  responseCount?: number;
  casesInJobs?: number;
  availableCases?: number;
  uniqueCasesAfterAggregation?: number;
  isDerived?: boolean;
  coderTrainingRequired?: boolean;
  includeDeriveError?: boolean;
}

export interface VariableBundle {
  id: number;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  variables: Variable[];
  caseOrderingMode?: 'continuous' | 'alternating';
}
