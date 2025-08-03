import {
  Column,
  ChildEntity,
  JoinTable,
  ManyToMany
} from 'typeorm';
import { Job } from './job.entity';
import WorkspaceUser from './workspace_user.entity';
import { Variable } from './variable.entity';
import { VariableBundle } from './variable-bundle.entity';

@ChildEntity('coding-job')
export class CodingJob extends Job {
  @Column()
    name: string;

  @Column({ nullable: true })
    description?: string;

  /**
   * Many-to-many relationship with workspace users (coders)
   * This represents the coders assigned to this job
   */
  @ManyToMany(() => WorkspaceUser)
  @JoinTable({
    name: 'coding_job_coders',
    joinColumn: {
      name: 'coding_job_id',
      referencedColumnName: 'id'
    },
    inverseJoinColumn: {
      name: 'coder_id',
      referencedColumnName: 'userId'
    }
  })
    assignedCoders: WorkspaceUser[];

  /**
   * Many-to-many relationship with variables
   */
  @ManyToMany('Variable', 'codingJobs')
  @JoinTable({
    name: 'coding_job_variable',
    joinColumn: {
      name: 'coding_job_id',
      referencedColumnName: 'id'
    },
    inverseJoinColumn: {
      name: 'variable_id',
      referencedColumnName: 'id'
    }
  })
    variables: Variable[];

  /**
   * Many-to-many relationship with variable bundles
   */
  @ManyToMany('VariableBundle', 'codingJobs')
  @JoinTable({
    name: 'coding_job_variable_bundle',
    joinColumn: {
      name: 'coding_job_id',
      referencedColumnName: 'id'
    },
    inverseJoinColumn: {
      name: 'variable_bundle_id',
      referencedColumnName: 'id'
    }
  })
    variableBundles: VariableBundle[];
}
