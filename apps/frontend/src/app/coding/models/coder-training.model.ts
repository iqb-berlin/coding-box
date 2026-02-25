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
}
