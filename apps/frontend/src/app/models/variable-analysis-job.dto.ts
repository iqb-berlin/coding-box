export interface VariableAnalysisJobDto {
  id: string; // Changed from number to string
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
  progress?: number;
  error?: string;
  created_at: Date;
  updated_at: Date;

  /**
   * Type of the job, used for inheritance discrimination
   */
  type?: string;
}
