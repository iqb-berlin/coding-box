import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { CodingJob } from './coding-job.entity';

export type JobDefinitionStatus = 'draft' | 'pending_review' | 'approved';

export interface JobDefinitionVariable {
  unitName: string;
  variableId: string;
}

export interface JobDefinitionVariableBundle {
  id: number;
  name: string;
}

@Entity({ name: 'job_definitions' })
export class JobDefinition {
  @PrimaryGeneratedColumn()
    id: number;

  @OneToMany(() => CodingJob, codingJob => codingJob.jobDefinition, { cascade: false })
    codingJobs: CodingJob[];

  @Column({
    type: 'enum',
    enum: [
      'draft',
      'pending_review',
      'approved'
    ],
    default: 'draft'
  })
    status: JobDefinitionStatus;

  @Column({ type: 'jsonb', nullable: true })
    assigned_variables?: JobDefinitionVariable[];

  @Column({ type: 'jsonb', nullable: true })
    assigned_variable_bundles?: JobDefinitionVariableBundle[];

  @Column({ type: 'jsonb', nullable: true })
    assigned_coders?: number[];

  @Column({ type: 'int', nullable: true })
    duration_seconds?: number;

  @Column({ type: 'int', nullable: true })
    max_coding_cases?: number;

  @Column({ type: 'int', nullable: true })
    double_coding_absolute?: number;

  @Column({
    type: 'decimal', precision: 5, scale: 2, nullable: true
  })
    double_coding_percentage?: number;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
