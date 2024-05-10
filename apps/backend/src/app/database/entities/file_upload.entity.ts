import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
class FileUpload {
  @PrimaryColumn({
    name: 'filename'
  })
    filename: string;

  @Column({ type: 'integer' })
    workspace_id: number;

  @Column({ type: 'varchar' })
    data: string;
}

export default FileUpload;
