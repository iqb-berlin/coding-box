import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { CoderTraining } from './coder-training.entity';
import { MissingsProfile } from './missings-profile.entity';
// eslint-disable-next-line import/no-cycle
import { CodingJobUnit } from './coding-job-unit.entity';
// eslint-disable-next-line import/no-cycle
import { CodingJobCoder } from './coding-job-coder.entity';

/**
 * Entity for coding jobs
 * A coding job is a collection of variables and variable bundles assigned to coders
 */
@Entity({ name: 'coding_job' })
export class CodingJob {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    workspace_id: number;

  @Column()
    name: string;

  @Column({ type: 'text', nullable: true })
    description?: string;

  /**
   * Status of the job: 'pending', 'active', 'paused', 'completed'
   */
  @Column({ default: 'pending' })
    status: string;

  @Column({ nullable: true })
    training_id?: number;

  @ManyToOne(() => CoderTraining, coderTraining => coderTraining.codingJobs)
  @JoinColumn({ name: 'training_id' })
    training?: CoderTraining;

  @Column({ name: 'missings_profile_id', nullable: true })
    missings_profile_id?: number;

  @ManyToOne(() => MissingsProfile)
  @JoinColumn({ name: 'missings_profile_id' })
    missingsProfile?: MissingsProfile;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;

  @OneToMany(() => CodingJobUnit, codingJobUnit => codingJobUnit.coding_job, { cascade: true })
    codingJobUnits: CodingJobUnit[];

  @OneToMany(() => CodingJobCoder, codingJobCoder => codingJobCoder.coding_job, { cascade: true })
    codingJobCoders: CodingJobCoder[];
}
