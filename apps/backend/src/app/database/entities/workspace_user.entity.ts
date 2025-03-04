import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
class WorkspaceUser {
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
}

export default WorkspaceUser;
