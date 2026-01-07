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

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
