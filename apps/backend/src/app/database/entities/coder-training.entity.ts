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
// eslint-disable-next-line import/no-cycle
import { CoderTrainingCoder } from './coder-training-coder.entity';
// eslint-disable-next-line import/no-cycle
import { CoderTrainingVariable } from './coder-training-variable.entity';
// eslint-disable-next-line import/no-cycle
import { CoderTrainingBundle } from './coder-training-bundle.entity';
import { CaseOrderingMode } from './job-definition.entity';

export type CaseSelectionMode =
  | 'oldest_first'
  | 'newest_first'
  | 'random'
  | 'random_per_testgroup'
  | 'random_testgroups';

export type ReferenceMode = 'same' | 'different';

/**
 * Entity for coder training sessions
 * A coder training contains multiple coding jobs for different coders
 */
@Entity({ name: 'coder_training' })
export class CoderTraining {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    workspace_id: number;

  @Column()
    label: string;

  @Column({
    type: 'enum',
    enum: ['continuous', 'alternating'],
    default: 'continuous'
  })
    case_ordering_mode: CaseOrderingMode;

  @Column({
    type: 'varchar',
    length: 30,
    default: 'oldest_first'
  })
    case_selection_mode: CaseSelectionMode;

  @Column({ type: 'jsonb', nullable: true })
    reference_training_ids: number[] | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
    reference_mode: ReferenceMode | null;

  @OneToMany(() => CodingJob, codingJob => codingJob.training, { cascade: true })
    codingJobs: CodingJob[];

  @OneToMany(() => CoderTrainingVariable, variable => variable.training, { cascade: true })
    variables: CoderTrainingVariable[];

  @OneToMany(() => CoderTrainingBundle, bundle => bundle.training, { cascade: true })
    bundles: CoderTrainingBundle[];

  @OneToMany(() => CoderTrainingCoder, coder => coder.training, { cascade: true })
    coders: CoderTrainingCoder[];

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
