export type CaseSelectionMode =
  | 'oldest_first'
  | 'newest_first'
  | 'random'
  | 'random_per_testgroup'
  | 'random_testgroups';

export type ReferenceMode = 'same' | 'different';

export interface CoderTraining {
  id: number;
  workspace_id: number;
  label: string;
  created_at: Date;
  updated_at: Date;
  jobsCount: number;
  assigned_variables?: { unitName: string; variableId: string; sampleCount: number }[];
  assigned_variable_bundles?: { id: number; name: string; sampleCount?: number; caseOrderingMode?: 'continuous' | 'alternating' }[];
  assigned_coders?: number[];
  case_ordering_mode?: 'continuous' | 'alternating';
  case_selection_mode?: CaseSelectionMode;
  reference_training_ids?: number[];
  reference_mode?: ReferenceMode | null;
}
