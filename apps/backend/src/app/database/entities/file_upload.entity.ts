import {
  Column, Entity, Index, PrimaryColumn, Unique
} from 'typeorm';

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
}

export default FileUpload;
