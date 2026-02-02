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
