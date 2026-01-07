import { ValidationTask } from '../../../workspaces/entities/validation-task.entity';

export class ValidationTaskDto {
  id: number;
  workspace_id: number;
  validation_type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'duplicateResponses';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  page?: number;
  limit?: number;
  created_at: Date;
  updated_at: Date;

  /**
   * Convert a ValidationTask entity to a ValidationTaskDto
   */
  static fromEntity(entity: ValidationTask): ValidationTaskDto {
    const dto = new ValidationTaskDto();
    dto.id = entity.id;
    dto.workspace_id = entity.workspace_id;
    dto.validation_type = entity.validation_type;
    dto.status = entity.status as 'pending' | 'processing' | 'completed' | 'failed';
    dto.progress = entity.progress;
    dto.error = entity.error;
    dto.page = entity.page;
    dto.limit = entity.limit;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;
    return dto;
  }
}
