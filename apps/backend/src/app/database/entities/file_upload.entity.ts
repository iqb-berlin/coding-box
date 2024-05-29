import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
class FileUpload {
  @PrimaryColumn({ type: 'integer' })
    id: number;

  @Column({ type: 'varchar' })
  filename: string;

  @Column({ type: 'integer' })
    workspace_id: number;

  @Column({ type: 'integer' })
    file_size: string;

  @Column({ type: 'varchar' })
    file_type: string;

  @Column({ type: 'varchar' })
    file_id: string;

  @Column({ type: 'timestamp' })
    created_at: number;

  @Column({ type: 'varchar' })
    data: string;
}

export default FileUpload;
