import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';
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
  jobDefinitionId?: number;
}

export interface Variable {
  unitName: string;
  variableId: string;
  responseCount?: number;
}

export interface VariableBundle {
  id: number;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  variables: Variable[];
}
