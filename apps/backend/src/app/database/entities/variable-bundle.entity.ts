import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable
} from 'typeorm';
import type { Variable } from './variable.entity';
import type { CodingJob } from './coding-job.entity';

@Entity('variable_bundle')
export class VariableBundle {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ name: 'workspace_id' })
    workspaceId: number;

  @Column()
    name: string;

  @Column({ nullable: true })
    description?: string;

  @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

  /**
   * Many-to-many relationship with variables (formerly variable bundles)
   */
  @ManyToMany('Variable', 'bundles')
  @JoinTable({
    name: 'variable_bundle_variables',
    joinColumn: {
      name: 'bundle_id',
      referencedColumnName: 'id'
    },
    inverseJoinColumn: {
      name: 'variable_id',
      referencedColumnName: 'id'
    }
  })
    variables: Variable[];

  /**
   * Many-to-many relationship with coding jobs
   * This is the inverse side of the relationship
   */
  @ManyToMany('CodingJob', 'variableBundles')
  @JoinTable({
    name: 'coding_job_variable_bundle',
    joinColumn: {
      name: 'variable_bundle_id',
      referencedColumnName: 'id'
    },
    inverseJoinColumn: {
      name: 'coding_job_id',
      referencedColumnName: 'id'
    }
  })
    codingJobs: CodingJob[];
}
