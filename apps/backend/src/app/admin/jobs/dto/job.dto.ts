import { Job } from '../../../database/entities/job.entity';

export class JobDto {
  id: number;
  workspace_id: number;
  type: string;
  status: string;
  progress?: number;
  error?: string;
  result?: string;
  created_at: Date;
  updated_at: Date;

  /**
   * Static method to create a DTO from an entity
   */
  static fromEntity(entity: Job): JobDto {
    const dto = new JobDto();
    dto.id = entity.id;
    dto.workspace_id = entity.workspace_id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dto.type = (entity as any).type; // Type is added by TypeORM for inheritance
    dto.status = entity.status;
    dto.progress = entity.progress;
    dto.error = entity.error;
    dto.result = entity.result;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;
    return dto;
  }
}
