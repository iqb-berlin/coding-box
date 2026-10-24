import {
  JoinColumn, ManyToOne, Column, Entity, PrimaryColumn
} from 'typeorm';
import Workspace from './workspace.entity';

@Entity()
class WorkspaceUser {
  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace?: Workspace;

  @PrimaryColumn({
    name: 'workspace_id'
  })
  workspaceId!: number;

  @PrimaryColumn({
    name: 'user_id'
  })
  userId!: number;

  @Column({
    name: 'access_level'
  })
  accessLevel!: number;

  @Column({
    name: 'can_code',
    type: 'boolean',
    default: false
  })
  canCode!: boolean;
}

export default WorkspaceUser;
