import {
  Column, Entity, Index, PrimaryColumn, Unique
} from 'typeorm';

export interface StructuredFileData {
  extractedInfo?: {
    [key: string]: unknown;
  };
  metadata?: {
    [key: string]: unknown;
  };
}

@Entity()
@Unique('file_upload_id', ['file_id', 'workspace_id'])
class FileUpload {
  @PrimaryColumn({ type: 'integer' })
    id: number;

  @Column({ type: 'varchar' })
    filename: string;

  @Index()
  @Column({ type: 'integer' })
    workspace_id: number;

  @Column({ type: 'integer' })
    file_size: number;

  @Index()
  @Column({ type: 'varchar' })
    file_type: string;

  @Column({ type: 'varchar' })
    file_id!: string;

  @Column({ type: 'timestamp' })
    created_at: number;

  @Column({ type: 'varchar' })
    data: string;

  @Column({ type: 'jsonb', nullable: true })
    structured_data: StructuredFileData;
}

export default FileUpload;
