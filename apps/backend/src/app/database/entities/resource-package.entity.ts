import {
  Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn
} from 'typeorm';
import Workspace from './workspace.entity';

@Entity()
class ResourcePackage {
  @Column({
    name: 'owner_workspace_id',
    type: 'integer',
    nullable: true,
    asExpression: 'CASE WHEN scope = \'workspace\' THEN "workspaceId" ELSE NULL END',
    generatedType: 'STORED',
    select: false,
    insert: false,
    update: false
  })
  ownerWorkspaceId: number | null;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_workspace_id' })
  workspace: Workspace | null;

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  workspaceId: number;

  @Column()
  name: string;

  @Column('text', { array: true })
  elements: string[];

  @Column({
    type: 'varchar',
    length: 30,
    name: 'package_type',
    default: 'resource'
  })
  packageType: 'resource' | 'geogebra';

  @Column({
    type: 'varchar',
    length: 20,
    default: 'workspace'
  })
  scope: 'workspace' | 'global';

  @Column({
    type: 'varchar',
    length: 100,
    name: 'detected_version',
    nullable: true
  })
  detectedVersion: string | null;

  @Column({
    type: 'varchar',
    length: 64,
    name: 'content_hash',
    nullable: true
  })
  contentHash: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'original_filename',
    nullable: true
  })
  originalFilename: string | null;

  @Column({
    type: 'bigint',
    name: 'package_size',
    default: 0
  })
  packageSize: number;

  @Column({
    type: 'timestamp with time zone',
    name: 'created_at'
  })
  createdAt: Date;
}

export default ResourcePackage;
