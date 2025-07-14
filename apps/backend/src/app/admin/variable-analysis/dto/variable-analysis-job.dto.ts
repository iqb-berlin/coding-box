import { VariableAnalysisJob } from '../../../database/entities/variable-analysis-job.entity';

export class VariableAnalysisJobDto {
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

  /**
   * Status of the job: 'pending', 'processing', 'completed', 'failed'
   */
  status: string;
  error?: string;
  created_at: Date;
  updated_at: Date;

  /**
   * Static method to create a DTO from an entity
   */
  static fromEntity(entity: VariableAnalysisJob): VariableAnalysisJobDto {
    const dto = new VariableAnalysisJobDto();
    dto.id = entity.id;
    dto.workspace_id = entity.workspace_id;
    dto.unit_id = entity.unit_id;
    dto.variable_id = entity.variable_id;
    dto.status = entity.status;
    dto.error = entity.error;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;
    return dto;
  }
}
