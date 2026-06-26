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

export const NO_CODING_SCHEME_REF_NORMALIZED = '__NO_CODING_SCHEME_REF__';

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

  @Index()
  @Column({ type: 'varchar', nullable: true })
    file_id_normalized?: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
    coding_scheme_ref_normalized?: string | null;

  @Column({ type: 'timestamp' })
    created_at: number;

  @Column({ type: 'varchar' })
    data: string;

  @Column({ type: 'jsonb', nullable: true })
    structured_data: StructuredFileData;
}

export default FileUpload;
