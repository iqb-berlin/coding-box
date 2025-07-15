export interface VariableAnalysisJobDto {
  id: number;
  workspace_id: number;

  /**
   * Optional unit ID to filter by
   */
  unit_id?: number;

  /**
   * Optional variable ID to filter by
   */
  variable_id?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  created_at: Date;
  updated_at: Date;

  /**
   * Type of the job, used for inheritance discrimination
   */
  type?: string;
}
