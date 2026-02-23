export interface VariableAnalysisJobInput {
  id: string | number;
  workspaceId?: number;
  unitId?: number;
  variableId?: string;
  data?: {
    workspaceId?: number;
    unitId?: number;
    variableId?: string;
  };
  status: string;
  progress?: number;
  error?: string;
  timestamp?: number;
  created_at?: number | Date;
  finishedOn?: number;
}

// import { VariableAnalysisJob } from '../../../database/entities/variable-analysis-job.entity';

export class VariableAnalysisJobDto {
  id: string; // Changed from number to string to support Bull IDs
  workspace_id: number;

  /**
   * Optional unit ID to filter by
   */
  unit_id?: number;

  /**
   * Optional variable ID to filter by
   */
  variable_id?: string;

  /**
   * Status of the job: 'pending', 'processing', 'completed', 'failed'
   */
  status: string;
  progress?: number;
  error?: string;
  created_at: Date;
  updated_at: Date;

  /**
   * Type of the job, used for inheritance discrimination
   */
  type?: string;

  /**
   * Static method to create a DTO from a plain object (e.g. from Bull job)
   */
  static fromJob(job: VariableAnalysisJobInput): VariableAnalysisJobDto {
    const dto = new VariableAnalysisJobDto();
    dto.id = job.id.toString();
    dto.workspace_id = job.workspaceId || (job.data && job.data.workspaceId);
    dto.unit_id = job.unitId || (job.data && job.data.unitId);
    dto.variable_id = job.variableId || (job.data && job.data.variableId);
    dto.status = job.status;
    dto.progress = job.progress;
    dto.error = job.error; // Bull job failedReason or similar
    dto.created_at = new Date(job.timestamp || job.created_at);
    dto.updated_at = new Date(job.finishedOn || Date.now());
    dto.type = 'variable-analysis';
    return dto;
  }
}
