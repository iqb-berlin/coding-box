import { VariableAnalysisOptions } from '../../../../../../../api-dto/coding/variable-analysis-options';

export interface VariableAnalysisJobInput extends VariableAnalysisOptions {
  id: string | number;
  workspaceId?: number;
  unitId?: number;
  variableId?: string;
  data?: VariableAnalysisOptions & {
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

export class VariableAnalysisJobDto implements VariableAnalysisOptions {
  analysisMode?: VariableAnalysisOptions['analysisMode'];
  codingVersion?: VariableAnalysisOptions['codingVersion'];
  id: string; // Changed from number to string to support Bull IDs
  workspace_id?: number;

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
    dto.created_at = new Date(job.timestamp ?? job.created_at ?? Date.now());
    dto.updated_at = new Date(job.finishedOn || Date.now());
    dto.type = 'variable-analysis';
    dto.analysisMode = job.analysisMode ?? job.data?.analysisMode ?? 'values';
    dto.codingVersion = dto.analysisMode === 'codes' ? job.codingVersion ?? job.data?.codingVersion ?? 'v1' : undefined;
    return dto;
  }
}
