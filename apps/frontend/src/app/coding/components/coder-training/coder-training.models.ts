import type { CoderTraining } from '../../models/coder-training.model';
import type { CoderTrainingFormValue } from './coder-training-form';

export interface VariableConfig {
  variableId: string;
  unitId: string;
  sampleCount: number;
  includeDeriveError?: boolean;
}

export const CODER_TRAINING_RECOVERY_KEY = 'coder-training-active-state';

export interface CoderTrainingRecoveryVariable {
  variableId: string;
  unitId: string;
  sampleCount: number;
  bundleId?: number;
  bundleName?: string;
  bundleCaseOrderingMode?: 'continuous' | 'alternating';
  includeDeriveError?: boolean;
}

export interface CoderTrainingRecoveryDraft {
  workspaceId?: number;
  mode: 'create' | 'edit';
  editTraining?: CoderTraining | null;
  formValue: CoderTrainingFormValue;
  selectedCoderIds: number[];
  selectedBundleIds: number[];
  manualVariableKeys: string[];
  variables: CoderTrainingRecoveryVariable[];
  variableFilter: string;
  bundleFilter: string;
}
